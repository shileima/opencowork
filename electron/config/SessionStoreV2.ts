import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import logger from '../services/Logger';

export interface Session {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: Anthropic.MessageParam[];
}

export interface SessionSummary {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    preview?: string;
    tags?: string[];
}

// 索引文件结构
interface SessionIndex {
    sessions: SessionSummary[];
    currentSessionId: string | null;
    currentFloatingBallSessionId: string | null;
    version: number;
}

// 会话元数据结构
interface SessionMeta {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    tags: string[];
    preview: string;
}

// 会话消息结构
interface SessionMessages {
    messages: Anthropic.MessageParam[];
}

/**
 * SessionStore V2 - 分文件存储架构
 *
 * 架构优势：
 * - 索引文件：快速加载会话列表
 * - 元数据文件：按需加载会话元数据
 * - 消息文件：按需加载完整消息
 * - 防抖写：减少磁盘 I/O
 * - LRU 缓存：提升访问速度
 */
class SessionStoreV2 {
    private indexStore: Store<SessionIndex>;
    private metaCache: Map<string, SessionMeta> = new Map();
    private messagesCache: Map<string, SessionMessages> = new Map();
    private writeThrottle: Map<string, NodeJS.Timeout> = new Map();
    private runningSessions: Set<string> = new Set();

    // 配置
    private readonly CACHE_SIZE = 50;
    private readonly WRITE_DELAY = 500;
    private readonly SESSIONS_DIR = path.join(app.getPath('userData'), 'sessions');
    private readonly META_DIR = path.join(app.getPath('userData'), 'sessions', 'meta');
    private readonly MESSAGES_DIR = path.join(app.getPath('userData'), 'sessions', 'messages');

    constructor() {
        this.indexStore = new Store<SessionIndex>({
            name: 'opencowork-sessions-index',
            defaults: {
                sessions: [],
                currentSessionId: null,
                currentFloatingBallSessionId: null,
                version: 2
            }
        });

        this.ensureDirectories();
        this.migrateIfNeeded();
    }

    private ensureDirectories(): void {
        [this.META_DIR, this.MESSAGES_DIR].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    // ========== 数据迁移 ==========

    /**
     * 检查并执行必要的迁移
     *
     * 迁移策略：
     * - V1 → V2: 会话存储从单文件迁移到分文件存储
     * - 未来迁移：在此添加新版本迁移逻辑
     */
    private migrateIfNeeded(): void {
        try {
            const currentVersion = this.indexStore.get('version') || 1;
            logger.debug(`Current data version: v${currentVersion}`);

            if (currentVersion < 2) {
                logger.info('Migrating from v1 to v2...');
                this.migrateFromV1ToV2();
                this.indexStore.set('version', 2);
                logger.info('Migration to v2 complete');
            }

        } catch (error) {
            logger.error('Migration failed:', error);
        }
    }

    /**
     * V1 → V2 迁移：从单文件存储迁移到分文件存储
     *
     * 旧结构：
     * - opencowork-sessions.json (所有数据在一个文件)
     *
     * 新结构：
     * - sessions/meta/{session-id}.json (会话元数据)
     * - sessions/messages/{session-id}.json (会话消息)
     * - sessions/opencowork-sessions-index.json (会话索引)
     */
    private migrateFromV1ToV2(): void {
        const oldStorePath = path.join(app.getPath('userData'), 'opencowork-sessions.json');
        const backupPath = oldStorePath + '.v1.backup.' + Date.now();

        try {
            if (!fs.existsSync(oldStorePath)) {
                logger.info('No v1 data found, skipping migration');
                return;
            }

            logger.info(`Found v1 data: ${oldStorePath}`);

            let oldData: {
                sessions: Session[];
                currentSessionId?: string | null;
                currentFloatingBallSessionId?: string | null;
            };

            try {
                const rawContent = fs.readFileSync(oldStorePath, 'utf-8');
                oldData = JSON.parse(rawContent) as {
                    sessions: Session[];
                    currentSessionId?: string | null;
                    currentFloatingBallSessionId?: string | null;
                };
                logger.debug('JSON parsing successful');
            } catch (parseError) {
                logger.error('Failed to parse v1 JSON:', parseError);
                logger.error('Original file preserved - manual intervention may be required');
                throw new Error(`Invalid v1 JSON format: ${parseError}`);
            }

            if (!Array.isArray(oldData.sessions)) {
                logger.error('Invalid v1 data format: sessions is not an array');
                throw new Error('Invalid v1 data format: sessions must be an array');
            }

            if (oldData.sessions.length === 0) {
                logger.info('No sessions to migrate');
                fs.copyFileSync(oldStorePath, backupPath);
                logger.debug(`Backed up empty v1 data to: ${backupPath}`);
                return;
            }

            logger.info(`Migrating ${oldData.sessions.length} sessions...`);

            fs.copyFileSync(oldStorePath, backupPath);
            logger.debug(`Created backup: ${backupPath}`);

            // ========== Step 5: 验证并迁移每个会话 ==========
            const newSessions: SessionSummary[] = [];
            let successCount = 0;
            let failCount = 0;
            const validationErrors: string[] = [];

            for (let i = 0; i < oldData.sessions.length; i++) {
                const session = oldData.sessions[i];

                try {
                    // ----- 字段验证 -----
                    if (!session.id) {
                        const error = `Session at index ${i} is missing required field: id`;
                        logger.error(`${error}`);
                        validationErrors.push(error);
                        failCount++;
                        continue;
                    }

                    // 验证 ID 格式（应该是有效的字符串）
                    if (typeof session.id !== 'string' || session.id.trim().length === 0) {
                        const error = `Session at index ${i} has invalid id format`;
                        logger.error(`${error}`);
                        validationErrors.push(error);
                        failCount++;
                        continue;
                    }

                    // 验证消息字段
                    if (!session.messages) {
                        logger.warn(`Session ${session.id} has missing messages field, defaulting to empty array`);
                    }

                    if (!Array.isArray(session.messages)) {
                        logger.warn(`Session ${session.id} has invalid messages format (not an array), defaulting to empty array`);
                    }

                    // ----- 验证通过，开始迁移 -----
                    logger.debug(`Session ${session.id} validation passed`);

                    // 创建会话元数据（保留所有原始字段）
                    const meta: SessionMeta = {
                        id: session.id,
                        title: session.title || 'Untitled Session',
                        createdAt: session.createdAt || Date.now(),
                        updatedAt: session.updatedAt || Date.now(),
                        messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
                        tags: [],
                        preview: this.generatePreview(Array.isArray(session.messages) ? session.messages : [])
                    };

                    // 保存元数据文件
                    this.saveMetaFile(session.id, meta);
                    logger.debug(`Saved meta file: ${session.id}`);

                    // 保存消息文件（完整复制，无损失）
                    const messages: SessionMessages = {
                        messages: Array.isArray(session.messages) ? session.messages : []
                    };
                    this.saveMessagesFile(session.id, messages);
                    logger.debug(`Saved messages file: ${session.id} (${messages.messages.length} messages)`);

                    // 添加到索引
                    newSessions.push({
                        id: session.id,
                        title: meta.title,
                        createdAt: meta.createdAt,
                        updatedAt: meta.updatedAt,
                        messageCount: meta.messageCount,
                        preview: meta.preview,
                        tags: meta.tags
                    });

                    successCount++;
                    logger.debug(`Successfully migrated session ${session.id} (${i + 1}/${oldData.sessions.length})`);

                } catch (error) {
                    const errorMsg = `Failed to migrate session ${session.id || `at index ${i}`}`;
                    logger.error(`${errorMsg}:`, error);
                    validationErrors.push(`${errorMsg}: ${error}`);
                    failCount++;
                }
            }

            // ========== Step 6: 更新索引 ==========
            logger.debug('Updating session index...');
            this.indexStore.set('sessions', newSessions);
            this.indexStore.set('currentSessionId', oldData.currentSessionId || null);
            this.indexStore.set('currentFloatingBallSessionId', oldData.currentFloatingBallSessionId || null);
            logger.debug(`Current session ID: ${oldData.currentSessionId || 'none'}`);
            logger.debug(`Floating ball session ID: ${oldData.currentFloatingBallSessionId || 'none'}`);

            // ========== Step 7: 根据迁移结果处理原文件 ==========
            if (successCount > 0 && failCount === 0) {
                // 全部成功，删除原文件
                fs.unlinkSync(oldStorePath);
                logger.info(`Removed original v1 file (all sessions migrated successfully)`);
            } else if (successCount > 0) {
                // 部分成功，保留原文件但重命名
                const keptPath = oldStorePath + '.migrated';
                if (!fs.existsSync(keptPath)) {
                    fs.renameSync(oldStorePath, keptPath);
                }
                logger.warn(`Some sessions failed to migrate. Original file kept as: ${keptPath}`);
                logger.warn(`Validation errors:`);
                validationErrors.forEach(err => logger.warn(`   - ${err}`));
            } else {
                // 全部失败，保留原文件
                logger.error(`All sessions failed to migrate. Original file kept`);
                validationErrors.forEach(err => logger.error(`   - ${err}`));
            }

            // ========== Step 8: 迁移总结 ==========
            
            
            logger.info('Migration Summary');
            
            logger.info(`Successfully migrated: ${successCount} sessions`);
            logger.info(`Failed to migrate: ${failCount} sessions`);
            logger.debug(`Original file: ${oldStorePath}`);
            logger.debug(`Backup file: ${backupPath}`);
            if (failCount > 0) {
                logger.debug(`Review validation errors above for details`);
            }
            
            

        } catch (error) {
            logger.error('Critical migration error:', error);
            // 确保原文件不被删除
            if (fs.existsSync(oldStorePath)) {
                logger.info('Original v1 file preserved due to error');
            }
            throw error;
        }
    }

    // ========== 核心操作 ==========

    getSessions(): SessionSummary[] {
        return this.indexStore.get('sessions') || [];
    }

    getSession(id: string): Session | null {
        const index = this.getSessions();
        const summary = index.find(s => s.id === id);

        if (!summary) {
            return null;
        }

        const messages = this.loadMessages(id);

        return {
            id: summary.id,
            title: summary.title,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt,
            messages: messages
        };
    }

    createSession(title?: string): Session {
        const id = uuidv4();
        const now = Date.now();

        const meta: SessionMeta = {
            id,
            title: title || '新会话',
            createdAt: now,
            updatedAt: now,
            messageCount: 0,
            tags: [],
            preview: ''
        };

        this.saveMetaFile(id, meta);
        this.metaCache.set(id, meta);

        const messages: SessionMessages = { messages: [] };
        this.saveMessagesFile(id, messages);
        this.messagesCache.set(id, messages);

        const sessions = this.getSessions();
        const summary: SessionSummary = {
            id,
            title: meta.title,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
            messageCount: 0,
            preview: meta.preview,
            tags: meta.tags
        };
        sessions.unshift(summary);
        this.indexStore.set('sessions', sessions);

        logger.debug(`Created session: ${id}`);

        return {
            id,
            title: meta.title,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
            messages: []
        };
    }

    updateSession(id: string, messages: Anthropic.MessageParam[], title?: string): void {
        // 防抖：清除之前的定时器
        if (this.writeThrottle.has(id)) {
            clearTimeout(this.writeThrottle.get(id)!);
        }

        // 延迟写入
        this.writeThrottle.set(id, setTimeout(() => {
            this.doUpdateSession(id, messages, title);
            this.writeThrottle.delete(id);
        }, this.WRITE_DELAY));
    }

    // ⚠️ 立即保存（用于用户消息等需要立即持久化的场景）
    updateSessionImmediate(id: string, messages: Anthropic.MessageParam[], title?: string): void {
        // 清除防抖定时器
        if (this.writeThrottle.has(id)) {
            clearTimeout(this.writeThrottle.get(id)!);
            this.writeThrottle.delete(id);
        }

        // 立即保存
        this.doUpdateSession(id, messages, title);
        logger.debug(`Immediate save for session ${id}: ${messages.length} messages`);
    }

    private doUpdateSession(id: string, messages: Anthropic.MessageParam[], title?: string): void {
        const meta = this.loadMeta(id);
        if (!meta) {
            logger.warn(`Session ${id} not found`);
            return;
        }

        // 更新消息
        const messagesData: SessionMessages = { messages };
        this.saveMessagesFile(id, messagesData);
        this.messagesCache.set(id, messagesData);

        // 更新元数据
        meta.updatedAt = Date.now();
        meta.messageCount = messages.length;
        meta.preview = this.generatePreview(messages);

        if (title) {
            meta.title = title;
        } else if (meta.title === '新会话' || !meta.title) {
            const firstUserMsg = messages.find(m => m.role === 'user');
            if (firstUserMsg) {
                const text = this.extractTextFromMessage(firstUserMsg);
                if (text) {
                    meta.title = text.slice(0, 20) + (text.length > 20 ? '...' : '');
                }
            }
        }

        this.saveMetaFile(id, meta);
        this.metaCache.set(id, meta);

        // 更新索引
        const sessions = this.getSessions();
        const index = sessions.findIndex(s => s.id === id);
        if (index >= 0) {
            sessions[index] = {
                id: meta.id,
                title: meta.title,
                createdAt: meta.createdAt,
                updatedAt: meta.updatedAt,
                messageCount: meta.messageCount,
                preview: meta.preview,
                tags: meta.tags
            };
            this.indexStore.set('sessions', sessions);
        }

        logger.debug(`Updated session: ${id} (${messages.length} messages)`);
    }

    deleteSession(id: string): void {
        const metaPath = path.join(this.META_DIR, `${id}.json`);
        const messagesPath = path.join(this.MESSAGES_DIR, `${id}.json`);

        try {
            if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
            if (fs.existsSync(messagesPath)) fs.unlinkSync(messagesPath);
        } catch (error) {
            logger.error(`Error deleting files for ${id}:`, error);
        }

        this.metaCache.delete(id);
        this.messagesCache.delete(id);

        const sessions = this.getSessions().filter(s => s.id !== id);
        this.indexStore.set('sessions', sessions);

        if (this.getCurrentSessionId() === id) {
            this.indexStore.set('currentSessionId', sessions.length > 0 ? sessions[0].id : null);
        }

        logger.debug(`Deleted session: ${id}`);
    }

    // ========== 文件操作 ==========

    private loadMeta(id: string): SessionMeta | null {
        if (this.metaCache.has(id)) {
            return this.metaCache.get(id)!;
        }

        const metaPath = path.join(this.META_DIR, `${id}.json`);
        if (!fs.existsSync(metaPath)) {
            return null;
        }

        try {
            const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SessionMeta;
            this.metaCache.set(id, data);
            this.evictCacheIfNeeded();
            return data;
        } catch (error) {
            logger.error(`Error loading meta for ${id}:`, error);
            return null;
        }
    }

    private saveMetaFile(id: string, meta: SessionMeta): void {
        const metaPath = path.join(this.META_DIR, `${id}.json`);
        try {
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        } catch (error) {
            logger.error(`Error saving meta for ${id}:`, error);
            throw error;
        }
    }

    private loadMessages(id: string): Anthropic.MessageParam[] {
        if (this.messagesCache.has(id)) {
            return this.messagesCache.get(id)!.messages;
        }

        const messagesPath = path.join(this.MESSAGES_DIR, `${id}.json`);
        if (!fs.existsSync(messagesPath)) {
            return [];
        }

        try {
            const data = JSON.parse(fs.readFileSync(messagesPath, 'utf-8')) as SessionMessages;
            this.messagesCache.set(id, data);
            this.evictCacheIfNeeded();
            return data.messages;
        } catch (error) {
            logger.error(`Error loading messages for ${id}:`, error);
            return [];
        }
    }

    private saveMessagesFile(id: string, messages: SessionMessages): void {
        const messagesPath = path.join(this.MESSAGES_DIR, `${id}.json`);
        try {
            fs.writeFileSync(messagesPath, JSON.stringify(messages, null, 2));
        } catch (error) {
            logger.error(`Error saving messages for ${id}:`, error);
            throw error;
        }
    }

    // ========== 缓存管理 ==========

    private evictCacheIfNeeded(): void {
        if (this.metaCache.size > this.CACHE_SIZE) {
            const firstKey = this.metaCache.keys().next().value;
            if (firstKey) this.metaCache.delete(firstKey);
        }

        if (this.messagesCache.size > this.CACHE_SIZE) {
            const firstKey = this.messagesCache.keys().next().value;
            if (firstKey) this.messagesCache.delete(firstKey);
        }
    }

    // ========== 工具方法 ==========

    private generatePreview(messages: Anthropic.MessageParam[]): string {
        const firstMsg = messages.find(m => {
            const text = this.extractTextFromMessage(m);
            return text && text.trim().length > 0;
        });

        if (!firstMsg) return '';

        const text = this.extractTextFromMessage(firstMsg) || '';
        return text.slice(0, 100) + (text.length > 100 ? '...' : '');
    }

    private extractTextFromMessage(message: Anthropic.MessageParam): string | null {
        if (typeof message.content === 'string') {
            return message.content;
        } else if (Array.isArray(message.content)) {
            const textBlock = message.content.find(b => b.type === 'text');
            return textBlock?.text || null;
        }
        return null;
    }

    // ========== 兼容接口 ==========

    saveSession(id: string | null, messages: Anthropic.MessageParam[]): string {
        const hasRealContent = messages.some(m => {
            const content = m.content;
            if (typeof content === 'string') {
                return content.trim().length > 0;
            } else if (Array.isArray(content)) {
                return content.some(block =>
                    block.type === 'text' ? (block.text || '').trim().length > 0 : true
                );
            }
            return false;
        });

        if (!hasRealContent) {
            return this.getCurrentSessionId() || '';
        }

        let sessionId = id;
        if (!sessionId) {
            const session = this.createSession();
            sessionId = session.id;
        }

        this.updateSession(sessionId, messages);
        return sessionId;
    }

    cleanupEmptySessions(): void {
        const sessions = this.getSessions();
        const emptySessions: string[] = [];

        for (const session of sessions) {
            // 检查会话是否有实际内容
            const messages = this.loadMessages(session.id);
            const hasRealContent = messages.some(m => {
                const content = m.content;
                if (typeof content === 'string') {
                    return content.trim().length > 0;
                } else if (Array.isArray(content)) {
                    return content.some(block =>
                        block.type === 'text' ? (block.text || '').trim().length > 0 : true
                    );
                }
                return false;
            });

            if (!hasRealContent) {
                emptySessions.push(session.id);
            }
        }

        // 删除空会话
        if (emptySessions.length > 0) {
            logger.info(`Cleaning up ${emptySessions.length} empty sessions`);
            for (const id of emptySessions) {
                this.deleteSession(id);
            }
        }
    }

    getCurrentSessionId(): string | null {
        return this.indexStore.get('currentSessionId');
    }

    setCurrentSession(id: string | null): void {
        this.indexStore.set('currentSessionId', id);
    }

    getFloatingBallSessionId(): string | null {
        return this.indexStore.get('currentFloatingBallSessionId');
    }

    setFloatingBallSession(id: string | null): void {
        this.indexStore.set('currentFloatingBallSessionId', id);
    }

    getSessionId(isFloatingBall: boolean = false): string | null {
        return isFloatingBall
            ? this.getFloatingBallSessionId()
            : this.getCurrentSessionId();
    }

    setSessionId(id: string | null, isFloatingBall: boolean = false): void {
        if (isFloatingBall) {
            this.setFloatingBallSession(id);
        } else {
            this.setCurrentSession(id);
        }
    }

    setSessionRunning(id: string, isRunning: boolean): void {
        if (isRunning) {
            this.runningSessions.add(id);
        } else {
            this.runningSessions.delete(id);
        }
    }

    isSessionRunning(id: string): boolean {
        return this.runningSessions.has(id);
    }

    getRunningSessionIds(): string[] {
        return Array.from(this.runningSessions);
    }

    getRunningSessionsCount(): number {
        return this.runningSessions.size;
    }

    clearRunningSessions(): void {
        this.runningSessions.clear();
    }

    // ========== 记忆助手专用存储 ==========
    // 记忆助手的对话历史单独存储，不显示在历史会话列表

    private readonly MEMORY_HISTORY_VERSION = 1; // 记忆历史版本号

    private getMemoryAssistantHistoryPath(): string {
        return path.join(this.SESSIONS_DIR, 'memory-assistant-history.json');
    }

    /**
     * 获取记忆助手历史记录
     * 支持版本检测和自动迁移
     */
    getMemoryAssistantHistory(): Anthropic.MessageParam[] {
        try {
            const historyPath = this.getMemoryAssistantHistoryPath();
            if (!fs.existsSync(historyPath)) {
                // 首次使用，无需迁移
                return [];
            }

            const data = fs.readFileSync(historyPath, 'utf-8');
            const parsed = JSON.parse(data);

            // 检查版本
            if (parsed.version === this.MEMORY_HISTORY_VERSION) {
                return parsed.messages || [];
            } else if (parsed.version === undefined || parsed.version < this.MEMORY_HISTORY_VERSION) {
                // 需要迁移（目前是 V1，暂无旧版本）
                logger.info('Memory history is in legacy format, migrating...');
                const migrated = this.migrateMemoryHistory(parsed);
                // 保存迁移后的数据
                this.saveMemoryAssistantHistory(migrated);
                return migrated;
            }

            return parsed.messages || [];
        } catch (error) {
            logger.error('Failed to load memory assistant history:', error);
            return [];
        }
    }

    /**
     * 迁移记忆助手历史记录
     */
    private migrateMemoryHistory(data: any): Anthropic.MessageParam[] {
        // 目前 V1 是最新版本，无需迁移
        // 未来如果升级到 V2，在此添加迁移逻辑
        return data.messages || [];
    }

    /**
     * 保存记忆助手历史记录
     * 自动添加版本号
     */
    saveMemoryAssistantHistory(messages: Anthropic.MessageParam[]): void {
        try {
            const historyPath = this.getMemoryAssistantHistoryPath();
            const data = {
                messages,
                updatedAt: Date.now(),
                version: this.MEMORY_HISTORY_VERSION,
                schemaVersion: '1.0' // 格式版本
            };

            // 使用原子写入：先写临时文件，再重命名
            const tempPath = historyPath + '.tmp';
            fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');

            // 重命名（原子操作）
            if (fs.existsSync(historyPath)) {
                fs.unlinkSync(historyPath);
            }
            fs.renameSync(tempPath, historyPath);

            logger.debug('Saved memory assistant history, messages:', messages.length);
        } catch (error) {
            logger.error('Failed to save memory assistant history:', error);
        }
    }

    /**
     * 清空记忆助手历史记录
     */
    clearMemoryAssistantHistory(): void {
        try {
            const historyPath = this.getMemoryAssistantHistoryPath();
            if (fs.existsSync(historyPath)) {
                // 创建备份
                const backupPath = historyPath + '.backup.' + Date.now();
                fs.copyFileSync(historyPath, backupPath);
                logger.debug(`Backed up memory history to: ${backupPath}`);

                // 删除原文件
                fs.unlinkSync(historyPath);
                logger.debug('Cleared memory assistant history');
            }
        } catch (error) {
            logger.error('Failed to clear memory assistant history:', error);
        }
    }
}

export const sessionStoreV2 = new SessionStoreV2();
