import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import http from 'http';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { getBuiltinNodePath, getBuiltinNpmPath, getBuiltinNpmCliJsPath, getNpmEnvVars } from '../../utils/NodePath';
import { getCommonPackageManagerPaths } from '../../utils/PathUtils';
import { getPlaywrightEnvVars } from '../../utils/PlaywrightPath';
import { ensurePlaywrightForAutomation } from '../../utils/PlaywrightEnsure';
import { nodeVersionManager } from '../../utils/NodeVersionManager';
import { ErrorDetector, DetectedError } from './ErrorDetector';
import { resolveShellForCommand } from '../../utils/ShellResolver';

const execAsync = promisify(exec);

/** 轮询直到端口可连接或超时，确保 dev 服务真正在监听后再打开浏览器，避免 ERR_CONNECTION_REFUSED */
function isPortOpen(host: string, port: number, timeoutMs = 800): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const timer = setTimeout(() => {
            socket.destroy();
            resolve(false);
        }, timeoutMs);
        socket.connect(port, host, () => {
            clearTimeout(timer);
            socket.destroy();
            resolve(true);
        });
        socket.on('error', () => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

/** 等待端口就绪：每 intervalMs 尝试连接，最多等待 maxWaitMs。同时尝试 IPv4 和 IPv6（macOS 上 Vite 可能绑定 ::1） */
async function waitForPortReady(
    host: string,
    port: number,
    options: { maxWaitMs?: number; intervalMs?: number } = {}
): Promise<boolean> {
    const { maxWaitMs = 20000, intervalMs = 300 } = options;
    const hosts = host === '127.0.0.1' ? ['127.0.0.1', '::1'] : [host];
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        for (const h of hosts) {
            if (await isPortOpen(h, port)) return true;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}

/** 检查 HTTP 根路径是否可访问。尝试 127.0.0.1 和 localhost（后者在 macOS 可能解析为 ::1） */
function checkHttpReady(port: number, timeoutMs = 5000): Promise<boolean> {
    const tryHost = (host: string): Promise<boolean> =>
        new Promise((resolve) => {
            const url = `http://${host}:${port}/`;
            const req = http.get(url, { timeout: timeoutMs }, (res) => {
                const ok = res.statusCode !== undefined && res.statusCode < 500;
                res.destroy();
                resolve(ok);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        });
    return tryHost('127.0.0.1').then((ok) => ok || tryHost('localhost'));
}

/** 等待 HTTP 就绪：端口已开后轮询 GET /，最多重试 maxRetries 次，每次间隔 intervalMs */
async function waitForHttpReady(
    port: number,
    options: { maxRetries?: number; intervalMs?: number; timeoutPerRequest?: number } = {}
): Promise<boolean> {
    const { maxRetries = 10, intervalMs = 800, timeoutPerRequest = 5000 } = options;
    for (let i = 0; i < maxRetries; i++) {
        if (await checkHttpReady(port, timeoutPerRequest)) return true;
        if (i < maxRetries - 1) await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}

export const ReadFileSchema = {
    name: "read_file",
    description: "Read the content of a file from the local filesystem. Use this to analyze code or documents.",
    input_schema: {
        type: "object" as const,
        properties: {
            path: { type: "string", description: "Absolute path to the file." }
        },
        required: ["path"]
    }
};

export const WriteFileSchema = {
    name: "write_file",
    description: "Write content to a file. Overwrites existing files. Create directories if needed.",
    input_schema: {
        type: "object" as const,
        properties: {
            path: { type: "string", description: "Absolute path to the file." },
            content: { type: "string", description: "The content to write." }
        },
        required: ["path", "content"]
    }
};

export const ListDirSchema = {
    name: "list_dir",
    description: "List contents of a directory.",
    input_schema: {
        type: "object" as const,
        properties: {
            path: { type: "string", description: "Absolute path to the directory." }
        },
        required: ["path"]
    }
};

export const RunCommandSchema = {
    name: "run_command",
    description: "Execute a shell command (bash, python, npm, etc.). Use for running scripts, installing dependencies, building projects. The command runs in the specified working directory.",
    input_schema: {
        type: "object" as const,
        properties: {
            command: { type: "string", description: "The command to execute (e.g., 'python script.py', 'npm install')." },
            cwd: { type: "string", description: "Working directory for the command. Defaults to first authorized folder." }
        },
        required: ["command"]
    }
};

export const OpenBrowserPreviewSchema = {
    name: "open_browser_preview",
    description: "Open the built-in browser preview tab and navigate to a URL. Use this AFTER starting a local dev server (e.g., npm run dev) to show the user the preview. Common URLs: http://localhost:3000, http://localhost:5173, http://localhost:8080. Check package.json scripts or the dev server output for the actual port.",
    input_schema: {
        type: "object" as const,
        properties: {
            url: { type: "string", description: "The URL to open in the browser preview tab (e.g., 'http://localhost:3000'). Will auto-add http:// if missing." }
        },
        required: ["url"]
    }
};

export const ValidatePageSchema = {
    name: "validate_page",
    description: "Validate a web page by checking for errors. Use this AFTER starting a dev server and opening browser preview to detect page errors, console errors, or missing dependencies. Returns error details if found, or success message if page loads correctly.",
    input_schema: {
        type: "object" as const,
        properties: {
            url: { type: "string", description: "The URL to validate (e.g., 'http://localhost:3000'). Will auto-add http:// if missing." },
            timeout: { type: "number", description: "Timeout in milliseconds (default: 10000)." },
            cwd: { type: "string", description: "Working directory for resolving file paths (optional)." }
        },
        required: ["url"]
    }
};

export const KillProjectDevServerSchema = {
    name: "kill_project_dev_server",
    description: "Stop the user's project development server running on port 3000. Use this when the user says '关闭服务', '关闭本地服务', 'stop the server', etc. NEVER use run_command to kill processes—use this tool instead to avoid accidentally killing the OpenCowork app's own Vite server (port 5173).",
    input_schema: {
        type: "object" as const,
        properties: {
            cwd: { type: "string", description: "Working directory of the current project (Primary). Used for validation." }
        },
        required: ["cwd"]
    }
};

export class FileSystemTools {
    // 跟踪所有启动的子进程
    private static childProcesses: Set<import('child_process').ChildProcess> = new Set();
    private static activePorts: Set<number> = new Set();

    /**
     * 清理所有子进程和端口
     */
    public static async cleanupAll(): Promise<void> {
        console.log('[FileSystemTools] Cleaning up all child processes and ports...');
        
        // 清理所有子进程
        for (const child of FileSystemTools.childProcesses) {
            try {
                if (child.pid && !child.killed) {
                    console.log(`[FileSystemTools] Killing child process ${child.pid}`);
                    if (process.platform === 'win32') {
                        // Windows: 使用 taskkill 强制终止进程树
                        exec(`taskkill /PID ${child.pid} /T /F`, (error) => {
                            if (error) {
                                console.warn(`[FileSystemTools] Failed to kill process ${child.pid}:`, error.message);
                            }
                        });
                    } else {
                        // Unix: 发送 SIGKILL 信号
                        child.kill('SIGKILL');
                    }
                }
            } catch (error) {
                console.warn(`[FileSystemTools] Error killing child process:`, error);
            }
        }
        FileSystemTools.childProcesses.clear();
        
        // 清理所有活动端口
        for (const port of FileSystemTools.activePorts) {
            try {
                console.log(`[FileSystemTools] Cleaning up port ${port}`);
                await FileSystemTools.killPortProcesses(port);
            } catch (error) {
                console.warn(`[FileSystemTools] Failed to cleanup port ${port}:`, error);
            }
        }
        FileSystemTools.activePorts.clear();
        
        console.log('[FileSystemTools] Cleanup completed');
    }

    /**
     * 静态方法：清理指定端口上的所有进程
     */
    private static async killPortProcesses(port: number): Promise<void> {
        try {
            if (process.platform === 'darwin' || process.platform === 'linux') {
                const { stdout } = await execAsync(`lsof -ti :${port}`, {
                    timeout: 3000,
                    maxBuffer: 4096,
                    encoding: 'utf-8'
                });
                const pids = stdout.trim().split(/\s+/).filter(Boolean).map((s) => parseInt(s, 10));
                for (const pid of pids) {
                    if (!isNaN(pid) && pid > 0) {
                        await execAsync(`kill -9 ${pid}`, { timeout: 3000 });
                        console.log(`[FileSystemTools] Killed process ${pid} on port ${port}`);
                    }
                }
            } else if (process.platform === 'win32') {
                const { stdout } = await execAsync(`netstat -ano | findstr ":${port}"`, {
                    timeout: 3000,
                    maxBuffer: 65536,
                    encoding: 'utf-8',
                    shell: 'cmd.exe'
                });
                const lines = stdout.trim().split(/\r?\n/).filter((line) => line.includes(`:${port}`) && line.includes('LISTENING'));
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parseInt(parts[parts.length - 1], 10);
                    if (!isNaN(pid) && pid > 0) {
                        await execAsync(`taskkill /PID ${pid} /F`, {
                            timeout: 3000,
                            shell: 'cmd.exe'
                        });
                        console.log(`[FileSystemTools] Killed process ${pid} on port ${port}`);
                    }
                }
            }
        } catch (error) {
            // 端口可能已经被清理，忽略错误
            console.log(`[FileSystemTools] Port ${port} cleanup completed or already clean`);
        }
    }

    async readFile(args: { path: string }) {
        try {
            const content = await fs.readFile(args.path, 'utf-8');
            return `Successfully read file ${args.path}:\n${content}`;
        } catch (error: unknown) {
            return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    async writeFile(args: { path: string, content: string }) {
        try {
            await fs.mkdir(path.dirname(args.path), { recursive: true });
            await fs.writeFile(args.path, args.content, 'utf-8');
            return `Successfully wrote to ${args.path}`;
        } catch (error: unknown) {
            return `Error writing file: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    async listDir(args: { path: string }) {
        try {
            const items = await fs.readdir(args.path, { withFileTypes: true });
            const result = items.map(item =>
                `${item.isDirectory() ? '[DIR]' : '[FILE]'} ${item.name}`
            ).join('\n');
            return `Directory contents of ${args.path}:\n${result}`;
        } catch (error: unknown) {
            return `Error listing directory: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    async validatePage(args: { url: string; timeout?: number; cwd?: string }): Promise<string> {
        const timeout = args.timeout || 15000; // 增加超时时间，等待页面加载
        const cwd = args.cwd || process.cwd();
        let url = args.url.trim();
        if (!/^https?:\/\//i.test(url)) {
            url = `http://${url}`;
        }

        try {
            // 使用 Playwright 访问页面并检测错误（更准确）
            const playwrightEnv = getPlaywrightEnvVars();
            const playwrightPath = playwrightEnv.NODE_PATH 
                ? playwrightEnv.NODE_PATH.split(path.delimiter)[0]
                : null;

            // 如果 Playwright 可用，使用它进行更准确的验证
            if (playwrightPath) {
                try {
                    // 尝试多种方式加载 Playwright
                    let playwright: any;
                    let chromium: any;
                    
                    try {
                        // 方式1：从 NODE_PATH 加载
                        playwright = require('playwright');
                        chromium = playwright.chromium;
                    } catch {
                        // 方式2：从指定路径加载
                        const playwrightModulePath = path.join(playwrightPath, 'playwright');
                        if (fsSync.existsSync(playwrightModulePath)) {
                            playwright = require(playwrightModulePath);
                            chromium = playwright.chromium;
                        } else {
                            throw new Error('Playwright not found');
                        }
                    }
                    
                    const browser = await chromium.launch({ 
                        headless: true,
                        env: playwrightEnv
                    });
                    const page = await browser.newPage();
                    
                    const consoleErrors: string[] = [];
                    const pageErrors: string[] = [];
                    const networkErrors: string[] = [];
                    const overlayErrors: string[] = [];
                    
                    // 监听控制台错误（只记录真正的错误，忽略警告）
                    page.on('console', (msg: any) => {
                        const msgType = msg.type();
                        const msgText = msg.text();
                        // 只记录错误，忽略警告和信息
                        if (msgType === 'error') {
                            const lowerText = msgText.toLowerCase();
                            // 完全忽略 Playwright 和工具相关的错误
                            // 同时忽略 "require is not defined" 错误（通常是误报）
                            if (lowerText.includes('playwright') ||
                                lowerText.includes('evaluation') ||
                                lowerText.includes('chromium') ||
                                lowerText.includes('browser') ||
                                lowerText.includes('favicon') ||
                                lowerText.includes('sourcemap') ||
                                lowerText.includes('devtools') ||
                                lowerText.includes('extension') ||
                                lowerText.includes('chrome-extension') ||
                                lowerText.includes('require is not defined') ||
                                (lowerText.includes('referenceerror') && lowerText.includes('require'))) {
                                return; // 完全忽略，不记录
                            }
                            
                            // 只记录真正影响页面功能的 Vite/React 错误
                            if (lowerText.includes('failed to resolve') ||
                                lowerText.includes('cannot find module') ||
                                lowerText.includes('module not found') ||
                                lowerText.includes('[plugin:vite:import-analysis]') ||
                                lowerText.includes('@ant-design') ||
                                lowerText.includes('@/')) {
                                consoleErrors.push(msgText);
                            }
                        }
                    });
                    
                    // 监听页面错误（JavaScript 运行时错误）
                    page.on('pageerror', (error: Error) => {
                        const errorMsg = error.message;
                        const errorStack = error.stack || '';
                        const lowerMsg = errorMsg.toLowerCase();
                        const lowerStack = errorStack.toLowerCase();
                        
                        // 完全忽略 Playwright 相关的错误
                        // 同时忽略 "require is not defined" 错误（通常是误报）
                        if (lowerStack.includes('page.evaluate') ||
                            lowerStack.includes('evaluation') ||
                            lowerStack.includes('playwright') ||
                            lowerStack.includes('chromium') ||
                            lowerStack.includes('browser') ||
                            lowerStack.includes('frame.evaluate') ||
                            lowerStack.includes('frameManager') ||
                            lowerMsg.includes('favicon') ||
                            lowerMsg.includes('sourcemap') ||
                            lowerMsg.includes('extension') ||
                            lowerMsg.includes('chrome-extension') ||
                            lowerMsg.includes('require is not defined') ||
                            (lowerMsg.includes('referenceerror') && lowerMsg.includes('require'))) {
                            return; // 完全忽略，不记录
                        }
                        
                        // 只记录页面本身的运行时错误（缺失依赖、模块未找到等）
                        if (lowerMsg.includes('failed to resolve') ||
                            lowerMsg.includes('cannot find module') ||
                            lowerMsg.includes('module not found')) {
                            pageErrors.push(errorMsg);
                        }
                    });
                    
                    // 监听网络错误（失败的 HTTP 请求）
                    page.on('response', (response: any) => {
                        const status = response.status();
                        const url = response.url();
                        // 只记录关键错误（4xx, 5xx），忽略重定向等
                        if (status >= 400 && status < 600) {
                            // 过滤掉一些非关键资源
                            const lowerUrl = url.toLowerCase();
                            if (!lowerUrl.includes('favicon') && 
                                !lowerUrl.includes('sourcemap') &&
                                !lowerUrl.includes('.map')) {
                                networkErrors.push(`Failed to load ${url}: ${status} ${response.statusText()}`);
                            }
                        }
                    });

                    try {
                        await page.goto(url, { waitUntil: 'networkidle', timeout });
                        
                        // 等待一下，确保错误覆盖层已经渲染（如果有的话）
                        await page.waitForTimeout(2000);
                        
                        // 首先检查页面是否正常加载（检查关键指标）
                        // 使用 try-catch 完全隔离 page.evaluate 的错误，不报告为页面错误
                        let pageStatus: { hasContent: boolean; hasError: boolean; errorText: string | null };
                        try {
                            pageStatus = await page.evaluate(() => {
                                try {
                                    // 检查页面是否有内容
                                    const hasBodyContent = document.body && document.body.children.length > 0;
                                    
                                    // 检查页面标题
                                    const hasTitle = document.title && document.title.trim().length > 0;
                                    
                                    // 检查是否有 React 根元素
                                    const hasRoot = !!(document.getElementById('root') || 
                                                       document.querySelector('[id^="root"]') ||
                                                       document.querySelector('#app') ||
                                                       document.querySelector('[id="app"]'));
                                    
                                    // 检查是否有 Vite 错误覆盖层（更严格的检查）
                                    const viteErrorOverlay = document.querySelector('[data-vite-error-overlay]') || 
                                                            document.querySelector('.vite-error-overlay');
                                    
                                    let hasVisibleError = false;
                                    let errorText: string | null = null;
                                    
                                    if (viteErrorOverlay) {
                                        const style = window.getComputedStyle(viteErrorOverlay);
                                        const isVisible = style.display !== 'none' && 
                                                         style.visibility !== 'hidden' && 
                                                         style.opacity !== '0' &&
                                                         parseInt(style.zIndex || '0', 10) >= 0;
                                        if (isVisible) {
                                            const overlayText = viteErrorOverlay.textContent || '';
                                            if (overlayText.trim().length > 0) {
                                                // 检查错误文本，如果是 "require is not defined" 且页面已经正常加载，可能是误报
                                                const overlayTextLower = overlayText.toLowerCase();
                                                const isRequireError = overlayTextLower.includes('require is not defined') ||
                                                                       (overlayTextLower.includes('referenceerror') && overlayTextLower.includes('require'));
                                                
                                                // 如果页面已经正常加载（有内容、有标题、有根元素），且错误是 require 相关，可能是误报
                                                // 只有在页面没有正常加载时，才认为这是真正的错误
                                                if (!isRequireError || !(hasBodyContent && hasTitle && hasRoot)) {
                                                    hasVisibleError = true;
                                                    errorText = overlayText.substring(0, 500);
                                                }
                                            }
                                        }
                                    }
                                    
                                    return {
                                        hasContent: hasBodyContent && hasTitle && hasRoot,
                                        hasError: hasVisibleError,
                                        errorText: errorText
                                    };
                                } catch (_e: unknown) {
                                    // 如果评估失败，返回安全值（不报告错误）
                                    return {
                                        hasContent: false,
                                        hasError: false,
                                        errorText: null
                                    };
                                }
                            });
                        } catch (evaluateError: unknown) {
                            // 如果整个 evaluate 失败，也不报告错误，只记录日志
                            console.log(`[FileSystemTools] page.evaluate failed (ignored): ${evaluateError instanceof Error ? evaluateError.message : String(evaluateError)}`);
                            pageStatus = {
                                hasContent: false,
                                hasError: false,
                                errorText: null
                            };
                        }
                        
                        // 如果页面正常加载（有内容、有标题、有根元素、没有错误覆盖层），直接返回成功
                        // 优先级：页面加载成功 > 错误检测
                        // 即使有一些错误信息，只要页面正常加载，就认为成功
                        if (pageStatus.hasContent && !pageStatus.hasError) {
                            await browser.close();
                            return `✅ Page validation successful: ${url} loaded correctly. Page has content and no error overlay detected.`;
                        }
                        
                        // 如果检测到可见的错误覆盖层，提取详细错误信息
                        // 但先过滤掉 "require is not defined" 错误（可能是误报）
                        if (pageStatus.hasError && pageStatus.errorText) {
                            const errorTextLower = pageStatus.errorText.toLowerCase();
                            // 如果错误覆盖层中包含 "require is not defined"，但页面已经正常加载（有内容），可能是误报
                            // 只有在页面没有正常加载时，才记录这个错误
                            if (!pageStatus.hasContent || 
                                (!errorTextLower.includes('require is not defined') && 
                                 !(errorTextLower.includes('referenceerror') && errorTextLower.includes('require')))) {
                                overlayErrors.push(pageStatus.errorText);
                            }
                        }
                        
                        await browser.close();

                        // 只有在页面没有正常加载时，才检查其他错误
                        // 如果页面有错误覆盖层，说明有真正的错误
                        if (overlayErrors.length > 0) {
                            // 使用 ErrorDetector 解析错误
                            const detectedErrors: DetectedError[] = [];
                            
                            // 从错误覆盖层检测错误
                            for (const overlayError of overlayErrors) {
                                const errors = ErrorDetector.detectFromOverlay(overlayError, cwd);
                                detectedErrors.push(...errors);
                            }
                            
                            // 从控制台错误检测
                            for (const consoleError of consoleErrors) {
                                const errors = ErrorDetector.detectFromConsole(consoleError, cwd);
                                detectedErrors.push(...errors);
                            }
                            
                            const allErrors = [
                                ...consoleErrors.map((e: string) => `Console Error: ${e}`),
                                ...pageErrors.map((e: string) => `Page Error: ${e}`),
                                ...networkErrors.map((e: string) => `Network Error: ${e}`),
                                ...overlayErrors.map((e: string) => `Vite Error Overlay: ${e}`)
                            ].join('\n');
                            
                            // 构建修复提示
                            let fixHint = '';
                            const fixableErrors = detectedErrors.filter(e => e.fixable);
                            
                            if (fixableErrors.length > 0) {
                                fixHint = '\n\n🔧 Auto-fixable errors detected:\n';
                                for (const error of fixableErrors) {
                                    if (error.type === 'missing_dependency' && error.packageName) {
                                        fixHint += `- Missing dependency: ${error.packageName} (will be installed automatically)\n`;
                                    } else if (error.type === 'css_error' && error.importPath) {
                                        fixHint += `- CSS/Resource file not found: ${error.importPath} (will be fixed automatically)\n`;
                                    } else if (error.type === 'import_error' && error.importPath) {
                                        fixHint += `- Import error: ${error.importPath} (may require manual fix)\n`;
                                    }
                                }
                                fixHint += '\nThese errors will be automatically fixed.';
                            }
                            
                            return `❌ Page validation failed: ${url}\n\nErrors detected:\n${allErrors}${fixHint}\n\nPlease fix these errors and restart the dev server.`;
                        }
                        
                        // 如果页面正常加载，但有一些非关键错误，检查是否是关键错误
                        if (consoleErrors.length > 0 || pageErrors.length > 0 || networkErrors.length > 0) {
                            // 过滤出关键错误（影响页面功能的错误）
                            const criticalErrors: string[] = [];
                            
                            // 检查控制台错误是否是关键错误
                            // 完全排除 "require is not defined" 错误（通常是误报）
                            for (const error of consoleErrors) {
                                const lowerError = error.toLowerCase();
                                // 完全忽略 require 相关错误
                                if (lowerError.includes('require is not defined') ||
                                    (lowerError.includes('referenceerror') && lowerError.includes('require'))) {
                                    continue; // 跳过，不记录
                                }
                                if (lowerError.includes('failed to resolve') ||
                                    lowerError.includes('cannot find module') ||
                                    lowerError.includes('module not found') ||
                                    lowerError.includes('[plugin:vite:import-analysis]') ||
                                    lowerError.includes('@ant-design') ||
                                    lowerError.includes('@/')) {
                                    criticalErrors.push(`Console Error: ${error}`);
                                }
                            }
                            
                            // 检查页面错误是否是关键错误
                            // 完全排除 "require is not defined" 错误（通常是误报）
                            for (const error of pageErrors) {
                                const lowerError = error.toLowerCase();
                                // 完全忽略 require 相关错误
                                if (lowerError.includes('require is not defined') ||
                                    (lowerError.includes('referenceerror') && lowerError.includes('require'))) {
                                    continue; // 跳过，不记录
                                }
                                if (lowerError.includes('failed to resolve') ||
                                    lowerError.includes('cannot find module') ||
                                    lowerError.includes('module not found')) {
                                    criticalErrors.push(`Page Error: ${error}`);
                                }
                            }
                            
                            // 网络错误通常是关键的
                            criticalErrors.push(...networkErrors.map((e: string) => `Network Error: ${e}`));
                            
                            // 只有关键错误才报告
                            // 在上面的循环中已经过滤掉了 require 错误，这里不需要再次过滤
                            const filteredCriticalErrors = criticalErrors;
                            
                            if (filteredCriticalErrors.length > 0) {
                                const allErrors = filteredCriticalErrors.join('\n');
                                
                                // 检查是否是 require 错误（只在真正的错误中检查）
                                // 如果页面已经正常加载，不应该有 require 错误
                                const allErrorsLower = allErrors.toLowerCase();
                                const hasRequireError = !pageStatus.hasContent && 
                                                       (allErrorsLower.includes('require is not defined') || 
                                                        (allErrorsLower.includes('referenceerror') && allErrorsLower.includes('require')));
                                
                                // 检查是否是缺失依赖错误
                                const hasMissingDep = allErrors.toLowerCase().includes('failed to resolve import') || 
                                                    allErrors.toLowerCase().includes('cannot find module') ||
                                                    allErrors.toLowerCase().includes('module not found');
                                
                                let fixHint = '';
                                if (hasRequireError) {
                                    fixHint = '\n\n⚠️ IMPORTANT: "require is not defined" error means code is using Node.js require() in browser context. Fix by:\n1. Find the file causing the error (check error stack trace)\n2. Replace require() with ES6 import statements\n3. Example: const module = require("module") → import module from "module"\n4. For named exports: const { func } = require("module") → import { func } from "module"\n';
                                } else if (hasMissingDep) {
                                    // 尝试提取包名
                                    const packageMatch = allErrors.match(/["']([^"']+@[^"']+|@[^"']+\/[^"']+)["']/) || 
                                                         allErrors.match(/Cannot find module ["']([^"']+)["']/) ||
                                                         allErrors.match(/Module not found ["']([^"']+)["']/);
                                    const packageName = packageMatch ? packageMatch[1] : '<package-name>';
                                    fixHint = `\n\n⚠️ IMPORTANT: Missing dependency detected. Install it using: pnpm add ${packageName}\n`;
                                }
                                
                                return `❌ Page validation failed: ${url}\n\nErrors detected:\n${allErrors}${fixHint}\nPlease fix these errors and restart the dev server.`;
                            }
                        }

                        // 如果页面正常加载且没有关键错误，返回成功
                        return `✅ Page validation successful: ${url} loaded correctly with no errors detected.`;
                    } catch (error: unknown) {
                        await browser.close();
                        const errorMsg = error instanceof Error ? error.message : String(error);
                        return `❌ Page validation failed: ${url}\n\nError: ${errorMsg}\n\nPage may not be accessible or server may not be running.`;
                    }
                } catch (playwrightError: unknown) {
                    console.log(`[FileSystemTools] Playwright validation failed, falling back to HTTP: ${playwrightError instanceof Error ? playwrightError.message : String(playwrightError)}`);
                    // 如果 Playwright 失败，回退到 HTTP 方法
                }
            }

            // 回退方案：使用 HTTP 请求检查（但不够准确）
            const http = require('http');
            return new Promise((resolve) => {
                const urlObj = new URL(url);
                const req = http.get({
                    hostname: urlObj.hostname,
                    port: urlObj.port || 3000,
                    path: urlObj.pathname,
                    timeout: timeout
                }, (res: any) => {
                    let data = '';
                    res.on('data', (chunk: string) => { data += chunk; });
                    res.on('end', () => {
                        // 检查响应中是否包含错误信息（HTTP 回退方案，只检测明显的错误）
                        // 不检测 require 错误，因为 HTTP 方案不够准确
                        const hasError = data.includes('Failed to resolve import') || 
                                        data.includes('[plugin:vite:import-analysis]') ||
                                        data.includes('Cannot find module') ||
                                        data.includes('Module not found') ||
                                        res.statusCode !== 200;
                        
                        if (!hasError) {
                            resolve(`✅ Page validation successful: ${url} loaded correctly (status: ${res.statusCode})\n\nNote: HTTP validation may not detect all errors. For accurate validation, use Playwright.`);
                        } else {
                            // 尝试提取错误信息（HTTP 回退方案不够准确，只检测明显的错误）
                            const errorPatterns = [
                                /Failed to resolve import\s+["']([^"']+)["']/gi,
                                /\[plugin:vite:import-analysis\][^\n]+/gi,
                                /Cannot find module\s+["']([^"']+)["']/gi,
                                /Module not found\s+["']([^"']+)["']/gi
                            ];
                            
                            const foundErrors: string[] = [];
                            for (const pattern of errorPatterns) {
                                const matches = data.match(pattern);
                                if (matches) {
                                    foundErrors.push(...matches.slice(0, 5));
                                }
                            }
                            
                            const errorMsg = foundErrors.length > 0 
                                ? foundErrors.join('\n')
                                : `Page returned status ${res.statusCode}`;
                            
                            // HTTP 回退方案不检测 require 错误（不够准确）
                            // 只检测明显的缺失依赖错误
                            let fixHint = '';
                            if (errorMsg.toLowerCase().includes('failed to resolve import') ||
                                errorMsg.toLowerCase().includes('cannot find module') ||
                                errorMsg.toLowerCase().includes('module not found')) {
                                const packageMatch = errorMsg.match(/["']([^"']+@[^"']+|@[^"']+\/[^"']+)["']/) || 
                                                   errorMsg.match(/Cannot find module ["']([^"']+)["']/) ||
                                                   errorMsg.match(/Module not found ["']([^"']+)["']/);
                                const packageName = packageMatch ? packageMatch[1] : '<package-name>';
                                fixHint = `\n\n⚠️ IMPORTANT: Missing dependency detected. Install it using: pnpm add ${packageName}\n`;
                            }
                            
                            resolve(`❌ Page validation failed: ${url}\n\nErrors detected:\n${errorMsg}${fixHint}\nPlease fix these errors and restart the dev server.`);
                        }
                    });
                });
                req.on('error', (err: Error) => {
                    resolve(`❌ Page validation failed: ${url}\n\nError: ${err.message}\n\nServer may not be running or URL is incorrect.`);
                });
                req.on('timeout', () => {
                    req.destroy();
                    resolve(`❌ Page validation failed: ${url}\n\nError: Request timeout after ${timeout}ms\n\nServer may be slow to start or not responding.`);
                });
            });
        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return `❌ Page validation failed: ${url}\n\nError: ${errorMsg}\n\nUnable to validate page. Please check manually.`;
        }
    }

    async runCommand(args: { command: string, cwd?: string }, defaultCwd: string) {
        const workingDir = args.cwd || defaultCwd;
        const timeout = 60000; // 60 second timeout

        // 检测是否为开发服务器命令 - 禁止打开外部 Chrome，使用内置浏览器 Tab 展示
        const isDevServerCommand = /run\s+(dev|start)\b|pnpm\s+(dev|start)\b|yarn\s+(dev|start)\b|npx\s+vite|vite\s|webpack.*serve/i.test(args.command);

        // 检测是否为预览服务器命令（构建后查看，Vite 默认 4173）
        const isPreviewServerCommand = /(?:pnpm|npm|yarn)\s+(?:run\s+)?preview\b|vite\s+preview/i.test(args.command);

        // 检测项目需要的 Node.js 版本
        // 对于开发/预览服务器命令，等待下载完成；对于其他命令，异步下载
        let projectNodePath: string | null = null;
        let projectNpmPath: string | null = null;
        let projectEnv: Record<string, string> = {};
        
        try {
            const waitForDownload = isDevServerCommand || isPreviewServerCommand;
            console.log(`[FileSystemTools] Detecting Node.js version for project at ${workingDir}, waitForDownload=${waitForDownload}`);
            const projectNodeInfo = await nodeVersionManager.getNodePathForProject(workingDir, waitForDownload);
            projectNodePath = projectNodeInfo.nodePath;
            projectNpmPath = projectNodeInfo.npmPath;
            projectEnv = projectNodeInfo.env || {};
            console.log(`[FileSystemTools] Using Node.js: ${projectNodePath}, npm: ${projectNpmPath || 'builtin'}`);
        } catch (error) {
            console.warn('[FileSystemTools] Failed to detect project Node.js version, using builtin:', error);
        }

        // 如果命令包含 'node' 或 'npm'，替换为项目需要的版本路径
        let command = args.command;
        const nodePath = projectNodePath || getBuiltinNodePath();
        const npmPath = projectNpmPath || getBuiltinNpmPath();
        
        if (nodePath && nodePath !== 'node') {
            // 使用正则表达式替换独立的 'node' 命令（避免替换其他单词中的 node）
            // 匹配：node 前后是空白字符、引号、行首或行尾
            const nodeRegex = /(^|\s|["'])\bnode\b(\s|$|["'])/g;
            const nodeCommand = nodePath.includes(' ') ? `"${nodePath}"` : nodePath;
            command = command.replace(nodeRegex, (_match, before, after) => {
                // 保留前后的空白字符或引号
                return `${before}${nodeCommand}${after}`;
            });
        }
        
        if (npmPath && npmPath !== 'npm') {
            // 如果项目版本提供了 npm，优先使用项目版本的 npm
            const npmRegex = /(^|\s|["'])\bnpm\b(\s|$|["'])/g;
            const npmCommand = npmPath.includes(' ') ? `"${npmPath}"` : npmPath;
            command = command.replace(npmRegex, (_match, before, after) => {
                // 保留前后的空白字符或引号
                return `${before}${npmCommand}${after}`;
            });
        } else if (!projectNpmPath) {
            // 如果没有项目版本的 npm，使用内置 npm（通过 node 执行 npm-cli.js）
            const npmCliJsPath = getBuiltinNpmCliJsPath();
            const nodePathForNpm = nodePath;
            
            if (npmCliJsPath && nodePathForNpm && nodePathForNpm !== 'node') {
                // 使用 node 直接执行 npm-cli.js，避免 npm 脚本的路径问题
                const nodeCommand = nodePathForNpm.includes(' ') ? `"${nodePathForNpm}"` : nodePathForNpm;
                const npmCliCommand = npmCliJsPath.includes(' ') ? `"${npmCliJsPath}"` : npmCliJsPath;
                
                // 替换 npm 命令为: node npm-cli.js [args]
                // 匹配: npm 后跟空格和参数（可能是 install、run 等）
                // 例如: "npm install" -> "node npm-cli.js install"
                //      'npm run build' -> 'node npm-cli.js run build'
                const npmRegex = /(^|\s|["'])\bnpm\b(\s+)(.*?)(?=\s*$|\s*["']|$)/g;
                command = command.replace(npmRegex, (_match, before, _space, args) => {
                    // 保留 npm 后的所有参数
                    const npmArgs = args.trim();
                    return `${before}${nodeCommand} ${npmCliCommand}${npmArgs ? ' ' + npmArgs : ''}`;
                });
            } else {
                // 回退到使用 npm 脚本
                const npmRegex = /(^|\s|["'])\bnpm\b(\s|$|["'])/g;
                const npmCommand = npmPath.includes(' ') ? `"${npmPath}"` : npmPath;
                command = command.replace(npmRegex, (_match, before, after) => {
                    // 保留前后的空白字符或引号
                    return `${before}${npmCommand}${after}`;
                });
            }
        }

        // 检测是否为自动化测试命令（可能启动 Chrome for Testing）
        const isAutomationTest = this.isAutomationTestCommand(command);
        if (isAutomationTest) {
            try {
                await ensurePlaywrightForAutomation();
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return `自动化需要 Playwright/Chromium，自动安装失败: ${msg}\n请检查网络后重试，或手动在终端执行: npx playwright install chromium`;
            }
        }

        try {
            // 获取 Playwright 和 npm 环境变量
            const playwrightEnv = getPlaywrightEnvVars();
            // 如果项目版本提供了环境变量，优先使用；否则使用内置 npm 环境变量
            const npmEnv = Object.keys(projectEnv).length > 0 ? projectEnv : getNpmEnvVars();
            
            // 确保 Node.js 路径在 PATH 的最前面，这样 pnpm/yarn 会使用正确的 Node.js
            // 在 nodeBinDir 之后插入常见 pnpm/包管理器路径，使从 Dock 启动时子进程也能找到 pnpm
            let finalPath = process.env.PATH || '';
            const pathSeparator = process.platform === 'win32' ? ';' : ':';
            const commonPkgPaths = getCommonPackageManagerPaths();

            if (nodePath && nodePath !== 'node') {
                const nodeBinDir = path.dirname(nodePath);
                // 如果项目环境变量中有 PATH，使用它作为基础；否则使用系统 PATH
                const basePath = projectEnv.PATH || finalPath;
                const pathParts = [nodeBinDir, ...commonPkgPaths].filter(Boolean);
                const prefix = pathParts.join(pathSeparator);
                finalPath = prefix ? `${prefix}${pathSeparator}${basePath}` : basePath;
            } else if (projectEnv.PATH) {
                const basePath = projectEnv.PATH;
                const prefix = commonPkgPaths.join(pathSeparator);
                finalPath = prefix ? `${prefix}${pathSeparator}${basePath}` : basePath;
            } else if (commonPkgPaths.length > 0) {
                finalPath = `${commonPkgPaths.join(pathSeparator)}${pathSeparator}${finalPath}`;
            }
            
            let env: NodeJS.ProcessEnv = {
                ...process.env,
                ...playwrightEnv,
                ...npmEnv,
                PATH: finalPath, // 使用修改后的 PATH
                // CRA/Vite 等支持 BROWSER=none
                ...(isDevServerCommand || isPreviewServerCommand ? { BROWSER: 'none' } : {}),
                // Project 模式约束：开发服务器统一使用端口 3000（CRA/Next 等认 PORT，Vite 需配合 --port）
                ...(isDevServerCommand ? { PORT: '3000', VITE_PORT: '3000' } : {})
            };

            // macOS/Linux：用假命令劫持 open/xdg-open，阻止 webpack-dev-server / vite preview 等打开外部浏览器
            if ((isDevServerCommand || isPreviewServerCommand) && (process.platform === 'darwin' || process.platform === 'linux')) {
                const noBrowserDir = this.ensureNoBrowserScriptDir();
                if (noBrowserDir) {
                    env = { ...env, PATH: `${noBrowserDir}:${env.PATH || ''}` };
                }
            }
            
            console.log(`[FileSystemTools] Executing command: ${command} in ${workingDir}`);

            const resolvedShell = resolveShellForCommand();
            console.log(`[FileSystemTools] Resolved shell: ${resolvedShell}`);
            if (!resolvedShell) {
                return `Command execution failed: No usable shell found on this system. Checked: /bin/zsh, /bin/bash, /bin/sh. Please verify shell availability.`;
            }

            // 开发服务器命令：后台运行，统一端口 3000，便于内置浏览器预览
            if (isDevServerCommand) {
                const PROJECT_DEV_PORT = 3000;
                const parsedPort = this.parseDevServerPort(command, workingDir);
                // Vite 默认 5173，需通过 CLI 指定端口；CRA/Next 等认 PORT 环境变量
                let runCommand = command;
                if (parsedPort === 5173 && !/--port\s+\d+|\b5173\b/.test(command)) {
                    const isRunScript = /(?:npm|pnpm|yarn)\s+(?:run\s+)?(dev|start)\b/i.test(command);
                    // --host 127.0.0.1 显式绑定 IPv4，确保 127.0.0.1 可访问；localhost 解析时通常会尝试 127.0.0.1 故也可用
                    const portHostArg = ` --port ${PROJECT_DEV_PORT} --host 127.0.0.1`;
                    runCommand = isRunScript
                        ? command.trimEnd() + ' --' + portHostArg
                        : command.trimEnd() + portHostArg;
                }
                await this.killProcessOnPort(PROJECT_DEV_PORT);
                
                console.log(`[FileSystemTools] Starting dev server with command: ${runCommand}`);
                console.log(`[FileSystemTools] Using Node.js: ${nodePath}`);
                console.log(`[FileSystemTools] Using npm: ${npmPath || 'builtin'}`);
                console.log(`[FileSystemTools] Environment PATH: ${env.PATH}`);
                console.log(`[FileSystemTools] Node.js bin directory: ${nodePath && nodePath !== 'node' ? path.dirname(nodePath) : 'system'}`);
                
                const child = spawn(runCommand, [], {
                    cwd: workingDir,
                    env: env,
                    shell: resolvedShell,
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
                
                // 跟踪子进程和端口
                FileSystemTools.childProcesses.add(child);
                FileSystemTools.activePorts.add(PROJECT_DEV_PORT);
                
                // 当进程退出时从跟踪列表中移除
                child.on('exit', () => {
                    FileSystemTools.childProcesses.delete(child);
                    FileSystemTools.activePorts.delete(PROJECT_DEV_PORT);
                });
                
                // 收集输出用于错误检测
                let stdoutBuffer = '';
                let stderrBuffer = '';
                const detectedErrors: DetectedError[] = [];
                
                // 监听输出并检测错误
                child.stdout?.on('data', (data) => {
                    const output = data.toString();
                    stdoutBuffer += output;
                    console.log(`[DevServer] stdout: ${output.substring(0, 200)}`);
                    
                    // 实时检测错误
                    const errors = ErrorDetector.detectFromOutput(output, workingDir);
                    detectedErrors.push(...errors);
                });
                
                child.stderr?.on('data', (data) => {
                    const output = data.toString();
                    stderrBuffer += output;
                    console.error(`[DevServer] stderr: ${output.substring(0, 200)}`);
                    
                    // 实时检测错误
                    const errors = ErrorDetector.detectFromOutput(output, workingDir);
                    detectedErrors.push(...errors);
                });
                
                child.on('error', (error) => {
                    console.error(`[DevServer] Failed to start: ${error.message}`);
                });
                
                child.unref();
                
                // 先等 TCP 端口可连接，再等 HTTP 根路径可访问，确保内置浏览器打开时页面已可加载
                console.log(`[FileSystemTools] Waiting for dev server to start on port ${PROJECT_DEV_PORT}...`);
                const portReady = await waitForPortReady('127.0.0.1', PROJECT_DEV_PORT, { maxWaitMs: 20000, intervalMs: 300 });
                if (!portReady) {
                    console.warn(`[FileSystemTools] Dev server port ${PROJECT_DEV_PORT} did not become ready within 20s, opening browser anyway.`);
                } else {
                    console.log(`[FileSystemTools] Dev server port ${PROJECT_DEV_PORT} TCP ready, waiting for HTTP...`);
                    const httpReady = await waitForHttpReady(PROJECT_DEV_PORT, { maxRetries: 10, intervalMs: 800 });
                    if (httpReady) {
                        console.log(`[FileSystemTools] Dev server HTTP ready on port ${PROJECT_DEV_PORT}.`);
                    } else {
                        console.warn(`[FileSystemTools] Dev server port ${PROJECT_DEV_PORT} HTTP did not respond in time, opening browser anyway.`);
                    }
                }
                
                // 检测收集到的错误
                const allErrors = ErrorDetector.detectFromOutput(stdoutBuffer + stderrBuffer, workingDir);
                const uniqueErrors = this.deduplicateErrors([...detectedErrors, ...allErrors]);
                
                const url = `http://localhost:${PROJECT_DEV_PORT}`;
                let result = `[Dev server started in background]\n\nCommand: ${runCommand}\nWorking directory: ${workingDir}\nNode.js: ${nodePath}\nnpm: ${npmPath || 'builtin'}\n\nPreview URL: ${url}\n\nThe development server is running on port ${PROJECT_DEV_PORT}. Use open_browser_preview to display it in the built-in browser.`;
                
                // 如果有错误，添加到结果中
                if (uniqueErrors.length > 0) {
                    result += `\n\n⚠️ Detected ${uniqueErrors.length} error(s) during startup:\n`;
                    for (const error of uniqueErrors) {
                        result += `- ${error.type}: ${error.message}`;
                        if (error.packageName) {
                            result += ` (package: ${error.packageName})`;
                        }
                        result += '\n';
                    }
                    result += '\nThese errors will be automatically fixed if possible.';
                }
                
                return result;
            }

            // 预览服务器命令：后台运行，Vite 默认 4173，便于内置浏览器预览构建结果
            if (isPreviewServerCommand) {
                const PROJECT_PREVIEW_PORT = 4173;
                await this.killProcessOnPort(PROJECT_PREVIEW_PORT);

                console.log(`[FileSystemTools] Starting preview server with command: ${command}`);
                const child = spawn(command, [], {
                    cwd: workingDir,
                    env: env,
                    shell: resolvedShell,
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

                FileSystemTools.childProcesses.add(child);
                FileSystemTools.activePorts.add(PROJECT_PREVIEW_PORT);

                child.on('exit', () => {
                    FileSystemTools.childProcesses.delete(child);
                    FileSystemTools.activePorts.delete(PROJECT_PREVIEW_PORT);
                });

                child.unref();

                console.log(`[FileSystemTools] Waiting for preview server to start on port ${PROJECT_PREVIEW_PORT}...`);
                await waitForPortReady('127.0.0.1', PROJECT_PREVIEW_PORT, { maxWaitMs: 15000, intervalMs: 300 });

                const url = `http://localhost:${PROJECT_PREVIEW_PORT}`;
                return `[Preview server started in background]\n\nCommand: ${command}\nWorking directory: ${workingDir}\n\nPreview URL: ${url}\n\nThe preview server is running on port ${PROJECT_PREVIEW_PORT}. Use open_browser_preview to display it in the built-in browser.`;
            }

            if (Object.keys(playwrightEnv).length > 0) {
                console.log(`[FileSystemTools] Playwright env vars: ${JSON.stringify(playwrightEnv)}`);
            }
            if (Object.keys(npmEnv).length > 0) {
                console.log(`[FileSystemTools] npm env vars: ${JSON.stringify(npmEnv)}`);
            }
            
            const { stdout, stderr } = await execAsync(command, {
                cwd: workingDir,
                env: env,
                timeout: timeout,
                maxBuffer: 1024 * 1024 * 10,
                encoding: 'utf-8',
                shell: resolvedShell,
            });

            // 如果是自动化测试命令，执行完成后清理 Chrome for Testing 进程
            if (isAutomationTest) {
                await this.cleanupChromeForTesting();
            }

            let result = `Command executed in ${workingDir}:\n$ ${command}\n\n`;
            if (stdout) result += `STDOUT:\n${stdout}\n`;
            if (stderr) result += `STDERR:\n${stderr}\n`;
            return result || 'Command completed with no output.';
        } catch (error: unknown) {
            // 即使命令失败，如果是自动化测试命令，也要清理 Chrome for Testing 进程
            if (isAutomationTest) {
                await this.cleanupChromeForTesting();
            }

            const err = error as { stdout?: string; stderr?: string; message?: string };
            let errorMsg = `Command failed in ${workingDir}:\n$ ${command}\n\n`;
            if (err.stdout) errorMsg += `STDOUT:\n${err.stdout}\n`;
            if (err.stderr) errorMsg += `STDERR:\n${err.stderr}\n`;
            errorMsg += `Error: ${err.message || String(error)}`;
            return errorMsg;
        }
    }

    /**
     * 确保存在“不打开浏览器”的假命令目录，用于劫持 open/xdg-open
     * macOS: 劫持 open；Linux: 劫持 xdg-open
     * 返回目录路径，失败时返回 null
     */
    /**
     * 去重错误列表（基于错误类型和包名/导入路径）
     */
    private deduplicateErrors(errors: DetectedError[]): DetectedError[] {
        const seen = new Set<string>();
        const unique: DetectedError[] = [];
        
        for (const error of errors) {
            const key = `${error.type}:${error.packageName || error.importPath || error.message}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(error);
            }
        }
        
        return unique;
    }

    private parseDevServerPort(command: string, cwd: string): number {
        const lower = command.toLowerCase();
        if (lower.includes('5173') || lower.includes('vite')) return 5173;
        if (lower.includes('8080')) return 8080;
        if (lower.includes('4173')) return 4173;
        try {
            const pkgPath = path.join(cwd, 'package.json');
            const content = fsSync.readFileSync(pkgPath, 'utf-8');
            const pkg = JSON.parse(content);
            const scripts = pkg.scripts || {};
            const devScript = (scripts.dev || scripts.start || '').toString();
            if (/5173|vite/.test(devScript)) return 5173;
            if (/8080/.test(devScript)) return 8080;
            if (fsSync.existsSync(path.join(cwd, 'vite.config.js'))) return 5173;
        } catch {
            /* ignore */
        }
        return 3000;
    }

    private ensureNoBrowserScriptDir(): string | null {
        try {
            const dir = path.join(os.tmpdir(), 'opencowork-no-browser');
            fsSync.mkdirSync(dir, { recursive: true });
            const scriptName = process.platform === 'darwin' ? 'open' : 'xdg-open';
            const scriptPath = path.join(dir, scriptName);
            const scriptContent = '#!/bin/sh\nexit 0\n';
            fsSync.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
            return dir;
        } catch (e) {
            console.warn('[FileSystemTools] Failed to create no-browser script:', e);
            return null;
        }
    }

    /**
     * 获取占用指定端口的进程 PID 列表（仅 LISTEN 状态）
     */
    private async getPidsOnPort(port: number): Promise<number[]> {
        try {
            if (process.platform === 'darwin' || process.platform === 'linux') {
                const { stdout } = await execAsync(`lsof -ti :${port}`, {
                    timeout: 3000,
                    maxBuffer: 4096,
                    encoding: 'utf-8'
                });
                const pids = stdout.trim().split(/\s+/).filter(Boolean).map((s) => parseInt(s, 10));
                return pids.filter((n) => !isNaN(n) && n > 0);
            }
            if (process.platform === 'win32') {
                const { stdout } = await execAsync(`netstat -ano | findstr ":${port}"`, {
                    timeout: 3000,
                    maxBuffer: 65536,
                    encoding: 'utf-8',
                    shell: 'cmd.exe'
                });
                const pids: number[] = [];
                const lines = stdout.trim().split(/\r?\n/).filter((line) => line.includes(`:${port}`) && line.includes('LISTENING'));
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    const last = parts[parts.length - 1];
                    const pid = parseInt(last, 10);
                    if (!isNaN(pid) && pid > 0) pids.push(pid);
                }
                return [...new Set(pids)];
            }
        } catch (e) {
            const err = e as { code?: number };
            if (err.code === 1) return [];
        }
        return [];
    }

    /**
     * 若指定端口被占用，则结束占用该端口的进程，以便开发服务器能正常启动
     */
    private async killProcessOnPort(port: number): Promise<void> {
        const pids = await this.getPidsOnPort(port);
        if (pids.length === 0) return;
        console.log(`[FileSystemTools] Port ${port} is in use by PIDs: ${pids.join(', ')}, killing before starting dev server.`);
        try {
            if (process.platform === 'darwin' || process.platform === 'linux') {
                for (const pid of pids) {
                    await execAsync(`kill -9 ${pid}`, { timeout: 3000 });
                }
                console.log(`[FileSystemTools] Killed process(es) on port ${port}.`);
            } else if (process.platform === 'win32') {
                for (const pid of pids) {
                    await execAsync(`taskkill /PID ${pid} /F`, {
                        timeout: 3000,
                        shell: 'cmd.exe'
                    });
                }
                console.log(`[FileSystemTools] Killed process(es) on port ${port}.`);
            }
        } catch (e) {
            console.warn(`[FileSystemTools] Failed to kill process on port ${port}:`, (e as Error).message);
        }
        await new Promise((r) => setTimeout(r, 500));
    }

    /**
     * 终止用户项目的 dev 服务（仅 port 3000），排除 OpenCowork 自身进程
     * 避免误杀 OpenCowork 的 Vite 服务（5173）导致整客户端刷新
     */
    async killProjectDevServer(_args: { cwd: string }): Promise<string> {
        const PROJECT_DEV_PORT = 3000;
        const appRoot = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : '';

        const pids = await this.getPidsOnPort(PROJECT_DEV_PORT);
        if (pids.length === 0) {
            return `Port ${PROJECT_DEV_PORT} 上暂无进程，开发服务可能已关闭。`;
        }

        const toKill: number[] = [];
        if (process.platform === 'darwin' || process.platform === 'linux') {
            for (const pid of pids) {
                try {
                    const { stdout } = await execAsync(`ps -o cwd= -p ${pid}`, {
                        timeout: 2000,
                        maxBuffer: 2048,
                        encoding: 'utf-8'
                    });
                    const cwd = (stdout || '').trim();
                    const cwdNorm = cwd ? path.resolve(cwd) : '';
                    if (appRoot && cwdNorm && (cwdNorm === appRoot || cwdNorm.startsWith(appRoot + path.sep))) {
                        console.log(`[FileSystemTools] Skipping PID ${pid} (cwd under APP_ROOT: ${cwd})`);
                        continue;
                    }
                    toKill.push(pid);
                } catch {
                    toKill.push(pid);
                }
            }
        } else {
            toKill.push(...pids);
        }

        if (toKill.length === 0) {
            return `Port ${PROJECT_DEV_PORT} 上的进程属于 OpenCowork 应用，已跳过。`;
        }

        try {
            if (process.platform === 'darwin' || process.platform === 'linux') {
                for (const pid of toKill) {
                    await execAsync(`kill -9 ${pid}`, { timeout: 3000 });
                }
                console.log(`[FileSystemTools] Killed project dev server PIDs: ${toKill.join(', ')}`);
                return `已关闭开发服务，终止了 ${toKill.length} 个进程 (PIDs: ${toKill.join(', ')})。`;
            } else if (process.platform === 'win32') {
                for (const pid of toKill) {
                    await execAsync(`taskkill /PID ${pid} /F`, { timeout: 3000, shell: 'cmd.exe' });
                }
                console.log(`[FileSystemTools] Killed project dev server PIDs: ${toKill.join(', ')}`);
                return `已关闭开发服务，终止了 ${toKill.length} 个进程 (PIDs: ${toKill.join(', ')})。`;
            }
        } catch (e) {
            const msg = (e as Error).message || String(e);
            console.warn('[FileSystemTools] Failed to kill project dev server:', msg);
            return `关闭开发服务时出错: ${msg}`;
        }
        return '当前平台不支持此操作。';
    }

    /**
     * 检测命令是否为自动化测试命令（可能启动 Chrome for Testing）
     */
    private isAutomationTestCommand(command: string): boolean {
        const cmdLower = command.toLowerCase();
        // 检测是否包含 playwright、chrome-agent、自动化测试相关关键词
        return cmdLower.includes('playwright') ||
               cmdLower.includes('chrome-agent') ||
               cmdLower.includes('chromium') ||
               (cmdLower.includes('node') && cmdLower.includes('.js') && cmdLower.includes('chrome'));
    }

    /**
     * 清理 Google Chrome for Testing 进程
     */
    private async cleanupChromeForTesting(): Promise<void> {
        try {
            console.log('[FileSystemTools] Cleaning up Google Chrome for Testing processes...');
            
            if (process.platform === 'darwin' || process.platform === 'linux') {
                // macOS 和 Linux 使用 pkill
                const cleanupCommand = 'pkill -9 -f "Google Chrome for Testing"';
                await execAsync(cleanupCommand, {
                    timeout: 5000,
                    maxBuffer: 1024 * 1024, // 1MB buffer
                    encoding: 'utf-8'
                });
                console.log('[FileSystemTools] Successfully cleaned up Google Chrome for Testing processes');
            } else if (process.platform === 'win32') {
                // Windows 使用 taskkill
                const cleanupCommand = 'taskkill /F /IM "Google Chrome for Testing.exe" /T';
                await execAsync(cleanupCommand, {
                    timeout: 5000,
                    maxBuffer: 1024 * 1024, // 1MB buffer
                    encoding: 'utf-8',
                    shell: 'powershell.exe'
                });
                console.log('[FileSystemTools] Successfully cleaned up Google Chrome for Testing processes');
            }
        } catch (error: unknown) {
            // 如果进程不存在或已退出，pkill 会返回错误，这是正常的
            const err = error as { code?: number; message?: string };
            if (err.code === 1) {
                // pkill 返回 1 表示没有找到匹配的进程，这是正常的
                console.log('[FileSystemTools] No Google Chrome for Testing processes found to clean up');
            } else {
                console.warn(`[FileSystemTools] Failed to cleanup Chrome for Testing: ${err.message || String(error)}`);
            }
        }
    }
}
