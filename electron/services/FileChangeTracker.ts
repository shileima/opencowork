/**
 * 文件变更追踪服务
 * File Change Tracker Service
 *
 * 追踪所有文件操作（新增、修改、删除）
 * 保存文件快照用于对比
 * 提供变更历史查询
 */

import fs from 'fs/promises';
import logger from './Logger';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
    FileChange,
    FileChangeType,
    FileSnapshot,
    SessionFileMap
} from '../../src/types/fileTracker';

export class FileChangeTracker {
    private changes: Map<string, FileChange[]> = new Map();
    private snapshots: Map<string, FileSnapshot> = new Map();
    private sessionFiles: Map<string, SessionFileMap> = new Map();
    private basePath: string;

    // 内存限制：最多保留多少个变更记录
    private readonly MAX_CHANGES_PER_FILE = 50;
    private readonly MAX_SNAPSHOTS = 100;

    constructor(basePath: string) {
        this.basePath = basePath;
    }

    // ============================================================
    // 文件操作追踪
    // ============================================================

    /**
     * 记录文件变更（在文件写入前调用）
     */
    async recordBeforeWrite(filePath: string): Promise<void> {
        try {
            const fullPath = this.resolvePath(filePath);
            const stats = await fs.stat(fullPath).catch(() => null);

            if (stats && stats.isFile()) {
                // 文件存在，保存当前内容作为快照
                const content = await fs.readFile(fullPath, 'utf-8');
                const snapshot: FileSnapshot = {
                    path: fullPath,
                    content,
                    timestamp: Date.now(),
                    hash: this.hashContent(content),
                    size: stats.size
                };

                this.snapshots.set(fullPath, snapshot);
            }
        } catch (error) {
            logger.error(`Failed to record before write: ${filePath}`, error);
        }
    }

    /**
     * 记录文件变更（在文件写入后调用）
     */
    async recordAfterWrite(
        filePath: string,
        sessionId: string,
        messageId?: string,
        toolUseId?: string
    ): Promise<FileChange | null> {
        try {
            const fullPath = this.resolvePath(filePath);
            const stats = await fs.stat(fullPath);
            const content = await fs.readFile(fullPath, 'utf-8');
            const snapshot = this.snapshots.get(fullPath);

            // 判断变更类型
            let changeType: FileChangeType;
            if (!snapshot) {
                changeType = 'created';
            } else if (snapshot.hash !== this.hashContent(content)) {
                changeType = 'modified';
            } else {
                // 内容没变化，不记录
                return null;
            }

            // 创建变更记录
            const change: FileChange = {
                id: uuidv4(),
                path: fullPath,
                type: changeType,
                timestamp: Date.now(),
                size: stats.size,
                oldContent: snapshot?.content,
                newContent: content,
                sessionId,
                messageId,
                toolUseId
            };

            // 保存变更
            if (!this.changes.has(fullPath)) {
                this.changes.set(fullPath, []);
            }

            const fileChanges = this.changes.get(fullPath)!;
            fileChanges.push(change);

            // 限制变更记录数量
            if (fileChanges.length > this.MAX_CHANGES_PER_FILE) {
                fileChanges.shift(); // 移除最旧的记录
            }

            // 更新会话文件映射
            this.updateSessionFileMap(sessionId, fullPath);

            // 更新快照
            const newSnapshot: FileSnapshot = {
                path: fullPath,
                content,
                timestamp: Date.now(),
                hash: this.hashContent(content),
                size: stats.size
            };
            this.snapshots.set(fullPath, newSnapshot);

            // 限制快照数量
            if (this.snapshots.size > this.MAX_SNAPSHOTS) {
                const oldestKey = Array.from(this.snapshots.entries())
                    .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
                this.snapshots.delete(oldestKey);
            }

            logger.debug(`Recorded change: ${changeType} - ${filePath}`);
            return change;
        } catch (error) {
            logger.error(`Failed to record after write: ${filePath}`, error);
            return null;
        }
    }

    /**
     * 记录文件删除
     */
    async recordDelete(
        filePath: string,
        sessionId: string,
        messageId?: string
    ): Promise<FileChange | null> {
        try {
            const fullPath = this.resolvePath(filePath);
            const snapshot = this.snapshots.get(fullPath);

            const change: FileChange = {
                id: uuidv4(),
                path: fullPath,
                type: 'deleted',
                timestamp: Date.now(),
                oldContent: snapshot?.content,
                sessionId,
                messageId
            };

            // 保存变更
            if (!this.changes.has(fullPath)) {
                this.changes.set(fullPath, []);
            }

            const fileChanges = this.changes.get(fullPath)!;
            fileChanges.push(change);

            // 清理快照
            this.snapshots.delete(fullPath);

            // 更新会话文件映射
            this.updateSessionFileMap(sessionId, fullPath);

            logger.debug(`Recorded delete: ${filePath}`);
            return change;
        } catch (error) {
            logger.error(`Failed to record delete: ${filePath}`, error);
            return null;
        }
    }

    // ============================================================
    // 查询方法
    // ============================================================

    /**
     * 获取文件的所有变更记录
     */
    getChanges(filePath: string): FileChange[] {
        const fullPath = this.resolvePath(filePath);
        return this.changes.get(fullPath) || [];
    }

    /**
     * 获取会话的所有变更
     */
    getSessionChanges(sessionId: string): FileChange[] {
        const sessionMap = this.sessionFiles.get(sessionId);
        if (!sessionMap) {
            return [];
        }

        const allChanges: FileChange[] = [];
        for (const filePath of sessionMap.files) {
            const fileChanges = this.changes.get(filePath) || [];
            allChanges.push(...fileChanges.filter(c => c.sessionId === sessionId));
        }

        return allChanges.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * 获取最近的变更
     */
    getRecentChanges(limit: number = 100): FileChange[] {
        const allChanges: FileChange[] = [];
        for (const changes of this.changes.values()) {
            allChanges.push(...changes);
        }

        return allChanges
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * 获取文件统计
     */
    getStatistics(sessionId?: string): {
        totalFiles: number;
        createdFiles: number;
        modifiedFiles: number;
        deletedFiles: number;
        totalSize: number;
    } {
        const changes = sessionId
            ? this.getSessionChanges(sessionId)
            : this.getRecentChanges(1000);

        return {
            totalFiles: new Set(changes.map(c => c.path)).size,
            createdFiles: changes.filter(c => c.type === 'created').length,
            modifiedFiles: changes.filter(c => c.type === 'modified').length,
            deletedFiles: changes.filter(c => c.type === 'deleted').length,
            totalSize: changes.reduce((sum, c) => sum + (c.size || 0), 0)
        };
    }

    /**
     * 生成文件差异
     */
    async generateDiff(filePath: string, fromId?: string, toId?: string): Promise<{
        oldContent: string | null;
        newContent: string | null;
        changes: Array<{
            type: 'added' | 'removed' | 'unchanged';
            content: string;
        }>;
    } | null> {
        try {
            const fullPath = this.resolvePath(filePath);
            const fileChanges = this.changes.get(fullPath) || [];

            if (fileChanges.length === 0) {
                return null;
            }

            // 如果指定了版本ID，使用指定的版本
            let oldChange: FileChange | null = null;
            let newChange: FileChange | null = null;

            if (fromId && toId) {
                oldChange = fileChanges.find(c => c.id === fromId) || null;
                newChange = fileChanges.find(c => c.id === toId) || null;
            } else {
                // 默认对比第一个和最后一个变更
                oldChange = fileChanges[0];
                newChange = fileChanges[fileChanges.length - 1];
            }

            if (!oldChange || !newChange) {
                return null;
            }

            // 生成差异
            const changes = this.computeDiff(
                oldChange.oldContent || '',
                newChange.newContent || ''
            );

            return {
                oldContent: oldChange.oldContent || null,
                newContent: newChange.newContent || null,
                changes
            };
        } catch (error) {
            logger.error(`Failed to generate diff: ${filePath}`, error);
            return null;
        }
    }

    // ============================================================
    // 会话管理
    // ============================================================

    /**
     * 开始新的会话追踪
     */
    startSession(sessionId: string, rootPath: string): void {
        const sessionMap: SessionFileMap = {
            sessionId,
            files: [],
            changes: [],
            rootPath
        };

        this.sessionFiles.set(sessionId, sessionMap);
        logger.debug(`Started tracking session: ${sessionId}`);
    }

    /**
     * 结束会话追踪
     */
    endSession(sessionId: string): SessionFileMap | null {
        const sessionMap = this.sessionFiles.get(sessionId);
        if (sessionMap) {
            logger.debug(`Ended tracking session: ${sessionId}`);
            // 暂时不删除，保留历史记录
        }
        return sessionMap || null;
    }

    /**
     * 获取会话信息
     */
    getSession(sessionId: string): SessionFileMap | null {
        return this.sessionFiles.get(sessionId) || null;
    }

    /**
     * 清理会话数据（可选）
     */
    cleanupSession(sessionId: string): void {
        this.sessionFiles.delete(sessionId);
        logger.debug(`Cleaned up session: ${sessionId}`);
    }

    // ============================================================
    // 工具方法
    // ============================================================

    private resolvePath(filePath: string): string {
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.resolve(this.basePath, filePath);
    }

    private hashContent(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    private updateSessionFileMap(sessionId: string, filePath: string): void {
        const sessionMap = this.sessionFiles.get(sessionId);
        if (sessionMap) {
            if (!sessionMap.files.includes(filePath)) {
                sessionMap.files.push(filePath);
            }
        }
    }

    private computeDiff(oldContent: string, newContent: string): Array<{
        type: 'added' | 'removed' | 'unchanged';
        content: string;
    }> {
        // 简单的逐行差异对比
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        const changes: Array<{ type: 'added' | 'removed' | 'unchanged'; content: string }> = [];

        let oldIndex = 0;
        let newIndex = 0;

        while (oldIndex < oldLines.length || newIndex < newLines.length) {
            if (oldIndex >= oldLines.length) {
                // 只有新行
                changes.push({ type: 'added', content: newLines[newIndex] });
                newIndex++;
            } else if (newIndex >= newLines.length) {
                // 只有旧行
                changes.push({ type: 'removed', content: oldLines[oldIndex] });
                oldIndex++;
            } else if (oldLines[oldIndex] === newLines[newIndex]) {
                // 行相同
                changes.push({ type: 'unchanged', content: newLines[newIndex] });
                oldIndex++;
                newIndex++;
            } else {
                // 行不同
                changes.push({ type: 'removed', content: oldLines[oldIndex] });
                changes.push({ type: 'added', content: newLines[newIndex] });
                oldIndex++;
                newIndex++;
            }
        }

        return changes;
    }
}
