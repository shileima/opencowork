/**
 * 文件画布主面板
 * File Canvas Panel
 *
 * 右侧可展开的面板，显示文件树、预览和变更
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronLeft, FileText, FolderOpen, Search, RefreshCw, Folder, Home } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { logger } from '../../services/logger';
import { FileExplorer } from './FileExplorer';
import { FilePreview } from './FilePreview';
import { FileSearch } from './FileSearch';

interface AuthorizedFolder {
    path: string;
    trustLevel: 'strict' | 'standard' | 'trust';
    addedAt: number;
}

interface FileCanvasPanelProps {
    isOpen: boolean;
    sessionId: string | null;
    workingDir: string | null;
    onClose: () => void;
    initialPath?: string | null; // 新增：外部指定要打开的路径（文件或文件夹）
}

export function FileCanvasPanel({ isOpen, sessionId, workingDir, onClose, initialPath }: FileCanvasPanelProps) {
    const { t } = useI18n();
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    // 从 localStorage 加载保存的宽度，默认根据窗口大小自适应
    const [width, setWidth] = useState(() => {
        try {
            const saved = localStorage.getItem('filecanvas-width');
            // 只有在超大窗口（>=1800px）时才使用保存的宽度，普通窗口强制100%覆盖
            if (saved && window.innerWidth >= 1800) {
                const savedWidth = parseInt(saved, 10);
                const maxWidth = window.innerWidth / 2;
                if (savedWidth >= 300 && savedWidth <= maxWidth) {
                    return savedWidth;
                }
            }
            // 默认宽度：普通窗口100%，超大窗口50%
            return window.innerWidth < 1800 ? window.innerWidth : window.innerWidth / 2;
        } catch {
            return window.innerWidth < 1800 ? window.innerWidth : window.innerWidth / 2;
        }
    });
    const [isResizing, setIsResizing] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [showSearch, setShowSearch] = useState(false);
    const [showFolderSelector, setShowFolderSelector] = useState(false);
    const [authorizedFolders, setAuthorizedFolders] = useState<AuthorizedFolder[]>([]);
    const panelRef = useRef<HTMLDivElement>(null);
    const resizerRef = useRef<HTMLDivElement>(null);

    // ⚠️ 用于跟踪外部设置的文件路径，避免被 workingDir 变化清空
    const pendingPathRef = useRef<string | null>(null);

    // 保存宽度到 localStorage
    useEffect(() => {
        try {
            localStorage.setItem('filecanvas-width', width.toString());
        } catch (err) {
            logger.warn('[FileCanvasPanel] Failed to save width:', err);
        }
    }, [width]);

    // ⚠️ 新增：处理外部传入的 initialPath
    useEffect(() => {
        if (initialPath) {
            console.log('[FileCanvasPanel] Initial path received:', initialPath);
            // 检查路径是文件还是文件夹
            window.ipcRenderer.invoke('file:get-type', initialPath).then((result: any) => {
                if (result?.success && result.type) {
                    if (result.type === 'directory') {
                        // 是文件夹：设置为工作目录
                        console.log('[FileCanvasPanel] Opening directory:', initialPath);
                        window.ipcRenderer.invoke('agent:set-working-dir', initialPath);
                        setSelectedPath(null);
                        setShowSearch(false);
                        pendingPathRef.current = null;
                    } else if (result.type === 'file') {
                        // 是文件：先设置工作目录为文件所在目录，然后选中该文件
                        const dirPath = initialPath.replace(/[/\\][^/\\]+$/, '');
                        console.log('[FileCanvasPanel] Opening file:', initialPath, 'in directory:', dirPath);
                        // 保存待处理的文件路径
                        pendingPathRef.current = initialPath;
                        // 设置工作目录（异步）
                        window.ipcRenderer.invoke('agent:set-working-dir', dirPath).then(() => {
                            // 在下一个微任务中设置 selectedPath，避免被 workingDir 的 useEffect 清空
                            setTimeout(() => {
                                console.log('[FileCanvasPanel] Setting selectedPath after workingDir update:', initialPath);
                                setSelectedPath(initialPath);
                                setShowSearch(false);
                                pendingPathRef.current = null;
                            }, 0);
                        });
                    }
                }
            }).catch((error: Error) => {
                logger.error('[FileCanvasPanel] Failed to get path type:', error);
            });
        }
    }, [initialPath]);

    // 加载已授权的文件夹列表
    useEffect(() => {
        loadAuthorizedFolders();
    }, []);

    // ⚠️ 当 sessionId 变化时，清除状态并刷新
    useEffect(() => {
        // 如果有待处理的文件路径，不要清空（避免与 initialPath 处理冲突）
        if (!pendingPathRef.current) {
            setSelectedPath(null);
        }
        // 退出搜索模式，返回文件树
        setShowSearch(false);
        // 触发 FileExplorer 重新加载（通过 refreshKey）
        setRefreshKey(prev => prev + 1);
    }, [sessionId, workingDir]);

    // ⚠️ 当面板关闭或 initialPath 清空时，清理待处理的路径
    useEffect(() => {
        if (!isOpen || !initialPath) {
            pendingPathRef.current = null;
        }
    }, [isOpen, initialPath]);

    const loadAuthorizedFolders = async () => {
        try {
            const result = await window.ipcRenderer.invoke('agent:get-authorized-folders') as AuthorizedFolder[];
            setAuthorizedFolders(result || []);
        } catch (error) {
            logger.error('Failed to load authorized folders:', error);
        }
    };

    // 选择工作目录
    const handleSelectFolder = async (folderPath: string) => {
        try {
            await window.ipcRenderer.invoke('agent:set-working-dir', folderPath);
            setRefreshKey(prev => prev + 1);
            setShowFolderSelector(false);
        } catch (error) {
            logger.error('Failed to set working directory:', error);
        }
    };

    // 刷新文件树
    const handleRefresh = useCallback(() => {
        setRefreshKey(prev => prev + 1);
        loadAuthorizedFolders();
    }, []);

    // 选择文件
    const handleSelectFile = useCallback((path: string) => {
        setSelectedPath(path);
    }, []);

    // 返回到文件树
    const handleBack = useCallback(() => {
        setSelectedPath(null);
    }, []);

    // 处理拖拽调整宽度
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizing && panelRef.current) {
                const newWidth = window.innerWidth - e.clientX;
                // 动态限制：普通窗口最多100%，超大窗口（1800px以上）最多50%
                const maxWidth = window.innerWidth < 1800 ? window.innerWidth : window.innerWidth / 2;
                const minWidth = 300;
                if (newWidth >= minWidth && newWidth <= maxWidth) {
                    setWidth(newWidth);
                }
            }
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    // 监听窗口大小变化，自动调整文件画布宽度
    useEffect(() => {
        const handleResize = () => {
            const maxWidth = window.innerWidth < 1800 ? window.innerWidth : window.innerWidth / 2;
            setWidth(prevWidth => {
                // 如果当前宽度超过了新的最大宽度，自动调整为最大宽度
                if (prevWidth > maxWidth) {
                    return maxWidth;
                }
                // 确保不小于最小宽度
                return Math.max(prevWidth, 300);
            });
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    if (!isOpen) {
        return null;
    }

    // 获取文件夹名称
    const getFolderName = (path: string) => {
        const parts = path.split(/[/\\]/);
        return parts[parts.length - 1] || path;
    };

    return (
        <>

            <div
                ref={panelRef}
                className={`relative h-full bg-white dark:bg-zinc-900 border-l border-stone-200 dark:border-zinc-800 flex flex-col shadow-xl transition-shadow ${
                    isResizing ? 'shadow-2xl ring-2 ring-blue-500/50' : ''
                }`}
                style={{ width: `${width}px` }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-zinc-800 bg-gradient-to-r from-stone-50 to-white dark:from-zinc-900 dark:to-zinc-900">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-lg transition-all hover:scale-105"
                            title={t('close')}
                        >
                            <X size={18} className="text-stone-600 dark:text-zinc-400" />
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setShowFolderSelector(!showFolderSelector)}
                                className={`p-1.5 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-lg transition-all hover:scale-105 ${showFolderSelector ? 'bg-blue-100 dark:bg-blue-900/30' : ''}`}
                                title={t('switchFolder')}
                            >
                                <Folder size={16} className="text-blue-500 dark:text-blue-400" />
                            </button>
                            <button
                                onClick={() => setShowSearch(!showSearch)}
                                className={`p-1.5 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-lg transition-all hover:scale-105 ${showSearch ? 'bg-blue-100 dark:bg-blue-900/30' : ''}`}
                                title={t('searchFiles')}
                            >
                                <Search size={16} className="text-stone-600 dark:text-zinc-400" />
                            </button>
                            <button
                                onClick={handleRefresh}
                                className="p-1.5 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-lg transition-all hover:scale-105"
                                title={t('refresh')}
                            >
                                <RefreshCw size={16} className="text-stone-600 dark:text-zinc-400" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* 文件夹选择器 */}
                {showFolderSelector && (
                    <div className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-800/50 p-3">
                        <div className="text-xs font-medium text-stone-600 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
                            <Home size={12} />
                            {t('selectWorkingDir')}
                        </div>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                            {authorizedFolders.length === 0 ? (
                                <div className="text-xs text-stone-400 dark:text-zinc-500 text-center py-2">
                                    {t('noAuthorizedFolders')}
                                </div>
                            ) : (
                                authorizedFolders.map((folder) => (
                                    <button
                                        key={folder.path}
                                        onClick={() => handleSelectFolder(folder.path)}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${
                                            workingDir === folder.path
                                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                                                : 'hover:bg-stone-200 dark:hover:bg-zinc-700 text-stone-600 dark:text-zinc-400'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Folder size={14} className={workingDir === folder.path ? 'text-blue-500' : ''} />
                                            <span className="truncate flex-1">{getFolderName(folder.path)}</span>
                                            {workingDir === folder.path && (
                                                <span className="text-[10px] px-1.5 py-0.5 bg-blue-500 text-white rounded-full">{t('current')}</span>
                                            )}
                                        </div>
                                        <div className="text-[10px] text-stone-400 dark:text-zinc-500 truncate mt-0.5 ml-6">
                                            {folder.path}
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* 可拖拽调整宽度的分隔条 - 在左边界上 */}
                <div
                    className={`absolute flex items-center justify-center`}
                    style={{ left: '-12px', width: '24px', top: '50%', transform: 'translateY(-50%)' }}
                >
                    {/* 实际可拖动的区域 - 仅在三条横线图标上 */}
                    <div
                        ref={resizerRef}
                        className={`flex flex-col gap-1 items-center justify-center cursor-ew-resize z-50 group px-1.5 py-2 rounded-lg transition-all ${
                            isResizing
                                ? 'bg-blue-100 dark:bg-blue-900/30'
                                : 'hover:bg-stone-100 dark:hover:bg-zinc-800'
                        }`}
                        onMouseDown={handleMouseDown}
                        title={t('dragToResize')}
                    >
                        <div className={`w-1 h-5 rounded-full transition-all ${
                            isResizing
                                ? 'bg-blue-500'
                                : 'bg-stone-400 dark:bg-zinc-500 group-hover:bg-blue-500 dark:group-hover:bg-blue-400'
                        }`} />
                        <div className={`w-1 h-5 rounded-full transition-all ${
                            isResizing
                                ? 'bg-blue-500'
                                : 'bg-stone-400 dark:bg-zinc-500 group-hover:bg-blue-500 dark:group-hover:bg-blue-400'
                        }`} />
                        <div className={`w-1 h-5 rounded-full transition-all ${
                            isResizing
                                ? 'bg-blue-500'
                                : 'bg-stone-400 dark:bg-zinc-500 group-hover:bg-blue-500 dark:group-hover:bg-blue-400'
                        }`} />
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* File Explorer - Always mounted to preserve state */}
                    <div className={`flex-1 overflow-hidden ${selectedPath || showSearch ? 'hidden' : ''}`}>
                        <FileExplorer
                            sessionId={sessionId}
                            workingDir={workingDir}
                            onSelectFile={handleSelectFile}
                            refreshTrigger={refreshKey}
                        />
                    </div>

                    {showSearch ? (
                        // 搜索模式
                        <div className="flex-1 overflow-hidden">
                            <FileSearch
                                workingDir={workingDir}
                                onResultClick={(path) => {
                                    setSelectedPath(path);
                                    setShowSearch(false);
                                }}
                                onClose={() => setShowSearch(false)}
                            />
                        </div>
                    ) : selectedPath ? (
                        // 文件预览模式
                        <div className="flex-1 flex flex-col overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-200 dark:border-zinc-800 bg-stone-50/50 dark:bg-zinc-800/30">
                                <button
                                    onClick={handleBack}
                                    className="p-1.5 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-lg transition-all hover:scale-105"
                                    title={t('back')}
                                >
                                    <ChevronLeft size={16} className="text-stone-600 dark:text-zinc-400" />
                                </button>
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <FileText size={14} className="text-stone-400 dark:text-zinc-500 flex-shrink-0" />
                                    <span className="text-xs font-medium text-stone-600 dark:text-zinc-400 truncate">
                                        {selectedPath}
                                    </span>
                                </div>
                            </div>
                            <div className="flex-1 overflow-hidden bg-white dark:bg-zinc-900">
                                <FilePreview
                                    key={selectedPath + refreshKey}
                                    filePath={selectedPath}
                                    sessionId={sessionId}
                                />
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* Footer - 统计信息 */}
                <div className="px-4 py-2.5 border-t border-stone-200 dark:border-zinc-800 bg-stone-50/50 dark:bg-zinc-800/30 text-xs">
                    {workingDir ? (
                        <div className="flex items-center gap-2 truncate" title={workingDir}>
                            <FolderOpen size={14} className="text-blue-500 flex-shrink-0" />
                            <span className="text-stone-600 dark:text-zinc-400 truncate">
                                {getFolderName(workingDir)}
                            </span>
                        </div>
                    ) : (
                        <div className="text-center text-stone-400 dark:text-zinc-500">
                            {t('selectFolderToBrowse')}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
