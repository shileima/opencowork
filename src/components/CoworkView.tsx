import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { Zap, AlertTriangle, Check, X, Settings, History, Plus, Trash2, ChevronDown, ChevronUp, MessageCircle, Download, Play, Edit2, Star, RefreshCw, FolderOpen } from 'lucide-react';
import { ChatInput } from './ChatInput';
import { useI18n } from '../i18n/I18nContext';
import { MarkdownRenderer } from './MarkdownRenderer';
import Anthropic from '@anthropic-ai/sdk';
import { CopyButton } from './CopyButton';
import { PlaywrightPrompt } from './PlaywrightPrompt';

type Mode = 'chat' | 'work' | 'automation';

interface PermissionRequest {
    id: string;
    tool: string;
    description: string;
    args: Record<string, unknown>;
}

interface SessionSummary {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
}

interface Script {
    id: string;
    name: string;
    filePath: string;
    createdAt: number;
    updatedAt: number;
    isOfficial?: boolean; // 是否为官方脚本
}

interface CoworkViewProps {
    history: Anthropic.MessageParam[];
    onSendMessage: (message: string | { content: string, images: string[] }) => void;
    onAbort: () => void;
    isProcessing: boolean;
    onOpenSettings: () => void;
}

// Memoize the entire view to prevent re-renders when parent state (like settings) changes
export const CoworkView = memo(function CoworkView({ history, onSendMessage, onAbort, isProcessing, onOpenSettings }: CoworkViewProps) {
    const { t } = useI18n();
    const [mode, setMode] = useState<Mode>('work');
    const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
    const [streamingText, setStreamingText] = useState('');
    const [workingDir, setWorkingDir] = useState<string | null>(null);
    const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [showScripts, setShowScripts] = useState(false);
    const [scripts, setScripts] = useState<Script[]>([]);
    const [config, setConfig] = useState<any>(null);
    const [userRole, setUserRole] = useState<'user' | 'admin'>('user');
    const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
    const [editingScriptName, setEditingScriptName] = useState<string>('');
    // 跟踪正在运行的脚本：scriptId -> sessionId 映射
    const [runningScripts, setRunningScripts] = useState<Map<string, string>>(new Map());

    const scrollRef = useRef<HTMLDivElement>(null);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const isLoadingSessionRef = useRef(false);

    const scrollToBottom = () => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    };

    // Load config including model name
    // Provider Constants


    useEffect(() => {
        window.ipcRenderer.invoke('config:get-all').then((cfg) => {
            setConfig(cfg as any); // Use full config
        });
        // 获取用户角色
        window.ipcRenderer.invoke('permission:get-role').then((role) => {
            setUserRole(role as 'user' | 'admin');
        });
        // 设置默认工作目录为 chrome-agent（仅在初始化时，如果工作目录为空）
        (async () => {
            try {
                const scriptsDir = await window.ipcRenderer.invoke('agent:get-scripts-dir') as string;
                if (scriptsDir && !workingDir) {
                    setWorkingDir(scriptsDir);
                    await window.ipcRenderer.invoke('agent:set-working-dir', scriptsDir);
                }
            } catch (error) {
                console.error('[CoworkView] Error setting default working dir:', error);
            }
        })();
        // ... existing listeners
        const removeStreamListener = window.ipcRenderer.on('agent:stream-token', (_event, ...args) => {
            const token = args[0] as string;
            setStreamingText(prev => prev + token);
        });

        // Listen for config updates from main process (e.g. settings change)
        const removeConfigListener = window.ipcRenderer.on('config:updated', (_event, newConfig) => {
            console.log('[CoworkView] Config updated:', newConfig);
            setConfig(newConfig);
        });

        // 监听自动加载会话事件
        const removeAutoLoadListener = window.ipcRenderer.on('session:auto-loaded', (_event, ...args) => {
            const sessionId = args[0] as string;
            console.log('[CoworkView] Session auto-loaded:', sessionId);
            // 标记正在加载会话，避免自动保存覆盖
            isLoadingSessionRef.current = true;
            // 刷新会话列表
            window.ipcRenderer.invoke('session:list').then((list) => {
                setSessions(list as SessionSummary[]);
            });
        });

        // 监听任务完成事件，移除运行状态
        const removeDoneListener = window.ipcRenderer.on('agent:done', (_event, ...args) => {
            const data = args[0] as { timestamp?: number; taskId?: string };
            console.log(`[CoworkView] agent:done event received:`, data);
            if (data?.taskId) {
                // 通过 taskId (sessionId) 找到对应的 scriptId 并移除运行状态
                setRunningScripts(prev => {
                    const newMap = new Map(prev);
                    let found = false;
                    for (const [scriptId, sessionId] of newMap.entries()) {
                        if (sessionId === data.taskId) {
                            console.log(`[CoworkView] Removing running status for script ${scriptId}, sessionId: ${sessionId}`);
                            newMap.delete(scriptId);
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        console.warn(`[CoworkView] Could not find script for taskId: ${data.taskId}`);
                    }
                    console.log(`[CoworkView] Running scripts after removal:`, Array.from(newMap.entries()));
                    return newMap;
                });
            }
        });

        // Clear streaming when history updates and save session
        const removeHistoryListener = window.ipcRenderer.on('agent:history-update', async (_event, ...args) => {
            const newHistory = args[0] as Anthropic.MessageParam[];
            setStreamingText('');
            
            // 如果正在加载会话，不自动保存（避免覆盖已加载的会话）
            if (isLoadingSessionRef.current) {
                isLoadingSessionRef.current = false;
                return;
            }
            
            // Auto-save session only if there's meaningful content
            if (newHistory && newHistory.length > 0) {
                const hasRealContent = newHistory.some(msg => {
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
                    try {
                        const result = await window.ipcRenderer.invoke('session:save', newHistory) as { success: boolean; sessionId?: string; error?: string };
                        if (!result.success) {
                            console.error('[CoworkView] Failed to save session:', result.error);
                        } else {
                            // 无论历史任务列表是否打开，都刷新列表（如果列表打开的话）
                            // 这样可以确保新保存的会话能及时显示
                            if (showHistory) {
                                // 延迟一下，确保会话已保存到存储
                                setTimeout(() => {
                                    window.ipcRenderer.invoke('session:list').then((list) => {
                                        setSessions(list as SessionSummary[]);
                                    });
                                }, 300);
                            }
                        }
                    } catch (error) {
                        console.error('[CoworkView] Error saving session:', error);
                    }
                }
            }
        });

        // Listen for permission requests
        const removeConfirmListener = window.ipcRenderer.on('agent:confirm-request', (_event, ...args) => {
            const req = args[0] as PermissionRequest;
            setPermissionRequest(req);
        });

        // Listen for abort events
        const removeAbortListener = window.ipcRenderer.on('agent:aborted', () => {
            setStreamingText('');
            setPermissionRequest(null);
        });

        // Listen for error events
        const removeErrorListener = window.ipcRenderer.on('agent:error', (_event, msg) => {
            console.error('[CoworkView] Received agent error:', msg);
            setError(msg as string);
            setStreamingText(''); // Stop streaming effect on error
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
                        console.error('[CoworkView] Error saving session on unmount:', err);
                    });
                }
            }

            removeStreamListener?.();
            removeConfigListener?.();
            removeHistoryListener?.();
            removeAutoLoadListener?.();
            removeConfirmListener?.();
            removeAbortListener?.();
            removeErrorListener?.();
            removeDoneListener?.();
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

    // 定期刷新历史任务列表（当列表打开时）
    useEffect(() => {
        if (!showHistory) return;
        
        const interval = setInterval(() => {
            window.ipcRenderer.invoke('session:list').then((list) => {
                setSessions(list as SessionSummary[]);
            });
        }, 2000); // 每2秒刷新一次
        
        return () => clearInterval(interval);
    }, [showHistory]);

    // Fetch scripts list when scripts panel is opened
    useEffect(() => {
        if (showScripts) {
            const loadScripts = async () => {
                const list = await window.ipcRenderer.invoke('script:list') as Script[];
                setScripts(list);
            };
            loadScripts();
            // 设置定时刷新，每5秒刷新一次脚本列表（用于检测新添加的脚本）
            const interval = setInterval(() => {
                if (showScripts) {
                    loadScripts();
                }
            }, 5000);
            return () => clearInterval(interval);
        }
    }, [showScripts]);

    useEffect(() => {
        scrollToBottom();
    }, [history, streamingText]);



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



    // Keyboard shortcuts
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // Focus input on Ctrl/Cmd+L
            if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
                e.preventDefault();
                // inputRef.current?.focus(); // Logic moved to ChatInput
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, []);



    const toggleBlock = useCallback((id: string) => {
        setExpandedBlocks(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const relevantHistory = history.filter(m => (m.role as string) !== 'system');

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
                            onClick={() => setMode('chat')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'chat' ? 'bg-white dark:bg-zinc-700 text-stone-800 dark:text-zinc-100 shadow-sm' : 'text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200'
                                }`}
                        >
                            <MessageCircle size={14} />
                            {t('chat')}
                        </button>
                        <button
                            onClick={() => setMode('work')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'work' ? 'bg-white dark:bg-zinc-700 text-stone-800 dark:text-zinc-100 shadow-sm' : 'text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200'
                                }`}
                        >
                            <Zap size={14} />
                            {t('cowork')}
                        </button>
                        <button
                            onClick={async () => {
                                setMode('automation');
                                setShowScripts(true);
                                // 切换到自动化模式时，自动设置工作目录为 chrome-agent
                                try {
                                    const scriptsDir = await window.ipcRenderer.invoke('agent:get-scripts-dir') as string;
                                    if (scriptsDir) {
                                        setWorkingDir(scriptsDir);
                                        await window.ipcRenderer.invoke('agent:set-working-dir', scriptsDir);
                                    }
                                } catch (error) {
                                    console.error('[CoworkView] Error setting scripts dir:', error);
                                }
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'automation' ? 'bg-white dark:bg-zinc-700 text-stone-800 dark:text-zinc-100 shadow-sm' : 'text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200'
                                }`}
                        >
                            <Play size={14} />
                            {t('automation')}
                        </button>
                    </div>
                </div>

                {/* History + Settings */}
                <div className="flex items-center gap-2">
                    {workingDir && (
                        <span className="text-xs text-stone-400 dark:text-zinc-500 truncate w-[120px] flex-shrink-0" title={workingDir.split(/[\\/]/).pop()}>
                            📂 {workingDir.split(/[\\/]/).pop()}
                        </span>
                    )}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={async () => {
                                await window.ipcRenderer.invoke('agent:new-session');
                                // 新打开对话时，设置默认工作目录为 chrome-agent
                                try {
                                    const scriptsDir = await window.ipcRenderer.invoke('agent:get-scripts-dir') as string;
                                    if (scriptsDir) {
                                        setWorkingDir(scriptsDir);
                                        await window.ipcRenderer.invoke('agent:set-working-dir', scriptsDir);
                                    }
                                } catch (error) {
                                    console.error('[CoworkView] Error setting default scripts dir:', error);
                                }
                                // 刷新历史任务列表（如果打开的话）
                                if (showHistory) {
                                    setTimeout(() => {
                                        window.ipcRenderer.invoke('session:list').then((list) => {
                                            setSessions(list as SessionSummary[]);
                                        });
                                    }, 100);
                                }
                            }}
                            className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                            title={t('newSession')}
                        >
                            <Plus size={16} />
                        </button>
                        <button
                            onClick={() => setShowHistory(!showHistory)}
                            className={`p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded-lg transition-colors ${showHistory ? 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-300' : ''}`}
                            title={t('history')}
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
                <>
                    {/* Backdrop - 点击外部关闭 */}
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowHistory(false)}
                    />
                    {/* History Panel */}
                    <div 
                        className="absolute top-12 right-6 z-20 w-80 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-stone-200 dark:border-zinc-800 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
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
                                            <p className="text-xs font-medium text-stone-700 dark:text-zinc-300 line-clamp-2 leading-relaxed">
                                                {session.title}
                                            </p>
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
                                                        // 标记正在加载会话，避免自动保存覆盖
                                                        isLoadingSessionRef.current = true;
                                                        const result = await window.ipcRenderer.invoke('session:load', session.id) as { success: boolean; error?: string };
                                                        if (result.success) {
                                                            setShowHistory(false);
                                                        } else {
                                                            isLoadingSessionRef.current = false;
                                                            console.error('[CoworkView] Failed to load session:', result.error);
                                                        }
                                                    }}
                                                    className="text-[10px] flex items-center gap-1 text-orange-500 hover:text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full"
                                                >
                                                    {t('load')}
                                                </button>
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        await window.ipcRenderer.invoke('session:delete', session.id);
                                                        setSessions(sessions.filter(s => s.id !== session.id));
                                                    }}
                                                    className="p-1 text-stone-400 hover:text-red-500 transition-colors"
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
                </>
            )}

            {/* Scripts Panel - Floating Popover */}
            {showScripts && (
                <>
                    {/* Backdrop - 点击外部关闭 */}
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => {
                            setShowScripts(false);
                            if (mode === 'automation') {
                                setMode('work');
                            }
                        }}
                    />
                    {/* Scripts Panel */}
                    <div 
                        className="absolute top-12 right-6 z-20 w-80 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-stone-200 dark:border-zinc-800 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 dark:border-zinc-800 bg-stone-50/50 dark:bg-zinc-800/50">
                            <div className="flex items-center gap-2">
                                <Play size={14} className="text-orange-500" />
                                <span className="text-sm font-semibold text-stone-700 dark:text-zinc-200">{t('automationScripts')}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={async () => {
                                        // 手动刷新脚本列表
                                        const list = await window.ipcRenderer.invoke('script:list') as Script[];
                                        setScripts(list);
                                    }}
                                    className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                                    title={(t('refresh' as any) as string) || '刷新脚本列表'}
                                >
                                    <RefreshCw size={14} />
                                </button>
                                <button
                                    onClick={async () => {
                                        // 打开脚本目录（chrome-agent 子目录）
                                        const paths = await window.ipcRenderer.invoke('directory:get-all-paths') as Record<string, string>;
                                        const scriptsPath = paths?.scriptsDir;
                                        if (scriptsPath) {
                                            await window.ipcRenderer.invoke('directory:open-path', scriptsPath);
                                        } else {
                                            // 如果没有 scriptsDir，尝试使用 skillsDir + chrome-agent
                                            const skillsPath = paths?.skillsDir;
                                            if (skillsPath) {
                                                await window.ipcRenderer.invoke('directory:open-path', skillsPath);
                                            }
                                        }
                                    }}
                                    className="p-1 text-stone-400 hover:text-blue-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-blue-400 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                                    title={(t('openScriptsFolder' as any) as string) || '打开脚本目录'}
                                >
                                    <FolderOpen size={14} />
                                </button>
                                <button
                                    onClick={() => {
                                        setShowScripts(false);
                                        if (mode === 'automation') {
                                            setMode('work');
                                        }
                                    }}
                                    className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        </div>

                        <div className="max-h-[320px] overflow-y-auto p-2">
                            {scripts.length === 0 ? (
                                <div className="py-8 text-center">
                                    <p className="text-sm text-stone-400 dark:text-zinc-500">{t('noScripts')}</p>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {scripts.map((script) => (
                                        <div
                                            key={script.id}
                                            className="group relative p-3 rounded-lg hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors border border-transparent hover:border-stone-100 dark:hover:border-zinc-700"
                                        >
                                            <div className="flex items-start gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <p className="text-xs font-medium text-stone-700 dark:text-zinc-300 line-clamp-2 leading-relaxed">
                                                            {script.name}
                                                        </p>
                                                        {script.isOfficial && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                                                官方
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-[10px] text-stone-400 mt-1 flex items-center gap-1.5">
                                                        <span>
                                                            {new Date(script.updatedAt).toLocaleString('zh-CN', {
                                                                month: 'short',
                                                                day: 'numeric',
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                                second: '2-digit'
                                                            })}
                                                        </span>
                                                        {runningScripts.has(script.id) && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                                                                running
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={async () => {
                                                    // 立即关闭浮层
                                                    setShowScripts(false);
                                                    // 保持在当前模式，不切换到 work 模式
                                                    
                                                    try {
                                                        // 执行脚本（script:execute 会使用当前会话，不清空历史）
                                                        const result = await window.ipcRenderer.invoke('script:execute', script.id) as { success: boolean; error?: string; sessionId?: string };
                                                        if (result.success && result.sessionId) {
                                                            // 立即记录脚本正在运行
                                                            console.log(`[CoworkView] Script ${script.id} started, sessionId: ${result.sessionId}`);
                                                            setRunningScripts(prev => {
                                                                const newMap = new Map(prev);
                                                                newMap.set(script.id, result.sessionId!);
                                                                console.log(`[CoworkView] Running scripts:`, Array.from(newMap.entries()));
                                                                return newMap;
                                                            });
                                                        } else {
                                                            setError(result.error || '执行脚本失败');
                                                        }
                                                        // 注意：会话会在 agent:history-update 事件触发时自动保存和刷新列表
                                                    } catch (err) {
                                                        setError('执行脚本时出错');
                                                        console.error(err);
                                                    }
                                                }}
                                                className="text-[10px] flex items-center gap-1 text-orange-500 hover:text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full"
                                            >
                                                {t('execute')}
                                            </button>
                                            {/* 编辑按钮：只有管理员可以编辑脚本（官方和非官方都需要管理员权限） */}
                                            {userRole === 'admin' && (
                                                <>
                                                    {editingScriptId === script.id ? (
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="text"
                                                                value={editingScriptName}
                                                                onChange={(e) => setEditingScriptName(e.target.value)}
                                                                onKeyDown={async (e) => {
                                                                    if (e.key === 'Enter') {
                                                                        const result = await window.ipcRenderer.invoke('script:rename', script.id, editingScriptName) as { success: boolean; error?: string };
                                                                        if (result.success) {
                                                                            setEditingScriptId(null);
                                                                            setScripts(await window.ipcRenderer.invoke('script:list') as Script[]);
                                                                        } else {
                                                                            setError(result.error || '重命名失败');
                                                                        }
                                                                    } else if (e.key === 'Escape') {
                                                                        setEditingScriptId(null);
                                                                        setEditingScriptName('');
                                                                    }
                                                                }}
                                                                className="text-[10px] px-1.5 py-0.5 border border-orange-300 rounded bg-white dark:bg-zinc-800 text-stone-700 dark:text-zinc-200 w-20"
                                                                autoFocus
                                                            />
                                                            <button
                                                                onClick={async () => {
                                                                    const result = await window.ipcRenderer.invoke('script:rename', script.id, editingScriptName) as { success: boolean; error?: string };
                                                                    if (result.success) {
                                                                        setEditingScriptId(null);
                                                                        setScripts(await window.ipcRenderer.invoke('script:list') as Script[]);
                                                                    } else {
                                                                        setError(result.error || '重命名失败');
                                                                    }
                                                                }}
                                                                className="p-0.5 text-green-500 hover:text-green-600"
                                                            >
                                                                <Check size={10} />
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    setEditingScriptId(null);
                                                                    setEditingScriptName('');
                                                                }}
                                                                className="p-0.5 text-stone-400 hover:text-stone-600"
                                                            >
                                                                <X size={10} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setEditingScriptId(script.id);
                                                                    setEditingScriptName(script.name);
                                                                }}
                                                                className="p-1 text-stone-400 hover:text-blue-500 transition-colors"
                                                                title={script.isOfficial ? "重命名脚本（官方脚本，仅管理员）" : "重命名脚本"}
                                                            >
                                                                <Edit2 size={12} />
                                                            </button>
                                                            {!script.isOfficial && (
                                                                <button
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        if (window.confirm(`确定要将脚本 "${script.name}" 标记为官方吗？\n\n标记后，该脚本将同步给所有用户。`)) {
                                                                            const result = await window.ipcRenderer.invoke('script:mark-official', script.id) as { success: boolean; error?: string };
                                                                            if (result.success) {
                                                                                setScripts(await window.ipcRenderer.invoke('script:list') as Script[]);
                                                                            } else {
                                                                                setError(result.error || '标记失败');
                                                                            }
                                                                        }
                                                                    }}
                                                                    className="p-1 text-stone-400 hover:text-yellow-500 transition-colors"
                                                                    title="标记为官方"
                                                                >
                                                                    <Star size={12} />
                                                                </button>
                                                            )}
                                                            {script.isOfficial && (
                                                                <button
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        if (window.confirm(`确定要将脚本 "${script.name}" 取消官方标记吗？\n\n取消后，该脚本将不再作为官方脚本。`)) {
                                                                            const result = await window.ipcRenderer.invoke('script:unmark-official', script.id) as { success: boolean; error?: string };
                                                                            if (result.success) {
                                                                                setScripts(await window.ipcRenderer.invoke('script:list') as Script[]);
                                                                            } else {
                                                                                setError(result.error || '取消官方标记失败');
                                                                            }
                                                                        }
                                                                    }}
                                                                    className="p-1 text-stone-400 hover:text-orange-500 transition-colors"
                                                                    title="取消官方标记"
                                                                >
                                                                    <Star size={12} className="fill-current" />
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                    {!script.isOfficial && (
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                // 确认删除
                                                                const confirmMessage = script.name === 'index' 
                                                                    ? `确定要删除脚本 "${script.name}" 吗？\n\n注意：index.js 可能是系统文件，删除后可能影响功能。`
                                                                    : `确定要删除脚本 "${script.name}" 吗？\n\n此操作将永久删除文件，无法恢复。`;
                                                                
                                                                if (window.confirm(confirmMessage)) {
                                                                    const result = await window.ipcRenderer.invoke('script:delete', script.id) as { success: boolean; error?: string };
                                                                    if (result.success) {
                                                                        setScripts(scripts.filter(s => s.id !== script.id));
                                                                    } else {
                                                                        setError(result.error || '删除脚本失败');
                                                                    }
                                                                }
                                                            }}
                                                            className="p-1 text-stone-400 hover:text-red-500 transition-colors"
                                                            title="删除脚本"
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* Messages Area - Narrower for better readability */}
            <div className="flex-1 overflow-y-auto px-4 py-6" ref={scrollRef}>
                <div className="max-w-xl mx-auto space-y-5">
                    {/* Playwright Installation Prompt - 在 automation 模式或启动时显示 */}
                    <PlaywrightPrompt />
                    
                    {relevantHistory.length === 0 && !streamingText ? (
                        <EmptyState mode={mode} workingDir={workingDir} />
                    ) : (
                        <>
                            {relevantHistory.map((msg, idx) => (
                                <MessageItem
                                    key={idx}
                                    message={msg}
                                    expandedBlocks={expandedBlocks}
                                    toggleBlock={toggleBlock}
                                    showTools={mode === 'work'}
                                    onImageClick={setSelectedImage}
                                />
                            ))}

                            {streamingText && (
                                <div className="animate-in fade-in duration-200">
                                    <div className="text-stone-700 dark:text-zinc-300 text-[15px] leading-7 max-w-none">
                                        <div className="relative group">
                                            <MarkdownRenderer content={streamingText} isDark={true} />
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


            {/* Bottom Input */}
            <ChatInput
                onSendMessage={(msg) => {
                    setStreamingText('');
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
    );
});



const MessageItem = memo(function MessageItem({ message, expandedBlocks, toggleBlock, showTools, onImageClick }: {
    message: Anthropic.MessageParam,
    expandedBlocks: Set<string>,
    toggleBlock: (id: string) => void,
    showTools: boolean,
    onImageClick: (src: string) => void
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
                if (block.type === 'text' && block.text) {
                    return (
                        <div key={i} className="text-stone-700 dark:text-zinc-300 text-[15px] leading-7 max-w-none">
                            <div className="relative group">
                                <MarkdownRenderer content={block.text} isDark={true} />
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
                    {mode === 'chat' ? 'QACowork' : mode === 'automation' ? '自动化脚本' : 'QACowork'}
                </h2>
                <p className="text-stone-500 dark:text-zinc-400 text-sm max-w-xs">
                    {mode === 'work' && !workingDir
                        ? '请先选择一个工作目录来开始任务'
                        : mode === 'work' && workingDir
                            ? `工作目录: ${workingDir.split(/[\\/]/).pop()}`
                            : mode === 'automation'
                                ? '点击上方"自动化"标签查看可用脚本'
                                : t('startByDescribing')
                    }
                </p>
            </div>
        </div>
    );
}
