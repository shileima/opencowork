/**
 * 文件监听服务
 * File Watcher Service
 *
 * 监听文件系统变化，通知 FileChangeTracker 记录变更
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import logger from './Logger';
import path from 'path';
import { EventEmitter } from 'events';
import { FileChangeTracker } from './FileChangeTracker';

type FSWatcher = ReturnType<typeof fs.watch>;

interface WatchConfig {
    basePath: string;
    sessionId?: string;
    messageId?: string;
    toolUseId?: string;
    ignored?: RegExp[];
}

export class FileWatcher extends EventEmitter {
    private tracker: FileChangeTracker;
    private watchers: Map<string, FSWatcher> = new Map();
    private writeQueue: Map<string, NodeJS.Timeout> = new Map();
    private sessionId?: string;

    // 配置
    private readonly WRITE_DELAY = 100; // 写入延迟（毫秒），避免重复记录
    private readonly IGNORED_PATTERNS = [
        /node_modules/,
        /\.git/,
        /\.vscode/,
        /\.idea/,
        /dist/,
        /build/,
        /\.DS_Store/,
        /Thumbs\.db$/,
        /\~$/
    ];

    constructor(tracker: FileChangeTracker) {
        super();
        this.tracker = tracker;
    }

    // ============================================================
    // 监听控制
    // ============================================================

    /**
     * 开始监听目录
     */
    watch(config: WatchConfig): void {
        this.sessionId = config.sessionId;

        // 开始会话追踪
        if (config.sessionId) {
            this.tracker.startSession(config.sessionId, config.basePath);
        }

        // 递归监听目录
        this.watchDirectory(config.basePath, config.ignored);

        logger.debug(`Started watching: ${config.basePath}`);
    }

    /**
     * 停止监听目录
     */
    unwatch(basePath: string): void {
        // 关闭所有监听器
        for (const [path, watcher] of this.watchers) {
            if (path.startsWith(basePath)) {
                watcher.close();
                this.watchers.delete(path);
            }
        }

        // 清理写入队列
        for (const [path, timeout] of this.writeQueue) {
            clearTimeout(timeout);
            this.writeQueue.delete(path);
        }

        logger.debug(`Stopped watching: ${basePath}`);
    }

    /**
     * 停止所有监听
     */
    unwatchAll(): void {
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();

        for (const timeout of this.writeQueue.values()) {
            clearTimeout(timeout);
        }
        this.writeQueue.clear();

        logger.debug('[FileWatcher] Stopped all watchers');
    }

    // ============================================================
    // 私有方法
    // ============================================================

    private watchDirectory(dirPath: string, ignored?: RegExp[]): void {
        try {
            // 检查是否应该忽略此路径
            if (this.shouldIgnore(dirPath)) {
                return;
            }

            // 监听目录
            const watcher = fs.watch(dirPath, { recursive: false }, async (eventType, filename) => {
                if (!filename) return;

                const fullPath = path.join(dirPath, filename);

                // 检查是否应该忽略
                if (this.shouldIgnore(fullPath)) {
                    return;
                }

                // 处理事件
                if (eventType === 'change') {
                    await this.handleFileChange(fullPath);
                } else if (eventType === 'rename') {
                    await this.handleFileRename(fullPath);
                }
            });

            this.watchers.set(dirPath, watcher);

            // 递归监听子目录
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !this.shouldIgnore(entry.name)) {
                    const fullPath = path.join(dirPath, entry.name);
                    this.watchDirectory(fullPath, ignored);
                }
            }
        } catch (error) {
            logger.error(`Failed to watch directory: ${dirPath}`, error);
        }
    }

    private async handleFileChange(filePath: string): Promise<void> {
        try {
            // 防抖：如果已经有写入队列，先清除
            const existingTimeout = this.writeQueue.get(filePath);
            if (existingTimeout) {
                clearTimeout(existingTimeout);
            }

            // 延迟处理，避免重复记录
            const timeout = setTimeout(async () => {
                try {
                    const stats = await fsPromises.stat(filePath);

                    if (stats && stats.isFile()) {
                        // 在实际写入前先记录快照
                        await this.tracker.recordBeforeWrite(filePath);

                        // 等待一小段时间确保写入完成
                        await new Promise(resolve => setTimeout(resolve, 50));

                        // 记录变更
                        const change = await this.tracker.recordAfterWrite(
                            filePath,
                            this.sessionId || 'default'
                        );

                        if (change) {
                            this.emit('change', change);
                            this.emit('file:modified', change);
                        }
                    }
                } catch (statError) {
                    // 文件不存在或无法访问，忽略
                }

                this.writeQueue.delete(filePath);
            }, this.WRITE_DELAY);

            this.writeQueue.set(filePath, timeout);
        } catch (error) {
            logger.error(`Failed to handle file change: ${filePath}`, error);
        }
    }

    private async handleFileRename(filePath: string): Promise<void> {
        try {
            // 检查文件是否被删除
            try {
                await fsPromises.access(filePath);
            } catch {
                // 文件不存在，被删除
                const change = await this.tracker.recordDelete(
                    filePath,
                    this.sessionId || 'default'
                );

                if (change) {
                    this.emit('change', change);
                    this.emit('file:deleted', change);
                }
            }
        } catch (error) {
            logger.error(`Failed to handle file rename: ${filePath}`, error);
        }
    }

    private shouldIgnore(filePath: string): boolean {
        // 检查忽略模式
        for (const pattern of this.IGNORED_PATTERNS) {
            if (pattern.test(filePath)) {
                return true;
            }
        }

        // 检查是否为隐藏文件（以.开头）
        const basename = path.basename(filePath);
        if (basename.startsWith('.') && basename !== '.') {
            return true;
        }

        return false;
    }

    // ============================================================
    // 手动触发变更（用于 Agent 工具操作）
    // ============================================================

    /**
     * 手动记录文件写入（用于 Agent 工具写入后的通知）
     */
    async recordManualWrite(
        filePath: string,
        sessionId: string,
        messageId?: string,
        toolUseId?: string
    ): Promise<void> {
        try {
            // 记录快照（如果还未记录）
            await this.tracker.recordBeforeWrite(filePath);

            // 延迟一下确保写入完成
            await new Promise(resolve => setTimeout(resolve, 100));

            // 记录变更
            const change = await this.tracker.recordAfterWrite(
                filePath,
                sessionId,
                messageId,
                toolUseId
            );

            if (change) {
                this.emit('change', change);
                this.emit('file:modified', change);
            }
        } catch (error) {
            logger.error(`Failed to record manual write: ${filePath}`, error);
        }
    }

    /**
     * 手动记录文件删除
     */
    async recordManualDelete(
        filePath: string,
        sessionId: string,
        messageId?: string
    ): Promise<void> {
        try {
            const change = await this.tracker.recordDelete(filePath, sessionId, messageId);

            if (change) {
                this.emit('change', change);
                this.emit('file:deleted', change);
            }
        } catch (error) {
            logger.error(`Failed to record manual delete: ${filePath}`, error);
        }
    }
}
