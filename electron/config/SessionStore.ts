import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';

export interface Session {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    workspaceDir?: string;
    /** 区分会话来源：cowork（协作模式）| project（代码模式）| automation（自动化模式）。旧数据没有此字段视为 cowork */
    mode?: 'cowork' | 'project' | 'automation';
    messages: Anthropic.MessageParam[];
}

export type SessionMode = 'cowork' | 'project' | 'automation';

interface SessionStoreSchema {
    sessions: Session[];
    currentSessionId: string | null;
    currentFloatingBallSessionId: string | null; // Separate session tracking for floating ball
}

const defaults: SessionStoreSchema = {
    sessions: [],
    currentSessionId: null,
    currentFloatingBallSessionId: null
};

class SessionStore {
    private store: Store<SessionStoreSchema>;

    constructor() {
        this.store = new Store<SessionStoreSchema>({
            name: 'qa-cowork-sessions',
            defaults
        });
    }

    // Get all sessions (summary only, without full messages for list view)
    // Optionally filter by mode; for 'cowork', also handles legacy sessions without mode field
    getSessions(mode?: SessionMode, coworkWorkspaceDir?: string): Omit<Session, 'messages'>[] {
        const sessions = this.store.get('sessions') || [];
        const filtered = mode
            ? sessions.filter(s => {
                // cowork 模式：workspaceDir 匹配 cowork 目录时视为 cowork 会话
                // 兼容历史数据中 mode 被误标为 'project' 的协作模式会话
                const isCoworkDir = (dir?: string) =>
                    !!dir && (
                        (coworkWorkspaceDir && dir === coworkWorkspaceDir) ||
                        dir.endsWith('/.qa-cowork') ||
                        dir.endsWith('\\.qa-cowork')
                    );
                if (mode === 'cowork') {
                    if (isCoworkDir(s.workspaceDir)) return true;
                    if (s.mode) return s.mode === 'cowork';
                    // 无 mode 字段的旧数据：workspaceDir 为空也视为 cowork
                    return !s.workspaceDir;
                }
                if (s.mode) return s.mode === mode;
                // Legacy data without mode field: infer from workspaceDir
                if (mode === 'automation') {
                    // 旧数据无 automation mode，历史上 automation session 可能被误存为 project
                    return false;
                } else {
                    // project mode: workspaceDir exists and is not cowork dir
                    if (!s.workspaceDir) return false;
                    if (isCoworkDir(s.workspaceDir)) return false;
                    return true;
                }
            })
            : sessions;
        return filtered.map(s => ({
            id: s.id,
            title: s.title,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            workspaceDir: s.workspaceDir,
            mode: s.mode
        }));
    }

    // Get full session by ID
    getSession(id: string): Session | null {
        const sessions = this.store.get('sessions') || [];
        return sessions.find(s => s.id === id) || null;
    }

    // Create new session
    createSession(title?: string): Session {
        const session: Session = {
            id: uuidv4(),
            title: title || '新会话',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: []
        };
        const sessions = this.store.get('sessions') || [];
        sessions.unshift(session); // Add to beginning
        this.store.set('sessions', sessions);
        this.store.set('currentSessionId', session.id);
        return session;
    }

    // Update session messages
    updateSession(id: string, messages: Anthropic.MessageParam[], title?: string, workspaceDir?: string, mode?: SessionMode): void {
        const MAX_STORED_MESSAGES = 200;
        const sessions = this.store.get('sessions') || [];
        const index = sessions.findIndex(s => s.id === id);
        if (index >= 0) {
            // 超过上限时保留最新的消息，防止持久化数据无限增长
            const storedMessages = messages.length > MAX_STORED_MESSAGES
                ? messages.slice(messages.length - MAX_STORED_MESSAGES)
                : messages;
            sessions[index].messages = storedMessages;
            sessions[index].updatedAt = Date.now();
            if (workspaceDir) {
                sessions[index].workspaceDir = workspaceDir;
            }
            if (mode) {
                sessions[index].mode = mode;
            }
            if (title) {
                sessions[index].title = title;
            } else if (sessions[index].title === '新会话' && messages.length > 0) {
                // Auto-generate title from first user message
                const firstUserMsg = messages.find(m => m.role === 'user');
                if (firstUserMsg) {
                    const text = typeof firstUserMsg.content === 'string'
                        ? firstUserMsg.content
                        : (Array.isArray(firstUserMsg.content)
                            ? (firstUserMsg.content as Array<{ type: string; text?: string }>).find(b => b.type === 'text')?.text
                            : '');
                    if (text) {
                        sessions[index].title = text.slice(0, 50) + (text.length > 50 ? '...' : '');
                    }
                }
            }
            this.store.set('sessions', sessions);
        }
    }

    // Create or update session only if it has meaningful content
    saveSession(id: string | null, messages: Anthropic.MessageParam[], workspaceDir?: string, mode?: SessionMode): string {
        // Check if there's real content (user or assistant messages with actual text)
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

        // If no meaningful messages, don't save
        if (!hasRealContent) {
            console.log('[SessionStore] Skipping empty session');
            return this.getCurrentSessionId() || '';
        }

        let sessionId = id;
        if (!sessionId) {
            // Create new session only when we have actual content
            const session = this.createSession();
            sessionId = session.id;
            console.log(`[SessionStore] Created new session: ${sessionId}`);
        }

        try {
            this.updateSession(sessionId, messages, undefined, workspaceDir, mode);
            console.log(`[SessionStore] Successfully saved session ${sessionId} with ${messages.length} messages`);
        } catch (error) {
            console.error(`[SessionStore] Error updating session ${sessionId}:`, error);
            // Try to recover by creating a new session
            if (id) {
                console.log('[SessionStore] Attempting recovery by creating new session...');
                const newSession = this.createSession();
                sessionId = newSession.id;
                this.updateSession(sessionId, messages, undefined, workspaceDir, mode);
                console.log(`[SessionStore] Recovery successful, new session: ${sessionId}`);
            } else {
                throw error; // Re-throw if we can't recover
            }
        }

        return sessionId;
    }

    // Clean up empty sessions (can be called periodically)
    cleanupEmptySessions(): void {
        const sessions = this.store.get('sessions') || [];
        const validSessions = sessions.filter(session => {
            // Keep sessions that have meaningful messages
            return session.messages.some(msg => {
                const content = msg.content;
                if (typeof content === 'string') {
                    return content.trim().length > 0;
                } else if (Array.isArray(content)) {
                    return content.some(block =>
                        block.type === 'text' ? (block.text || '').trim().length > 0 : true
                    );
                }
                return false;
            });
        });

        if (validSessions.length !== sessions.length) {
            console.log(`[SessionStore] Cleaned up ${sessions.length - validSessions.length} empty sessions`);
            this.store.set('sessions', validSessions);
        }
    }

    // Delete session
    deleteSession(id: string): void {
        const sessions = (this.store.get('sessions') || []).filter(s => s.id !== id);
        this.store.set('sessions', sessions);
        if (this.store.get('currentSessionId') === id) {
            this.store.set('currentSessionId', sessions.length > 0 ? sessions[0].id : null);
        }
    }

    // Get current session ID
    getCurrentSessionId(): string | null {
        return this.store.get('currentSessionId');
    }

    // Set current session
    setCurrentSession(id: string): void {
        this.store.set('currentSessionId', id);
    }

    // Get floating ball's current session ID
    getFloatingBallSessionId(): string | null {
        return this.store.get('currentFloatingBallSessionId');
    }

    // Set floating ball's current session
    setFloatingBallSession(id: string): void {
        this.store.set('currentFloatingBallSessionId', id);
    }

    // Get appropriate session ID based on context
    getSessionId(isFloatingBall: boolean = false): string | null {
        return isFloatingBall
            ? this.getFloatingBallSessionId()
            : this.getCurrentSessionId();
    }

    // Set appropriate session based on context
    setSessionId(id: string | null, isFloatingBall: boolean = false): void {
        if (isFloatingBall) {
            if (id === null) {
                this.store.set('currentFloatingBallSessionId', null);
            } else {
                this.setFloatingBallSession(id);
            }
        } else {
            if (id === null) {
                this.store.set('currentSessionId', null);
            } else {
                this.setCurrentSession(id);
            }
        }
    }
}

export const sessionStore = new SessionStore();
