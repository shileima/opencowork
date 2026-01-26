import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * DirectoryManager - 统一管理所有目录路径和初始化逻辑
 * 
 * 提供统一的目录管理接口，区分开发环境和生产环境，
 * 确保所有目录在使用前都已正确创建。
 */
export class DirectoryManager {
    private static instance: DirectoryManager;
    private baseDir: string;
    private initialized: boolean = false;

    private constructor() {
        // 客户端运行目录：~/.qa-cowork/ (macOS/Linux) 或 %USERPROFILE%\.qa-cowork\ (Windows)
        this.baseDir = path.join(os.homedir(), '.qa-cowork');
    }

    /**
     * 获取 DirectoryManager 单例实例
     */
    public static getInstance(): DirectoryManager {
        if (!DirectoryManager.instance) {
            DirectoryManager.instance = new DirectoryManager();
        }
        return DirectoryManager.instance;
    }

    /**
     * 初始化所有目录结构
     * 确保所有必要的目录都存在
     */
    public initialize(): void {
        if (this.initialized) {
            return;
        }

        console.log('[DirectoryManager] Initializing directories...');
        console.log(`[DirectoryManager] Base directory: ${this.baseDir}`);

        // 创建基础目录
        this.ensureDirectory(this.baseDir);

        // 创建子目录
        this.ensureDirectory(this.getConfigDir());
        this.ensureDirectory(this.getSkillsDir());
        this.ensureDirectory(this.getScriptsDir());
        this.ensureDirectory(this.getMcpDir());
        this.ensureDirectory(this.getCacheDir());
        this.ensureDirectory(this.getLogsDir());

        this.initialized = true;
        console.log('[DirectoryManager] Directory initialization complete');
    }

    /**
     * 确保目录存在，如果不存在则创建
     */
    private ensureDirectory(dirPath: string): void {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(`[DirectoryManager] Created directory: ${dirPath}`);
        }
    }

    /**
     * 获取基础目录路径 (~/.qa-cowork/)
     */
    public getBaseDir(): string {
        return this.baseDir;
    }

    /**
     * 获取配置目录路径 (~/.qa-cowork/config/)
     */
    public getConfigDir(): string {
        return path.join(this.baseDir, 'config');
    }

    /**
     * 获取技能目录路径 (~/.qa-cowork/skills/)
     */
    public getSkillsDir(): string {
        return path.join(this.baseDir, 'skills');
    }

    /**
     * 获取自动化脚本目录路径 (~/.qa-cowork/skills/chrome-agent/)
     */
    public getScriptsDir(): string {
        return path.join(this.baseDir, 'skills', 'chrome-agent');
    }

    /**
     * 获取MCP配置目录路径 (~/.qa-cowork/mcp/)
     */
    public getMcpDir(): string {
        return path.join(this.baseDir, 'mcp');
    }

    /**
     * 获取缓存目录路径 (~/.qa-cowork/cache/)
     */
    public getCacheDir(): string {
        return path.join(this.baseDir, 'cache');
    }

    /**
     * 获取日志目录路径 (~/.qa-cowork/logs/)
     */
    public getLogsDir(): string {
        return path.join(this.baseDir, 'logs');
    }

    /**
     * 获取热更新目录路径 (~/.qa-cowork/hot-update/)
     * 用于存储从远程下载的更新资源
     */
    public getHotUpdateDir(): string {
        return path.join(this.baseDir, 'hot-update');
    }

    /**
     * 获取热更新前端资源目录 (~/.qa-cowork/hot-update/dist/)
     */
    public getHotUpdateDistDir(): string {
        return path.join(this.getHotUpdateDir(), 'dist');
    }

    /**
     * 获取热更新技能目录 (~/.qa-cowork/hot-update/resources/skills/)
     * 注意：保持与 manifest 中的路径结构一致
     */
    public getHotUpdateSkillsDir(): string {
        return path.join(this.getHotUpdateDir(), 'resources', 'skills');
    }

    /**
     * 获取热更新MCP目录 (~/.qa-cowork/hot-update/resources/mcp/)
     * 注意：保持与 manifest 中的路径结构一致
     */
    public getHotUpdateMcpDir(): string {
        return path.join(this.getHotUpdateDir(), 'resources', 'mcp');
    }

    /**
     * 获取热更新版本清单文件路径
     */
    public getHotUpdateManifestPath(): string {
        return path.join(this.getHotUpdateDir(), 'manifest.json');
    }

    /**
     * 获取热更新版本号
     * @returns 热更新版本号，如果没有热更新则返回 null
     */
    public getHotUpdateVersion(): string | null {
        try {
            const manifestPath = this.getHotUpdateManifestPath();
            console.log(`[DirectoryManager] Checking hot update manifest at: ${manifestPath}`);
            if (fs.existsSync(manifestPath)) {
                const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
                const manifest = JSON.parse(manifestContent);
                const version = manifest.version || null;
                console.log(`[DirectoryManager] Found hot update version: ${version}`);
                return version;
            } else {
                console.log(`[DirectoryManager] Hot update manifest not found at: ${manifestPath}`);
            }
        } catch (error) {
            console.error('[DirectoryManager] Failed to read hot update version:', error);
        }
        return null;
    }

    /**
     * 检查热更新目录中是否存在指定文件
     */
    public hasHotUpdateFile(relativePath: string): boolean {
        const hotPath = path.join(this.getHotUpdateDir(), relativePath);
        return fs.existsSync(hotPath);
    }

    /**
     * 获取资源的有效路径（优先热更新，其次内置）
     * @param relativePath 相对路径，如 'skills/xxx' 或 'mcp/xxx'
     * @returns 实际可用的文件路径
     */
    public resolveResourcePath(relativePath: string): string {
        // 优先使用热更新目录
        const hotPath = path.join(this.getHotUpdateDir(), relativePath);
        if (fs.existsSync(hotPath)) {
            return hotPath;
        }
        // 回退到内置资源目录
        return path.join(this.getBuiltinResourcesDir(), relativePath);
    }

    /**
     * 获取内置资源目录路径（开发环境和生产环境）
     * 
     * 开发环境：项目根目录/resources/
     * 生产环境：process.resourcesPath/resources/ 或 process.resourcesPath/
     */
    public getBuiltinResourcesDir(): string {
        const possiblePaths: string[] = [];

        if (app.isPackaged) {
            // 生产环境
            possiblePaths.push(
                path.join(process.resourcesPath, 'resources'),
                path.join(process.resourcesPath, 'app.asar.unpacked', 'resources'),
                process.resourcesPath
            );
        } else {
            // 开发环境
            possiblePaths.push(
                path.join(process.cwd(), 'resources'),
                path.join(__dirname, '..', '..', 'resources')
            );
        }

        // 尝试找到存在的路径
        for (const testPath of possiblePaths) {
            if (fs.existsSync(testPath)) {
                return testPath;
            }
        }

        // 如果都不存在，返回第一个可能的路径（用于创建）
        return possiblePaths[0] || path.join(process.cwd(), 'resources');
    }

    /**
     * 获取内置技能目录路径
     */
    public getBuiltinSkillsDir(): string {
        return path.join(this.getBuiltinResourcesDir(), 'skills');
    }

    /**
     * 获取内置MCP配置目录路径
     */
    public getBuiltinMcpDir(): string {
        return path.join(this.getBuiltinResourcesDir(), 'mcp');
    }

    /**
     * 获取内置MCP配置文件路径
     */
    public getBuiltinMcpConfigPath(): string {
        return path.join(this.getBuiltinMcpDir(), 'builtin-mcp.json');
    }

    /**
     * 获取用户MCP配置文件路径
     */
    public getUserMcpConfigPath(): string {
        return path.join(this.getMcpDir(), 'mcp.json');
    }

    /**
     * 获取用户MCP存储文件路径
     */
    public getUserMcpStoragePath(): string {
        return path.join(this.getMcpDir(), 'mcp_storage.json');
    }

    /**
     * 验证目录是否存在且可访问
     */
    public validateDirectory(dirPath: string): boolean {
        try {
            if (!fs.existsSync(dirPath)) {
                return false;
            }
            const stats = fs.statSync(dirPath);
            return stats.isDirectory();
        } catch (error) {
            console.error(`[DirectoryManager] Error validating directory ${dirPath}:`, error);
            return false;
        }
    }

    /**
     * 获取所有目录路径信息（用于UI显示）
     */
    public getAllPaths(): {
        baseDir: string;
        configDir: string;
        skillsDir: string;
        scriptsDir: string;
        mcpDir: string;
        cacheDir: string;
        logsDir: string;
        builtinResourcesDir: string;
        builtinSkillsDir: string;
        builtinMcpDir: string;
        hotUpdateDir: string;
        hotUpdateDistDir: string;
        hotUpdateSkillsDir: string;
        hotUpdateMcpDir: string;
    } {
        return {
            baseDir: this.getBaseDir(),
            configDir: this.getConfigDir(),
            skillsDir: this.getSkillsDir(),
            scriptsDir: this.getScriptsDir(),
            mcpDir: this.getMcpDir(),
            cacheDir: this.getCacheDir(),
            logsDir: this.getLogsDir(),
            builtinResourcesDir: this.getBuiltinResourcesDir(),
            builtinSkillsDir: this.getBuiltinSkillsDir(),
            builtinMcpDir: this.getBuiltinMcpDir(),
            hotUpdateDir: this.getHotUpdateDir(),
            hotUpdateDistDir: this.getHotUpdateDistDir(),
            hotUpdateSkillsDir: this.getHotUpdateSkillsDir(),
            hotUpdateMcpDir: this.getHotUpdateMcpDir()
        };
    }
}

// 导出单例实例
export const directoryManager = DirectoryManager.getInstance();
