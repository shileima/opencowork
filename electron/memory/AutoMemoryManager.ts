import fs from 'fs/promises';
import logger from '../services/Logger';
import path from 'path';
import os from 'os';

// ============================================================
// 自动记忆管理器 - 完全自动化，用户无感知
// ============================================================

export interface MemoryFile {
    path: string;
    name: string;
    size: number;
    type: 'global' | 'project';
    modified: Date;
}

export interface ImportantInfo {
    decisions: Array<{ context: string; response: string }>;
    progress: string | null;
    userPreferences: Array<{ key: string; value: string }>;
    knowledge: Array<{ topic: string; content: string }>;
}

export class AutoMemoryManager {
    private globalMemoryDir: string;
    private projectMemoryDir: string | null;
    private initPromise: Promise<void>;

    constructor(projectPath?: string) {
        this.globalMemoryDir = path.join(os.homedir(), '.opencowork', 'memories');
        this.projectMemoryDir = projectPath
            ? path.join(os.homedir(), '.opencowork', 'projects', this.hashPath(projectPath), 'memories')
            : null;

        // Initialize directories asynchronously and store the promise
        this.initPromise = this.ensureDirectories();
    }

    // 确保在使用前完成初始化
    private async ensureInitialized(): Promise<void> {
        await this.initPromise;
    }

    private async ensureDirectories(): Promise<void> {
        try {
            await fs.mkdir(this.globalMemoryDir, { recursive: true });
        } catch (error) {
            // Directory already exists or other error, ignore
        }
        if (this.projectMemoryDir) {
            try {
                await fs.mkdir(this.projectMemoryDir, { recursive: true });
            } catch (error) {
                // Directory already exists or other error, ignore
            }
        }
    }

    // 生成项目路径的哈希（作为项目 ID）
    private hashPath(projectPath: string): string {
        // 简单哈希：将路径中的特殊字符替换为下划线
        return projectPath
            .replace(/[\\/]/g, '_')
            .replace(/[^a-zA-Z0-9_]/g, '_')
            .toLowerCase()
            .substring(0, 50);
    }

    // ============================================================
    // Agent 调用：检查相关记忆（静默，用户看不到）
    // ============================================================

    async checkRelevantMemories(task: string): Promise<string> {
        try {
            await this.ensureInitialized();  // 确保目录已初始化

            let context = '';

            // 1. 检查全局记忆
            const globalMemories = await this.searchMemories(task, 'global');
            if (globalMemories.length > 0) {
                context += '\n### Global Memories\n';
                for (const file of globalMemories) {
                    const content = await this.readMemory(file.path);
                    context += `\n${content}\n`;
                }
            }

            // 2. 检查项目记忆
            if (this.projectMemoryDir) {
                const projectMemories = await this.searchMemories(task, 'project');
                if (projectMemories.length > 0) {
                    context += '\n### Project Memories\n';
                    for (const file of projectMemories) {
                        const content = await this.readMemory(file.path);
                        context += `\n${content}\n`;
                    }
                }
            }

            return context;
        } catch (error) {
            logger.error('[AutoMemory] Failed to check memories:', error);
            return '';
        }
    }

    // ============================================================
    // Agent 调用：分析并保存重要信息（后台，用户看不到）
    // ============================================================

    async analyzeAndSave(userMessage: string, assistantResponse: string): Promise<void> {
        // 后台分析，不阻塞主流程
        setImmediate(async () => {
            try {
                // 1. 提取重要信息
                const importantInfo = await this.extractImportantInfo(userMessage, assistantResponse);

                // 2. 自动保存到记忆
                await this.saveToMemory(importantInfo);

                logger.debug('[AutoMemory] Important information saved to memory');
            } catch (error) {
                logger.error('[AutoMemory] Failed to save:', error);
            }
        });
    }

    // ============================================================
    // 内部方法：搜索相关记忆
    // ============================================================

    private async searchMemories(query: string, type: 'global' | 'project'): Promise<MemoryFile[]> {
        try {
            const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
            const files = await this.listMemoryFiles(type);

            // 简单的关键词匹配
            return files.filter(file => {
                const fileName = file.name.toLowerCase();
                return keywords.some(keyword => fileName.includes(keyword));
            });
        } catch (error) {
            logger.error('[AutoMemory] Failed to search memories:', error);
            return [];
        }
    }

    // ============================================================
    // 内部方法：提取重要信息
    // ============================================================

    private async extractImportantInfo(userMessage: string, assistantResponse: string): Promise<ImportantInfo> {
        const info: ImportantInfo = {
            decisions: [],
            progress: null,
            userPreferences: [],
            knowledge: []
        };

        // 检测决策模式
        const decisionPatterns = [
            /(?:决定|选择|decided|choose|使用|use|采用|adopt)/i,
            /(?:应该|should|will|将要)/i
        ];

        for (const pattern of decisionPatterns) {
            if (pattern.test(userMessage) || pattern.test(assistantResponse)) {
                info.decisions.push({
                    context: userMessage,
                    response: assistantResponse
                });
                break;
            }
        }

        // 检测用户偏好模式
        const preferencePatterns = [
            /(?:我喜欢|我偏好|i prefer|i like)/i,
            /(?:风格|style|习惯|habit)/i,
            /(?:总是|usually|always|typically)/i
        ];

        for (const pattern of preferencePatterns) {
            const match = userMessage.match(pattern);
            if (match && match.index !== undefined) {
                // 提取偏好的关键内容
                const content = userMessage.substring(match.index, match.index + 100);
                info.userPreferences.push({
                    key: 'preference',
                    value: content.trim()
                });
            }
        }

        // 检测知识/学习模式
        if (userMessage.includes('学到了') || userMessage.includes('learned') || userMessage.includes('发现')) {
            info.knowledge.push({
                topic: userMessage.substring(0, 50),
                content: assistantResponse
            });
        }

        return info;
    }

    // ============================================================
    // 内部方法：保存到记忆
    // ============================================================

    private async saveToMemory(info: ImportantInfo): Promise<void> {
        const timestamp = new Date().toISOString();

        // 保存决策到项目记忆
        if (info.decisions.length > 0 && this.projectMemoryDir) {
            const decisionsPath = path.join(this.projectMemoryDir, 'decisions.md');
            await this.appendMemory(decisionsPath, `
## Decision - ${timestamp}
${info.decisions.map(d => `- **Context**: ${d.context}\n- **Response**: ${d.response}`).join('\n\n')}
`);
        }

        // 保存用户偏好到全局记忆
        if (info.userPreferences.length > 0) {
            const preferencesPath = path.join(this.globalMemoryDir, 'user_preferences.md');
            await this.appendMemory(preferencesPath, `
- ${info.userPreferences.map(p => `${p.key}: ${p.value}`).join(', ')} (${timestamp})
`);
        }

        // 保存知识到全局记忆
        if (info.knowledge.length > 0) {
            const knowledgePath = path.join(this.globalMemoryDir, 'knowledge.md');
            await this.appendMemory(knowledgePath, `
## ${info.knowledge[0].topic} - ${timestamp}
${info.knowledge.map(k => k.content).join('\n\n')}
`);
        }
    }

    // ============================================================
    // 基础文件操作
    // ============================================================

    async readMemory(memoryPath: string): Promise<string> {
        try {
            await this.ensureInitialized();  // 确保目录已初始化

            const fullPath = this.resolveMemoryPath(memoryPath);
            const content = await fs.readFile(fullPath, 'utf-8');
            return content;
        } catch (error) {
            logger.error(`Failed to read memory: ${memoryPath}`, error);
            return '';
        }
    }

    async appendMemory(memoryPath: string, content: string): Promise<void> {
        try {
            await this.ensureInitialized();  // 确保目录已初始化

            const fullPath = this.resolveMemoryPath(memoryPath);

            // 确保父目录存在
            const parentDir = path.dirname(fullPath);
            await fs.mkdir(parentDir, { recursive: true });

            // 追加内容
            await fs.appendFile(fullPath, content + '\n', 'utf-8');
        } catch (error) {
            logger.error(`Failed to append memory: ${memoryPath}`, error);
        }
    }

    private resolveMemoryPath(memoryPath: string): string {
        // 如果是全局记忆路径
        if (memoryPath.startsWith('/memories')) {
            return path.join(this.globalMemoryDir, memoryPath.slice('/memories'.length));
        }

        // 如果是项目记忆路径
        if (memoryPath.startsWith('~/memories') && this.projectMemoryDir) {
            return path.join(this.projectMemoryDir, memoryPath.slice('~/memories'.length));
        }

        // 默认：相对路径，视为项目记忆
        if (this.projectMemoryDir) {
            return path.join(this.projectMemoryDir, memoryPath);
        }

        return path.join(this.globalMemoryDir, memoryPath);
    }

    // ============================================================
    // 列出记忆文件（用于 UI）
    // ============================================================

    async listMemoryFiles(type: 'global' | 'project' | 'all'): Promise<MemoryFile[]> {
        await this.ensureInitialized();  // 确保目录已初始化

        const files: MemoryFile[] = [];

        if (type === 'global' || type === 'all') {
            const globalFiles = await this.listFilesInDir(this.globalMemoryDir, 'global');
            files.push(...globalFiles);
        }

        if ((type === 'project' || type === 'all') && this.projectMemoryDir) {
            const projectFiles = await this.listFilesInDir(this.projectMemoryDir, 'project');
            files.push(...projectFiles);
        }

        return files;
    }

    private async listFilesInDir(dirPath: string, type: 'global' | 'project'): Promise<MemoryFile[]> {
        try {
            const files: MemoryFile[] = [];
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.name.startsWith('.')) continue;

                const fullPath = path.join(dirPath, entry.name);
                const stat = await fs.stat(fullPath);

                if (entry.isDirectory()) {
                    // 递归列出子目录
                    const subFiles = await this.listFilesInDir(fullPath, type);
                    files.push(...subFiles);
                } else {
                    files.push({
                        path: fullPath,
                        name: entry.name,
                        size: stat.size,
                        type,
                        modified: stat.mtime
                    });
                }
            }

            return files;
        } catch (error) {
            logger.error(`Failed to list directory: ${dirPath}`, error);
            return [];
        }
    }

    // ============================================================
    // 删除记忆文件（用于 UI）
    // ============================================================

    async deleteMemory(memoryPath: string): Promise<void> {
        try {
            await this.ensureInitialized();  // 确保目录已初始化

            const fullPath = this.resolveMemoryPath(memoryPath);
            await fs.unlink(fullPath);
            logger.debug(`Deleted memory: ${memoryPath}`);
        } catch (error) {
            logger.error(`Failed to delete memory: ${memoryPath}`, error);
            throw error;
        }
    }

    // ============================================================
    // 写入记忆文件（用于 UI）
    // ============================================================

    async writeMemory(memoryPath: string, content: string): Promise<void> {
        try {
            await this.ensureInitialized();  // 确保目录已初始化

            const fullPath = this.resolveMemoryPath(memoryPath);

            // 确保父目录存在
            const parentDir = path.dirname(fullPath);
            await fs.mkdir(parentDir, { recursive: true });

            await fs.writeFile(fullPath, content, 'utf-8');
            logger.debug(`Written memory: ${memoryPath}`);
        } catch (error) {
            logger.error(`Failed to write memory: ${memoryPath}`, error);
            throw error;
        }
    }
}
