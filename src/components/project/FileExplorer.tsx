import { useState, useEffect, useCallback } from 'react';
import {
    File,
    FileCode,
    FileBraces,
    FileText,
    FileType,
    FileImage,
    FileTerminal,
    FileArchive,
    FileCog,
    FileKey,
    Folder,
    FolderOpen,
    RefreshCw,
    ChevronRight,
    ChevronDown,
    ListCollapse,
    Edit2,
    Trash2,
    Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { InputDialog } from './InputDialog';

/** 紧凑简约风格的文件图标配置 */
interface FileIconConfig {
    icon: LucideIcon;
    colorClass: string;
}

/** 图标尺寸（紧凑方案） */
const FILE_ICON_SIZE = 12;
const FOLDER_ICON_SIZE = 12;
const CHEVRON_SIZE = 10;

/** 根据文件名/扩展名返回紧凑风格的图标与配色 */
const getFileIconConfig = (fileName: string): FileIconConfig => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const name = fileName.toLowerCase();

    // .env - 绿色
    if (name.startsWith('.env') || name === '.env') {
        return { icon: FileKey, colorClass: 'text-emerald-500' };
    }
    if (name === '.gitignore' || name === '.gitattributes') {
        return { icon: File, colorClass: 'text-zinc-400' };
    }
    if (name === '.npmrc') {
        return { icon: File, colorClass: 'text-red-400' };
    }
    if (name === 'license' || name.startsWith('license.')) {
        return { icon: FileKey, colorClass: 'text-amber-400' };
    }
    if (ext === 'json' || ext === 'json5' || name.endsWith('.json5')) {
        return { icon: FileBraces, colorClass: 'text-amber-400' };
    }
    if (name.startsWith('tsconfig') && (ext === 'json' || name.endsWith('.json'))) {
        return { icon: FileCode, colorClass: 'text-blue-400' };
    }
    if (['md', 'mdx', 'markdown'].includes(ext || '')) {
        return { icon: FileText, colorClass: 'text-blue-400' };
    }
    if (['txt', 'rst', 'log'].includes(ext || '')) {
        return { icon: FileText, colorClass: 'text-zinc-400' };
    }
    if (['html', 'htm', 'xhtml'].includes(ext || '')) {
        return { icon: FileType, colorClass: 'text-orange-400' };
    }
    if (ext === 'xml' || ext === 'svg') {
        return { icon: FileType, colorClass: 'text-amber-500' };
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(ext || '')) {
        return { icon: FileImage, colorClass: 'text-pink-400' };
    }
    if (['sh', 'bash', 'zsh'].includes(ext || '')) {
        return { icon: FileTerminal, colorClass: 'text-emerald-400' };
    }
    if (['zip', 'tar', 'gz', 'tgz', '7z', 'rar'].includes(ext || '')) {
        return { icon: FileArchive, colorClass: 'text-amber-500' };
    }
    if (name.includes('vite.config')) {
        return { icon: Zap, colorClass: 'text-amber-400' };
    }
    if (name.includes('eslint') || name === '.eslintrc' || name === '.eslintrc.cjs' || name === '.eslintrc.js') {
        return { icon: FileCog, colorClass: 'text-purple-400' };
    }
    if (
        name.endsWith('.config.js') ||
        name.endsWith('.config.ts') ||
        name.endsWith('.config.cjs') ||
        name.endsWith('.config.mjs') ||
        name === '.babelrc' ||
        name === '.babelrc.js' ||
        name === 'webpack.config.js' ||
        name === 'tailwind.config.cjs' ||
        name === 'postcss.config.cjs' ||
        name === 'postcss.config.js'
    ) {
        return { icon: FileCog, colorClass: 'text-amber-500' };
    }
    if (['ts', 'tsx', 'mts', 'cts'].includes(ext || '')) {
        return { icon: FileCode, colorClass: 'text-blue-400' };
    }
    if (['js', 'jsx', 'mjs', 'cjs'].includes(ext || '')) {
        return { icon: FileCode, colorClass: 'text-yellow-500' };
    }
    if (ext === 'css') {
        return { icon: FileCode, colorClass: 'text-blue-400' };
    }
    if (['scss', 'sass', 'less'].includes(ext || '')) {
        return { icon: FileCode, colorClass: 'text-pink-400' };
    }
    if (['yaml', 'yml'].includes(ext || '')) {
        return { icon: FileCode, colorClass: 'text-rose-400' };
    }
    if (ext === 'py') {
        return { icon: FileCode, colorClass: 'text-sky-400' };
    }
    if (ext === 'go') {
        return { icon: FileCode, colorClass: 'text-cyan-400' };
    }
    if (ext === 'rs') {
        return { icon: FileCode, colorClass: 'text-orange-500' };
    }
    if (['java', 'cpp', 'c', 'h', 'hpp', 'php', 'rb', 'sql', 'kt', 'swift'].includes(ext || '')) {
        return { icon: FileCode, colorClass: 'text-slate-400' };
    }
    return { icon: File, colorClass: 'text-zinc-500' };
};

interface FileItem {
    name: string;
    path: string;
    isDirectory: boolean;
}

interface FileExplorerProps {
    projectPath: string | null;
    onOpenFile: (filePath: string) => void;
}

export function FileExplorer({ projectPath, onOpenFile }: FileExplorerProps) {
    const { t } = useI18n();
    const [files, setFiles] = useState<FileItem[]>([]);
    const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
    const [editingPath, setEditingPath] = useState<string | null>(null);
    const [showNewFileDialog, setShowNewFileDialog] = useState(false);
    const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
    const [newItemParentPath, setNewItemParentPath] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; isDirectory: boolean } | null>(null);

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
                // 如果是权限错误，尝试刷新项目路径的授权
                if (result.error.includes('not authorized') && projectPath) {
                    console.warn('Path not authorized, attempting to authorize:', dirPath);
                }
            }
        } catch (error) {
            console.error('Failed to load directory:', error);
        }
    }, [projectPath]);

    const handleRefresh = useCallback(() => {
        if (projectPath) {
            // 刷新时递归加载所有文件
            setFiles([]); // 清空现有文件列表
            loadDirectory(projectPath, true);
        }
    }, [projectPath, loadDirectory]);

    useEffect(() => {
        if (projectPath) {
            // 初始加载时递归加载所有文件
            loadDirectory(projectPath, true);
        } else {
            setFiles([]);
        }
    }, [projectPath, loadDirectory]);

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
                // 延迟刷新，确保文件写入完成
                setTimeout(() => {
                    handleRefresh();
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

    const handleNewFile = () => {
        if (!projectPath) return;
        setNewItemParentPath(projectPath);
        setShowNewFileDialog(true);
    };

    const handleConfirmNewFile = async (fileName: string) => {
        if (!projectPath || !newItemParentPath) return;
        const filePath = `${newItemParentPath}/${fileName}`;
        try {
            await window.ipcRenderer.invoke('fs:write-file', filePath, '');
            handleRefresh();
        } catch (error) {
            console.error('Failed to create file:', error);
        }
        setShowNewFileDialog(false);
        setNewItemParentPath(null);
    };

    const handleNewFolder = () => {
        if (!projectPath) return;
        setNewItemParentPath(projectPath);
        setShowNewFolderDialog(true);
    };

    const handleConfirmNewFolder = async (folderName: string) => {
        if (!projectPath || !newItemParentPath) return;
        const folderPath = `${newItemParentPath}/${folderName}`;
        try {
            await window.ipcRenderer.invoke('fs:create-dir', folderPath);
            handleRefresh();
        } catch (error) {
            console.error('Failed to create folder:', error);
        }
        setShowNewFolderDialog(false);
        setNewItemParentPath(null);
    };

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

        return directChildren.map(item => {

                if (item.isDirectory) {
                    const isExpanded = expandedDirs.has(item.path);
                    const children = items.filter(child => child.path.startsWith(item.path + '/') && child.path !== item.path);

                    return (
                        <div key={item.path}>
                            <div
                                className="flex items-center gap-0.5 px-1.5 py-0.5 hover:bg-stone-50 dark:hover:bg-zinc-800 rounded cursor-pointer group"
                                onContextMenu={(e) => handleContextMenu(e, item.path, true)}
                            >
                                <button
                                    onClick={() => handleToggleDir(item.path)}
                                    className="p-0.5 shrink-0 text-zinc-500 hover:text-zinc-700"
                                    aria-label={isExpanded ? t('collapse') : t('expand')}
                                >
                                    {isExpanded ? <ChevronDown size={CHEVRON_SIZE} strokeWidth={2} /> : <ChevronRight size={CHEVRON_SIZE} strokeWidth={2} />}
                                </button>
                                <button
                                    onClick={() => handleToggleDir(item.path)}
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
                                    >
                                        <Edit2 size={12} />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(item.path);
                                        }}
                                        className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                                    >
                                        <Trash2 size={12} />
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
                } else {
                    return (
                        <div
                            key={item.path}
                            className="flex items-center gap-1.5 px-1.5 py-0.5 hover:bg-stone-50 dark:hover:bg-zinc-800 rounded cursor-pointer group"
                            onClick={() => handleFileClick(item.path, false)}
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
                                />
                            ) : (
                                <span className="flex-1 text-sm text-stone-700 dark:text-zinc-300 min-w-0 truncate">
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
                                >
                                    <Edit2 size={12} />
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(item.path);
                                    }}
                                    className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </div>
                    );
                }
            })
            .filter(Boolean);
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
        <>
            {showNewFileDialog && (
                <InputDialog
                    title={t('newFile')}
                    label={t('newFile')}
                    defaultValue="newfile.txt"
                    placeholder={t('newFile')}
                    onClose={() => {
                        setShowNewFileDialog(false);
                        setNewItemParentPath(null);
                    }}
                    onConfirm={handleConfirmNewFile}
                />
            )}

            {showNewFolderDialog && (
                <InputDialog
                    title={t('newFolder')}
                    label={t('newFolder')}
                    defaultValue="newfolder"
                    placeholder={t('newFolder')}
                    onClose={() => {
                        setShowNewFolderDialog(false);
                        setNewItemParentPath(null);
                    }}
                    onConfirm={handleConfirmNewFolder}
                />
            )}

            <div className="w-64 bg-white dark:bg-zinc-900 border-l border-stone-200 dark:border-zinc-800 flex flex-col">
            {/* Header */}
            <div className="p-3 border-b border-stone-200 dark:border-zinc-800 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-stone-700 dark:text-zinc-200">{t('fileExplorer')}</h3>
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
                        onClick={handleRefresh}
                        className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors"
                        title={t('refresh')}
                    >
                        <RefreshCw size={14} />
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
                        <Edit2 size={14} />
                        {t('rename')}
                    </button>
                    <button
                        onClick={() => {
                            handleDelete(contextMenu.path);
                            setContextMenu(null);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                    >
                        <Trash2 size={14} />
                        {t('delete')}
                    </button>
                </div>
            )}
        </div>
        </>
    );
}
