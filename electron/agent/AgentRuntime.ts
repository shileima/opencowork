import Anthropic from '@anthropic-ai/sdk';
import { BrowserWindow } from 'electron';

import { FileSystemTools, ReadFileSchema, WriteFileSchema, ListDirSchema, RunCommandSchema, OpenBrowserPreviewSchema, ValidatePageSchema } from './tools/FileSystemTools';
import { ErrorDetector, DetectedError } from './tools/ErrorDetector';
import { ErrorFixer } from './tools/ErrorFixer';
import { SkillManager } from './skills/SkillManager';
import { MCPClientService } from './mcp/MCPClientService';
import { permissionManager } from './security/PermissionManager';
import { configStore } from '../config/ConfigStore';
import { directoryManager } from '../config/DirectoryManager';
import { projectStore } from '../config/ProjectStore';
import { sessionStore } from '../config/SessionStore';
import { setCurrentTaskIdForContextSwitch } from '../contextSwitchCoordinator';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// Safe commands that can be auto-approved in standard/trust modes
const SAFE_COMMANDS = [
    'python', 'python3', 'node', 'npm', 'pip', 'pip3', 'git', 'ls', 'cat', 'head', 'tail',
    'grep', 'find', 'echo', 'pwd', 'cd', 'ls -la', 'ls -l', 'ls -a', 'tree', 'wc', 'sort',
    'uniq', 'diff', 'patch', 'tar', 'unzip', 'zip', 'gzip', 'gunzip', 'bunzip2',
    'curl', 'wget', 'ping', 'traceroute', 'netstat', 'ps', 'top', 'htop'
];

// Dangerous patterns that always require confirmation
const DANGEROUS_PATTERNS = [
    /rm\s+-rf\s+/i, /rm\s+-r\s+/i, /del\s+\/s\s+\/q/i, /rd\s+\/s\s+\/q/i,
    /format\s+/i, /mkfs/i, /dd\s+if=/i, /shred/i,
    />\s*\/?dev\/(null|sda|sdb)/i, /2>\s*&1\s*>\s*\/dev\/null/i,
    /chmod\s+777/i, /chmod\s+-R\s+777/i, /chown\s+-R/i
];

/**
 * 检查命令是否为自动化脚本相关命令
 */
function isAutomationScriptCommand(command: string): boolean {
    const cmd = command.trim().toLowerCase();
    // 检查是否包含 node 执行 .js 文件，或者包含 chrome-agent、自动化等关键词
    const automationKeywords = [
        'chrome-agent',
        'automation',
        '自动化',
        'ui自动化',
        'ui测试',
        'browser automation',
        'web automation'
    ];
    
    // 检查是否执行 .js 文件
    const jsFilePattern = /node\s+.*\.js|\.js\s*$/;
    
    // 检查是否在 chrome-agent 目录下执行
    const chromeAgentPathPattern = /chrome-agent/;
    
    return jsFilePattern.test(cmd) && 
           (chromeAgentPathPattern.test(cmd) || automationKeywords.some(keyword => cmd.includes(keyword)));
}

/**
 * 验证自动化脚本是否符合规范
 */
function validateAutomationScript(command: string, cwd: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    try {
        // 提取脚本文件路径
        const scriptPathMatch = command.match(/node\s+["']?([^"'\s]+\.js)["']?/i) || 
                               command.match(/([^\s]+\.js)/);
        
        if (!scriptPathMatch) {
            // 如果不是直接执行脚本文件，可能是通过其他方式，跳过检查
            return { valid: true, errors: [] };
        }
        
        let scriptPath = scriptPathMatch[1];
        
        // 如果是相对路径，转换为绝对路径
        if (!path.isAbsolute(scriptPath)) {
            scriptPath = path.resolve(cwd, scriptPath);
        }
        
        // 规范化路径
        scriptPath = path.normalize(scriptPath);
        
        // 获取标准脚本目录
        const scriptsDir = directoryManager.getScriptsDir();
        const normalizedScriptsDir = path.normalize(scriptsDir);
        
        // 检查1: 文件是否在正确的目录下
        if (!scriptPath.startsWith(normalizedScriptsDir)) {
            errors.push(`脚本文件不在正确的目录下\n  当前路径: ${scriptPath}\n  应该位于: ${scriptsDir}`);
        }
        
        // 检查2: 文件扩展名是否为 .js
        if (!scriptPath.toLowerCase().endsWith('.js')) {
            errors.push(`文件扩展名必须为 .js\n  当前文件: ${scriptPath}`);
        }
        
        // 检查3: 文件是否存在
        if (!fs.existsSync(scriptPath)) {
            errors.push(`脚本文件不存在\n  路径: ${scriptPath}`);
        } else {
            // 检查4: 文件是否有读取权限
            try {
                fs.accessSync(scriptPath, fs.constants.R_OK);
            } catch {
                errors.push(`脚本文件没有读取权限\n  路径: ${scriptPath}`);
            }
            
            // 检查5: 脚本内容是否使用了禁止的自动化框架
            try {
                const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
                const forbiddenFrameworks = checkForbiddenFrameworks(scriptContent);
                if (forbiddenFrameworks.length > 0) {
                    errors.push(`脚本使用了禁止的自动化框架：${forbiddenFrameworks.join(', ')}\n  只允许使用 Playwright 进行浏览器自动化\n  请移除 Selenium 或 Puppeteer 相关代码，改用 Playwright`);
                }
            } catch (readError) {
                // 如果无法读取文件内容，记录警告但不阻止（可能权限问题）
                console.warn(`[AgentRuntime] Could not read script content for validation: ${readError instanceof Error ? readError.message : String(readError)}`);
            }
        }
        
    } catch (error) {
        errors.push(`验证脚本时出错: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * 检查脚本内容是否使用了禁止的自动化框架（Selenium 或 Puppeteer）
 */
function checkForbiddenFrameworks(scriptContent: string): string[] {
    const forbidden: string[] = [];
    const content = scriptContent.toLowerCase();
    
    // 检查 Selenium 相关导入和使用
    const seleniumPatterns = [
        /require\s*\(\s*['"]selenium-webdriver['"]/,
        /require\s*\(\s*['"]webdriverio['"]/,
        /from\s+['"]selenium['"]/,
        /from\s+['"]selenium\.webdriver['"]/,
        /import\s+.*from\s+['"]selenium['"]/,
        /import\s+.*from\s+['"]selenium\.webdriver['"]/,
        /selenium-webdriver/,
        /webdriverio/,
        /\.getDriver\(\)/,
        /new\s+webdriver\./,
        /Builder\(\)/,
        /\.findElement\(/,
        /\.findElements\(/
    ];
    
    // 检查 Puppeteer 相关导入和使用（只检查包名和特定 API，不检查通用方法）
    // 注意：Playwright 和 Puppeteer 的 API 很相似，所以主要依赖包名检测
    const puppeteerPackagePatterns = [
        /require\s*\(\s*['"]puppeteer['"]/,
        /require\s*\(\s*['"]puppeteer-core['"]/,
        /from\s+['"]puppeteer['"]/,
        /from\s+['"]puppeteer-core['"]/,
        /import\s+.*from\s+['"]puppeteer['"]/,
        /import\s+.*from\s+['"]puppeteer-core['"]/,
    ];
    
    // Puppeteer 特有的 API 调用（这些是 Playwright 没有的）
    const puppeteerSpecificPatterns = [
        /puppeteer\.launch\(/,
        /puppeteer-core\.launch\(/,
        /const\s+puppeteer\s*=/,
        /let\s+puppeteer\s*=/,
        /var\s+puppeteer\s*=/
    ];
    
    // 检查是否使用了 Selenium
    const hasSelenium = seleniumPatterns.some(pattern => pattern.test(content));
    if (hasSelenium) {
        forbidden.push('Selenium');
    }
    
    // 检查是否使用了 Puppeteer（但要排除 Playwright）
    // 如果脚本中同时包含 playwright，则可能是误判，跳过检查
    const hasPlaywright = content.includes('playwright') || content.includes('@playwright');
    const hasPuppeteerPackage = puppeteerPackagePatterns.some(pattern => pattern.test(content));
    const hasPuppeteerSpecific = puppeteerSpecificPatterns.some(pattern => pattern.test(content));
    
    // 只有当明确检测到 Puppeteer 包名或特定 API，且没有 Playwright 时才标记为禁止
    if ((hasPuppeteerPackage || hasPuppeteerSpecific) && !hasPlaywright) {
        forbidden.push('Puppeteer');
    }
    
    return forbidden;
}

// Check if a command is considered safe
function isSafeCommand(command: string): boolean {
    const trimmedCmd = command.trim();
    const baseCmd = trimmedCmd.split(' ')[0].toLowerCase();

    // Check if base command is in safe list
    if (SAFE_COMMANDS.some(safe => baseCmd === safe || trimmedCmd.startsWith(safe + ' '))) {
        return true;
    }

    // Check for dangerous patterns
    if (DANGEROUS_PATTERNS.some(pattern => pattern.test(trimmedCmd))) {
        return false;
    }

    // Read-only git commands are safe
    if (/^git\s+(log|show|diff|status|branch|remote|ls-files)/i.test(trimmedCmd)) {
        return true;
    }

    // Python/node with script files are generally safe
    if ((baseCmd === 'python' || baseCmd === 'python3' || baseCmd === 'node') &&
        (trimmedCmd.endsWith('.py') || trimmedCmd.endsWith('.js') || trimmedCmd.endsWith('.ts'))) {
        return true;
    }

    return false;
}



export type AgentMessage = {
    role: 'user' | 'assistant';
    content: string | Anthropic.ContentBlock[];
    id?: string;
};

export class AgentRuntime {
    private anthropic: Anthropic;
    private history: Anthropic.MessageParam[] = [];
    private windows: BrowserWindow[] = [];
    private fsTools: FileSystemTools;
    private skillManager: SkillManager;
    private mcpService: MCPClientService;
    private abortController: AbortController | null = null;
    private isProcessing = false;
    private pendingConfirmations: Map<string, { resolve: (approved: boolean) => void }> = new Map();
    private artifacts: { path: string; name: string; type: string }[] = [];

    private model: string;
    private maxTokens: number;
    private lastProcessTime: number = 0;
    private userWantsCloseBrowser: boolean = false; // 用户是否要求关闭浏览器
    
    // 支持并发任务：每个任务有独立的处理状态
    private activeTasks: Map<string, {
        abortController: AbortController;
        startTime: number;
        history: Anthropic.MessageParam[];
    }> = new Map();

    constructor(apiKey: string, window: BrowserWindow, model: string = 'claude-3-5-sonnet-20241022', apiUrl: string = 'https://api.anthropic.com', maxTokens: number = 131072) {
        this.anthropic = new Anthropic({ apiKey, baseURL: apiUrl });
        this.model = model;
        this.maxTokens = maxTokens;
        this.windows = [window];
        this.fsTools = new FileSystemTools();
        this.skillManager = new SkillManager();
        this.mcpService = MCPClientService.getInstance();
        // Note: IPC handlers are now registered in main.ts, not here
    }

    // Add a window to receive updates (for floating ball)
    public addWindow(win: BrowserWindow) {
        if (!this.windows.includes(win)) {
            this.windows.push(win);
        }
    }

    public async initialize() {
        console.log('Initializing AgentRuntime...');
        try {
            // Parallelize loading for faster startup
            await Promise.all([
                this.skillManager.loadSkills(),
                this.mcpService.loadClients()
            ]);
            console.log('AgentRuntime initialized (Skills & MCP loaded)');
        } catch (error) {
            console.error('Failed to initialize AgentRuntime:', error);
        }
    }

    // Hot-Swap Configuration without reloading context
    public updateConfig(model: string, apiUrl?: string, apiKey?: string, maxTokens?: number) {
        if (this.model === model && !apiUrl && !apiKey && maxTokens === undefined) return;

        this.model = model;
        if (maxTokens !== undefined) {
            this.maxTokens = maxTokens;
        }
        // Re-create Anthropic client if credentials change
        if (apiUrl || apiKey) {
            this.anthropic = new Anthropic({
                apiKey: apiKey || this.anthropic.apiKey,
                baseURL: apiUrl || this.anthropic.baseURL
            });
        }
        console.log(`[Agent] Hot-Swap: Model updated to ${model}, maxTokens: ${this.maxTokens}`);
    }

    public removeWindow(win: BrowserWindow) {
        this.windows = this.windows.filter(w => w !== win);
    }

    /**
     * 检测用户输入中是否包含"关闭浏览器"的意图
     */
    private detectCloseBrowserIntent(userInput: string): boolean {
        if (!userInput) return false;
        
        const closeKeywords = [
            '关闭浏览器',
            '关闭窗口',
            '关闭页面',
            'close browser',
            'close window',
            'close page',
            'browser.close',
            'context.close',
            'page.close',
            '退出浏览器',
            '退出窗口',
            'shut down browser',
            'quit browser'
        ];
        
        const inputLower = userInput.toLowerCase();
        return closeKeywords.some(keyword => inputLower.includes(keyword.toLowerCase()));
    }

    // Handle confirmation response
    public handleConfirmResponse(id: string, approved: boolean) {
        const pending = this.pendingConfirmations.get(id);
        if (pending) {
            pending.resolve(approved);
            this.pendingConfirmations.delete(id);
        }
    }

    // Clear history for new session
    public clearHistory() {
        this.history = [];
        this.artifacts = [];
        this.notifyUpdate();
    }

    // Load history from saved session
    public loadHistory(messages: Anthropic.MessageParam[]) {
        this.history = messages;
        this.artifacts = [];
        this.notifyUpdate();
    }

    public async processUserMessage(input: string | { content: string, images: string[] }, taskId?: string, projectId?: string, isFloatingBall?: boolean) {
        // 如果提供了 taskId，使用任务级别的并发控制；否则使用全局控制（向后兼容）
        const useTaskLevelConcurrency = taskId !== undefined;
        const restoreRef = { originalHistory: this.history };
        
        if (useTaskLevelConcurrency) {
            // 任务级别并发：检查该任务是否已在处理中
            if (this.activeTasks.has(taskId)) {
                const task = this.activeTasks.get(taskId)!;
                // 如果任务超过60秒未更新，自动重置
                if (Date.now() - task.startTime > 60000) {
                    console.warn(`[AgentRuntime] Task ${taskId} stale (60s+). Auto-resetting.`);
                    this.activeTasks.delete(taskId);
                } else {
                    throw new Error(`Task ${taskId} is already processing`);
                }
            }
            
            // 创建任务上下文
            const abortController = new AbortController();
            const taskHistory: Anthropic.MessageParam[] = [];
            this.activeTasks.set(taskId, {
                abortController,
                startTime: Date.now(),
                history: taskHistory
            });
            
            // 保存全局状态（用于恢复）
            const originalAbortController = this.abortController;
            restoreRef.originalHistory = this.history;
            const originalIsProcessing = this.isProcessing;

            // 使用任务级别的状态（每个任务有独立的上下文）
            this.abortController = abortController;
            this.history = taskHistory;
            this.isProcessing = true;

            let effectiveTaskIdForDone = taskId;
            try {
                const result = await this.processMessageWithContext(input, taskId, projectId, isFloatingBall, restoreRef);
                if (result?.effectiveTaskId) {
                    effectiveTaskIdForDone = result.effectiveTaskId;
                }
            } catch (error) {
                // 即使出错也要确保状态恢复和任务清理
                console.error(`[AgentRuntime] Task ${taskId} error:`, error);
                throw error; // 重新抛出，让外层处理
            } finally {
                // 确保状态恢复和任务清理（无论成功还是失败）
                this.history = restoreRef.originalHistory;
                this.isProcessing = originalIsProcessing;
                this.abortController = originalAbortController;
                this.activeTasks.delete(taskId);
                // 只有在有历史记录时才通知更新（避免空更新）
                if (taskHistory.length > 0) {
                    this.notifyUpdate();
                }
                this.broadcast('agent:done', { timestamp: Date.now(), taskId: effectiveTaskIdForDone, projectId });
            }
        } else {
            // 全局并发控制（向后兼容）：保持原有逻辑
            if (this.isProcessing) {
                if (Date.now() - this.lastProcessTime > 60000) {
                    console.warn('[AgentRuntime] Detected stale processing state (60s+). Auto-resetting.');
                    this.isProcessing = false;
                    this.abortController = null;
                } else {
                    throw new Error('Agent is already processing a message');
                }
            }

            this.lastProcessTime = Date.now();
            this.isProcessing = true;
            this.abortController = new AbortController();
            
            try {
                await this.processMessageWithContext(input, undefined, undefined, isFloatingBall, restoreRef);
            } finally {
                this.isProcessing = false;
                this.abortController = null;
                this.notifyUpdate();
                this.broadcast('agent:done', { timestamp: Date.now() });
            }
        }
    }
    
    /**
     * @returns effectiveTaskId 若发生上下文切换创建了新任务，返回新任务 ID，供 agent:done 使用
     */
    private async processMessageWithContext(
        input: string | { content: string, images: string[] },
        taskId?: string,
        projectId?: string,
        isFloatingBall?: boolean,
        restoreRef?: { originalHistory: Anthropic.MessageParam[] }
    ): Promise<{ effectiveTaskId?: string } | void> {
        
        // 重置浏览器关闭意图检测（每次新消息时重置）
        this.userWantsCloseBrowser = false;

        try {
            await this.skillManager.loadSkills();
            await this.mcpService.loadClients();

            let userContent: string | Anthropic.ContentBlockParam[] = '';

            if (typeof input === 'string') {
                userContent = input;
            } else {
                const blocks: Anthropic.ContentBlockParam[] = [];
                // Process images
                if (input.images && input.images.length > 0) {
                    for (const img of input.images) {
                        // format: data:image/png;base64,......
                        const match = img.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
                        if (match) {
                            blocks.push({
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                                    data: match[2]
                                }
                            });
                        }
                    }
                }
                // Add text
                if (input.content && input.content.trim()) {
                    blocks.push({ type: 'text', text: input.content });
                } else if (blocks.some(b => b.type === 'image')) {
                    // [Fix] If only images are present, add a default prompt to satisfy API requirements
                    blocks.push({ type: 'text', text: "Please analyze this image." });
                }
                userContent = blocks;
            }

            // 检测用户输入中是否包含"关闭浏览器"的意图（用于 chrome-agent 脚本）
            const userInputText = typeof userContent === 'string' ? userContent : 
                (Array.isArray(userContent) ? userContent.filter(b => b.type === 'text').map(b => (b as any).text).join(' ') : '');
            this.userWantsCloseBrowser = this.detectCloseBrowserIntent(userInputText);
            
            // Add user message to history
            this.history.push({ role: 'user', content: userContent });
            this.notifyUpdate();

            // Start the agent loop
            await this.runLoop(taskId);

        } catch (error: unknown) {
            const err = error as { status?: number; statusCode?: number; message?: string; error?: { message?: string; type?: string } };
            console.error('Agent Loop Error:', error);

            // 检查是否有成功的工具执行（特别是脚本执行）
            const hasSuccessfulScriptExecution = this.history.some(msg => {
                if (msg.role === 'user' && Array.isArray(msg.content)) {
                    return msg.content.some((block: any) => {
                        if (block.type === 'tool_result') {
                            const result = typeof block.content === 'string' ? block.content : '';
                            // 检查是否是脚本执行成功的结果（包含成功标识或没有错误信息）
                            return result.includes('chrome-agent') || 
                                   result.includes('自动化') ||
                                   (result.length > 0 && !result.toLowerCase().includes('error') && !result.toLowerCase().includes('失败'));
                        }
                        return false;
                    });
                }
                return false;
            });

            // 若脚本已执行成功且非可重试错误，则仅友好提示不弹窗；否则由下方逻辑处理
            if (hasSuccessfulScriptExecution && (err.status === 400 || err.status === 429 || err.status === 500 || err.status === 503) && !this.isRetryableContextError(err, error)) {
                console.warn(`[AgentRuntime] Script execution succeeded, but subsequent AI call failed (${err.status}). This is non-critical.`);
                const friendlyMessage: Anthropic.MessageParam = {
                    role: 'assistant',
                    content: `✅ 脚本执行已完成。\n\n注意：后续的 AI 响应处理遇到了问题（状态码 ${err.status}），但这不影响脚本的执行结果。`
                };
                this.history.push(friendlyMessage);
                this.notifyUpdate();
                this.broadcast('agent:done', { timestamp: Date.now(), taskId: taskId || undefined, projectId });
                return;
            }

            // 上下文超限/可重试错误：自动创建新任务（新会话）并继续执行
            if (this.isRetryableContextError(err, error)) {
                try {
                    const lastUserMsg = this.history.length > 0 ? this.history[this.history.length - 1] : null;
                    const lastUserInput = lastUserMsg && lastUserMsg.role === 'user'
                        ? this.extractTextFromMessage(lastUserMsg)
                        : typeof input === 'string' ? input : (input?.content ?? '');
                    const condensed = this.buildCondensedContext(this.history, lastUserInput);

                    const newSession = sessionStore.createSession('上下文切换继续');
                    sessionStore.setSessionId(newSession.id, isFloatingBall ?? false);

                    let effectiveTaskId = taskId;
                    if (taskId && projectId) {
                        // 将旧任务标记为 failed（400 错误），后续不再展示
                        projectStore.updateTask(projectId, taskId, { status: 'failed' });
                        // Project 模式：新建任务（如点击 + 新任务），关联新 session
                        const newTask = projectStore.createTask(projectId, '上下文切换继续', newSession.id);
                        if (newTask) {
                            effectiveTaskId = newTask.id;
                            setCurrentTaskIdForContextSwitch(newTask.id);
                            this.broadcast('project:task:updated', { projectId, taskId, updates: { status: 'failed' } });
                            this.broadcast('project:task:created', newTask);
                            this.broadcast('project:task:updated', { projectId, taskId: newTask.id, updates: { sessionId: newSession.id } });
                        } else {
                            projectStore.updateTask(projectId, taskId, { sessionId: newSession.id });
                            this.broadcast('project:task:updated', { projectId, taskId, updates: { sessionId: newSession.id } });
                        }
                    }

                    this.history = condensed;
                    if (restoreRef) {
                        restoreRef.originalHistory = condensed;
                    }
                    sessionStore.updateSession(newSession.id, condensed);
                    this.notifyUpdate();
                    this.broadcast('agent:context-switched', { newSessionId: newSession.id, newTaskId: effectiveTaskId, taskId: effectiveTaskId, projectId });

                    await this.runLoop(effectiveTaskId);
                    return { effectiveTaskId };
                } catch (retryError) {
                    console.error('[AgentRuntime] Context switch retry failed:', retryError);
                    throw error;
                }
            }

            // [Fix] Handle MiniMax/provider sensitive content errors gracefully
            const errorTaskId = taskId || undefined;
            const errorPayload = (msg: string) => ({ message: msg, taskId: errorTaskId, projectId });
            if (err.status === 500 && (err.message?.includes('sensitive') || JSON.stringify(error).includes('1027'))) {
                this.broadcast('agent:error', errorPayload('AI Provider Error: The generated content was flagged as sensitive and blocked by the provider.'));
            } else if (err.error?.type === 'invalid_request_error' && err.error?.message?.includes('tools[')) {
                this.broadcast('agent:error', errorPayload(`配置错误: MCP 工具名称格式不正确\n\n详细信息: ${err.error.message}\n\n这通常是因为 MCP 服务器返回的工具名称包含了特殊字符（如中文）。请尝试：\n1. 禁用有问题的 MCP 服务器\n2. 或联系开发者修复此问题\n\n错误代码: ${err.status || 400}`));
            } else if (err.status === 400) {
                const details = err.error?.message || err.message || 'Unknown error';
                this.broadcast('agent:error', errorPayload(`请求错误 (400): ${details}\n\n请检查：\n- API Key 是否正确\n- API 地址是否有效\n- 模型名称是否正确`));
            } else if (err.status === 401) {
                this.broadcast('agent:error', errorPayload('认证失败 (401): API Key 无效或已过期\n\n请检查您的 API Key 配置。'));
            } else if (err.status === 429) {
                this.broadcast('agent:error', errorPayload('请求过多 (429): API 调用频率超限\n\n请稍后再试或升级您的 API 套餐。'));
            } else if (err.status === 500) {
                this.broadcast('agent:error', errorPayload(`服务器错误 (500): AI 服务提供商出现问题\n\n${err.message || '请稍后再试。'}`));
            } else if (err.status === 503) {
                this.broadcast('agent:error', errorPayload('服务不可用 (503): AI 服务暂时无法访问\n\n请稍后再试或检查服务状态。'));
            } else {
                const errorMsg = err.message || err.error?.message || 'An unknown error occurred';
                const statusInfo = err.status ? `[${err.status}] ` : '';
                this.broadcast('agent:error', errorPayload(`${statusInfo}${errorMsg}`));
            }
        }
    }

    private isRetryableContextError(err: { status?: number; statusCode?: number; message?: string; error?: { message?: string } }, rawError?: unknown): boolean {
        const status = err.status ?? err.statusCode;
        // 400: 上下文超限或上游/代理返回的 bad response，均可尝试切换新会话重试
        if (status === 400) {
            const msg = (err.message || err.error?.message || '').toLowerCase();
            const rawStr = rawError ? JSON.stringify(rawError).toLowerCase() : '';
            return (
                /context|exceed|input length|token/.test(msg) ||
                /context|exceed|input length|token/.test(rawStr) ||
                /bad response status code|provider_response_error|upstream_error/.test(msg) ||
                /bad response status code|provider_response_error|upstream_error/.test(rawStr)
            );
        }
        return status === 429 || status === 500 || status === 503;
    }

    private extractTextFromMessage(msg: Anthropic.MessageParam): string {
        const content = msg.content;
        if (typeof content === 'string') {
            return content;
        }
        if (Array.isArray(content)) {
            const texts: string[] = [];
            for (const block of content) {
                const b = block as { type?: string; text?: string };
                if (b.type === 'text' && b.text) {
                    texts.push(b.text);
                }
            }
            return texts.join(' ');
        }
        return '';
    }

    private buildCondensedContext(history: Anthropic.MessageParam[], lastUserInput: string): Anthropic.MessageParam[] {
        const older = history.slice(0, -1);
        if (older.length === 0) {
            return [{ role: 'user', content: lastUserInput }];
        }

        const bullets: string[] = [];
        for (const msg of older) {
            const text = this.extractTextFromMessage(msg);
            if (text.trim()) {
                bullets.push(text.slice(0, 80) + (text.length > 80 ? '...' : ''));
            }
        }

        const summary = bullets.length > 0
            ? `[上一轮对话因上下文过长已自动切换]\n\n简要摘要：\n${bullets.join('\n')}\n\n---\n用户最新请求：\n`
            : `[继续执行] 用户最新请求：\n`;

        return [{ role: 'user', content: summary + lastUserInput }];
    }

    private async runLoop(_taskId?: string) {
        let keepGoing = true;
        let iterationCount = 0;
        const MAX_ITERATIONS = 30;

        while (keepGoing && iterationCount < MAX_ITERATIONS) {
            iterationCount++;
            console.log(`[AgentRuntime] Loop iteration: ${iterationCount}`);
            if (this.abortController?.signal.aborted) break;

            const tools: Anthropic.Tool[] = [
                ReadFileSchema,
                WriteFileSchema,
                ListDirSchema,
                RunCommandSchema,
                OpenBrowserPreviewSchema,
                ValidatePageSchema,
                ...(this.skillManager.getTools() as Anthropic.Tool[]),
                ...(await this.mcpService.getTools() as Anthropic.Tool[])
            ];

            // Build working directory context (Project 模式下 Primary = 当前已选项目路径)
            const authorizedFolders = permissionManager.getAuthorizedFolders();
            const currentProject = projectStore.getCurrentProject();
            const projectContext = currentProject 
                ? `\n\nCURRENT PROJECT:\n- Project Name: "${currentProject.name}"\n- Project Path: ${currentProject.path}\n\n⚠️ CRITICAL: You are working INSIDE an existing project. When the user asks to create code, a website, or an application, you MUST create files directly in the current project directory (${currentProject.path}), NOT create a new project directory. Only create a NEW project if the user explicitly asks to "create a new project" or "新建项目".`
                : '';
            const workingDirContext = authorizedFolders.length > 0
                ? `${projectContext}\n\nWORKING DIRECTORY:\n- Primary (current selected project): ${authorizedFolders[0]}\n- All authorized: ${authorizedFolders.join(', ')}\n\nYou MUST primarily work within the Primary directory. When user does NOT specify a project (e.g. start/stop service), use ONLY the Primary. Always use absolute paths.`
                : '\n\nNote: No working directory has been selected yet. Ask the user to select a folder first.';

            const skillsDir = os.homedir() + '/.qa-cowork/skills';
            const systemPrompt = `
# OpenCowork Assistant System

## Role Definition
You are OpenCowork, an advanced AI desktop assistant designed for efficient task execution, file management, coding assistance, and research. You operate in a secure local environment with controlled access to user-selected directories and specialized tools.

## Core Behavioral Principles

### Communication Style
- **Direct & Professional**: Be concise and purposeful. Avoid unnecessary pleasantries.
- **Execution-Focused**: Prioritize completing tasks efficiently over extensive discussion.
- **Proactive**: Verify tool availability before relying on them.

### Response Format
- Use Markdown for all structured content
- Prefer clear prose over bullet points for narrative content
- Use bullet points only for lists, summaries, or when explicitly requested

## Task Execution Guidelines

### Planning & Execution
**Internal Process (Not Visible to User):**
- Mentally break down complex requests into clear, actionable steps
- Identify required tools, dependencies, and potential obstacles
- Plan the most efficient execution path before starting

**External Output:**
- Start directly with execution or brief acknowledgment
- Provide natural progress updates during execution
- Focus on completed work, not planning intentions
- Use professional, results-oriented language

### File Management
- **Primary Workspace**: User-authorized directories (your main deliverable location)
- **Temporary Workspace**: System temp directories for intermediate processing
- **Security**: Never access files outside authorized directories without explicit permission

### Project Creation & Default Technology Stack
When creating new projects or generating code, if the user does NOT specify a technology stack, use the following **default stack**:
- **Framework**: React 18+ with TypeScript
- **Build Tool**: Vite (latest version)
- **Package Manager**: pnpm (use \`pnpm\` commands, not npm or yarn)
- **Styling**: TailwindCSS 3.4+ for utility-first CSS
- **UI Component Library**: Ant Design (antd) - use for professional, polished UI components
- **UI/UX Best Practices**: 
  - Use Ant Design components for consistent, professional UI
  - Follow modern UI/UX principles: clean layouts, proper spacing, intuitive interactions
  - Ensure responsive design and accessibility
  - Use TailwindCSS for custom styling and theming
  - Create visually appealing and well-organized interfaces

**CRITICAL - Project Location Constraint**:
- **If CURRENT PROJECT EXISTS**: You are working INSIDE an existing project (created from template). When the user asks to create code, a website, or an application, create files DIRECTLY in the current project directory. Use \`write_file\` to create files in the current project path.
- **If NO CURRENT PROJECT** or **User explicitly asks for NEW project**: ALL new projects MUST be created in: \`~/Library/Application Support/qacowork/projects\` (use \`$HOME\` environment variable in shell commands). Projects are created from template by OpenCowork—do NOT run \`pnpm create vite\`.
- **ALWAYS use absolute paths**: When running commands in a project, use the full absolute path: \`$HOME/Library/Application Support/qacowork/projects/<project-name>\`
- **NEVER create projects elsewhere**: Do NOT create projects in the current working directory, home directory, or any other location. The specified directory is MANDATORY.
- **Check react-project-builder skill**: For detailed project creation instructions, refer to the react-project-builder skill.

**CRITICAL - Code Generation Requirements**:
- **You MUST use tools to generate code**: When the user asks to create a project, website, or application, you MUST use the \`write_file\` tool to create actual code files. Do NOT just describe what you will do—actually create the files.
- **Template-based workflow**: When user creates a NEW project via OpenCowork, the project is ALREADY initialized from a template (React + Vite + TailwindCSS + Ant Design). Do NOT run \`pnpm create vite\`. The template already has all config files.
- **Execution Steps**:
  - **If CURRENT PROJECT EXISTS** (including newly created projects with template): Generate business code directly using \`write_file\` (e.g., \`src/App.tsx\`, \`src/components/*\`). Then run \`pnpm install\` and \`pnpm dev\` in the project directory. Do NOT run \`pnpm create vite\`.
  - **If creating NEW project**: The project directory was already created and populated from template. Generate only the business logic files (e.g., \`src/App.tsx\`, \`src/components/*\`). Run \`pnpm install\` and \`pnpm dev\` in the project directory.
- **No Text-Only Responses**: If the user asks to create something, your response MUST include tool calls. A text-only response without tool calls is NOT acceptable for project creation tasks.

**Important**: 
- Always use \`pnpm\` as the package manager (e.g., \`pnpm install\`, \`pnpm dev\`)
- Do NOT run \`pnpm create vite\`—projects are created from template
- Template already includes Ant Design, TailwindCSS, PostCSS
- Use Ant Design components for forms, tables, buttons, modals, etc.
- Combine Ant Design with TailwindCSS for custom styling needs
- Ensure the project structure is clean and follows best practices

**When to deviate**: Only use a different stack if the user explicitly specifies it (e.g., "use Next.js", "use Vue", "use npm instead of pnpm").

### Tool Usage Protocol
1. **Skills First**: Before any task, check for relevant skills in \`${skillsDir}\`
2. **MCP Integration**: Leverage available MCP servers for enhanced capabilities
3. **Tool Prefixes**: MCP tools use namespace prefixes (e.g., \`tool_name__action\`)

### Development Server & Browser Preview
When starting or stopping a dev server, **always use the Primary Working Directory** (current selected project). Do NOT look in other directories (e.g. ~/.qa-cowork) for projects—use the Primary path directly.
When you start a local development server (e.g., \`npm run dev\`, \`pnpm dev\`, \`yarn dev\`), follow these steps:

1. **Start the dev server** using \`run_command\`
2. **Open browser preview** using \`open_browser_preview\` with the preview URL (usually http://localhost:3000)
3. **CRITICAL - Validate the page**: ~~After opening browser preview, **IMMEDIATELY call \`validate_page\`** with the preview URL to check for errors. This is MANDATORY and cannot be skipped.~~ (Temporarily disabled to avoid false positives)
4. **Auto-heal if errors found**: ~~If \`validate_page\` reports ANY errors:~~ (Temporarily disabled)
   - **Parse the error message** to identify the exact issue:
     - If you see "Failed to resolve import" or "@ant-design/icons" or similar: This means a dependency is missing
     - Extract the package name from the error (e.g., "@ant-design/icons" from "Failed to resolve import '@ant-design/icons'")
     - If you see "require is not defined": This means code is using Node.js \`require()\` syntax in browser context. Fix by:
       1. Find the file causing the error (check error stack trace for file path)
       2. Replace \`require()\` with ES6 \`import\` statements
       3. For example: \`const something = require('module')\` → \`import something from 'module'\`
       4. For default exports: \`const module = require('module')\` → \`import module from 'module'\`
       5. For named exports: \`const { func } = require('module')\` → \`import { func } from 'module'\`
   - **Automatically fix the issue**:
     - **If missing dependency**: Install it IMMEDIATELY using \`run_command\` (e.g., \`pnpm add @ant-design/icons\`). Do NOT skip this step.
     - **If "require is not defined"**: Read the file mentioned in the error, convert all \`require()\` to \`import\` statements, and write the fixed code using \`write_file\`
     - If import error: Fix the import statement in the code file using \`write_file\`
     - If syntax error: Fix the code using \`write_file\`
   - **Restart the dev server**: Stop the current server (kill process on port 3000) and start it again using \`run_command\`
   - **Re-validate**: ~~Call \`validate_page\` again with the same URL to check if the error is fixed~~ (Temporarily disabled)
   - **Repeat until success**: ~~Continue fixing and restarting until \`validate_page\` returns "✅ Page validation successful"~~ (Temporarily disabled)
   - **DO NOT give up**: Keep trying until validation succeeds. Missing dependencies and require/import issues are common and easy to fix.
5. **Only mark as done when validation succeeds**: ~~Do NOT mark the task as complete, do NOT say "服务器正常运行" (server is running normally), and do NOT say "成功创建" (successfully created) until \`validate_page\` explicitly returns "✅ Page validation successful". If you see ANY error in validate_page response, you MUST fix it.~~ (Temporarily disabled - validation check removed)

**Development servers are always started on port 3000** (Vite, CRA, Next.js, etc.). Use **http://localhost:3000** for open_browser_preview and validate_page.

### Preview Server (构建后预览)
When the user asks to **start the preview server** (启动预览服务器), **view the built application** (查看构建后的应用), or **deploy locally** (本地部署):
1. **Ensure build exists**: Run \`pnpm build\` first if dist/ may not exist.
2. **Start preview server** using \`run_command\` with \`pnpm preview\` (or \`vite preview\`).
3. **Open browser preview** using \`open_browser_preview\` with **http://localhost:4173** (Vite preview default port).
The preview server runs on **port 4173** and serves the built output from dist/. Use it to verify the production build locally.

### Closing/Stopping Local Services (CRITICAL)
When the user asks to close/stop a service **without specifying which one** (e.g. "关闭服务", "关闭本地服务", "stop the server"):
- **Scope**: ONLY consider services running from the **current project** (Primary Working Directory above). That is the user's selected project.
- **NEVER include** the OpenCowork application's own Vite dev server. Its app directory is: \`${process.env.APP_ROOT || process.cwd()}\`. Exclude any process whose cwd or command path is under this directory.
- **Action**: When listing processes (e.g. \`lsof -i :PORT\`, \`ps aux | grep node\`), filter out processes belonging to the OpenCowork app. Then close/stop only the remaining processes (the user's project). Do NOT ask "which one?"—assume the user means the current project's service.

### Browser Automation Guidelines (chrome-agent scripts)
When executing Playwright automation scripts:
- **Default Behavior**: Keep the browser open after script completion unless the user explicitly requests to close it
- **Browser Closing**: Only call \`browser.close()\`, \`context.close()\`, or \`page.close()\` if:
  - The user's message explicitly contains keywords like "关闭浏览器", "close browser", "关闭窗口", etc.
  - The user explicitly requests to close the browser in their instructions
- **User Intent Detection**: If the user's input does NOT contain any closing intent, preserve the browser state for:
  - Result verification
  - Continued manual interaction
  - Debugging purposes
- **Current User Intent**: ${this.userWantsCloseBrowser ? 'User HAS requested to close the browser - you may close it after script completion.' : 'User has NOT requested to close the browser - KEEP the browser open after script execution.'}
- **Exception**: If the script explicitly requires closing (e.g., cleanup scripts), follow the script's logic, but prefer keeping it open when in doubt

## Current Context
**Working Directory**: ${workingDirContext}
**Skills Directory**: \`${skillsDir}\`

**Available Skills**:
${this.skillManager.getSkillMetadata().map(s => `- ${s.name}: ${s.description}`).join('\n')}

**Active MCP Servers**: ${JSON.stringify(this.mcpService.getActiveServers())}

---
Remember: Plan internally, execute visibly. Focus on results, not process.`;

            console.log('Sending request to API...');
            console.log('Model:', this.model);
            console.log('Base URL:', this.anthropic.baseURL);

            try {
                // Pass abort signal to the API for true interruption
                const stream: any = await this.anthropic.messages.create({
                    model: this.model,
                    max_tokens: this.maxTokens,
                    system: systemPrompt,
                    messages: this.history,
                    stream: true,
                    tools: tools
                } as any, {
                    signal: this.abortController?.signal
                });

                const finalContent: Anthropic.ContentBlock[] = [];
                let currentToolUse: { id: string; name: string; input: string } | null = null;
                let textBuffer = "";

                for await (const chunk of stream) {
                    if (this.abortController?.signal.aborted) {
                        stream.controller.abort();
                        break;
                    }

                    switch (chunk.type) {
                        case 'content_block_start':
                            if (chunk.content_block.type === 'tool_use') {
                                if (textBuffer) {
                                    finalContent.push({ type: 'text', text: textBuffer, citations: null });
                                    textBuffer = "";
                                }
                                currentToolUse = { ...chunk.content_block, input: "" };
                            }
                            break;
                        case 'content_block_delta':
                            if (chunk.delta.type === 'text_delta') {
                                textBuffer += chunk.delta.text;
                                // Broadcast streaming token to ALL windows
                                this.broadcast('agent:stream-token', chunk.delta.text);
                            } else if ((chunk.delta as any).type === 'reasoning_content' || (chunk.delta as any).reasoning) {
                                // Support for native "Thinking" models (DeepSeek/compatible args)
                                const reasoningObj = chunk.delta as any;
                                const text = reasoningObj.text || reasoningObj.reasoning || ""; // Adapt to provider
                                this.broadcast('agent:stream-thinking', text);
                            } else if (chunk.delta.type === 'input_json_delta' && currentToolUse) {
                                currentToolUse.input += chunk.delta.partial_json;
                            }
                            break;
                        case 'content_block_stop':
                            if (currentToolUse) {
                                try {
                                    const parsedInput = JSON.parse(currentToolUse.input);
                                    finalContent.push({
                                        type: 'tool_use',
                                        id: currentToolUse.id,
                                        name: currentToolUse.name,
                                        input: parsedInput
                                    });
                                } catch (e) {
                                    console.error("Failed to parse tool input", e);
                                    // Treat as a failed tool use so the model knows it messed up
                                    finalContent.push({
                                        type: 'tool_use',
                                        id: currentToolUse.id,
                                        name: currentToolUse.name,
                                        input: { error: "Invalid JSON input", raw: currentToolUse.input }
                                    });
                                }
                                currentToolUse = null;
                            } else if (textBuffer) {
                                // [Fix] Flush text buffer on block stop
                                finalContent.push({ type: 'text', text: textBuffer, citations: null });
                                textBuffer = "";
                            }
                            break;
                        case 'message_stop':
                            if (textBuffer) {
                                finalContent.push({ type: 'text', text: textBuffer, citations: null });
                                textBuffer = "";
                            }
                            break;
                    }
                }

                // If aborted, save any partial content that was generated
                if (this.abortController?.signal.aborted) {
                    if (textBuffer) {
                        finalContent.push({ type: 'text', text: textBuffer + '\n\n[已中断]', citations: null });
                    }
                    if (finalContent.length > 0) {
                        const assistantMsg: Anthropic.MessageParam = { role: 'assistant', content: finalContent };
                        this.history.push(assistantMsg);
                        this.notifyUpdate();
                    }
                    return; // Stop execution completely
                }

                // [Fix] Ensure any remaining buffer is captured (in case message_stop didn't fire)
                if (textBuffer) {
                    finalContent.push({ type: 'text', text: textBuffer, citations: null });
                }

                if (finalContent.length > 0) {
                    const assistantMsg: Anthropic.MessageParam = { role: 'assistant', content: finalContent };
                    this.history.push(assistantMsg);
                    this.notifyUpdate();

                    const toolUses = finalContent.filter(c => c.type === 'tool_use');
                    if (toolUses.length > 0) {
                        const toolResults: Anthropic.ToolResultBlockParam[] = [];
                        for (const toolUse of toolUses) {
                            // Check abort before each tool execution
                            if (this.abortController?.signal.aborted) {
                                console.log('[AgentRuntime] Aborted before tool execution');
                                return;
                            }

                            if (toolUse.type !== 'tool_use') continue;

                            console.log(`Executing tool: ${toolUse.name}`);
                            let result = "Tool execution failed or unknown tool.";

                            try {
                                if (toolUse.name === 'read_file') {
                                    const args = toolUse.input as { path: string };
                                    if (!permissionManager.isPathAuthorized(args.path)) {
                                        result = `Error: Path ${args.path} is not in an authorized folder.`;
                                    } else {
                                        result = await this.fsTools.readFile(args);
                                    }
                                } else if (toolUse.name === 'write_file') {
                                    const args = toolUse.input as { path: string, content: string };
                                    if (!permissionManager.isPathAuthorized(args.path)) {
                                        result = `Error: Path ${args.path} is not in an authorized folder.`;
                                    } else {
                                        // 如果路径在已授权的文件夹中，直接写入，无需确认（定制化：简化写入流程）
                                        result = await this.fsTools.writeFile(args);
                                        const fileName = args.path.split(/[\\/]/).pop() || 'file';
                                        this.artifacts.push({ path: args.path, name: fileName, type: 'file' });
                                        this.broadcast('agent:artifact-created', { path: args.path, name: fileName, type: 'file' });
                                    }
                                } else if (toolUse.name === 'list_dir') {
                                    const args = toolUse.input as { path: string };
                                    if (!permissionManager.isPathAuthorized(args.path)) {
                                        result = `Error: Path ${args.path} is not in an authorized folder.`;
                                    } else {
                                        result = await this.fsTools.listDir(args);
                                    }
                                } else if (toolUse.name === 'run_command') {
                                    const args = toolUse.input as { command: string, cwd?: string };
                                    const defaultCwd = authorizedFolders[0] || process.cwd();

                                    // 检查是否为自动化脚本相关命令
                                    const isAutomationScript = isAutomationScriptCommand(args.command);
                                    if (isAutomationScript) {
                                        // 检查命令中是否包含禁止的框架安装
                                        const cmdLower = args.command.toLowerCase();
                                        if (cmdLower.includes('npm install') || cmdLower.includes('npm i') || cmdLower.includes('yarn add')) {
                                            if (cmdLower.includes('selenium') || cmdLower.includes('webdriverio') || cmdLower.includes('puppeteer')) {
                                                result = `❌ 禁止安装 Selenium 或 Puppeteer 相关包\n\n自动化脚本只能使用 Playwright 进行浏览器自动化\n\n✅ 正确做法：\n  npm install playwright\n  npx playwright install\n\n❌ 禁止的做法：\n  npm install selenium-webdriver\n  npm install puppeteer\n  npm install webdriverio`;
                                                return;
                                            }
                                        }
                                        
                                        // 验证自动化脚本规范
                                        const validationResult = validateAutomationScript(args.command, args.cwd || defaultCwd);
                                        if (!validationResult.valid) {
                                            result = `❌ 自动化脚本规范检查失败：\n\n${validationResult.errors.map((e: string) => `• ${e}`).join('\n')}\n\n请确保：\n✅ 脚本文件在 ~/.qa-cowork/skills/chrome-agent/ 目录下\n✅ 文件扩展名为 .js\n✅ 文件有读取权限\n✅ 只使用 Playwright 进行浏览器自动化（禁止使用 Selenium 和 Puppeteer）\n✅ 在自动化脚本列表中点击刷新按钮或等待自动刷新`;
                                            return;
                                        }
                                    }

                                    // Determine trust level from the working directory
                                    const trustLevel = args.cwd
                                        ? configStore.getFileTrustLevel(args.cwd)
                                        : configStore.getFileTrustLevel(defaultCwd);

                                    // Check if command is dangerous (always requires confirmation)
                                    const isDangerous = DANGEROUS_PATTERNS.some(pattern => pattern.test(args.command.trim()));
                                    if (isDangerous) {
                                        // Dangerous commands always need confirmation
                                        const approved = await this.requestConfirmation(toolUse.name, `Execute command: ${args.command}`, args);
                                        if (approved) {
                                            result = await this.fsTools.runCommand(args, defaultCwd);
                                        } else {
                                            result = 'User denied the command execution.';
                                        }
                                        return;
                                    }

                                    // Check if command is safe
                                    const isSafe = isSafeCommand(args.command);

                                    let approved = false;

                                    if (trustLevel === 'trust') {
                                        // Trust mode: auto-approve safe commands
                                        approved = true;
                                    } else if (trustLevel === 'standard') {
                                        // Standard mode: auto-approve safe commands
                                        approved = isSafe;
                                        if (!approved) {
                                            approved = await this.requestConfirmation(toolUse.name, `Execute command: ${args.command}`, args);
                                        }
                                    } else {
                                        // Strict mode: always confirm
                                        approved = await this.requestConfirmation(toolUse.name, `Execute command: ${args.command}`, args);
                                    }

                                    if (approved) {
                                        result = await this.fsTools.runCommand(args, defaultCwd);
                                        // 开发服务器启动后自动打开内置浏览器并导航到预览地址
                                        if (result.includes('[Dev server started in background]')) {
                                            const urlMatch = result.match(/Preview URL:\s*(https?:\/\/\S+)/);
                                            const previewUrl = urlMatch?.[1]?.trim() || 'http://localhost:3000';
                                            this.broadcast('agent:open-browser-preview', previewUrl);
                                            
                                            // 自动错误检测和修复循环
                                            const workingDir = args.cwd || defaultCwd;
                                            await this.autoFixErrors(workingDir, previewUrl, 5);
                                        }
                                    } else {
                                        result = 'User denied the command execution.';
                                    }
                                } else if (toolUse.name === 'open_browser_preview') {
                                    const args = toolUse.input as { url: string };
                                    let url = (args?.url || '').trim();
                                    if (!url) {
                                        result = 'Error: url is required. Example: http://localhost:3000';
                                    } else {
                                        if (!/^https?:\/\//i.test(url)) {
                                            url = `http://${url}`;
                                        }
                                        this.broadcast('agent:open-browser-preview', url);
                                        result = `Opened browser preview tab with URL: ${url}`;
                                    }
                                } else if (toolUse.name === 'validate_page') {
                                    const args = toolUse.input as { url: string; timeout?: number };
                                    result = await this.fsTools.validatePage(args);
                                } else {
                                    const skillInfo = this.skillManager.getSkillInfo(toolUse.name);
                                    console.log(`[Runtime] Skill ${toolUse.name} info found? ${!!skillInfo} (len: ${skillInfo?.instructions?.length})`);
                                    if (skillInfo) {
                                        // Return skill content following official Claude Code Skills pattern
                                        // The model should create scripts and run them from the skill directory
                                        result = `[SKILL LOADED: ${toolUse.name}]

SKILL DIRECTORY: ${skillInfo.skillDir}

Follow these instructions to complete the user's request. When the instructions reference Python modules in core/, create your script in the working directory and run it from the skill directory:

run_command: cd "${skillInfo.skillDir}" && python /path/to/your_script.py

Or add to the top of your script:
import sys; sys.path.insert(0, r"${skillInfo.skillDir}")

---
${skillInfo.instructions}
---`;
                                    } else if (toolUse.name.includes('__')) {
                                        result = await this.mcpService.callTool(toolUse.name, toolUse.input as Record<string, unknown>);
                                    } else if (toolUse.name.startsWith('mcp_')) {
                                        // Handle MCP Management Skill Tools
                                        const args = toolUse.input as any;
                                        if (toolUse.name === 'mcp_get_all_servers') {
                                            result = JSON.stringify(await this.mcpService.getAllServers(), null, 2);
                                        } else if (toolUse.name === 'mcp_add_server') {
                                            result = JSON.stringify(await this.mcpService.addServer(args.json_config), null, 2);
                                        } else if (toolUse.name === 'mcp_remove_server') {
                                            result = JSON.stringify(await this.mcpService.removeServer(args.name), null, 2);
                                        } else if (toolUse.name === 'mcp_toggle_server') {
                                            result = JSON.stringify(await this.mcpService.toggleServer(args.name, args.enabled), null, 2);
                                        } else if (toolUse.name === 'mcp_diagnose_server') {
                                            const status = (await this.mcpService.getAllServers()).find(s => s.name === args.name);
                                            if (status) {
                                                result = JSON.stringify(await this.mcpService.diagnoseServer(args.name, status.config), null, 2);
                                            } else {
                                                result = JSON.stringify({ success: false, message: "Server not found" });
                                            }
                                        } else if (toolUse.name === 'mcp_retry_connection') {
                                            // Force reconnect
                                            const status = (await this.mcpService.getAllServers()).find(s => s.name === args.name);
                                            if (status) {
                                                await this.mcpService['connectToServer'](status.name, status.config);
                                                result = `Retry initiated for ${args.name}`;
                                            } else {
                                                result = `Server ${args.name} not found`;
                                            }
                                        }
                                    }
                                }
                                // Check if input has parse error
                                const inputObj = toolUse.input as Record<string, unknown>;
                                if (inputObj && inputObj.error === "Invalid JSON input") {
                                    // Provide simpler error, just raw info
                                    result = `Error: The tool input was not valid JSON. Please fix the JSON format and retry. Raw input length: ${(inputObj.raw as string)?.length || 0}`;
                                }
                            } catch (toolErr: unknown) {
                                result = `Error executing tool: ${(toolErr as Error).message}`;
                            }

                            toolResults.push({
                                type: 'tool_result',
                                tool_use_id: toolUse.id,
                                content: result
                            });
                        }

                        this.history.push({ role: 'user', content: toolResults });
                        this.notifyUpdate();
                    } else {
                        // 如果没有工具调用，检查是否是项目创建/代码生成任务
                        // 如果是，应该继续循环让AI有机会调用工具
                        // 查找最后一条用户消息（跳过tool_result消息）
                        let lastUserMessage: Anthropic.MessageParam | null = null;
                        for (let i = this.history.length - 1; i >= 0; i--) {
                            if (this.history[i].role === 'user') {
                                lastUserMessage = this.history[i];
                                break;
                            }
                        }
                        
                        const userMessageText = lastUserMessage 
                            ? (typeof lastUserMessage.content === 'string' 
                                ? lastUserMessage.content 
                                : Array.isArray(lastUserMessage.content)
                                    ? lastUserMessage.content.map((c: any) => c.type === 'text' ? c.text : '').join(' ')
                                    : '')
                            : '';
                        
                        const isProjectCreationRequest = userMessageText && (
                            (/创建|生成|建立|新建|build|create|generate|make/i.test(userMessageText) &&
                            (/项目|网站|应用|project|website|app|application/i.test(userMessageText))) ||
                            (/代码|code|file|文件/i.test(userMessageText) && /生成|create|write|创建/i.test(userMessageText))
                        );
                        
                        if (isProjectCreationRequest && iterationCount < 5) {
                            // 如果是项目创建请求但AI没有调用工具，继续循环（最多5次）
                            console.log(`[AgentRuntime] Project creation request detected but no tools called, continuing loop (iteration ${iterationCount}/${MAX_ITERATIONS})`);
                            // 添加提示消息，引导AI使用工具
                            this.history.push({
                                role: 'user',
                                content: '[SYSTEM REMINDER] You need to use tools (write_file, run_command) to actually create the project files and initialize the project. Please use the available tools to generate code files. Do NOT just describe what you will do—actually create the files using write_file tool.'
                            });
                            this.notifyUpdate();
                            // 继续循环，不设置 keepGoing = false
                        } else {
                            keepGoing = false;
                        }
                    }
                } else {
                    keepGoing = false;
                }

            } catch (loopError: unknown) {
                // Check if this is an abort error - handle gracefully
                if (this.abortController?.signal.aborted) {
                    console.log('[AgentRuntime] Request was aborted');
                    return; // Exit cleanly on abort
                }

                const loopErr = loopError as { status?: number; message?: string; name?: string };
                console.error("Agent Loop detailed error:", loopError);

                // Check for abort-related errors (different SDK versions may throw different errors)
                if (loopErr.name === 'AbortError' || loopErr.message?.includes('abort')) {
                    console.log('[AgentRuntime] Caught abort error');
                    return;
                }

                // 检查是否有成功的工具执行（特别是脚本执行）
                // 如果脚本已经执行成功，对于后续的 API 调用错误，优雅处理
                const hasSuccessfulScriptExecution = this.history.some(msg => {
                    if (msg.role === 'user' && Array.isArray(msg.content)) {
                        return msg.content.some((block: any) => {
                            if (block.type === 'tool_result') {
                                const result = typeof block.content === 'string' ? block.content : '';
                                // 检查是否是脚本执行成功的结果
                                const isScriptExecution = result.includes('chrome-agent') || 
                                                         result.includes('自动化') ||
                                                         result.includes('node ') ||
                                                         result.includes('.js');
                                // 检查是否成功（没有错误信息）
                                const isSuccess = result.length > 0 && 
                                                  !result.toLowerCase().includes('error') && 
                                                  !result.toLowerCase().includes('失败') &&
                                                  !result.toLowerCase().includes('failed');
                                return isScriptExecution && isSuccess;
                            }
                            return false;
                        });
                    }
                    return false;
                });

                // Handle Sensitive Content Error (1027)
                if (loopErr.status === 500 && (loopErr.message?.includes('sensitive') || JSON.stringify(loopError).includes('1027'))) {
                    console.log("Caught sensitive content error, asking Agent to retry...");

                    // Add a system-like user message to prompt the agent to fix its output
                    this.history.push({
                        role: 'user',
                        content: `[SYSTEM ERROR] Your previous response was blocked by the safety filter (Error Code 1027: output new_sensitive). \n\nThis usually means the generated content contained sensitive, restricted, or unsafe material.\n\nPlease generate a NEW response that:\n1. Addresses the user's request safely.\n2. Avoids the sensitive topic or phrasing that triggered the block.\n3. Acknowledges the issue briefly if necessary.`
                    });
                    this.notifyUpdate();

                    // Allow the loop to continue to the next iteration
                    continue;
                } else if (hasSuccessfulScriptExecution && (loopErr.status === 400 || loopErr.status === 429 || loopErr.status === 500 || loopErr.status === 503)) {
                    // 若是可重试错误，抛出以交由 processMessageWithContext 触发新会话切换并继续
                    if (this.isRetryableContextError(loopErr, loopError)) {
                        console.warn(`[AgentRuntime] Script execution succeeded but API failed (${loopErr.status}). Re-throwing to trigger context switch retry.`);
                        throw loopError;
                    }
                    // 不可重试时沿用原有友好提示
                    console.warn(`[AgentRuntime] Script execution succeeded, but subsequent AI call failed (${loopErr.status}). Ending loop gracefully.`);
                    const createdFiles = this.artifacts.filter(a => a.type === 'file').map(a => a.name).join('、') || '无';
                    const friendlyMessage: Anthropic.MessageParam = {
                        role: 'assistant',
                        content: `✅ 脚本执行已完成。\n\n📁 已生成的文件：${createdFiles}\n\n⚠️ 注意：后续的 AI 响应处理遇到了问题（状态码 ${loopErr.status}），但这不影响脚本的执行结果。如果文件已生成，请在文件资源管理器中查看。`
                    };
                    this.history.push(friendlyMessage);
                    this.notifyUpdate();
                    keepGoing = false;
                    return;
                } else {
                    // Re-throw other errors to be caught effectively by the outer handler
                    throw loopError;
                }
            }
        }
    }

    // Broadcast to all windows. When taskId is provided, always attach it to payload so renderer can update task status.
    private broadcast(channel: string, data?: unknown, taskId?: string) {
        let payload: unknown = data;
        if (taskId !== undefined) {
            payload = typeof data === 'object' && data !== null
                ? { ...(data as object), taskId }
                : { message: data, taskId };
        }
        for (const win of this.windows) {
            if (!win.isDestroyed()) {
                win.webContents.send(channel, payload);
            }
        }
    }

    private notifyUpdate() {
        this.broadcast('agent:history-update', this.history);
    }

    private async requestConfirmation(tool: string, description: string, args: Record<string, unknown>): Promise<boolean> {
        // Extract path from args if available
        const path = (args?.path || args?.cwd) as string | undefined;

        // Check if permission is already granted
        if (configStore.hasPermission(tool, path)) {
            console.log(`[AgentRuntime] Auto-approved ${tool} (saved permission)`);
            return true;
        }

        const id = `confirm-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        return new Promise((resolve) => {
            this.pendingConfirmations.set(id, { resolve });
            this.broadcast('agent:confirm-request', { id, tool, description, args });
        });
    }

    public handleConfirmResponseWithRemember(id: string, approved: boolean, remember: boolean): void {
        const pending = this.pendingConfirmations.get(id);
        if (pending) {
            if (approved && remember) {
                // Extract tool and path from the confirmation request
                // The tool name is in the id or we need to pass it
                // For now we'll extract from the most recent confirm request
            }
            pending.resolve(approved);
            this.pendingConfirmations.delete(id);
        }
    }

    public abort() {
        if (!this.isProcessing) return;

        this.abortController?.abort();

        // Clear any pending confirmations - respond with 'denied'
        for (const [, pending] of this.pendingConfirmations) {
            pending.resolve(false);
        }
        this.pendingConfirmations.clear();

        // Broadcast abort event to all windows
        this.broadcast('agent:aborted', {
            aborted: true,
            timestamp: Date.now()
        });

        // Mark processing as complete
        this.isProcessing = false;
        this.abortController = null;
    }
    /**
     * 自动错误检测和修复循环
     */
    private async autoFixErrors(cwd: string, url: string, maxRetries: number = 5): Promise<void> {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            // 等待服务器稳定
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // 验证页面
            const validationResult = await this.fsTools.validatePage({ url, cwd, timeout: 15000 });
            
            // 如果验证成功，退出循环
            if (validationResult.includes('✅ Page validation successful')) {
                console.log(`[AgentRuntime] Page validation successful after ${attempt} fix attempt(s)`);
                return;
            }
            
            // 解析错误
            const errors = this.parseErrorsFromValidation(validationResult, cwd);
            const fixableErrors = errors.filter(e => e.fixable);
            
            if (fixableErrors.length === 0) {
                console.log(`[AgentRuntime] No fixable errors found, stopping auto-fix loop`);
                break;
            }
            
            console.log(`[AgentRuntime] Attempt ${attempt + 1}/${maxRetries}: Found ${fixableErrors.length} fixable error(s)`);
            
            // 修复错误
            let fixed = false;
            for (const error of fixableErrors) {
                const fixResult = await ErrorFixer.fixError(error, cwd);
                if (fixResult.success) {
                    console.log(`[AgentRuntime] Fixed error: ${fixResult.message}`);
                    fixed = true;
                } else {
                    console.log(`[AgentRuntime] Failed to fix error: ${fixResult.message}`);
                }
            }
            
            // 如果没有修复任何错误，退出循环
            if (!fixed) {
                console.log(`[AgentRuntime] No errors were fixed, stopping auto-fix loop`);
                break;
            }
            
            // 等待修复生效（依赖安装等需要时间）
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    /**
     * 从验证结果中解析错误
     */
    private parseErrorsFromValidation(validationResult: string, cwd: string): DetectedError[] {
        const errors: DetectedError[] = [];
        
        // 从验证结果中提取错误信息
        if (validationResult.includes('Errors detected:')) {
            const errorSection = validationResult.split('Errors detected:')[1]?.split('\n\n')[0] || '';
            
            // 检测依赖缺失错误
            const missingDepMatches = errorSection.matchAll(/Failed to resolve import\s+["']([^"']+)["']/gi);
            for (const match of missingDepMatches) {
                const importPath = match[1];
                const errorsFromText = ErrorDetector.detectFromOutput(`Failed to resolve import "${importPath}"`, cwd);
                errors.push(...errorsFromText);
            }
            
            // 检测模块未找到错误
            const moduleNotFoundMatches = errorSection.matchAll(/Cannot find module\s+["']([^"']+)["']/gi);
            for (const match of moduleNotFoundMatches) {
                const importPath = match[1];
                const errorsFromText = ErrorDetector.detectFromOutput(`Cannot find module "${importPath}"`, cwd);
                errors.push(...errorsFromText);
            }
        }
        
        return errors;
    }

    public dispose() {
        this.abort();
        this.mcpService.dispose();
    }
}
