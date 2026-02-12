import { useState, useEffect, useCallback, useRef } from 'react';
import {
    File,
    Folder,
    FolderOpen,
    RefreshCw,
    Loader2,
    ChevronRight,
    ChevronDown,
    ListCollapse,
    Edit2,
    Trash2,
} from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { getFileIconConfig } from './fileIcons';

/** 内联新建项：在选中文件夹下或选中文件同级显示输入框，不弹框 */
interface PendingNewItem {
    parentPath: string;
    type: 'file' | 'folder';
    /** 插入到该路径项之后；null 表示插入到当前目录首位 */
    afterPath: string | null;
}

/** 图标尺寸（紧凑方案） */
const FILE_ICON_SIZE = 12;
const FOLDER_ICON_SIZE = 12;
const CHEVRON_SIZE = 10;

interface FileItem {
    name: string;
    path: string;
    isDirectory: boolean;
}

interface FileExplorerProps {
    projectPath: string | null;
    onOpenFile: (filePath: string) => void;
    /** 文件被删除后调用（如资源管理器中删除），用于同步关闭编辑器中已打开的该文件 tab */
    onFileDeleted?: (filePath: string) => void;
}

export function FileExplorer({ projectPath, onOpenFile, onFileDeleted }: FileExplorerProps) {
    const { t } = useI18n();
    const [files, setFiles] = useState<FileItem[]>([]);
    const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
    const [editingPath, setEditingPath] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    /** 当前选中的文件/文件夹路径，用于决定新建项的父目录与插入位置 */
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    /** 内联新建：待输入名称的新文件/文件夹，不弹框 */
    const [pendingNewItem, setPendingNewItem] = useState<PendingNewItem | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; isDirectory: boolean } | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    /** 正在更新/保存中的文件路径，在该文件右侧显示 loader */
    const [savingFilePath, setSavingFilePath] = useState<string | null>(null);
    const newItemInputRef = useRef<HTMLInputElement>(null);
    const authRetryRef = useRef<string | null>(null); // 权限错误重试：避免同一路径无限重试

    const loadDirectory = useCallback(async (dirPath: string, recursive: boolean = false) => {
        try {
            const result = await window.ipcRenderer.invoke('fs:list-dir', dirPath) as { success: boolean; items?: FileItem[]; error?: string };
            if (result.success && result.items) {
                if (recursive) {
                    // 递归加载所有子目录（用于初始加载）
                    const allFiles: FileItem[] = [...result.items];
                    const loadSubDirs = async (items: FileItem[]) => {
                        for (const item of items) {
                            if (item.isDirectory) {
                                try {
                                    const subResult = await window.ipcRenderer.invoke('fs:list-dir', item.path) as { success: boolean; items?: FileItem[]; error?: string };
                                    if (subResult.success && subResult.items) {
                                        allFiles.push(...subResult.items);
                                        // 递归加载更深层的目录
                                        await loadSubDirs(subResult.items.filter(i => i.isDirectory));
                                    }
                                } catch (err) {
                                    // 忽略子目录加载错误，继续加载其他目录
                                    console.warn(`Failed to load subdirectory ${item.path}:`, err);
                                }
                            }
                        }
                    };
                    await loadSubDirs(result.items.filter(i => i.isDirectory));
                    setFiles(allFiles);
                } else {
                    // 只加载当前目录，合并到现有文件列表
                    setFiles(prev => {
                        const existingPaths = new Set(prev.map(f => f.path));
                        const newItems = result.items!.filter(item => !existingPaths.has(item.path));
                        return [...prev, ...newItems];
                    });
                }
            } else if (result.error) {
                console.error('Failed to load directory:', result.error);
                // 权限错误时确保项目路径已授权并重试一次（刚打开页面时可能尚未完成 project:ensure-working-dir）
                if (result.error.includes('not authorized') && projectPath && authRetryRef.current !== dirPath) {
                    authRetryRef.current = dirPath;
                    window.ipcRenderer.invoke('project:ensure-working-dir').then(() => {
                        loadDirectory(dirPath, recursive);
                    }).catch(() => { authRetryRef.current = null; });
                }
            }
        } catch (error) {
            console.error('Failed to load directory:', error);
        }
    }, [projectPath]);

    const handleRefresh = useCallback(async () => {
        if (!projectPath) return;
        setIsRefreshing(true);
        try {
            await loadDirectory(projectPath, true);
        } finally {
            setIsRefreshing(false);
        }
    }, [projectPath, loadDirectory]);

    // 切换/删除项目时：仅加载根目录（非递归），立即展示；子目录在用户展开时按需加载
    useEffect(() => {
        authRetryRef.current = null; // 切换项目时重置重试标记
        setExpandedDirs(new Set()); // 切换项目时重置展开状态
        if (projectPath) {
            loadDirectory(projectPath, false);
        } else {
            setFiles([]);
        }
    }, [projectPath, loadDirectory]);

    // 内联新建时聚焦输入框
    useEffect(() => {
        if (pendingNewItem && newItemInputRef.current) {
            newItemInputRef.current.focus();
        }
    }, [pendingNewItem]);

    // 监听文件创建和修改事件，自动刷新
    useEffect(() => {
        if (!projectPath) return;
        
        const removeArtifactListener = window.ipcRenderer.on('agent:artifact-created', (_event, ...args) => {
            const artifact = args[0] as { path?: string; name?: string; type?: string };
            if (artifact?.type === 'file' && artifact.path && artifact.path.startsWith(projectPath)) {
                setTimeout(() => {
                    handleRefresh();
                }, 500);
            }
        });

        // 聊天改完项目文件后（回合结束）强制刷新资源管理器，重新加载最新文件列表
        const removeDoneListener = window.ipcRenderer.on('agent:done', () => {
            if (projectPath) {
                setTimeout(() => {
                    handleRefresh();
                }, 300);
            }
        });

        // 监听文件系统文件变化事件（包括预览服务修改、手动保存等）
        const removeFileChangedListener = window.ipcRenderer.on('fs:file-changed', (_event, ...args) => {
            const filePath = args[0] as string;
            if (filePath && filePath.startsWith(projectPath)) {
                setSavingFilePath(filePath);
                setTimeout(() => {
                    handleRefresh().then(() => {
                        setTimeout(() => setSavingFilePath(null), 1200);
                    });
                }, 300);
            }
        });

        return () => {
            removeArtifactListener();
            removeDoneListener();
            removeFileChangedListener();
        };
    }, [projectPath, handleRefresh]);

    const handleCollapseAll = () => {
        setExpandedDirs(new Set());
    };

    const handleToggleDir = async (dirPath: string) => {
        setExpandedDirs(prev => {
            const next = new Set(prev);
            if (next.has(dirPath)) {
                next.delete(dirPath);
            } else {
                next.add(dirPath);
                // 展开时加载子目录（如果还没有加载）
                const hasChildren = files.some(f => f.path.startsWith(dirPath + '/') && f.path !== dirPath);
                if (!hasChildren) {
                    // 异步加载子目录
                    loadDirectory(dirPath, false);
                }
            }
            return next;
        });
    };

    const handleFileClick = (filePath: string, isDirectory: boolean) => {
        if (isDirectory) {
            handleToggleDir(filePath);
        } else {
            onOpenFile(filePath);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, filePath: string, isDirectory: boolean) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, path: filePath, isDirectory });
    };

    /** 展开某路径及其所有祖先目录，以便在树中显示该路径 */
    const expandPathAndAncestors = useCallback((dirPath: string) => {
        if (!projectPath || dirPath === projectPath) return;
        setExpandedDirs(prev => {
            const next = new Set(prev);
            next.add(dirPath);
            let d = dirPath;
            while (d && d !== projectPath) {
                d = d.substring(0, d.lastIndexOf('/'));
                if (d) next.add(d);
            }
            return next;
        });
    }, [projectPath]);

    const handleNewFile = () => {
        if (!projectPath) return;
        const selectedItem = files.find(f => f.path === selectedPath);
        const parentPath = selectedPath
            ? (selectedItem?.isDirectory ? selectedPath : selectedPath.substring(0, selectedPath.lastIndexOf('/')))
            : projectPath;
        const afterPath = selectedPath && selectedItem && !selectedItem.isDirectory ? selectedPath : null;
        expandPathAndAncestors(parentPath);
        if (parentPath !== projectPath) loadDirectory(parentPath, false);
        setEditValue('');
        setPendingNewItem({ parentPath, type: 'file', afterPath });
    };

    const handleNewFolder = () => {
        if (!projectPath) return;
        const selectedItem = files.find(f => f.path === selectedPath);
        const parentPath = selectedPath
            ? (selectedItem?.isDirectory ? selectedPath : selectedPath.substring(0, selectedPath.lastIndexOf('/')))
            : projectPath;
        const afterPath = selectedPath && selectedItem && !selectedItem.isDirectory ? selectedPath : null;
        expandPathAndAncestors(parentPath);
        if (parentPath !== projectPath) loadDirectory(parentPath, false);
        setEditValue('');
        setPendingNewItem({ parentPath, type: 'folder', afterPath });
    };

    const handleConfirmNewItem = useCallback(async (name: string) => {
        const trimmed = name.trim();
        if (!projectPath || !pendingNewItem || !trimmed) {
            setPendingNewItem(null);
            setEditValue('');
            return;
        }
        try {
            if (pendingNewItem.type === 'file') {
                await window.ipcRenderer.invoke('fs:write-file', `${pendingNewItem.parentPath}/${trimmed}`, '');
            } else {
                await window.ipcRenderer.invoke('fs:create-dir', `${pendingNewItem.parentPath}/${trimmed}`);
            }
            setPendingNewItem(null);
            setEditValue('');
            handleRefresh();
        } catch (error) {
            console.error('Failed to create:', error);
        }
    }, [projectPath, pendingNewItem, handleRefresh]);

    const handleCancelNewItem = useCallback(() => {
        setPendingNewItem(null);
        setEditValue('');
    }, []);

    const handleRename = (oldPath: string) => {
        setEditingPath(oldPath);
        const name = oldPath.split(/[\\/]/).pop() || '';
        setEditValue(name);
    };

    const handleRenameConfirm = async () => {
        if (!editingPath || !editValue.trim()) {
            setEditingPath(null);
            return;
        }
        const parentDir = editingPath.substring(0, editingPath.lastIndexOf('/'));
        const newPath = `${parentDir}/${editValue.trim()}`;
        try {
            await window.ipcRenderer.invoke('fs:rename', editingPath, newPath);
            setEditingPath(null);
            handleRefresh();
        } catch (error) {
            console.error('Failed to rename:', error);
        }
    };

    const handleDelete = async (filePath: string) => {
        if (confirm(`${t('delete')} ${filePath.split(/[\\/]/).pop()}?`)) {
            try {
                await window.ipcRenderer.invoke('fs:delete', filePath);
                onFileDeleted?.(filePath);
                handleRefresh();
            } catch (error) {
                console.error('Failed to delete:', error);
            }
        }
    };

    const renderFileTree = (items: FileItem[], basePath: string, level: number = 0): React.ReactNode => {
        // 获取当前目录的直接子项
        const directChildren = items.filter(item => {
            if (!item.path.startsWith(basePath)) return false;
            const relativePath = item.path.replace(basePath + '/', '');
            return relativePath && !relativePath.includes('/');
        }).sort((a, b) => {
            // 目录在前，然后按名称排序
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        // 在正确位置插入「内联新建」行（Cursor 风格：选中文件夹下或选中文件同级）
        const withPending: (FileItem | { _pending: 'file' | 'folder' })[] = [];
        if (pendingNewItem?.parentPath === basePath) {
            const idx = pendingNewItem.afterPath === null
                ? 0
                : directChildren.findIndex(c => c.path === pendingNewItem.afterPath) + 1;
            const insertIdx = idx < 0 ? 0 : idx;
            directChildren.forEach((item, i) => {
                if (i === insertIdx) withPending.push({ _pending: pendingNewItem.type });
                withPending.push(item);
            });
            if (insertIdx === directChildren.length) withPending.push({ _pending: pendingNewItem.type });
        } else {
            directChildren.forEach(item => withPending.push(item));
        }

        return withPending.map(entry => {
            if ('_pending' in entry) {
                const type = entry._pending;
                return (
                    <div
                        key={`__new__${basePath}__${type}`}
                        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded group"
                    >
                        {type === 'folder' ? (
                            <Folder size={FOLDER_ICON_SIZE} className="text-amber-500 shrink-0" strokeWidth={1.5} />
                        ) : (
                            <File size={FILE_ICON_SIZE} className="text-zinc-400 shrink-0" strokeWidth={1.5} />
                        )}
                        <input
                            ref={newItemInputRef}
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={(e) => {
                                const v = (e.target as HTMLInputElement).value.trim();
                                if (v) handleConfirmNewItem(v);
                                else handleCancelNewItem();
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    const v = (e.target as HTMLInputElement).value.trim();
                                    if (v) handleConfirmNewItem(v);
                                    else handleCancelNewItem();
                                }
                                if (e.key === 'Escape') handleCancelNewItem();
                            }}
                            className="flex-1 min-w-0 px-1 py-0.5 text-sm bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-400 dark:focus:border-blue-400"
                            placeholder={type === 'file' ? t('newFile') : t('newFolder')}
                            aria-label={type === 'file' ? t('newFile') : t('newFolder')}
                        />
                    </div>
                );
            }

            const item = entry as FileItem;
            if (item.isDirectory) {
                const isExpanded = expandedDirs.has(item.path);
                const isSelected = selectedPath === item.path;

                return (
                    <div key={item.path}>
                        <div
                            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded cursor-pointer group ${isSelected ? 'bg-orange-100 dark:bg-orange-900/30' : 'hover:bg-stone-50 dark:hover:bg-zinc-800'}`}
                            onContextMenu={(e) => handleContextMenu(e, item.path, true)}
                            onClick={() => setSelectedPath(item.path)}
                        >
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleDir(item.path);
                                }}
                                className="p-0.5 shrink-0 text-zinc-500 hover:text-zinc-700"
                                aria-label={isExpanded ? t('collapse') : t('expand')}
                            >
                                {isExpanded ? <ChevronDown size={CHEVRON_SIZE} strokeWidth={2} /> : <ChevronRight size={CHEVRON_SIZE} strokeWidth={2} />}
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleDir(item.path);
                                }}
                                className="p-0.5 shrink-0"
                            >
                                {isExpanded ? <FolderOpen size={FOLDER_ICON_SIZE} className="text-amber-500" strokeWidth={1.5} /> : <Folder size={FOLDER_ICON_SIZE} className="text-zinc-400" strokeWidth={1.5} />}
                            </button>
                            {editingPath === item.path ? (
                                <input
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={handleRenameConfirm}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleRenameConfirm();
                                        if (e.key === 'Escape') setEditingPath(null);
                                    }}
                                    className="flex-1 px-1 py-0.5 text-sm bg-white dark:bg-zinc-900 border border-orange-500 rounded"
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                />
                            ) : (
                                <span
                                    className="flex-1 text-sm text-stone-700 dark:text-zinc-300 min-w-0 truncate"
                                    onClick={() => handleFileClick(item.path, true)}
                                >
                                    {item.name}
                                </span>
                            )}
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleRename(item.path);
                                    }}
                                    className="p-1 hover:bg-stone-100 dark:hover:bg-zinc-700 rounded"
                                    aria-label={t('rename')}
                                >
                                    <Edit2 size={10} />
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(item.path);
                                    }}
                                    className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                                    aria-label={t('delete')}
                                >
                                    <Trash2 size={10} />
                                </button>
                            </div>
                        </div>
                        {isExpanded && (
                            <div className="ml-4">
                                {renderFileTree(items, item.path, level + 1)}
                            </div>
                        )}
                    </div>
                );
            }

            const isSelected = selectedPath === item.path;
            return (
                <div
                    key={item.path}
                    className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded cursor-pointer group ${isSelected ? 'bg-orange-100 dark:bg-orange-900/30' : 'hover:bg-stone-50 dark:hover:bg-zinc-800'}`}
                    onClick={() => {
                        setSelectedPath(item.path);
                        handleFileClick(item.path, false);
                    }}
                    onContextMenu={(e) => handleContextMenu(e, item.path, false)}
                >
                    {(() => {
                        const { icon: FileIcon, colorClass } = getFileIconConfig(item.name);
                        return <FileIcon size={FILE_ICON_SIZE} className={`${colorClass} shrink-0`} strokeWidth={1.5} />;
                    })()}
                    {editingPath === item.path ? (
                        <input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleRenameConfirm}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameConfirm();
                                if (e.key === 'Escape') setEditingPath(null);
                            }}
                            className="flex-1 px-1 py-0.5 text-sm bg-white dark:bg-zinc-900 border border-orange-500 rounded"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <span className="flex-1 text-sm text-stone-700 dark:text-zinc-300 min-w-0 truncate">
                            {item.name}
                        </span>
                    )}
                    {savingFilePath === item.path && (
                        <Loader2 size={12} className="shrink-0 animate-spin text-orange-500" aria-hidden />
                    )}
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleRename(item.path);
                            }}
                            className="p-1 hover:bg-stone-100 dark:hover:bg-zinc-700 rounded"
                            aria-label={t('rename')}
                        >
                            <Edit2 size={10} />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(item.path);
                            }}
                            className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                            aria-label={t('delete')}
                        >
                            <Trash2 size={10} />
                        </button>
                    </div>
                </div>
            );
        });
    };

    if (!projectPath) {
        return (
            <div className="w-64 bg-white dark:bg-zinc-900 border-l border-stone-200 dark:border-zinc-800 flex flex-col">
                <div className="p-4 text-center text-sm text-stone-400 dark:text-zinc-500">
                    {t('noProjectSelected')}
                </div>
            </div>
        );
    }

    return (
        <div className="w-64 bg-white dark:bg-zinc-900 border-l border-stone-200 dark:border-zinc-800 flex flex-col">
            {/* Header：与主 Tab 栏同高（h-10） */}
            <div className="h-10 shrink-0 px-2 border-b border-stone-200 dark:border-zinc-800 flex items-center justify-between">
                <h3 className="text-sm font-normal text-stone-700 dark:text-zinc-200">{t('fileExplorer')}</h3>
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleCollapseAll}
                        className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors"
                        title={t('collapseAll') || '折叠全部'}
                        aria-label={t('collapseAll') || '折叠全部'}
                    >
                        <ListCollapse size={14} />
                    </button>
                    <button
                        onClick={handleNewFile}
                        className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors"
                        title={t('newFile')}
                    >
                        <File size={14} />
                    </button>
                    <button
                        onClick={handleNewFolder}
                        className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors"
                        title={t('newFolder')}
                    >
                        <Folder size={14} />
                    </button>
                    <button
                        onClick={() => handleRefresh()}
                        disabled={isRefreshing}
                        className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                        title={t('refresh')}
                        aria-label={t('refresh')}
                    >
                        {isRefreshing ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <RefreshCw size={14} />
                        )}
                    </button>
                </div>
            </div>

            {/* File Tree */}
            <div className="flex-1 overflow-y-auto p-2">
                {projectPath && renderFileTree(files, projectPath)}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-lg shadow-lg z-50 py-1"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onMouseLeave={() => setContextMenu(null)}
                >
                    <button
                        onClick={() => {
                            handleRename(contextMenu.path);
                            setContextMenu(null);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 flex items-center gap-2"
                    >
                        <Edit2 size={12} />
                        {t('rename')}
                    </button>
                    <button
                        onClick={() => {
                            handleDelete(contextMenu.path);
                            setContextMenu(null);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                    >
                        <Trash2 size={12} />
                        {t('delete')}
                    </button>
                </div>
            )}
        </div>
    );
}
