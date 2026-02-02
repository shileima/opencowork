import { useState, useEffect, useRef, useCallback } from 'react';
import { Home, History, X, Plus, Check } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { FloatingInput } from './FloatingInput';
import { useI18n } from '../i18n/I18nContext';
import { logger } from '../services/logger';

type BallState = 'collapsed' | 'input' | 'expanded';

interface ContentBlock {
    type: string;
    text?: string;
    name?: string;
    source?: { media_type: string; data: string };
}

interface SessionSummary {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
}

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string | ContentBlock[];
}

export function FloatingBallPage() {
    const { t } = useI18n();

    // ⚠️ 优化：环境检测，生产环境减少日志
    const isDevelopment = process.env.NODE_ENV === 'development';

    // ⚠️ 优化：创建日志工具函数
    const log = isDevelopment
        ? (...args: unknown[]) => console.log('[FloatingBall]', ...args)
        : () => {}; // 生产环境空函数

    const warn = isDevelopment
        ? (...args: unknown[]) => logger.warn('[FloatingBall]', ...args)
        : () => {};

    const error = (...args: unknown[]) => logger.error('[FloatingBall]', ...args);

    // ⚠️ 优化：历史哈希计算函数（用于重复更新检测）
    const computeHistoryHash = (data: Message[]): string => {
        // 简单哈希：取长度和前100个字符
        const str = JSON.stringify(data);
        return `${str.length}:${str.slice(0, 100)}`;
    };

    const [ballState, setBallState] = useState<BallState>('collapsed');
    // input/images moved to FloatingInput, but we track presence for auto logic
    const [hasContent, setHasContent] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    // ⚠️ 关键修复：使用 Map 存储每个会话的流式文本，支持会话切换时恢复流式显示
    const [streamingTextMap, setStreamingTextMap] = useState<Map<string, string>>(new Map());

    const [showHistory, setShowHistory] = useState(false);
    const [sessions, setSessions] = useState<SessionSummary[]>([]);  // Add sessions state
    const [isHovering, setIsHovering] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isNewSession, setIsNewSession] = useState(true); // Track if this is a new session
    const hasInitialized = useRef(false); // Track if we've initialized the first session
    const currentSessionIdRef = useRef<string | null>(null); // Track current session ID for event filtering
    const switchingSessionsRef = useRef<Set<string>>(new Set()); // ⚠️ 优化：使用队列管理多个会话切换
    const historyVersionRef = useRef<Map<string, number>>(new Map()); // ⚠️ 版本号，防止旧数据覆盖新数据
    const lastHistoryHashRef = useRef<Map<string, string>>(new Map()); // ⚠️ 重复更新检测
    const pendingUpdateRef = useRef<{ sessionId: string; timestamp: number } | null>(null); // ⚠️ P2-2: 事件超时检测

    // ⚠️ 计算属性：获取当前会话的流式文本
    const streamingText = sessionId ? streamingTextMap.get(sessionId) || '' : '';

    // 处理文件路径点击 - 打开主页并在文件画布中显示
    const handleFilePathClick = useCallback((filePath: string) => {
        log('File path clicked in floating ball:', filePath);
        // 使用 Electron API 打开主页窗口并传递文件路径
        window.ipcRenderer.invoke('open-main-with-file', { filePath });
    }, [log]);

    // Update ref when sessionId changes
    useEffect(() => {
        currentSessionIdRef.current = sessionId;
    }, [sessionId]);

    // Fetch session list when history is opened
    useEffect(() => {
        if (showHistory) {
            window.ipcRenderer.invoke('session:list').then((list) => {
                setSessions(list as SessionSummary[]);
            });
        }
    }, [showHistory]);

    // Initialize as new session when floating ball first expands (only once)
    useEffect(() => {
        if (ballState !== 'collapsed' && isNewSession && !hasInitialized.current) {
            // Clear any previous history to start fresh
            window.ipcRenderer.invoke('agent:new-session');
            setMessages([]);

            // ⚠️ 关键修复：清空新会话的流式文本
            if (sessionId) {
                setStreamingTextMap(prev => {
                    const newMap = new Map(prev);
                    newMap.set(sessionId, '');
                    return newMap;
                });
            }

            hasInitialized.current = true; // Mark as initialized
        }
    }, [ballState, isNewSession, sessionId]);

    // Listen for state changes and messages
    useEffect(() => {
        // Get current session ID on mount
        window.ipcRenderer.invoke('session:current').then((session: any) => {
            setSessionId(session?.id || null);
        });

        const removeUpdateListener = window.ipcRenderer.on('agent:history-update', async (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; version?: number; data: Message[] };

            // ⚠️ 优化1：switching 检查（队列机制）- 最快失败
            if (switchingSessionsRef.current.size > 0) {
                if (!switchingSessionsRef.current.has(eventData.sessionId)) {
                    log('⚠️ Switching sessions: ignored history from', eventData.sessionId, 'waiting for:', Array.from(switchingSessionsRef.current));
                    return;
                }
            }

            // ⚠️ 优化2：会话检查（第二快失败）
            if (eventData.sessionId !== currentSessionIdRef.current) {
                log('⚠️ Filtered history update: event sessionId=', eventData.sessionId, 'current=', currentSessionIdRef.current);
                return;
            }

            // ⚠️ 优化3：版本号检查（智能同步）
            if (eventData.version !== undefined) {
                const lastVersion = historyVersionRef.current.get(eventData.sessionId) || 0;

                // 如果是第一个事件（lastVersion = 0），接受任何版本号
                if (lastVersion === 0 || eventData.version > lastVersion) {
                  historyVersionRef.current.set(eventData.sessionId, eventData.version);
                } else if (eventData.version <= lastVersion) {
                  log('⚠️ Ignored old version', eventData.version, '(last:', lastVersion, ') for session', eventData.sessionId);
                  return;
                }
            }

            const history = eventData.data;

            // ⚠️ 优化4：重复更新检测（避免不必要的重渲染）
            const newHash = computeHistoryHash(history);
            const lastHash = lastHistoryHashRef.current.get(eventData.sessionId);

            if (lastHash === newHash) {
                log('⚠️ Skipping duplicate history update for session', eventData.sessionId);
                return; // 数据未变化，跳过更新
            }

            lastHistoryHashRef.current.set(eventData.sessionId, newHash);

            // ⚠️ P2-2 优化：清除超时检测并记录延迟
            if (pendingUpdateRef.current?.sessionId === eventData.sessionId) {
                const latency = Date.now() - pendingUpdateRef.current.timestamp;
                if (isDevelopment) {
                    log('✅ agent:history-update received in', latency, 'ms for', eventData.sessionId);
                }
                pendingUpdateRef.current = null;
            }

            log('✅ Processing history update for current session', eventData.sessionId, ':', history.length, 'messages');
            setMessages(history.filter(m => m.role !== 'system') || []);

            // ⚠️ 关键修复：只清空当前会话的流式文本，保留其他会话
            setStreamingTextMap(prev => {
                const newMap = new Map(prev);
                newMap.set(eventData.sessionId, '');
                return newMap;
            });

            // Note: History is auto-saved by AgentRuntime when message completes
            // No need to save here - just update the UI
        });

        const removeStreamListener = window.ipcRenderer.on('agent:stream-token', (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; data: string };

            // Filter events by session
            if (eventData.sessionId !== currentSessionIdRef.current) {
                return;
            }

            // ⚠️ 关键修复：更新 Map 中对应会话的流式文本
            setStreamingTextMap(prev => {
                const newMap = new Map(prev);
                const currentText = newMap.get(eventData.sessionId) || '';
                newMap.set(eventData.sessionId, currentText + eventData.data);
                return newMap;
            });
        });

        const removeErrorListener = window.ipcRenderer.on('agent:error', (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; data: string };

            // Filter events by session
            if (eventData.sessionId !== currentSessionIdRef.current) {
                return;
            }

            const err = eventData.data;
            error('Agent Error:', err);

            // Add error message to chat so user can see it
            const errorMessage: Message = {
                role: 'assistant',
                content: `⚠️ **错误发生**

${error}

请检查配置后重试。如果问题持续存在，请查看控制台日志获取更多信息。`
            };
            setMessages(prev => [...prev, errorMessage]);
            setIsProcessing(false);

            // ⚠️ 关键修复：清空当前会话的流式文本
            setStreamingTextMap(prev => {
                const newMap = new Map(prev);
                newMap.set(eventData.sessionId, '');
                return newMap;
            });
        });

        const removeAbortListener = window.ipcRenderer.on('agent:aborted', (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; data: unknown };

            // Only process abort for current session
            if (eventData.sessionId !== currentSessionIdRef.current) {
                return;
            }

            setIsProcessing(false);

            // ⚠️ 关键修复：清空当前会话的流式文本
            setStreamingTextMap(prev => {
                const newMap = new Map(prev);
                newMap.set(eventData.sessionId, '');
                return newMap;
            });
        });

        const removeDoneListener = window.ipcRenderer.on('agent:done', (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; data: unknown };

            // Only process done for current session
            if (eventData.sessionId !== currentSessionIdRef.current) {
                return;
            }

            setIsProcessing(false);
            setIsSuccess(true);
            setTimeout(() => setIsSuccess(false), 3000);
        });

        // Listen for session running status changes to update current session ID
        const removeRunningListener = window.ipcRenderer.on('session:running-changed', (_event, data) => {
            const { sessionId: newSessionId, isRunning } = data as { sessionId: string; isRunning: boolean; count: number };
            // Update session ID if task starts and we don't have one
            if (isRunning && !currentSessionIdRef.current) {
                setSessionId(newSessionId);
            }
        });

        // Listen for session current changed events
        const removeSessionChangedListener = window.ipcRenderer.on('session:current-changed', async (_event, data) => {
            const { sessionId: newSessionId, isRunning } = data as { sessionId: string | null; isRunning?: boolean };
            log('Session changed to:', newSessionId, 'running:', isRunning);

            // ⚠️ 关键修复：使用队列管理多个会话切换
            switchingSessionsRef.current.clear(); // 清空旧的切换标志
            if (newSessionId !== null) {
                switchingSessionsRef.current.add(newSessionId); // 添加新会话到切换队列
            }

            // ⚠️ 关键修复：立即同步更新 ref
            currentSessionIdRef.current = newSessionId;
            setSessionId(newSessionId);

            // 如果是 null（新会话），清空消息
            if (newSessionId === null) {
                setMessages([]);
                switchingSessionsRef.current.clear(); // 新会话不需要等待
            } else {
                // ⚠️ 关键修复：主动加载历史作为fallback，确保即使 agent:history-update 丢失/延迟也能显示数据
                log('Loading history for session', newSessionId, '...');

                try {
                    const session = await window.ipcRenderer.invoke('session:get', newSessionId) as { messages: Message[] } | null;
                    if (session && session.messages) {
                        const filteredMessages = session.messages.filter(m => m.role !== 'system');
                        log('✅ Loaded history for session', newSessionId, ':', filteredMessages.length, 'messages');
                        setMessages(filteredMessages);
                    } else {
                        warn('Session', newSessionId, 'not found or has no messages');
                        setMessages([]);
                    }
                } catch (err) {
                    error('Error loading session', newSessionId, ':', err);
                    setMessages([]);
                }

                // ⚠️ P2-2 优化：记录预期的更新，用于超时检测
                pendingUpdateRef.current = {
                    sessionId: newSessionId,
                    timestamp: Date.now()
                };

                // ⚠️ P2-2 优化：设置超时检测（1秒后检查）
                setTimeout(() => {
                    if (pendingUpdateRef.current?.sessionId === newSessionId) {
                        warn('⏱️ agent:history-update timeout for session', newSessionId, '- event may be lost');
                        pendingUpdateRef.current = null;
                    }
                }, 1000);
            }

            // ⚠️ 延迟清除切换标志，给 agent:history-update 事件足够的时间到达
            // 如果 agent:history-update 在这个期间到达，它会覆盖主动加载的历史（因为有版本号检查）
            if (newSessionId !== null) {
                setTimeout(() => {
                    switchingSessionsRef.current.delete(newSessionId);
                    log('✅ Session switch complete for:', newSessionId, ', remaining:', Array.from(switchingSessionsRef.current));
                }, 500);
            }

            log('✅ Session ref and messages updated for:', newSessionId);
        });

        // ⚠️ P2-1 优化：内存清理机制 - 定期清理旧会话的版本号和哈希数据
        const cleanupInterval = setInterval(() => {
            const currentSession = currentSessionIdRef.current;
            const versionKeys = Array.from(historyVersionRef.current.keys());
            const hashKeys = Array.from(lastHistoryHashRef.current.keys());

            // 只保留当前会话和最近 3 个活跃会话的数据
            const toKeep = [currentSession, ...versionKeys.slice(0, 3)].filter(Boolean) as string[];

            // 清理版本号 Map
            let versionCleaned = false;
            const newVersionMap = new Map<string, number>();
            toKeep.forEach(id => {
                const version = historyVersionRef.current.get(id);
                if (version !== undefined) {
                    newVersionMap.set(id, version);
                }
            });
            if (newVersionMap.size < historyVersionRef.current.size) {
                historyVersionRef.current = newVersionMap;
                versionCleaned = true;
            }

            // 清理哈希 Map
            let hashCleaned = false;
            const newHashMap = new Map<string, string>();
            toKeep.forEach(id => {
                const hash = lastHistoryHashRef.current.get(id);
                if (hash !== undefined) {
                    newHashMap.set(id, hash);
                }
            });
            if (newHashMap.size < lastHistoryHashRef.current.size) {
                lastHistoryHashRef.current = newHashMap;
                hashCleaned = true;
            }

            if ((versionCleaned || hashCleaned) && isDevelopment) {
                log('🧹 Memory cleanup: versions', versionKeys.length, '→', newVersionMap.size,
                    ', hashes', hashKeys.length, '→', newHashMap.size);
            }
        }, 5 * 60 * 1000); // 每 5 分钟清理一次

        return () => {
            // Note: History is auto-saved by AgentRuntime backend
            // No need to manually save on unmount

            removeUpdateListener?.();
            removeStreamListener?.();
            removeErrorListener?.();
            removeAbortListener?.();
            removeDoneListener?.();
            removeRunningListener?.();
            removeSessionChangedListener?.();
            clearInterval(cleanupInterval); // 清理定时器
        };
    }, []);

    // ... (refs and resizing logic same as before) ...
    // Change ref to textarea
    const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    // Auto-resize logic moved to FloatingInput

    // Add transparent class to html element
    useEffect(() => {
        document.documentElement.classList.add('floating-ball-mode');
        return () => {
            document.documentElement.classList.remove('floating-ball-mode');
        };
    }, []);

    // Auto-collapse logic (only if not hovering and no input)
    useEffect(() => {
        if (ballState === 'input' && !hasContent && !isProcessing && !isHovering) {
            collapseTimeoutRef.current = setTimeout(() => {
                setBallState('collapsed');
                window.ipcRenderer.invoke('floating-ball:toggle');
            }, 3000); // 3 seconds delay before auto-collapse
        }

        return () => {
            if (collapseTimeoutRef.current) {
                clearTimeout(collapseTimeoutRef.current);
            }
        };
    }, [ballState, hasContent, isProcessing, isHovering]);

    // Clear timeout when user types
    useEffect(() => {
        if (hasContent) {
            if (collapseTimeoutRef.current) {
                clearTimeout(collapseTimeoutRef.current);
                collapseTimeoutRef.current = null;
            }
        }
    }, [hasContent]);

    // Click outside to collapse
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                if (ballState !== 'collapsed' && !isProcessing) {
                    setBallState('collapsed');
                    window.ipcRenderer.invoke('floating-ball:toggle');
                }
            }
        };

        if (ballState !== 'collapsed') {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [ballState, isProcessing]);

    // Focus logic now handled in FloatingInput via autoFocus prop

    // Sync window height with state
    // Track previous state for resize direction logic
    const prevBallState = useRef(ballState);

    // Sync window height with state
    useEffect(() => {
        const isStateChange = ballState !== prevBallState.current;
        let targetHeight = 0;
        let anchorBottom = false;

        if (ballState === 'expanded') {
            targetHeight = showHistory ? 600 : 500;
            // When switching to expanded (showing messages), grow UP (anchor bottom) to keep input appearing stable
            if (isStateChange) {
                anchorBottom = true;
            }
        } else if (ballState === 'input') {
            if (showHistory) {
                targetHeight = 340;
                // If shrinking from expanded, anchor bottom to keep input stable
                if (isStateChange && prevBallState.current === 'expanded') {
                    anchorBottom = true;
                }
            } else if (isStateChange && prevBallState.current === 'expanded') {
                // Collapsing from expanded -> input (no history).
                // Force a shrink with AnchorBottom to position window correctly before ResizeObserver takes over.
                // Estimate height ~140px.
                targetHeight = 140;
                anchorBottom = true;
            }
        }

        if (targetHeight > 0) {
            window.ipcRenderer.invoke('floating-ball:set-height', { height: targetHeight, anchorBottom });
        }

        prevBallState.current = ballState;
    }, [ballState, showHistory]);

    // Handle dynamic resizing for compact input state
    useEffect(() => {
        if (ballState !== 'input' || showHistory) return;

        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const height = Math.ceil(entry.contentRect.height);
                // Add execution guard to prevent thrashing if needed, but atomic setBounds in main should handle it.
                // Add a small buffer for borders/shadows if strictly contentRect
                window.ipcRenderer.invoke('floating-ball:set-height', height + 2);
            }
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, [ballState, showHistory, hasContent]); // Re-bind if dependencies change layout relevantly

    // Handle ball click - expand slowly
    const handleBallClick = () => {
        setBallState('input');
        window.ipcRenderer.invoke('floating-ball:toggle');
    };

    // Handle submit - send message and expand to full view
    const handleSubmit = async (content: string, images: string[]) => {
        // Validate input
        if (!content.trim() && images.length === 0) return;

        // Prevent concurrent message sending
        if (isProcessing) {
            warn('Message send blocked: task already running');
            return;
        }

        // ⚠️ 关键修复：立即将用户消息添加到messages，让用户马上看到
        const userMessage: Message = typeof content === 'string' && images.length === 0
            ? { role: 'user' as const, content }
            : {
                role: 'user' as const,
                content: [
                    { type: 'text', text: content },
                    ...(images || []).map(img => ({
                        type: 'image',
                        source: { media_type: 'image/jpeg', data: img.split(',')[1] }
                    }))
                ]
            };

        log('Adding user message to messages immediately:', userMessage);
        setMessages(prev => [...prev, userMessage]);

        // Set initial processing state
        setIsProcessing(true);

        // ⚠️ 关键修复：清空当前会话的流式文本，保留其他会话
        if (sessionId) {
            setStreamingTextMap(prev => {
                const newMap = new Map(prev);
                newMap.set(sessionId, '');
                return newMap;
            });
        }

        setBallState('expanded'); // Expand to show conversation

        try {
            // Send as object if images exist, otherwise string for backward compat
            if (images.length > 0) {
                await window.ipcRenderer.invoke('agent:send-message', { content, images });
            } else {
                await window.ipcRenderer.invoke('agent:send-message', content.trim());
            }
        } catch (err) {
            error('Failed to send message:', err);
            // Reset processing state on error - user can try again
            setIsProcessing(false);
        }

        // Note: isProcessing will be managed by session:running-changed, agent:done, agent:error events
    };

    // Handle abort - stop the current task
    const handleAbort = () => {
        window.ipcRenderer.invoke('agent:abort');
        setIsProcessing(false);
    };



    // Handle collapse
    const handleCollapse = () => {
        setBallState('collapsed');
        window.ipcRenderer.invoke('floating-ball:toggle');
    };

    // Image Handlers Moved to FloatingInput

    // General drag handling - works for all states
    const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, moved: false });

    const handleDragStart = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = { isDragging: true, startX: e.screenX, startY: e.screenY, moved: false };

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (dragRef.current.isDragging) {
                const deltaX = moveEvent.screenX - dragRef.current.startX;
                const deltaY = moveEvent.screenY - dragRef.current.startY;

                // Move window immediately (no threshold for drag header)
                dragRef.current.startX = moveEvent.screenX;
                dragRef.current.startY = moveEvent.screenY;
                window.ipcRenderer.invoke('floating-ball:move', { deltaX, deltaY });
            }
        };

        const handleMouseUp = () => {
            dragRef.current.isDragging = false;
            dragRef.current.moved = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    // Collapsed state drag with click detection
    const handleMouseDown = (e: React.MouseEvent) => {
        if (ballState !== 'collapsed') return;
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = { isDragging: true, startX: e.screenX, startY: e.screenY, moved: false };

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (dragRef.current.isDragging) {
                const deltaX = moveEvent.screenX - dragRef.current.startX;
                const deltaY = moveEvent.screenY - dragRef.current.startY;

                if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                    dragRef.current.moved = true;
                }

                if (dragRef.current.moved) {
                    dragRef.current.startX = moveEvent.screenX;
                    dragRef.current.startY = moveEvent.screenY;
                    window.ipcRenderer.invoke('floating-ball:move', { deltaX, deltaY });
                }
            }
        };

        const handleMouseUp = () => {
            const wasMoved = dragRef.current.moved;
            dragRef.current.isDragging = false;
            dragRef.current.moved = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            // Only trigger click if not dragged
            if (!wasMoved) {
                handleBallClick();
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    // Collapsed Ball (Premium Design)
    if (ballState === 'collapsed') {
        return (
            <div
                ref={containerRef}
                className="w-16 h-16 flex items-center justify-center select-none cursor-move"
                style={{ background: 'transparent' }}
                onMouseDown={handleMouseDown}
            >
                <div className="relative w-14 h-14 group">
                    {/* Hover Glow - Subtle & Clean */}
                    {!isProcessing && !isSuccess && (
                        <div className="absolute inset-0 bg-stone-500/20 rounded-full blur-md opacity-0 group-hover:opacity-100" />
                    )}

                    {/* Processing State: Premium Rotating Gradient Border */}
                    {isProcessing && !isSuccess && (
                        <div className="absolute -inset-[3px] rounded-full animate-spin-slow opacity-100">
                            <div className="w-full h-full rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,transparent_90deg,#f97316_180deg,#f97316_270deg,transparent_360deg)] opacity-80 blur-[1px]" />
                        </div>
                    )}

                    {/* Inner Pulse for Processing */}
                    {isProcessing && !isSuccess && (
                        <div className="absolute inset-0 bg-orange-400/10 rounded-full animate-breathe" />
                    )}

                    {/* Main Ball Container */}
                    <div className={`relative w-14 h-14 rounded-full flex items-center justify-center shadow-md border overflow-hidden z-10 ${isSuccess
                        ? 'bg-emerald-500 border-emerald-400 shadow-emerald-500/30 shadow-lg'
                        : isProcessing
                            ? 'bg-stone-900 border-stone-800' // Darker bg for contrast during processing
                            : 'bg-stone-800 border-stone-700 hover:scale-105 hover:shadow-lg hover:border-stone-600'
                        }`}>

                        {/* Success Icon with Pop Animation */}
                        {isSuccess ? (
                            <div className="animate-success-pop flex flex-col items-center justify-center">
                                <Check size={28} className="text-white drop-shadow-sm" strokeWidth={3.5} />
                            </div>
                        ) : (
                            /* Logo or Icon */
                            <img
                                src="./icon.png"
                                alt="Logo"
                                className={`w-full h-full object-cover ${isProcessing ? 'opacity-80 scale-90 grayscale-[0.3]' : 'opacity-100 scale-100'}`}
                            />
                        )}

                        {/* Processing Center Dot (Optional, subtle tech feel) */}
                        {isProcessing && !isSuccess && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-8 h-8 rounded-full border border-orange-500/30 animate-ping opacity-20" />
                            </div>
                        )}

                    </div>
                </div>
            </div>
        );
    }

    // Unified Input & Expanded State
    return (
        <div
            ref={containerRef}
            className={`w-full bg-white dark:bg-zinc-950 rounded-2xl shadow-2xl border border-stone-200 dark:border-zinc-800 overflow-hidden flex flex-col relative ${showHistory || ballState === 'expanded' ? 'h-screen' : 'h-auto'}`}
            style={{ maxHeight: '100vh' }}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
        >
            {/* Draggable Header - Always at the top */}
            <div
                className="flex items-center justify-center py-1.5 cursor-move bg-stone-50 dark:bg-zinc-900 border-b border-stone-100 dark:border-zinc-800 shrink-0 z-20"
                onMouseDown={handleDragStart}
            >
                <div className="w-8 h-1 bg-stone-300 dark:bg-zinc-700 rounded-full" />
            </div>

            {/* Lightbox Overlay */}
            {selectedImage && (
                <div
                    className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                    onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImage(null);
                    }}
                >
                    <button
                        className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors"
                        onClick={(e) => {
                            e.stopPropagation();
                            setSelectedImage(null);
                        }}
                    >
                        <X size={24} />
                    </button>
                    <img
                        src={selectedImage}
                        alt="Full size"
                        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                    />
                </div>
            )}

            {/* Messages Area - Only shown in Expanded state */}
            {ballState === 'expanded' && (
                <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-hide shrink-0 border-b border-stone-100 dark:border-zinc-800 bg-stone-50/30 dark:bg-zinc-900/10">
                    {messages.length === 0 && !isProcessing && (
                        <div className="h-full flex flex-col items-center justify-center text-stone-300 gap-2 opacity-50">
                            <img src="./icon.png" className="w-8 h-8 opacity-20 grayscale" />
                            <p className="text-xs">{t('startChatHint')}</p>
                        </div>
                    )}

                    {messages.filter(m => m.role !== 'system').map((msg, idx) => {
                        if (msg.role === 'user') {
                            const text = typeof msg.content === 'string' ? msg.content :
                                Array.isArray(msg.content) ? msg.content.find(b => b.type === 'text')?.text : '';

                            // Check if message has images
                            const images = Array.isArray(msg.content) ? msg.content.filter(b => b.type === 'image') : [];

                            if (Array.isArray(msg.content) && msg.content[0]?.type === 'tool_result') return null;

                            return (
                                <div key={idx} className="bg-stone-100 dark:bg-zinc-800 rounded-xl px-3 py-2 text-sm text-stone-700 dark:text-zinc-100 max-w-[85%] space-y-2 ml-auto">
                                    {images.length > 0 && (
                                        <div className="flex gap-2 flex-wrap justify-end">
                                            {images.map((img, i: number) => (
                                                <img
                                                    key={i}
                                                    src={`data:${img.source?.media_type};base64,${img.source?.data}`}
                                                    alt="User upload"
                                                    className="w-20 h-20 object-cover rounded-lg cursor-zoom-in hover:opacity-90 transition-opacity"
                                                    onClick={() => setSelectedImage(`data:${img.source?.media_type};base64,${img.source?.data}`)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    {text && <div>{text}</div>}
                                    {!text && images.length === 0 && '...'}
                                </div>
                            );
                        }
                        // Assistant message
                        const blocks: ContentBlock[] = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
                        return (
                            <div key={idx} className="space-y-1">
                                {blocks.map((block, i: number) => {
                                    if (block.type === 'text' && block.text) {
                                        return (
                                            <div key={i} className="text-sm text-stone-600 dark:text-zinc-300 leading-relaxed max-w-none">
                                                <MarkdownRenderer content={block.text} className="prose-sm" isDark={true} onFilePathClick={handleFilePathClick} />
                                            </div>
                                        );
                                    }
                                    if (block.type === 'tool_use') {
                                        return (
                                            <div key={i} className="text-xs text-stone-400 bg-stone-50 rounded px-2 py-1">
                                                ⌘ {block.name}
                                            </div>
                                        );
                                    }
                                    return null;
                                })}
                            </div>
                        );
                    })}

                    {/* Streaming */}
                    {streamingText && (
                        <div className="text-sm text-stone-600 leading-relaxed max-w-none">
                            <MarkdownRenderer content={streamingText} className="prose-sm" onFilePathClick={handleFilePathClick} />
                            <span className="inline-block w-1.5 h-4 bg-orange-500 ml-0.5 animate-pulse" />
                        </div>
                    )}

                    {/* Processing indicator */}
                    {isProcessing && !streamingText && (
                        <div className="flex items-center gap-2 text-xs text-stone-400">
                            <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce" />
                            {t('thinking')}
                        </div>
                    )}
                </div>
            )}

            {/* Input Area - Using FloatingInput */}
            <FloatingInput
                onSendMessage={handleSubmit}
                onAbort={handleAbort}
                onContentChange={setHasContent}
                isProcessing={isProcessing}
                autoFocus={ballState === 'input'}
            />

            {/* Quick Actions */}
            <div className="px-2 pb-1.5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-1">
                    <button
                        onClick={async () => {
                            // Clear current conversation and start a new session
                            await window.ipcRenderer.invoke('agent:new-session');
                            setSessionId(null); // Reset to null so a new session will be created
                            setIsNewSession(true); // Mark as new session
                            hasInitialized.current = false; // Reset initialization flag
                            setMessages([]);

                            // ⚠️ 关键修复：清空当前会话的流式文本（但由于 sessionId 为 null，这里实际上清空了整个 Map）
                            // 如果需要保留其他会话的流式文本，可以只清空当前 sessionId
                            setStreamingTextMap(new Map());

                            // Keep the ball in input state for new conversation
                            setBallState('input');
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                    >
                        <Plus size={12} />
                        {t('newSession')}
                    </button>
                    <button
                        onClick={() => {
                            const newHistoryState = !showHistory;
                            setShowHistory(newHistoryState);
                        }}
                        className={`flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-colors ${showHistory ? 'text-orange-500 bg-orange-50' : 'text-stone-400 hover:text-stone-600 hover:bg-stone-100'}`}
                    >
                        <History size={12} />
                        {t('history')}
                    </button>
                    <button
                        onClick={() => window.ipcRenderer.invoke('floating-ball:show-main')}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                    >
                        <Home size={12} />
                        {t('home')}
                    </button>
                </div>
                <button
                    onClick={handleCollapse}
                    className="p-1 text-stone-400 hover:text-stone-600 rounded transition-colors"
                >
                    <X size={14} />
                </button>
            </div>

            {/* History Panel - Rendered Below Input */}
            {showHistory && (
                <div className="border-t border-stone-100 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-900/30 flex-1 min-h-[100px] overflow-hidden flex flex-col animate-in slide-in-from-top-2 duration-200">
                    <div className="px-3 py-2 text-xs font-semibold text-stone-500 flex justify-between items-center bg-stone-100/50 dark:bg-zinc-800/50">
                        <span>{t('history')}</span>
                    </div>
                    <div className="overflow-y-auto p-2 space-y-1 flex-1">
                        {sessions.length === 0 ? (
                            <p className="text-xs text-stone-300 py-4 text-center">{t('noHistory')}</p>
                        ) : (
                            <div className="space-y-1">
                                {sessions.map((session) => (
                                    <button
                                        key={session.id}
                                        onClick={async () => {
                                            setSessionId(session.id); // Set the actual session ID
                                            setIsNewSession(false); // Mark as existing session
                                            await window.ipcRenderer.invoke('session:load', session.id);
                                            setShowHistory(false);
                                            setBallState('expanded'); // Show conversation view
                                        }}
                                        className="w-full text-left p-2 hover:bg-stone-50 rounded-lg transition-colors group border border-transparent hover:border-stone-100"
                                    >
                                        <div className="text-xs text-stone-700 font-medium truncate">
                                            {session.title || t('untitledSession')}
                                        </div>
                                        <div className="text-[10px] text-stone-400 mt-0.5 flex justify-between">
                                            <span>
                                                {new Date(session.updatedAt).toLocaleString('zh-CN', {
                                                    month: 'numeric',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </span>
                                            <span className="opacity-0 group-hover:opacity-100 text-orange-500 transition-opacity">
                                                {t('load')}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
