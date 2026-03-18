import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import { Zap, AlertTriangle, Check, X, Settings, History, Plus, Trash2, ChevronDown, MessageCircle, Download, Terminal, FileText, Search, Globe, Code2, Cpu, FolderSearch, Wrench, Copy, RotateCcw } from 'lucide-react';
import { ChatInput } from './ChatInput';
import { useI18n } from '../i18n/I18nContext';
import { MarkdownRenderer } from './MarkdownRenderer';
import Anthropic from '@anthropic-ai/sdk';
import { CopyButton } from './CopyButton';
import { useToast } from './Toast';

type Mode = 'chat' | 'work';

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
    workspaceDir?: string;
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
    const { showToast } = useToast();
    const [mode, setMode] = useState<Mode>('work');
    const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
    const [streamingText, setStreamingText] = useState('');
    // 内部执行状态：脚本执行（不经过 App.tsx handleSendMessage）期间为 true
    const [isInternalProcessing, setIsInternalProcessing] = useState(false);
    const [workingDir, setWorkingDir] = useState<string | null>(null);
    const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [config, setConfig] = useState<any>(null);
    // 重新编辑消息时的预填文本
    const [prefillText, setPrefillText] = useState<string | null>(null);
    // 资源更新通知状态
    const [resourceUpdateAvailable, setResourceUpdateAvailable] = useState<{
        currentVersion: string;
        latestVersion: string;
        updateSize?: number;
    } | null>(null);

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
        // 会话加载由 App.tsx 在切换到协作模式时统一触发（session:auto-load），此处不再重复调用
        window.ipcRenderer.invoke('config:get-all').then((cfg) => {
            setConfig(cfg as any); // Use full config
        });
        // 设置默认工作目录为 .qa-cowork
        (async () => {
            try {
                const coworkWorkspaceDir = await window.ipcRenderer.invoke('agent:get-cowork-workspace-dir') as string;
                if (coworkWorkspaceDir) {
                    setWorkingDir(coworkWorkspaceDir);
                    await window.ipcRenderer.invoke('agent:set-working-dir', coworkWorkspaceDir);
                }
            } catch (error) {
                console.error('[CoworkView] Error setting default working dir:', error);
            }
        })();
        // ... existing listeners
        const removeStreamListener = window.ipcRenderer.on('agent:stream-token', (_event, ...args) => {
            const token = args[0] as string;
            setStreamingText(prev => prev + token);
            // 收到 stream token 说明 agent 正在运行，确保 isInternalProcessing 为 true
            setIsInternalProcessing(true);
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
            window.ipcRenderer.invoke('session:list', 'cowork').then((list) => {
                setSessions(list as SessionSummary[]);
            });
        });

        // 监听任务完成事件
        const removeDoneListener = window.ipcRenderer.on('agent:done', (_event, ...args) => {
            const data = args[0] as { timestamp?: number; taskId?: string };
            console.log(`[CoworkView] agent:done event received:`, data);
            setIsInternalProcessing(false);
            setStreamingText('');
        });

        // 监听资源更新通知
        const removeUpdateListener = window.ipcRenderer.on('resource:update-available', (_event, ...args) => {
            const updateInfo = args[0] as any;
            console.log('[CoworkView] Resource update available:', updateInfo);
            setResourceUpdateAvailable({
                currentVersion: updateInfo.currentVersion,
                latestVersion: updateInfo.latestVersion,
                updateSize: updateInfo.updateSize
            });
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
                                    window.ipcRenderer.invoke('session:list', 'cowork').then((list) => {
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
            setIsInternalProcessing(false);
            setPermissionRequest(null);
        });

        // Listen for error events (payload can be string or { message, taskId })
        const removeErrorListener = window.ipcRenderer.on('agent:error', (_event, ...args) => {
            const payload = args[0] as string | { message: string; taskId?: string };
            const msg = typeof payload === 'string' ? payload : (payload?.message ?? '');
            console.error('[CoworkView] Received agent error:', msg);
            setError(msg);
            setIsInternalProcessing(false);
            setStreamingText(''); // Stop streaming effect on error
        });

        const removeContextSwitchedListener = window.ipcRenderer.on('agent:context-switched', () => {
            showToast(t('contextSwitchedToNewSession'), 'info');
            window.ipcRenderer.invoke('session:list', 'cowork').then((list) => {
                setSessions(list as SessionSummary[]);
            });
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
            removeContextSwitchedListener?.();
            removeDoneListener?.();
            removeUpdateListener?.();
        };
    }, [showToast, t]);

    // Fetch session list when history panel is opened
    useEffect(() => {
        if (showHistory) {
            window.ipcRenderer.invoke('session:list', 'cowork').then((list) => {
                setSessions(list as SessionSummary[]);
            });
        }
    }, [showHistory]);

    // 定期刷新历史任务列表（当列表打开时）
    useEffect(() => {
        if (!showHistory) return;
        
        const interval = setInterval(() => {
            window.ipcRenderer.invoke('session:list', 'cowork').then((list) => {
                setSessions(list as SessionSummary[]);
            });
        }, 2000); // 每2秒刷新一次
        
        return () => clearInterval(interval);
    }, [showHistory]);


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
        <div className="flex-1 min-h-0 flex flex-col bg-[#FAF8F5] dark:bg-zinc-950 relative">
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
                        {/401|API Key 无效|API Key 已过期|api key.*invalid|api key.*expired/i.test(error) && (
                            <p className="text-amber-600 dark:text-amber-400 text-xs mb-4">
                                {t('apiKeyErrorHint')}
                            </p>
                        )}

                        <div className="flex gap-3">
                            {/401|API Key 无效|API Key 已过期|api key.*invalid|api key.*expired/i.test(error) ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => { setError(null); onOpenSettings(); }}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700 rounded-xl transition-colors"
                                    >
                                        <Settings size={16} />
                                        {t('goToSettings')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setError(null)}
                                        className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-600 dark:text-zinc-400 bg-stone-100 hover:bg-stone-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-xl transition-colors"
                                    >
                                        <X size={16} />
                                        {t('close') || 'Close'}
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setError(null)}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-stone-800 hover:bg-stone-900 dark:bg-zinc-700 dark:hover:bg-zinc-600 rounded-xl transition-colors"
                                >
                                    <X size={16} />
                                    {t('close') || 'Close'}
                                </button>
                            )}
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
            <div className="border-b border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2.5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    {/* Mode Tabs */}
                    <div className="flex items-center gap-0.5 bg-stone-100 dark:bg-zinc-800 rounded-lg p-0.5">
                        {/* 对话 tab 暂时隐藏，保留逻辑供后续启用 */}
                        {false && (
                        <button
                            onClick={() => setMode('chat')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${mode === 'chat' ? 'bg-white dark:bg-zinc-700 text-stone-800 dark:text-zinc-100 shadow-sm' : 'text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200'
                                }`}
                        >
                            <MessageCircle size={12} />
                            {t('chat')}
                        </button>
                        )}
                        <button
                            onClick={() => setMode('work')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${mode === 'work' ? 'bg-white dark:bg-zinc-700 text-stone-800 dark:text-zinc-100 shadow-sm' : 'text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200'
                                }`}
                        >
                            <Zap size={12} />
                            {t('cowork')}
                        </button>
                    </div>
                </div>

                {/* History + Settings */}
                <div className="flex items-center gap-1.5">
                    {workingDir && (
                        <span className="text-xs text-stone-400 dark:text-zinc-500 truncate w-[120px] flex-shrink-0" title={workingDir.split(/[\\/]/).pop()}>
                            📂 {workingDir.split(/[\\/]/).pop()}
                        </span>
                    )}
                    <div className="flex items-center gap-0.5">
                        <button
                            onClick={async () => {
                                await window.ipcRenderer.invoke('agent:new-session');
                                // 新打开对话时，设置默认工作目录为 .qa-cowork
                                try {
                                    const coworkWorkspaceDir = await window.ipcRenderer.invoke('agent:get-cowork-workspace-dir') as string;
                                    if (coworkWorkspaceDir) {
                                        setWorkingDir(coworkWorkspaceDir);
                                        await window.ipcRenderer.invoke('agent:set-working-dir', coworkWorkspaceDir);
                                    }
                                } catch (error) {
                                    console.error('[CoworkView] Error setting default cowork workspace dir:', error);
                                }
                                // 刷新历史任务列表（如果打开的话）
                                if (showHistory) {
                                    setTimeout(() => {
                                        window.ipcRenderer.invoke('session:list', 'cowork').then((list) => {
                                            setSessions(list as SessionSummary[]);
                                        });
                                    }, 100);
                                }
                            }}
                            className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded-md transition-colors"
                            title={t('newSession')}
                        >
                            <Plus size={14} />
                        </button>
                        <button
                            onClick={() => setShowHistory(!showHistory)}
                            className={`p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded-md transition-colors ${showHistory ? 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-300' : ''}`}
                            title={t('history')}
                        >
                            <History size={14} />
                        </button>
                    </div>
                    <button
                        onClick={onOpenSettings}
                        className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded-md transition-colors"
                        title="Settings"
                    >
                        <Settings size={14} />
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
                                            <p className="text-xs font-medium text-stone-700 dark:text-zinc-300 line-clamp-2 leading-relaxed pr-16">
                                                {session.title}
                                            </p>
                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                <p className="text-[10px] text-stone-400">
                                                    {new Date(session.updatedAt).toLocaleString('zh-CN', {
                                                        month: 'short',
                                                        day: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </p>
                                                {session.workspaceDir && (
                                                    <span
                                                        className="text-[9px] px-1.5 py-0.5 rounded-full bg-stone-100 dark:bg-zinc-700 text-stone-500 dark:text-zinc-400 max-w-[120px] truncate"
                                                        title={session.workspaceDir}
                                                    >
                                                        {session.workspaceDir.replace(/^.*[\\/]/, '') || session.workspaceDir}
                                                    </span>
                                                )}
                                            </div>
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


            {/* Messages Area - Narrower for better readability */}
            <div className="flex-1 overflow-y-auto px-4 py-6" ref={scrollRef}>
                <div className="max-w-xl mx-auto flex flex-col gap-5">
                    {/* Resource Update Notification Banner */}
                    {resourceUpdateAvailable && (
                        <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-xl p-4 shadow-lg animate-in slide-in-from-top-2 fade-in duration-300">
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                                    <Download size={20} className="text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-lg font-bold text-amber-900 dark:text-amber-100 mb-1">
                                        🎉 发现新资源版本!
                                    </h3>
                                    <p className="text-sm text-amber-800 dark:text-amber-200 mb-3">
                                        当前: v{resourceUpdateAvailable.currentVersion} → 最新: v{resourceUpdateAvailable.latestVersion}
                                        {resourceUpdateAvailable.updateSize && (
                                            <span className="ml-2">
                                                ({(resourceUpdateAvailable.updateSize / 1024 / 1024).toFixed(2)} MB)
                                            </span>
                                        )}
                                    </p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                onOpenSettings();
                                                // 延迟触发，确保设置页面已打开
                                                setTimeout(() => {
                                                    document.dispatchEvent(new CustomEvent('trigger-resource-update'));
                                                }, 100);
                                            }}
                                            className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors flex items-center gap-2"
                                        >
                                            <Download size={16} />
                                            立即更新
                                        </button>
                                        <button
                                            onClick={() => setResourceUpdateAvailable(null)}
                                            className="px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg transition-colors"
                                        >
                                            稍后提醒
                                        </button>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setResourceUpdateAvailable(null)}
                                    className="p-1 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>
                    )}
                    
                    {relevantHistory.length === 0 && !streamingText ? (
                        <EmptyState mode={mode} workingDir={workingDir} />
                    ) : (
                        <>
                            {relevantHistory.map((msg, idx) => (
                                <div key={idx} className="block w-full min-h-0 break-after-avoid">
                                    <MessageItem
                                        message={msg}
                                        expandedBlocks={expandedBlocks}
                                        toggleBlock={toggleBlock}
                                        showTools={mode === 'work'}
                                        onImageClick={setSelectedImage}
                                        onEdit={(text) => setPrefillText(text)}
                                    />
                                </div>
                            ))}

                            {streamingText && streamingText.trim().length > 0 && (
                                <>
                                    {/* 空行：用户消息与 AI 回复之间保持明显分隔 */}
                                    {relevantHistory.length > 0 && <div className="h-5 shrink-0" aria-hidden />}
                                    <div className="animate-in fade-in duration-200 block w-full">
                                        <div className="text-stone-700 dark:text-zinc-300 text-[12px] leading-6 max-w-none">
                                            <div className="relative group">
                                                <MarkdownRenderer content={streamingText} isDark={true} className="prose-sm" />
                                                <span className="inline-block w-[3px] h-[1em] bg-current ml-0.5 align-middle rounded-sm animate-[blink_1s_step-end_infinite]" />
                                                {streamingText && streamingText.trim().length > 0 && (
                                                    <div className="absolute right-0 -bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <CopyButton content={streamingText} size="sm" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {(isProcessing || isInternalProcessing) && !streamingText && (
                        <div className="flex items-center gap-2 text-sm">
                            <svg className="w-3 h-3 shrink-0 text-stone-400 dark:text-zinc-500 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="31.4 31.4" strokeDashoffset="0" />
                            </svg>
                            <span className="text-[11px] select-none flex items-baseline gap-0">
                                <span className="shimmer-thinking-text">{t('thinking')}</span>
                                <span className="animate-[ellipsis_1.5s_steps(4,end)_infinite] overflow-hidden whitespace-nowrap inline-block w-[1.5em] align-bottom text-stone-400 dark:text-zinc-500 font-normal">...</span>
                            </span>
                        </div>
                    )}
                </div>
            </div>


            {/* Bottom Input */}
            <ChatInput
                onSendMessage={(msg) => {
                    setStreamingText('');
                    setIsInternalProcessing(true);
                    onSendMessage(msg);
                }}
                onAbort={onAbort}
                isProcessing={isProcessing || isInternalProcessing}
                workingDir={workingDir}
                onSelectFolder={handleSelectFolder}
                mode={mode}
                config={config}
                setConfig={(newConfig) => {
                    setConfig(newConfig);
                    // Also update in main process if ChatInput doesn't do it directly?
                    // ChatInput logic calls invoke, so we just update local state.
                }}
                prefillText={prefillText}
                onPrefillConsumed={() => setPrefillText(null)}
            />
        </div>
    );
});



type ToolAccent = { bg: string; icon: string };
type ToolMeta = { label: string; Icon: React.ElementType; accent: ToolAccent };

const TOOL_META_MAP: Record<string, ToolMeta> = {
    run_command:    { label: '运行指令',   Icon: Terminal,    accent: { bg: 'bg-violet-100 dark:bg-violet-900/30', icon: 'text-violet-500 dark:text-violet-400' } },
    'agent-browser': { label: 'agent-browser', Icon: Wrench, accent: { bg: 'bg-violet-100 dark:bg-violet-900/30', icon: 'text-violet-500 dark:text-violet-400' } },
    write_file:     { label: '写入文件',   Icon: FileText,    accent: { bg: 'bg-blue-100 dark:bg-blue-900/30',   icon: 'text-blue-500 dark:text-blue-400' } },
    read_file:      { label: '读取文件',   Icon: FileText,    accent: { bg: 'bg-sky-100 dark:bg-sky-900/30',     icon: 'text-sky-500 dark:text-sky-400' } },
    search_files:   { label: '搜索文件',   Icon: FolderSearch,accent: { bg: 'bg-amber-100 dark:bg-amber-900/30', icon: 'text-amber-500 dark:text-amber-400' } },
    search_replace: { label: '搜索替换',   Icon: Search,      accent: { bg: 'bg-orange-100 dark:bg-orange-900/30',icon: 'text-orange-500 dark:text-orange-400' } },
    web_search:     { label: '网络搜索',   Icon: Globe,       accent: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', icon: 'text-emerald-500 dark:text-emerald-400' } },
    code_execute:   { label: '执行代码',   Icon: Code2,       accent: { bg: 'bg-pink-100 dark:bg-pink-900/30',   icon: 'text-pink-500 dark:text-pink-400' } },
    computer:       { label: '控制电脑',   Icon: Cpu,         accent: { bg: 'bg-rose-100 dark:bg-rose-900/30',   icon: 'text-rose-500 dark:text-rose-400' } },
};

const DEFAULT_TOOL_META: ToolMeta = {
    label: '执行工具',
    Icon: Wrench,
    accent: { bg: 'bg-stone-100 dark:bg-zinc-800', icon: 'text-stone-400 dark:text-zinc-500' },
};

const getToolMeta = (toolName?: string): ToolMeta => {
    if (!toolName) return DEFAULT_TOOL_META;
    return TOOL_META_MAP[toolName] ?? { ...DEFAULT_TOOL_META, label: toolName };
};

const MessageItem = memo(function MessageItem({ message, expandedBlocks, toggleBlock, showTools, onImageClick, onEdit }: {
    message: Anthropic.MessageParam,
    expandedBlocks: Set<string>,
    toggleBlock: (id: string) => void,
    showTools: boolean,
    onImageClick: (src: string) => void,
    onEdit?: (text: string) => void
}) {
    const { t } = useI18n();
    const { showToast } = useToast();
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

        const handleCopy = () => {
            if (!text.trim()) return;
            navigator.clipboard.writeText(text).then(() => {
                showToast(t('copied') || '已复制', 'success');
            });
        };

        const handleEdit = () => {
            if (!text.trim()) return;
            onEdit?.(text);
        };

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
                    <div className="group inline-block">
                        <div className="user-bubble">
                            {text}
                        </div>
                        {text.trim().length > 0 && (
                            <div className="flex items-center justify-end gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    type="button"
                                    onClick={handleCopy}
                                    aria-label={t('copy') || '复制'}
                                    title={t('copy') || '复制'}
                                    tabIndex={0}
                                    className="p-1 rounded-md text-stone-400 hover:text-stone-600 dark:text-zinc-500 dark:hover:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors"
                                >
                                    <Copy size={14} />
                                </button>
                                <button
                                    type="button"
                                    onClick={handleEdit}
                                    aria-label={t('reEdit') || '重新编辑'}
                                    title={t('reEdit') || '重新编辑'}
                                    tabIndex={0}
                                    className="p-1 rounded-md text-stone-400 hover:text-stone-600 dark:text-zinc-500 dark:hover:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors"
                                >
                                    <RotateCcw size={14} />
                                </button>
                            </div>
                        )}
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
                if (block.type === 'text' && block.text && block.text.trim().length > 0) {
                    return (
                        <div key={i} className="text-stone-700 dark:text-zinc-300 text-[12px] leading-6 max-w-none">
                            <div className="relative group">
                                <MarkdownRenderer content={block.text} isDark={true} className="prose-sm" />
                                {block.text && block.text.trim().length > 0 && (
                                    <div className="absolute right-0 -bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <CopyButton content={block.text} size="sm" />
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                }

                if (block.type === 'tool_group' && showTools) {
                    const toolGroup = block as ToolGroup;
                    return (
                        <div key={i} className="space-y-1.5">
                            {toolGroup.items.map((tool, j: number) => {
                                const blockId = tool.id || `tool-${i}-${j}`;
                                const isExpanded = expandedBlocks.has(blockId);
                                const { label, Icon, accent } = getToolMeta(tool.name);

                                return (
                                    <div key={j} className="command-block group/tool">
                                        <div
                                            className="command-block-header"
                                            onClick={() => toggleBlock(blockId)}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${accent.bg}`}>
                                                    <Icon size={13} className={accent.icon} />
                                                </div>
                                                <span className="text-[11px] text-stone-600 dark:text-zinc-300 font-medium truncate">{label}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                <span className="text-[9px] text-stone-400 dark:text-zinc-600 font-mono hidden group-hover/tool:inline-block transition-opacity">
                                    {tool.name}
                                </span>
                                                <ChevronDown
                                                    size={14}
                                                    className={`text-stone-400 dark:text-zinc-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                                                />
                                            </div>
                                        </div>
                                        {isExpanded && (
                                            <div className="px-3 pb-3 pt-2 bg-stone-50/80 dark:bg-zinc-950/60 border-t border-stone-100 dark:border-zinc-800/60">
                                                {Object.keys(tool.input || {}).length === 0 ? (
                                                    <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                                        <Check size={12} />
                                                        <span>{t('skillLoaded')}</span>
                                                    </div>
                                                ) : (
                                                    <pre className="text-[11px] font-mono text-stone-500 dark:text-zinc-400 whitespace-pre-wrap overflow-x-auto leading-relaxed">
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
                    QACowork
                </h2>
                <p className="text-stone-500 dark:text-zinc-400 text-sm max-w-xs">
                    {mode === 'work' && !workingDir
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
