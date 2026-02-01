import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Zap, AlertTriangle, Check, X, Settings, Plus, ChevronDown, ChevronUp, Download, Files, History, Activity, Trash2, Brain } from 'lucide-react';
import { ChatInput } from './ChatInput';
import { useI18n } from '../i18n/I18nContext';
import { logger } from '../services/logger';
import { MarkdownRenderer } from './MarkdownRenderer';
// import { TodoBar } from './TodoBar'; // ⚠️ 暂时禁用
import { ThinkingBubble } from './ThinkingBubble';
import Anthropic from '@anthropic-ai/sdk';
import { CopyButton } from './CopyButton';
import { FileCanvasPanel } from './FileCanvas/FileCanvasPanel';

type Mode = 'memory' | 'work';

interface PermissionRequest {
    id: string;
    tool: string;
    description: string;
    args: Record<string, unknown>;
}

interface UserQuestionOption {
    label: string;
    description: string;
}

interface UserQuestion {
    requestId: string;
    questions: Array<{
        question: string;
        header: string;
        options: UserQuestionOption[];
        multiSelect: boolean;
    }>;
}

interface SessionSummary {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
}

interface CoworkViewProps {
    history: Anthropic.MessageParam[];
    onSendMessage: (message: string | { content: string, images: string[] }) => void;
    onAbort: () => void;
    isProcessing: boolean;
    onOpenSettings: () => void;
}

// CoworkView 组件 - 不使用 memo，因为 history 和 isProcessing 频繁变化
export function CoworkView({ history, onSendMessage, onAbort, isProcessing, onOpenSettings }: CoworkViewProps) {
    const { t } = useI18n();
    const [mode, setMode] = useState<Mode>('work');
    const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());

    // ⚠️ 关键修复：使用 Map 存储每个会话的流式文本，支持会话切换时恢复流式显示
    const [streamingTextMap, setStreamingTextMap] = useState<Map<string, string>>(new Map());
    // ⚠️ 实时思考内容：只用于当前正在流式的消息（不是累积的）
    const [currentThinkingText, setCurrentThinkingText] = useState<string>('');
    // ⚠️ 新增：Todo 列表状态（每个会话独立）- 暂时禁用
    // const [todosMap, setTodosMap] = useState<Map<string, Array<{ id: string; content: string; activeForm: string; status: 'pending' | 'in_progress' | 'completed' }>>>(new Map());

    const [workingDir, setWorkingDir] = useState<string | null>(null);
    const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
    const [userQuestion, setUserQuestion] = useState<UserQuestion | null>(null);
    const [selectedAnswers, setSelectedAnswers] = useState<Map<number, string[]>>(new Map());
    const [customAnswers, setCustomAnswers] = useState<Map<number, string>>(new Map());
    const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set());
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [config, setConfig] = useState<any>(null);
    const [showFileCanvas, setShowFileCanvas] = useState(false);
    const [fileChangeCount, setFileChangeCount] = useState(0);
    const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);
    const currentSessionIdRef = useRef<string | null>(null);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const userScrolledRef = useRef(false);
    // ⚠️ 新增：待发送上下文队列（每个会话独立）
    const [pendingContextMap, setPendingContextMap] = useState<Map<string, string[]>>(new Map());

    // ⚠️ 计算属性：获取当前会话的流式文本
    const streamingText: string = currentSessionId ? (streamingTextMap.get(currentSessionId) || '') : '';

    // Update ref when currentSessionId changes
    useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
    }, [currentSessionId]);

    // ⚠️ 智能滚动：只在用户位于底部时自动滚动
    const scrollToBottom = () => {
        if (scrollRef.current) {
            const isNearBottom = scrollRef.current.scrollHeight - scrollRef.current.scrollTop - scrollRef.current.clientHeight < 50;
            if (isNearBottom && !userScrolledRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
        }
    };

    // ⚠️ 监听用户滚动行为
    useEffect(() => {
        const handleScroll = () => {
            if (scrollRef.current) {
                const isNearBottom = scrollRef.current.scrollHeight - scrollRef.current.scrollTop - scrollRef.current.clientHeight < 50;
                userScrolledRef.current = !isNearBottom;
            }
        };

        const currentRef = scrollRef.current;
        if (currentRef) {
            currentRef.addEventListener('scroll', handleScroll);
            return () => currentRef.removeEventListener('scroll', handleScroll);
        }
    }, []);

    // Load config including model name
    // Provider Constants


    useEffect(() => {
        window.ipcRenderer.invoke('config:get-all').then((cfg) => {
            setConfig(cfg as any);
        });

        // 获取当前会话ID
        window.ipcRenderer.invoke('session:current').then((session: any) => {
            setCurrentSessionId(session?.id || null);
        });

        // 流式事件监听（带会话过滤）
        const removeStreamListener = window.ipcRenderer.on('agent:stream-token', (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; data: string };

            // 只处理当前会话的事件
            if (eventData.sessionId !== currentSessionIdRef.current) {
                console.log(`[CoworkView] Ignoring stream for session ${eventData.sessionId} (current: ${currentSessionIdRef.current})`);
                return;
            }

            console.log('[CoworkView] Processing stream token for current session');

            // ⚠️ 累积流式文本（不清空思考内容，思考内容应该在消息完成时才清空）
            setStreamingTextMap(prev => {
                const newMap = new Map(prev);
                const currentText = newMap.get(eventData.sessionId) || '';
                newMap.set(eventData.sessionId, currentText + eventData.data);
                return newMap;
            });
        });

        // ⚠️ 新增：思考内容监听（显示模型推理过程）
        const removeThinkingListener = window.ipcRenderer.on('agent:stream-thinking', (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; data: string };

            // 只处理当前会话的事件
            if (eventData.sessionId !== currentSessionIdRef.current) {
                return;
            }

            // 累积当前消息的思考内容
            setCurrentThinkingText(prev => prev + eventData.data);
        });

        // ⚠️ 关键修复：恢复流式文本监听（用于切换回正在运行的会话）
        const removeRestoreStreamingListener = window.ipcRenderer.on('agent:restore-streaming', (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; data: string };

            // 只处理当前会话的事件
            if (eventData.sessionId !== currentSessionIdRef.current) {
                console.log(`[CoworkView] Ignoring restore streaming for session ${eventData.sessionId} (current: ${currentSessionIdRef.current})`);
                return;
            }

            console.log(`[CoworkView] ✅ Restoring streaming text for session ${eventData.sessionId}: ${eventData.data.length} chars`);

            // 恢复流式文本到 Map
            setStreamingTextMap(prev => {
                const newMap = new Map(prev);
                newMap.set(eventData.sessionId, eventData.data);
                return newMap;
            });
        });

        // 历史更新监听（带会话过滤）
        const removeHistoryListener = window.ipcRenderer.on('agent:history-update', async (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; data: Anthropic.MessageParam[] };

            // ⚠️ 简化过滤：只检查当前会话
            // 因为后端已经调整了事件发送顺序，确保 ref 在此之前已更新
            if (eventData.sessionId !== currentSessionIdRef.current) {
                console.log(`[CoworkView] Ignoring history update for session ${eventData.sessionId} (current: ${currentSessionIdRef.current})`);
                return;
            }

            const newHistory = eventData.data;
            console.log(`[CoworkView] ✅ Processing history update for current session ${eventData.sessionId}: ${newHistory.length} messages`);

            // ⚠️ 关键修复：只在会话不运行时清空流式文本
            // 如果会话正在运行，说明还有流式内容在继续，不应该清空
            const isSessionRunning = runningSessionIds.has(eventData.sessionId);
            if (!isSessionRunning) {
                setStreamingTextMap(prev => {
                    const newMap = new Map(prev);
                    newMap.set(eventData.sessionId, '');
                    return newMap;
                });
            } else {
                console.log(`[CoworkView] Session ${eventData.sessionId} is running, preserving streaming text`);
            }

            // Note: History is auto-saved by AgentRuntime when message completes
            // No need to save here - just update the UI
        });

        // Listen for permission requests
        const removeConfirmListener = window.ipcRenderer.on('agent:confirm-request', (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; data: PermissionRequest };

            // Only process requests for current session
            if (eventData.sessionId !== currentSessionIdRef.current) {
                console.log(`[CoworkView] Ignoring confirm request for session ${eventData.sessionId} (current: ${currentSessionIdRef.current})`);
                return;
            }

            console.log('[CoworkView] Processing confirm request for current session');
            setPermissionRequest(eventData.data);
        });

        // ⚠️ 新增：监听用户问题请求
        const removeUserQuestionListener = window.ipcRenderer.on('agent:ask-user-question', (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; data: UserQuestion };

            // Only process requests for current session
            if (eventData.sessionId !== currentSessionIdRef.current) {
                console.log(`[CoworkView] Ignoring user question for session ${eventData.sessionId} (current: ${currentSessionIdRef.current})`);
                return;
            }

            console.log('[CoworkView] Processing user question for current session:', eventData.data);
            setUserQuestion(eventData.data);
            // 重置选中的答案
            setSelectedAnswers(new Map());
            setCustomAnswers(new Map());
            setActiveQuestionIndex(0);
        });

        // Listen for abort events
        const removeAbortListener = window.ipcRenderer.on('agent:aborted', (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; data: unknown };

            // Only process abort for current session
            if (eventData.sessionId !== currentSessionIdRef.current) {
                console.log(`[CoworkView] Ignoring abort for session ${eventData.sessionId} (current: ${currentSessionIdRef.current})`);
                return;
            }

            console.log('[CoworkView] Processing abort for current session');

            // ⚠️ 新增：发送待发送的上下文
            const pending = pendingContextMap.get(eventData.sessionId) || [];
            if (pending.length > 0) {
                pending.forEach((msg) => onSendMessage(`[上下文信息]\n${msg}`));
                setPendingContextMap(prev => {
                    const newMap = new Map(prev);
                    newMap.set(eventData.sessionId, []);
                    return newMap;
                });
            }

            // ⚠️ 关键修复：清空当前会话的流式文本
            setStreamingTextMap(prev => {
                const newMap = new Map(prev);
                newMap.set(eventData.sessionId, '');
                return newMap;
            });

            setPermissionRequest(null);
            setUserQuestion(null);
            setSelectedAnswers(new Map());
            setCustomAnswers(new Map());
            setActiveQuestionIndex(0);
        });

        // Listen for error events
        const removeErrorListener = window.ipcRenderer.on('agent:error', (_event, ...args) => {
            const eventData = args[0] as { sessionId: string; data: string };

            // Only process errors for current session
            if (eventData.sessionId !== currentSessionIdRef.current) {
                console.log(`[CoworkView] Ignoring error for session ${eventData.sessionId} (current: ${currentSessionIdRef.current})`);
                return;
            }

            console.log('[CoworkView] Processing error for current session');
            setError(eventData.data);

            // ⚠️ 新增：发送待发送的上下文
            const pending = pendingContextMap.get(eventData.sessionId) || [];
            if (pending.length > 0) {
                pending.forEach((msg) => onSendMessage(`[上下文信息]\n${msg}`));
                setPendingContextMap(prev => {
                    const newMap = new Map(prev);
                    newMap.set(eventData.sessionId, []);
                    return newMap;
                });
            }

            // ⚠️ 关键修复：清空当前会话的流式文本
            setStreamingTextMap(prev => {
                const newMap = new Map(prev);
                newMap.set(eventData.sessionId, '');
                return newMap;
            });
        });

        // Listen for session running status changes
        const removeRunningListener = window.ipcRenderer.on('session:running-changed', (_event, data) => {
            const { sessionId, isRunning } = data as { sessionId: string; isRunning: boolean; count: number };

            // Update current session ID if needed
            if (isRunning && !currentSessionIdRef.current) {
                setCurrentSessionId(sessionId);
            }

            // Update running sessions set
            setRunningSessionIds(prev => {
                const newSet = new Set(prev);
                if (isRunning) {
                    newSet.add(sessionId);
                } else {
                    newSet.delete(sessionId);
                }
                return newSet;
            });
        });

        // ⚠️ 新增：监听 AI 完成事件，清空流式文本和思考内容
        const removeClearStreamingListener = window.ipcRenderer.on('agent:clear-streaming', (_event, data) => {
            const { sessionId } = data as { sessionId: string };
            // 只处理当前会话的事件
            if (sessionId !== currentSessionIdRef.current) {
                return;
            }
            console.log(`[CoworkView] Clearing streaming text and thinking for session ${sessionId}`);
            setStreamingTextMap(prev => {
                const newMap = new Map(prev);
                newMap.set(sessionId, '');
                return newMap;
            });
            // 清空当前消息的思考内容
            setCurrentThinkingText('');
        });

        // Listen for session current changed events (new session, load session, etc.)
        const removeSessionChangedListener = window.ipcRenderer.on('session:current-changed', (_event, data) => {
            const { sessionId: newSessionId, isRunning, mode } = data as { sessionId: string | null; isRunning?: boolean; mode?: string };
            console.log('[CoworkView] Session changed to:', newSessionId, 'running:', isRunning, 'mode:', mode);

            // ⚠️ 关键修复：立即同步更新 ref，不使用 async
            currentSessionIdRef.current = newSessionId;
            setCurrentSessionId(newSessionId);

            // ⚠️ 关键修复：不清空所有流式文本，保留每个会话的独立状态
            // streamingText 会自动从 streamingTextMap 中获取对应会话的值

            // 清除本地状态
            setError(null);
            setPermissionRequest(null);

            // 重置文件变更计数
            setFileChangeCount(0);

            // ⚠️ 关键修复：不要在这里重新加载历史！
            // agent:history-update 事件已经包含了完整的历史数据
            // App.tsx 会处理全局的 history 状态

            console.log(`[CoworkView] ✅ Session ref updated to: ${newSessionId}, streamingText restored from map`);
        });

        // ⚠️ 新增：监听文件变更事件
        const removeFileChangedListener = window.ipcRenderer.on('file:changed', (_event, data) => {
            const { sessionId, change } = data as { sessionId: string; change: any };
            // 只处理当前会话的文件变更
            if (sessionId !== currentSessionIdRef.current) {
                console.log(`[CoworkView] Ignoring file change for session ${sessionId} (current: ${currentSessionIdRef.current})`);
                return;
            }
            console.log('[CoworkView] ✅ File changed:', change.path, 'type:', change.type);
            // 增加变更计数
            setFileChangeCount(prev => prev + 1);
            // 自动打开 FileCanvas（如果尚未打开）
            setShowFileCanvas(true);
        });

        // ⚠️ 新增：监听工作目录变化事件
        const removeWorkingDirChangedListener = window.ipcRenderer.on('agent:working-dir-changed', (_event, folderPath) => {
            console.log('[CoworkView] ✅ Working directory changed to:', folderPath);
            setWorkingDir(folderPath as string);
        });

        // ⚠️ 新增：监听从悬浮球打开文件画布的事件
        const removeOpenFileCanvasListener = window.ipcRenderer.on('open-file-canvas', (_event, data) => {
            const { filePath } = data as { filePath: string };
            console.log('[CoworkView] ✅ Open file canvas from floating ball:', filePath);
            setPendingFilePath(filePath);
            setShowFileCanvas(true);
        });

        // Initial load of running sessions
        window.ipcRenderer.invoke('session:get-running-ids').then((ids) => {
            setRunningSessionIds(new Set(ids as string[]));
        });

        return () => {
            // Save session on unmount to prevent data loss
            if (history && history.length > 0) {
                const hasRealContent = history.some(msg => {
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

                if (hasRealContent) {
                    window.ipcRenderer.invoke('session:save', history).catch(err => {
                        logger.error('[CoworkView] Error saving session on unmount:', err);
                    });
                }
            }

            removeStreamListener?.();
            removeThinkingListener?.();
            removeRestoreStreamingListener?.();
            removeHistoryListener?.();
            removeConfirmListener?.();
            removeUserQuestionListener?.();
            removeAbortListener?.();
            removeErrorListener?.();
            removeRunningListener?.();
            removeSessionChangedListener?.();
            removeClearStreamingListener?.();
            removeFileChangedListener?.();
            removeWorkingDirChangedListener?.();
            removeOpenFileCanvasListener?.();
        };
    }, []);

    // Fetch session list when history panel is opened
    useEffect(() => {
        if (showHistory) {
            window.ipcRenderer.invoke('session:list').then((list) => {
                setSessions(list as SessionSummary[]);
            });
        }
    }, [showHistory]);

    const toggleBlock = useCallback((id: string) => {
        setExpandedBlocks(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    // ⚠️ 关键修复：避免重复显示最后一条 assistant 消息
    // 如果最后一条消息是 assistant 且有 streamingText，则在 history 中排除它
    const relevantHistory = history.filter(m => (m.role as string) !== 'system');
    const displayHistory = (() => {
        // ⚠️ 修复：只在真正流式进行时才排除最后一条 assistant 消息
        // 判断标准：AI 正在运行(isProcessing=true) 且有 streamingText
        const isActivelyStreaming = isProcessing && streamingText.length > 0;

        if (!isActivelyStreaming || relevantHistory.length === 0) {
            return relevantHistory;
        }
        const lastMessage = relevantHistory[relevantHistory.length - 1];
        if (lastMessage?.role === 'assistant') {
            // 排除最后一条 assistant 消息，因为它已经在 streamingText 中显示了
            return relevantHistory.slice(0, -1);
        }
        return relevantHistory;
    })();

    useEffect(() => {
        scrollToBottom();
    }, [displayHistory, streamingText]);



    const handleSelectFolder = async () => {
        const folder = await window.ipcRenderer.invoke('dialog:select-folder') as string | null;
        if (folder) {
            setWorkingDir(folder);
            // Set as primary working directory (also authorizes it)
            await window.ipcRenderer.invoke('agent:set-working-dir', folder);
        }
    };

    const handlePermissionResponse = (approved: boolean) => {
        if (permissionRequest) {
            window.ipcRenderer.invoke('agent:confirm-response', {
                id: permissionRequest.id,
                approved
            });
            setPermissionRequest(null);
        }
    };

    // ⚠️ 新增：处理用户问题回答
    const handleUserQuestionResponse = () => {
        if (!userQuestion) return;

        // 检查是否所有问题都已回答
        const allAnswered = userQuestion.questions.every((_, qIndex) => {
            const answers = selectedAnswers.get(qIndex) || [];
            // 如果选择了 "Other"，需要检查是否有自定义输入
            if (answers.includes('Other')) {
                const customAnswer = customAnswers.get(qIndex);
                return customAnswer && customAnswer.trim().length > 0;
            }
            return answers.length > 0;
        });

        if (!allAnswered) {
            logger.warn('[CoworkView] Not all questions answered');
            return;
        }

        // 将答案转换为字符串数组
        const answers: string[] = userQuestion.questions.map((q, qIndex) => {
            const answerList = selectedAnswers.get(qIndex) || [];
            // 如果选择了 "Other"，返回自定义输入
            if (answerList.includes('Other')) {
                return customAnswers.get(qIndex) || '';
            }
            // 多选模式：返回所有选中的选项（用逗号分隔）
            // 单选模式：返回第一个选中的选项
            if (q.multiSelect) {
                return answerList.join(', ');
            }
            return answerList[0];
        });

        console.log('[CoworkView] Sending user question answers:', answers);

        window.ipcRenderer.invoke('agent:user-question-answer', {
            requestId: userQuestion.requestId,
            answers
        });

        setUserQuestion(null);
        setSelectedAnswers(new Map());
        setCustomAnswers(new Map());
        setActiveQuestionIndex(0);
    };

    // ⚠️ 新增：处理选项选择
    const handleOptionSelect = (questionIndex: number, optionLabel: string, multiSelect: boolean) => {
        setSelectedAnswers(prev => {
            const newMap = new Map(prev);
            const currentAnswers = newMap.get(questionIndex) || [];

            if (multiSelect) {
                // 多选模式
                if (currentAnswers.includes(optionLabel)) {
                    // 取消选择
                    newMap.set(questionIndex, currentAnswers.filter(a => a !== optionLabel));
                } else {
                    // 添加选择
                    newMap.set(questionIndex, [...currentAnswers, optionLabel]);
                }
            } else {
                // 单选模式
                newMap.set(questionIndex, [optionLabel]);
            }

            return newMap;
        });

        // 如果取消选择了 "Other"，清空自定义输入
        if (selectedAnswers.get(activeQuestionIndex)?.includes('Other') === true) {
            setCustomAnswers(prev => {
                const newMap = new Map(prev);
                newMap.delete(activeQuestionIndex);
                return newMap;
            });
        }
    };

    // ⚠️ 新增：处理自定义输入
    const handleCustomInputChange = (questionIndex: number, value: string) => {
        setCustomAnswers(prev => {
            const newMap = new Map(prev);
            newMap.set(questionIndex, value);
            return newMap;
        });
    };

    // ⚠️ 新增：处理文件路径点击（在文件画布中打开）
    const handleFilePathClick = useCallback((filePath: string) => {
        console.log('[CoworkView] File path clicked:', filePath);
        setPendingFilePath(filePath);
        setShowFileCanvas(true);
    }, []);



    // Keyboard shortcuts
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // Focus input on Ctrl/Cmd+L
            if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
                e.preventDefault();
                // inputRef.current?.focus(); // Logic moved to ChatInput
            }
            // Toggle file canvas on Ctrl/Cmd+B
            if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                e.preventDefault();
                setShowFileCanvas(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, []);

    return (
        <div className="flex flex-col h-full bg-[#FAF8F5] dark:bg-zinc-950 relative">
            {/* Permission Dialog Overlay */}
            {permissionRequest && (
                <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 w-full max-w-md shadow-xl animate-in fade-in zoom-in-95 duration-200 border border-stone-200 dark:border-zinc-800">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                                <AlertTriangle size={24} className="text-amber-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-stone-800 dark:text-zinc-100 text-lg">{t('actionConfirmation')}</h3>
                                <p className="text-sm text-stone-500 dark:text-zinc-400">{permissionRequest.tool}</p>
                            </div>
                        </div>

                        <p className="text-stone-600 dark:text-zinc-300 mb-4">{permissionRequest.description}</p>

                        {/* Show details if write_file */}
                        {typeof permissionRequest.args?.path === 'string' && (
                            <div className="bg-stone-50 dark:bg-zinc-800 rounded-lg p-3 mb-4 font-mono text-xs text-stone-600 dark:text-zinc-300 border border-stone-200 dark:border-zinc-700">
                                <span className="text-stone-400 dark:text-zinc-500">{t('path')} </span>
                                {permissionRequest.args.path as string}
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={() => handlePermissionResponse(false)}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-600 dark:text-zinc-300 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-xl transition-colors"
                            >
                                <X size={16} />
                                {t('deny')}
                            </button>
                            <button
                                onClick={() => handlePermissionResponse(true)}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-xl transition-colors"
                            >
                                <Check size={16} />
                                {t('allow')}
                            </button>
                        </div>
                    </div>
                </div>
            )}



            {/* Error Dialog Overlay */}
            {error && (
                <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 w-full max-w-md shadow-xl animate-in fade-in zoom-in-95 duration-200 border border-red-200 dark:border-red-900/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                                <AlertTriangle size={24} className="text-red-600 dark:text-red-400" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-stone-800 dark:text-zinc-100 text-lg">{t('error') || 'Error'}</h3>
                            </div>
                        </div>

                        <div className="text-stone-600 dark:text-zinc-300 mb-6 whitespace-pre-wrap text-sm max-h-[60vh] overflow-y-auto">
                            {error}
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setError(null)}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-stone-800 hover:bg-stone-900 dark:bg-zinc-700 dark:hover:bg-zinc-600 rounded-xl transition-colors"
                            >
                                <X size={16} />
                                {t('close') || 'Close'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Image Lightbox */}
            {selectedImage && (
                <div
                    className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={() => setSelectedImage(null)}
                >
                    <button
                        className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors"
                        onClick={() => setSelectedImage(null)}
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

            {/* Top Bar with Mode Tabs and Settings */}
            <div className="border-b border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-2.5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    {/* Mode Tabs */}
                    <div className="flex items-center gap-0.5 bg-stone-100 dark:bg-zinc-800 rounded-lg p-0.5">
                        <button
                            onClick={async () => {
                                setMode('memory');
                                // 切换到记忆助手 session
                                await window.ipcRenderer.invoke('session:switch-to-memory-assistant');
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'memory' ? 'bg-white dark:bg-zinc-700 text-stone-800 dark:text-zinc-100 shadow-sm' : 'text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200'
                                }`}
                        >
                            <Brain size={14} />
                            {t('memory')}
                        </button>
                        <button
                            onClick={async () => {
                                setMode('work');
                                // 切换回协作 session
                                await window.ipcRenderer.invoke('session:switch-to-cowork');
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'work' ? 'bg-white dark:bg-zinc-700 text-stone-800 dark:text-zinc-100 shadow-sm' : 'text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200'
                                }`}
                        >
                            <Zap size={14} />
                            {t('cowork')}
                        </button>
                    </div>
                </div>

                {/* History + Settings */}
                <div className="flex items-center gap-2">
                    {workingDir && (
                        <span className="text-xs text-stone-400 dark:text-zinc-500 truncate max-w-32">
                            📂 {workingDir.split(/[\\/]/).pop()}
                        </span>
                    )}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => {
                                setShowFileCanvas(!showFileCanvas);
                                // 点击时重置变更计数（可选，或者保留计数直到会话切换）
                                // setFileChangeCount(0);
                            }}
                            className={`p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded-lg transition-colors relative ${showFileCanvas ? 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-300' : ''}`}
                            title={t('toggleFileCanvas')}
                        >
                            <Files size={16} />
                            {fileChangeCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                                    {fileChangeCount > 9 ? '9+' : fileChangeCount}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={async () => {
                                // Clear local state immediately
                                if (currentSessionId) {
                                    setStreamingTextMap(prev => {
                                        const newMap = new Map(prev);
                                        newMap.set(currentSessionId, '');
                                        return newMap;
                                    });
                                }
                                setError(null);
                                setPermissionRequest(null);
                                setExpandedBlocks(new Set());

                                // Create new session in backend
                                await window.ipcRenderer.invoke('agent:new-session');
                            }}
                            className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                            title={t('newSession')}
                        >
                            <Plus size={16} />
                        </button>
                        <button
                            onClick={() => setShowHistory(!showHistory)}
                            className={`p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded-lg transition-colors relative ${showHistory ? 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-300' : ''}`}
                            title={t('taskHistory')}
                        >
                            <History size={16} />
                        </button>
                    </div>
                    <button
                        onClick={onOpenSettings}
                        className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                        title="Settings"
                    >
                        <Settings size={16} />
                    </button>
                </div>
            </div>

            {/* History Panel - Floating Popover */}
            {showHistory && (
                <div className="absolute top-12 right-6 z-20 w-80 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-stone-200 dark:border-zinc-800 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 dark:border-zinc-800 bg-stone-50/50 dark:bg-zinc-800/50">
                        <div className="flex items-center gap-2">
                            <History size={14} className="text-orange-500" />
                            <span className="text-sm font-semibold text-stone-700 dark:text-zinc-200">{t('taskHistory')}</span>
                        </div>
                        <button
                            onClick={() => setShowHistory(false)}
                            className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                        >
                            <X size={14} />
                        </button>
                    </div>

                    <div className="max-h-[320px] overflow-y-auto p-2">
                        {sessions.length === 0 ? (
                            <div className="py-8 text-center">
                                <p className="text-sm text-stone-400 dark:text-zinc-500">{t('noHistorySessions')}</p>
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {sessions.map((session) => (
                                    <div
                                        key={session.id}
                                        className="group relative p-3 rounded-lg hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors border border-transparent hover:border-stone-100 dark:hover:border-zinc-700"
                                    >
                                        <div className="flex items-start gap-2">
                                            <p className="text-xs font-medium text-stone-700 dark:text-zinc-300 line-clamp-2 leading-relaxed flex-1">
                                                {session.title}
                                            </p>
                                            {runningSessionIds.has(session.id) && (
                                                <div className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-[10px] font-medium flex-shrink-0">
                                                    <Activity size={10} className="animate-pulse" />
                                                    <span>运行中</span>
                                                </div>
                                            )}
                                        </div>
                                        <p className="text-[10px] text-stone-400 mt-1">
                                            {new Date(session.updatedAt).toLocaleString('zh-CN', {
                                                month: 'short',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </p>
                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={async () => {
                                                    // Clear local state first
                                                    if (currentSessionId) {
                                                        setStreamingTextMap(prev => {
                                                            const newMap = new Map(prev);
                                                            newMap.set(currentSessionId, '');
                                                            return newMap;
                                                        });
                                                    }
                                                    setError(null);
                                                    setPermissionRequest(null);
                                                    setExpandedBlocks(new Set());

                                                    // Load session (backend will handle the rest)
                                                    await window.ipcRenderer.invoke('session:load', session.id);

                                                    setShowHistory(false);
                                                }}
                                                className="text-[10px] flex items-center gap-1 text-orange-500 hover:text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full"
                                            >
                                                {t('load')}
                                            </button>
                                            <button
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    const isCurrentSession = session.id === currentSessionId;

                                                    // Delete the session
                                                    await window.ipcRenderer.invoke('session:delete', session.id);

                                                    // Remove from session list
                                                    setSessions(sessions.filter(s => s.id !== session.id));

                                                    // If deleted session was current, switch to new session
                                                    if (isCurrentSession) {
                                                        setCurrentSessionId(null);
                                                        setStreamingTextMap(new Map());
                                                        setError(null);
                                                        setPermissionRequest(null);

                                                        // Create a new empty session
                                                        await window.ipcRenderer.invoke('agent:new-session');
                                                    }
                                                }}
                                                className="p-1 text-stone-400 hover:text-red-500 transition-colors"
                                                title={t('delete') || 'Delete'}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Messages Area + FileCanvas - Flex Layout */}
            <div className="flex-1 flex overflow-hidden">
                {/* Main Content Area */}
                <div className={`flex-1 flex flex-col overflow-hidden ${showFileCanvas ? 'w-[70%]' : 'w-full'}`}>
                    {/* Messages Area - Responsive width */}
                    <div className="flex-1 overflow-y-auto px-4 py-6" ref={scrollRef}>
                        <div className="max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto space-y-5">
                            {displayHistory.length === 0 && !streamingText ? (
                                <EmptyState mode={mode} workingDir={workingDir} />
                            ) : (
                                <>
                                    {displayHistory.map((msg, idx) => (
                                        <MessageItem
                                            key={idx}
                                            message={msg}
                                            expandedBlocks={expandedBlocks}
                                            toggleBlock={toggleBlock}
                                            showTools={mode === 'work'}
                                            onImageClick={setSelectedImage}
                                            onFilePathClick={handleFilePathClick}
                                        />
                                    ))}

                                    {/* ⚠️ 显示当前正在流式的消息的思考内容 */}
                                    {currentThinkingText && (
                                        <ThinkingBubble thinkingText={currentThinkingText} />
                                    )}

                                    {streamingText && (
                                        <div className="animate-in fade-in duration-200">
                                            <div className="text-stone-700 dark:text-zinc-300 text-[15px] leading-7 max-w-none">
                                                <div className="relative group">
                                                    <MarkdownRenderer content={streamingText} isDark={true} onFilePathClick={handleFilePathClick} />
                                                    <span className="inline-block w-2 h-5 bg-orange-500 ml-0.5 animate-pulse" />
                                                    <div className="absolute right-0 -bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <CopyButton content={streamingText} size="sm" />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {isProcessing && !streamingText && (
                                <div className="flex items-center gap-2 text-stone-400 text-sm animate-pulse">
                                    <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce" />
                                    <span>{t('thinking')}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ⚠️ 暂时禁用任务进度显示 */}
                    {/* <div className="px-4 pt-2 flex-shrink-0">
                        <div className="max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto">
                            <TodoBar
                                todos={currentSessionId ? (todosMap.get(currentSessionId) || []) : []}
                                onTodosChange={(newTodos) => {
                                    if (currentSessionId) {
                                        setTodosMap(prev => {
                                            const newMap = new Map(prev);
                                            newMap.set(currentSessionId, newTodos);
                                            return newMap;
                                        });
                                    }
                                }}
                                isProcessing={isProcessing}
                            />
                        </div>
                    </div> */}

                    {/* ⚠️ 用户问题选择框 */}
                    {userQuestion && (
                        <div className="px-4 pb-3 flex-shrink-0">
                            <div className="max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto bg-white dark:bg-zinc-900 rounded-xl border border-stone-200 dark:border-zinc-700 shadow-lg overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                                {/* Header - 简洁版 */}
                                <div className="bg-stone-50 dark:bg-zinc-800 px-3 py-2 border-b border-stone-200 dark:border-zinc-700">
                                    <div className="flex items-center justify-between">
                                        {/* 问题切换标签（多个问题时显示） */}
                                        {userQuestion.questions.length > 1 ? (
                                            <div className="flex gap-1.5 flex-1 overflow-x-auto scrollbar-thin">
                                                {userQuestion.questions.map((q, idx) => {
                                                    const isActive = idx === activeQuestionIndex;
                                                    const isAnswered = (selectedAnswers.get(idx) || []).length > 0 ||
                                                                     (customAnswers.get(idx) || '').trim().length > 0;

                                                    return (
                                                        <button
                                                            key={idx}
                                                            onClick={() => setActiveQuestionIndex(idx)}
                                                            className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-all ${
                                                                isActive
                                                                    ? 'bg-blue-500 text-white shadow-sm'
                                                                    : isAnswered
                                                                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                                                                    : 'bg-stone-100 dark:bg-zinc-700 text-stone-600 dark:text-zinc-400 hover:bg-stone-200 dark:hover:bg-zinc-600'
                                                            }`}
                                                        >
                                                            <span className="flex items-center gap-1.5">
                                                                {isAnswered && !isActive && <Check size={10} />}
                                                                {q.header}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="flex-1">
                                                {/* 单个问题时显示问题标签 */}
                                                <span className="text-xs font-semibold px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg inline-block">
                                                    {userQuestion.questions[0].header}
                                                </span>
                                            </div>
                                        )}

                                        {/* 关闭按钮 */}
                                        <button
                                            onClick={() => {
                                                setUserQuestion(null);
                                                setSelectedAnswers(new Map());
                                                setCustomAnswers(new Map());
                                                setActiveQuestionIndex(0);
                                            }}
                                            className="p-1.5 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-lg transition-colors ml-2"
                                        >
                                            <X size={16} className="text-stone-500 dark:text-zinc-400" />
                                        </button>
                                    </div>
                                </div>

                                {/* 问题内容区域（使用更小的最大高度） */}
                                <div className="max-h-[280px] overflow-y-auto p-3">
                                    {(() => {
                                        const currentQ = userQuestion.questions[activeQuestionIndex];
                                        const currentAnswers = selectedAnswers.get(activeQuestionIndex) || [];
                                        const isOtherSelected = currentAnswers.includes('Other');
                                        const customInput = customAnswers.get(activeQuestionIndex) || '';

                                        return (
                                            <div className="space-y-3">
                                                {/* 问题文本 */}
                                                <p className="text-sm font-medium text-stone-700 dark:text-zinc-300">
                                                    {currentQ.question}
                                                </p>

                                                {/* 选项列表 */}
                                                <div className="space-y-1.5">
                                                    {currentQ.options.map((option, oIndex) => {
                                                        const isSelected = currentAnswers.includes(option.label);
                                                        const isMulti = currentQ.multiSelect;

                                                        return (
                                                            <button
                                                                key={oIndex}
                                                                onClick={() => handleOptionSelect(activeQuestionIndex, option.label, isMulti)}
                                                                className={`w-full text-left px-2.5 py-2 rounded-lg text-sm transition-all border ${
                                                                    isSelected
                                                                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-600'
                                                                        : 'bg-stone-50 dark:bg-zinc-800 border-stone-200 dark:border-zinc-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-stone-100 dark:hover:bg-zinc-700'
                                                                }`}
                                                            >
                                                                <div className="flex items-start gap-2">
                                                                    {/* Checkbox/Radio 指示器 */}
                                                                    <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                                                                        isSelected
                                                                            ? 'bg-blue-500 border-blue-500'
                                                                            : 'border-stone-300 dark:border-zinc-600'
                                                                    } ${isMulti ? 'rounded-md' : 'rounded-full'}`}>
                                                                        {isSelected && (
                                                                            isMulti ? (
                                                                                <Check size={10} className="text-white" />
                                                                            ) : (
                                                                                <div className="w-1.5 h-1.5 bg-white rounded-full" />
                                                                            )
                                                                        )}
                                                                    </div>

                                                                    {/* 选项内容 */}
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className={`font-medium ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-stone-700 dark:text-zinc-300'}`}>
                                                                            {option.label}
                                                                        </div>
                                                                        {option.description && (
                                                                            <div className={`text-xs mt-0.5 ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-stone-500 dark:text-zinc-400'}`}>
                                                                                {option.description}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}

                                                    {/* "Other" 自定义输入选项 */}
                                                    <button
                                                        onClick={() => handleOptionSelect(activeQuestionIndex, 'Other', currentQ.multiSelect)}
                                                        className={`w-full text-left px-2.5 py-2 rounded-lg text-sm transition-all border ${
                                                            isOtherSelected
                                                                ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-600'
                                                                : 'bg-stone-50 dark:bg-zinc-800 border-stone-200 dark:border-zinc-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-stone-100 dark:hover:bg-zinc-700'
                                                        }`}
                                                    >
                                                        <div className="flex items-start gap-2">
                                                            <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                                                                isOtherSelected
                                                                    ? 'bg-blue-500 border-blue-500'
                                                                    : 'border-stone-300 dark:border-zinc-600'
                                                            } ${currentQ.multiSelect ? 'rounded-md' : 'rounded-full'}`}>
                                                                {isOtherSelected && (
                                                                    currentQ.multiSelect ? (
                                                                        <Check size={10} className="text-white" />
                                                                    ) : (
                                                                        <div className="w-1.5 h-1.5 bg-white rounded-full" />
                                                                    )
                                                                )}
                                                            </div>

                                                            <div className="flex-1 min-w-0">
                                                                <div className={`font-medium ${isOtherSelected ? 'text-blue-700 dark:text-blue-300' : 'text-stone-700 dark:text-zinc-300'}`}>
                                                                    Other（自定义）
                                                                </div>
                                                                <div className={`text-xs mt-0.5 ${isOtherSelected ? 'text-blue-600 dark:text-blue-400' : 'text-stone-500 dark:text-zinc-400'}`}>
                                                                    输入你自己的答案
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </button>

                                                    {/* 自定义输入框（选择了 Other 后显示） */}
                                                    {isOtherSelected && (
                                                        <div className="ml-6 animate-in fade-in slide-in-from-top-2 duration-200">
                                                            <textarea
                                                                value={customInput}
                                                                onChange={(e) => handleCustomInputChange(activeQuestionIndex, e.target.value)}
                                                                placeholder="请输入你的答案..."
                                                                className="w-full px-2.5 py-2 text-sm bg-white dark:bg-zinc-900 border-2 border-blue-300 dark:border-blue-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 resize-none"
                                                                rows={2}
                                                                autoFocus
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* Footer */}
                                <div className="px-3 py-2.5 bg-stone-50 dark:bg-zinc-800/50 border-t border-stone-200 dark:border-zinc-700 flex justify-between items-center">
                                    {/* 问题导航 */}
                                    <div className="flex items-center gap-2">
                                        {userQuestion.questions.length > 1 && (
                                            <>
                                                <button
                                                    onClick={() => setActiveQuestionIndex(prev => Math.max(0, prev - 1))}
                                                    disabled={activeQuestionIndex === 0}
                                                    className="px-2.5 py-1.5 text-xs font-medium text-stone-600 dark:text-zinc-300 bg-stone-100 dark:bg-zinc-700 hover:bg-stone-200 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-1"
                                                >
                                                    <ChevronDown size={14} className="rotate-90" />
                                                    上一个
                                                </button>
                                                <button
                                                    onClick={() => setActiveQuestionIndex(prev => Math.min(userQuestion.questions.length - 1, prev + 1))}
                                                    disabled={activeQuestionIndex === userQuestion.questions.length - 1}
                                                    className="px-2.5 py-1.5 text-xs font-medium text-stone-600 dark:text-zinc-300 bg-stone-100 dark:bg-zinc-700 hover:bg-stone-200 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-1"
                                                >
                                                    下一个
                                                    <ChevronDown size={14} className="-rotate-90" />
                                                </button>
                                            </>
                                        )}
                                    </div>

                                    {/* 确认按钮 */}
                                    <button
                                        onClick={handleUserQuestionResponse}
                                        disabled={!userQuestion.questions.every((_, qIndex) => {
                                            const answers = selectedAnswers.get(qIndex) || [];
                                            if (answers.includes('Other')) {
                                                const custom = customAnswers.get(qIndex) || '';
                                                return custom.trim().length > 0;
                                            }
                                            return answers.length > 0;
                                        })}
                                        className="px-3 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:bg-stone-300 dark:disabled:bg-zinc-700 disabled:text-stone-500 dark:disabled:text-zinc-500 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-1.5"
                                    >
                                        <Check size={14} />
                                        确认
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <ChatInput
                        onSendMessage={(msg) => {
                            // ⚠️ 新逻辑：AI 运行时自动将消息放入待发送队列
                            const isRunning = runningSessionIds.has(currentSessionId || '');
                            const messageText = typeof msg === 'string' ? msg : msg.content;

                            if (isRunning && currentSessionId) {
                                // AI 运行中，添加到待发送队列
                                console.log(`[CoworkView] AI running, adding message to pending queue: ${messageText.slice(0, 50)}...`);
                                setPendingContextMap(prev => {
                                    const newMap = new Map(prev);
                                    const list = newMap.get(currentSessionId) || [];
                                    list.push(messageText);
                                    newMap.set(currentSessionId, list);
                                    return newMap;
                                });
                                return; // 不立即发送
                            }

                            // ⚠️ 正常发送：清空当前会话的流式文本，保留其他会话
                            if (currentSessionId) {
                                setStreamingTextMap(prev => {
                                    const newMap = new Map(prev);
                                    newMap.set(currentSessionId, '');
                                    return newMap;
                                });
                            }
                            // ⚠️ 重置滚动状态，新消息会自动滚动到底部
                            userScrolledRef.current = false;
                            onSendMessage(msg);
                        }}
                        onAbort={onAbort}
                        isProcessing={isProcessing}
                        workingDir={workingDir}
                        onSelectFolder={handleSelectFolder}
                        mode={mode}
                        config={config}
                        setConfig={(newConfig) => {
                            setConfig(newConfig);
                            // Also update in main process if ChatInput doesn't do it directly?
                            // ChatInput logic calls invoke, so we just update local state.
                        }}
                    />
                </div>

                {/* FileCanvas Panel - Right Side */}
                {showFileCanvas && (
                    <FileCanvasPanel
                        isOpen={showFileCanvas}
                        sessionId={currentSessionId}
                        workingDir={workingDir}
                        onClose={() => {
                            setShowFileCanvas(false);
                            setPendingFilePath(null);
                        }}
                        initialPath={pendingFilePath}
                    />
                )}
            </div>
        </div>
    );
}



const MessageItem = memo(function MessageItem({ message, expandedBlocks, toggleBlock, showTools, onImageClick, onFilePathClick }: {
    message: Anthropic.MessageParam,
    expandedBlocks: Set<string>,
    toggleBlock: (id: string) => void,
    showTools: boolean,
    onImageClick: (src: string) => void,
    onFilePathClick?: (filePath: string) => void
}) {
    const { t } = useI18n();
    const isUser = message.role === 'user';

    if (isUser && Array.isArray(message.content) && message.content[0]?.type === 'tool_result') {
        return null;
    }

    if (isUser) {
        const contentArray = Array.isArray(message.content) ? message.content : [];
        const text = typeof message.content === 'string' ? message.content :
            contentArray.find((b): b is Anthropic.TextBlockParam => 'type' in b && b.type === 'text')?.text || '';

        // Extract images from user message
        const images = contentArray.filter((b): b is Anthropic.ImageBlockParam => 'type' in b && b.type === 'image');

        return (
            <div className="space-y-2 max-w-[85%]">
                {images.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                        {images.map((img, i: number) => {
                            const imgSource = img.source as { media_type: string; data: string };
                            const src = `data:${imgSource.media_type};base64,${imgSource.data}`;
                            return (
                                <img
                                    key={i}
                                    src={src}
                                    alt="User upload"
                                    className="w-32 h-32 object-cover rounded-xl border border-stone-200 cursor-zoom-in hover:opacity-90 transition-opacity"
                                    onClick={() => onImageClick(src)}
                                />
                            );
                        })}
                    </div>
                )}
                {text && (
                    <div className="relative group inline-block">
                        <div className="user-bubble">
                            {text}
                        </div>
                        <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <CopyButton content={text} size="sm" />
                        </div>
                    </div>
                )}
            </div>
        );
    }

    const blocks = Array.isArray(message.content) ? message.content : [{ type: 'text' as const, text: message.content as string }];

    type ContentBlock = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
    type ToolGroup = { type: 'tool_group'; items: ContentBlock[]; count: number };
    const groupedBlocks: (ContentBlock | ToolGroup)[] = [];
    let currentToolGroup: ContentBlock[] = [];

    blocks.forEach((block) => {
        const b = block as ContentBlock;
        if (b.type === 'tool_use') {
            currentToolGroup.push(b);
        } else {
            if (currentToolGroup.length > 0) {
                groupedBlocks.push({ type: 'tool_group', items: currentToolGroup, count: currentToolGroup.length });
                currentToolGroup = [];
            }
            groupedBlocks.push(b);
        }
    });
    if (currentToolGroup.length > 0) {
        groupedBlocks.push({ type: 'tool_group', items: currentToolGroup, count: currentToolGroup.length });
    }

    return (
        <div className="space-y-4">
            {groupedBlocks.map((block, i: number) => {
                // 处理思考内容块
                if (block.type === 'thinking' && block.text) {
                    return <ThinkingBubble key={i} thinkingText={block.text as string} />;
                }

                if (block.type === 'text' && block.text) {
                    return (
                        <div key={i} className="text-stone-700 dark:text-zinc-300 text-[15px] leading-7 max-w-none">
                            <div className="relative group">
                                <MarkdownRenderer content={block.text} isDark={true} onFilePathClick={onFilePathClick} />
                                <div className="absolute right-0 -bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <CopyButton content={block.text} size="sm" />
                                </div>
                            </div>
                        </div>
                    );
                }

                if (block.type === 'tool_group' && showTools) {
                    const toolGroup = block as ToolGroup;
                    return (
                        <div key={i} className="space-y-2">
                            {toolGroup.count > 1 && (
                                <div className="steps-indicator mb-2">
                                    <ChevronUp size={12} />
                                    <span>{toolGroup.count} steps</span>
                                </div>
                            )}

                            {toolGroup.items.map((tool, j: number) => {
                                const blockId = tool.id || `tool-${i}-${j}`;
                                const isExpanded = expandedBlocks.has(blockId);

                                return (
                                    <div key={j} className="command-block">
                                        <div
                                            className="command-block-header"
                                            onClick={() => toggleBlock(blockId)}
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <span className="text-stone-400 dark:text-zinc-500 text-sm">⌘</span>
                                                <span className="text-sm text-stone-600 dark:text-zinc-300 font-medium">{tool.name || 'Running command'}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {tool.name === 'write_file' && (
                                                    <Download size={14} className="text-stone-400" />
                                                )}
                                                <ChevronDown
                                                    size={16}
                                                    className={`text-stone-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                                />
                                            </div>
                                        </div>
                                        {isExpanded && (
                                            <div className="p-3 bg-stone-50 dark:bg-zinc-900 border-t border-stone-100 dark:border-zinc-800">
                                                {/* For Context Skills (empty input), show a friendly message */}
                                                {Object.keys(tool.input || {}).length === 0 ? (
                                                    <div className="text-xs text-emerald-600 font-medium">
                                                        ✓ {t('skillLoaded')}
                                                    </div>
                                                ) : (
                                                    <pre className="text-xs font-mono text-stone-500 dark:text-zinc-400 whitespace-pre-wrap overflow-x-auto">
                                                        {JSON.stringify(tool.input, null, 2)}
                                                    </pre>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                }

                return null;
            })}
        </div>
    );
});

function EmptyState({ mode, workingDir }: { mode: Mode, workingDir: string | null }) {
    const { t } = useI18n();

    return (
        <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-20">
            <div className="w-16 h-16 rounded-2xl bg-white dark:bg-zinc-800 shadow-lg flex items-center justify-center rotate-3 border border-stone-100 dark:border-zinc-700 overflow-hidden">
                <img src="./icon.png" alt="Logo" className="opacity-90 dark:opacity-80 w-full h-full object-cover" />
            </div>
            <div className="space-y-2">
                <h2 className="text-xl font-semibold text-stone-800 dark:text-zinc-100">
                    {mode === 'memory' ? 'OpenCowork Memory' : 'OpenCowork Work'}
                </h2>
                <p className="text-stone-500 dark:text-zinc-400 text-sm max-w-xs">
                    {mode === 'memory'
                        ? t('memoryModeDescription')
                        : mode === 'work' && !workingDir
                            ? '请先选择一个工作目录来开始任务'
                            : mode === 'work' && workingDir
                                ? `工作目录: ${workingDir.split(/[\\/]/).pop()}`
                                : t('startByDescribing')
                    }
                </p>
            </div>
        </div>
    );
}
