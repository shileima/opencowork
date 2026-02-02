/**
 * 文件树浏览器
 * File Explorer
 *
 * 显示文件和目录结构，标识变更状态
 */

import { useState, useEffect, useCallback } from 'react';
import React from 'react';
import {
    ChevronRight,
    ChevronDown,
    FileText,
    FolderOpen,
    File,
    Image,
    Code,
    FileCode
} from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { logger } from '../../services/logger';
import { FileTreeNode, FileChange } from '../../types/fileTracker';

interface FileExplorerProps {
    sessionId: string | null;
    workingDir: string | null;
    onSelectFile: (path: string) => void;
    refreshTrigger?: number;
}

export function FileExplorer({ sessionId, workingDir, onSelectFile, refreshTrigger }: FileExplorerProps) {
    const { t } = useI18n();
    const [tree, setTree] = useState<FileTreeNode | null>(null);
    const [changes, setChanges] = useState<FileChange[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
    const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set()); // 正在加载的目录

    // 懒加载：加载目录的子节点
    const loadDirectoryChildren = useCallback(async (node: FileTreeNode): Promise<void> => {
        if (node.children !== null) return; // 已经加载过了

        setLoadingPaths(prev => new Set(prev).add(node.path));

        try {
            const result = await window.ipcRenderer.invoke('file:getDirectoryChildren', node.path) as {
                success?: boolean;
                children?: any[];
                error?: string;
            };

            if (result && result.success && result.children) {
                // 更新节点的 children
                const updateNode = (currentNode: FileTreeNode): FileTreeNode => {
                    if (currentNode.path === node.path) {
                        return { ...currentNode, children: result.children };
                    }
                    if (currentNode.children) {
                        return {
                            ...currentNode,
                            children: currentNode.children.map(updateNode)
                        };
                    }
                    return currentNode;
                };

                setTree(prev => {
                    if (!prev) return null;
                    try {
                        return updateNode(prev);
                    } catch (error) {
                        logger.error('[FileExplorer] Error updating tree:', error);
                        return prev;
                    }
                });
            }
        } catch (error) {
            logger.error('[FileExplorer] Failed to load children:', error);
        } finally {
            setLoadingPaths(prev => {
                const newSet = new Set(prev);
                newSet.delete(node.path);
                return newSet;
            });
        }
    }, []);

    // 加载文件树
    const loadTree = useCallback(async () => {
        if (!workingDir) {
            return;
        }

        setLoading(true);
        try {
            console.log('[FileExplorer] Loading tree for:', workingDir);
            const result = await window.ipcRenderer.invoke('file:getTree', workingDir) as {
                success?: boolean;
                tree?: any;
                error?: string;
            };

            console.log('[FileExplorer] Tree load result:', result);

            if (result && result.success && result.tree) {
                console.log('[FileExplorer] Setting tree:', result.tree);
                setTree(result.tree);
            } else {
                logger.error('[FileExplorer] Failed to load file tree:', result?.error);
            }
        } catch (error) {
            logger.error('[FileExplorer] Exception loading file tree:', error);
        } finally {
            setLoading(false);
        }
    }, [workingDir]);

    // 加载文件变更
    const loadChanges = useCallback(async () => {
        if (!sessionId) {
            return;
        }

        try {
            const result = await window.ipcRenderer.invoke('file:getChanges', sessionId);
            setChanges((result as FileChange[]) || []);
        } catch (error) {
            logger.error('[FileExplorer] Failed to load file changes:', error);
        }
    }, [sessionId]);

    // 初始化加载
    useEffect(() => {
        loadTree();
        loadChanges();

        // 定期刷新
        const interval = setInterval(() => {
            loadChanges();
        }, 5000); // 每5秒刷新一次变更

        return () => clearInterval(interval);
    }, [loadTree, loadChanges]);

    // ⚠️ 当 refreshTrigger 变化时，重新加载树
    useEffect(() => {
        if (refreshTrigger && refreshTrigger > 0) {
            console.log('[FileExplorer] Refresh triggered:', refreshTrigger);
            loadTree();
        }
    }, [refreshTrigger, loadTree]);

    // ⚠️ 当 sessionId 变化时，只清空旧的变更数据（不清空展开状态）
    useEffect(() => {
        setChanges([]);
    }, [sessionId]);

    // 切换展开/折叠（支持懒加载）
    const toggleExpand = useCallback((path: string, node: FileTreeNode) => {
        setExpandedPaths(prev => {
            const newSet = new Set(prev);
            const isCurrentlyExpanded = newSet.has(path);

            if (isCurrentlyExpanded) {
                // 折叠
                newSet.delete(path);
            } else {
                // 展开
                newSet.add(path);
                // ⚠️ 如果目录的 children 为 null，触发懒加载
                if (node.type === 'directory' && node.children === null) {
                    // 异步加载，不阻塞 UI
                    loadDirectoryChildren(node);
                }
            }

            return newSet;
        });
    }, [loadDirectoryChildren]);

    // 获取文件图标
    const getFileIcon = (node: FileTreeNode) => {
        if (node.type === 'directory') {
            return FolderOpen;
        }

        const ext = node.extension?.toLowerCase();

        // 图片文件
        if (ext && ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp'].includes(ext)) {
            return Image;
        }

        // 代码文件
        if (ext && ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'go', 'rs'].includes(ext)) {
            return FileCode;
        }

        // Markdown
        if (ext === 'md') {
            return FileText;
        }

        // HTML
        if (ext && ['html', 'htm'].includes(ext)) {
            return Code;
        }

        // 默认文件图标
        return File;
    };

    // 获取文件的变更状态
    const getFileChange = (path: string): FileChange | undefined => {
        return changes.find(c => c.path === path);
    };

    // 渲染树节点
    const renderNode = (node: FileTreeNode, level: number = 0): React.ReactNode => {
        if (!node) return null;

        const isExpanded = expandedPaths.has(node.path);
        const isLoading = loadingPaths.has(node.path);
        const isEmpty = node.type === 'directory' && node.children && node.children.length === 0;
        const isUnloaded = node.type === 'directory' && node.children === null;
        const hasChanges = node.type === 'file' && getFileChange(node.path);
        const change = hasChanges ? getFileChange(node.path) : null;

        return (
            <div key={node.id || node.path} style={{ marginLeft: `${level * 16}px` }} className="mb-0.5">
                {/* 节点本身 */}
                <div
                    className={`flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg transition-all cursor-pointer select-none ${
                        change
                            ? 'bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 border border-orange-200 dark:border-orange-800/30'
                            : 'hover:bg-stone-100 dark:hover:bg-zinc-800 border border-transparent hover:border-stone-200 dark:hover:border-zinc-700'
                    }`}
                    onClick={() => {
                        try {
                            if (node.type === 'directory') {
                                toggleExpand(node.path, node);
                            } else {
                                onSelectFile(node.path);
                            }
                        } catch (error) {
                            logger.error('[FileExplorer] Error handling click:', error);
                        }
                    }}
                >
                    {/* 展开/折叠图标 */}
                    {node.type === 'directory' && (
                        <span className="shrink-0 w-4 flex justify-center">
                            {isLoading ? (
                                <span className="text-stone-400">...</span>
                            ) : isExpanded ? (
                                <ChevronDown size={12} className="text-stone-500 transition-transform" />
                            ) : (
                                <ChevronRight size={12} className="text-stone-500 transition-transform" />
                            )}
                        </span>
                    )}

                    {/* 文件/目录图标 */}
                    <span className="shrink-0">
                        {node.type === 'directory' ? (
                            <FolderOpen size={18} className="text-blue-500" />
                        ) : (
                            <span className={change ? `transition-colors` : 'text-stone-500'}>
                                {React.createElement(getFileIcon(node), {
                                    size: 16,
                                    className: change
                                        ? change.type === 'created'
                                            ? 'text-green-500'
                                            : change.type === 'deleted'
                                            ? 'text-red-500'
                                            : 'text-orange-500'
                                        : ''
                                })}
                            </span>
                        )}
                    </span>

                    {/* 名称 */}
                    <span
                        className={`text-sm truncate flex-1 ${
                            change?.type === 'deleted'
                                ? 'line-through text-stone-400 dark:text-zinc-600'
                                : 'text-stone-700 dark:text-zinc-300 font-medium'
                        }`}
                    >
                        {node.name}
                    </span>

                    {/* 变更标识 */}
                    {change && (
                        <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                                change.type === 'created'
                                    ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800'
                                    : change.type === 'deleted'
                                    ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'
                                    : 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800'
                            }`}
                        >
                            {change.type === 'created' ? '+' : change.type === 'deleted' ? '-' : '~'}
                        </span>
                    )}
                </div>

                {/* 子节点 */}
                {node.type === 'directory' && isExpanded && !isLoading && (
                    <div className="ml-1 mt-0.5">
                        {isUnloaded ? (
                            // 未加载：显示加载中
                            <div className="px-6 py-2 text-xs text-stone-400 dark:text-zinc-500">
                                加载中...
                            </div>
                        ) : isEmpty ? (
                            // 空目录
                            <div className="px-6 py-2 text-xs text-stone-400 dark:text-zinc-500">
                                空文件夹
                            </div>
                        ) : (
                            // 已加载：渲染子节点
                            node.children?.map((child, index) => (
                                <React.Fragment key={child.id || child.path || index}>
                                    {renderNode(child, level + 1)}
                                </React.Fragment>
                            ))
                        )}
                    </div>
                )}
            </div>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-stone-500 dark:text-zinc-400 text-sm">
                    {t('loading')}
                </div>
            </div>
        );
    }

    if (!tree) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-stone-500 dark:text-zinc-400 text-sm">
                    {workingDir ? t('noFilesFound') : t('selectWorkingDir')}
                </div>
            </div>
        );
    }

    try {
        return (
            <div className="h-full overflow-y-auto p-2">
                {renderNode(tree)}
            </div>
        );
    } catch (error) {
        logger.error('[FileExplorer] Error rendering tree:', error);
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-red-500 dark:text-red-400 text-sm">
                    Error loading file tree
                </div>
            </div>
        );
    }
}
