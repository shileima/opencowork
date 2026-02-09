import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, Pencil, MoreVertical, Loader2, CheckCircle, XCircle, Circle } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import type { Project, ProjectTask } from '../../../electron/config/ProjectStore';

interface TaskListPanelProps {
    isHidden: boolean;
    onToggleHide: () => void;
    currentProject: Project | null;
    currentTaskId: string | null;
    isProcessing: boolean;
    onSelectTask: (taskId: string) => void;
    onCreateTask: () => void;
}

export function TaskListPanel({
    isHidden,
    onToggleHide,
    currentProject,
    currentTaskId,
    isProcessing,
    onSelectTask,
    onCreateTask
}: TaskListPanelProps) {
    const { t } = useI18n();
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [contextMenuTaskId, setContextMenuTaskId] = useState<string | null>(null);
    const [contextMenuPosition, setContextMenuPosition] = useState({ top: 0, left: 0 });
    /** 原地重命名：正在编辑的任务 id，不弹框 */
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (currentProject) {
            loadTasks(currentProject.id);
        } else {
            setTasks([]);
        }
    }, [currentProject]);

    // 监听任务创建和更新事件，自动刷新任务列表
    useEffect(() => {
        if (!currentProject) return;
        
        const removeCreatedListener = window.ipcRenderer.on('project:task:created', (_event, ...args) => {
            const task = args[0] as ProjectTask;
            if (task && currentProject && task.id) {
                setTimeout(() => loadTasks(currentProject.id), 100);
            }
        });

        const removeUpdatedListener = window.ipcRenderer.on('project:task:updated', (_event, ...args) => {
            const payload = args[0] as { projectId: string; taskId: string };
            if (payload && currentProject && payload.projectId === currentProject.id) {
                loadTasks(currentProject.id);
            }
        });
        
        return () => {
            removeCreatedListener();
            removeUpdatedListener();
        };
    }, [currentProject]);

    const loadTasks = async (projectId: string) => {
        const taskList = await window.ipcRenderer.invoke('project:task:list', projectId) as ProjectTask[];
        // 按更新时间倒序排序，最新的任务在最上面
        const sortedTasks = [...taskList].sort((a, b) => b.updatedAt - a.updatedAt);
        setTasks(sortedTasks);
    };

    /** 进入原地重命名：在名称处显示输入框 */
    const handleRenameTask = (task: ProjectTask) => {
        if (!currentProject) return;
        setContextMenuTaskId(null);
        setEditingTaskId(task.id);
        setEditValue(task.title);
    };

    /** 原地重命名：聚焦输入框 */
    useEffect(() => {
        if (editingTaskId && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [editingTaskId]);

    /** 确认原地重命名（保存或取消） */
    const handleRenameConfirm = async () => {
        if (!currentProject || !editingTaskId) return;
        const task = tasks.find(t => t.id === editingTaskId);
        const newTitle = editValue.trim();
        setEditingTaskId(null);
        setEditValue('');
        if (!task || newTitle === task.title || !newTitle) return;
        const result = await window.ipcRenderer.invoke('project:task:update', currentProject.id, task.id, { title: newTitle }) as { success: boolean };
        if (result.success) {
            loadTasks(currentProject.id);
        }
    };

    const handleDeleteTask = async (task: ProjectTask) => {
        if (!currentProject) {
            console.error('No current project');
            return;
        }
        setContextMenuTaskId(null); // 关闭菜单
        
        const confirmMessage = `${t('delete')} "${task.title}"?`;
        if (confirm(confirmMessage)) {
            try {
                // 先获取剩余任务列表
                const remainingTasks = tasks.filter(t => t.id !== task.id);
                const wasCurrentTask = currentTaskId === task.id;
                
                console.log('Deleting task:', task.id, 'from project:', currentProject.id);
                const result = await window.ipcRenderer.invoke('project:task:delete', currentProject.id, task.id) as { success: boolean };
                console.log('Delete result:', result);
                
                if (result.success) {
                    // 刷新任务列表
                    await loadTasks(currentProject.id);
                    
                    // 如果删除的是当前任务，切换到其他任务
                    if (wasCurrentTask) {
                        if (remainingTasks.length > 0) {
                            // 切换到最新的剩余任务
                            const latestTask = remainingTasks.sort((a, b) => b.updatedAt - a.updatedAt)[0];
                            await onSelectTask(latestTask.id);
                        }
                        // 如果没有其他任务了，不需要特别处理，因为任务列表会显示"暂无任务"
                    }
                } else {
                    console.error('Failed to delete task');
                    alert('删除任务失败，请重试');
                }
            } catch (error) {
                console.error('Error deleting task:', error);
                alert('删除任务时发生错误：' + (error instanceof Error ? error.message : String(error)));
            }
        }
    };

    const handleContextMenu = (e: React.MouseEvent, taskId: string) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const menuWidth = 120;
        setContextMenuPosition({
            top: rect.bottom + 4,
            left: Math.max(8, rect.right - menuWidth)
        });
        setContextMenuTaskId(taskId);
    };

    // 点击外部关闭菜单（延迟绑定，避免打开菜单的同一点击被当作“外部点击”）
    useEffect(() => {
        if (!contextMenuTaskId) return;

        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (contextMenuRef.current?.contains(target)) return;
            const clickedButton = (event.target as HTMLElement).closest('button');
            if (clickedButton?.querySelector('svg')) return;
            setContextMenuTaskId(null);
        };

        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [contextMenuTaskId]);

    // 快捷键支持
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Shift+Ctrl+T (Windows/Linux) or Shift+Cmd+T (macOS)
            if ((e.shiftKey && (e.ctrlKey || e.metaKey)) && e.key === 'T') {
                e.preventDefault();
                onToggleHide();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onToggleHide]);

    // 如果隐藏，不渲染任何内容（展开按钮在顶部显示）
    if (isHidden) {
        return null;
    }

    return (
        <>
        <div className="w-64 bg-white dark:bg-zinc-900 border-r border-stone-200 dark:border-zinc-800 flex flex-col transition-all duration-300 overflow-hidden h-full">
            {/* New Task Button */}
            {currentProject && (
                <div className="h-10 flex items-center px-3 border-b border-stone-200 dark:border-zinc-800 shrink-0">
                    <button
                        onClick={onCreateTask}
                        className="w-full h-6 flex items-center justify-center gap-2 px-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors text-sm font-medium"
                    >
                        <Plus size={16} />
                        {t('newTask')}
                    </button>
                </div>
            )}

            {/* Task List - 支持滚动 */}
            <div className="flex-1 overflow-y-auto p-2 min-h-0 task-list-scroll">
                {!currentProject ? (
                    <div className="text-center py-8 text-sm text-stone-400 dark:text-zinc-500">
                        {t('noProjectSelected')}
                    </div>
                ) : tasks.length === 0 ? (
                    <div className="text-center py-8 text-sm text-stone-400 dark:text-zinc-500">
                        {t('noTasks')}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {tasks.map(task => (
                            <div
                                key={task.id}
                                className={`group relative w-full text-left p-2 rounded-lg transition-colors border ${
                                    currentTaskId === task.id
                                        ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/30'
                                        : 'bg-stone-50 dark:bg-zinc-800 border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700'
                                }`}
                            >
                                <button
                                    onClick={() => onSelectTask(task.id)}
                                    className="w-full text-left pr-10"
                                >
                                    <div className="flex items-start gap-2">
                                        <div
                                            className="mt-0.5 flex items-center justify-center w-5 h-5 shrink-0"
                                            title={
                                                task.status === 'completed'
                                                    ? t('taskCompleted')
                                                    : task.status === 'failed'
                                                    ? t('taskFailed')
                                                    : currentTaskId === task.id && isProcessing
                                                    ? t('thinking')
                                                    : t('taskActive')
                                            }
                                            aria-label={
                                                task.status === 'completed'
                                                    ? t('taskCompleted')
                                                    : task.status === 'failed'
                                                    ? t('taskFailed')
                                                    : currentTaskId === task.id && isProcessing
                                                    ? t('thinking')
                                                    : t('taskActive')
                                            }
                                        >
                                            {task.status === 'completed' ? (
                                                <CheckCircle size={18} className="text-green-500 dark:text-green-400 shrink-0 fill-green-500 dark:fill-green-400" strokeWidth={2} aria-hidden />
                                            ) : task.status === 'failed' ? (
                                                <XCircle size={18} className="text-red-500 dark:text-red-400 shrink-0" aria-hidden />
                                            ) : currentTaskId === task.id && isProcessing ? (
                                                <Loader2 size={18} className="text-amber-500 dark:text-amber-400 animate-spin shrink-0" aria-hidden />
                                            ) : (
                                                <Circle size={18} className="text-stone-300 dark:text-zinc-500 shrink-0" strokeWidth={2} aria-hidden />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 overflow-hidden">
                                            {editingTaskId === task.id ? (
                                                <input
                                                    ref={renameInputRef}
                                                    type="text"
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    onBlur={handleRenameConfirm}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleRenameConfirm();
                                                        if (e.key === 'Escape') {
                                                            setEditingTaskId(null);
                                                            setEditValue('');
                                                        }
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-full px-1 py-0.5 text-xs font-medium bg-white dark:bg-zinc-900 border border-orange-500 dark:border-orange-500 rounded focus:outline-none focus:ring-1 focus:ring-orange-500 text-stone-700 dark:text-zinc-300"
                                                    aria-label={t('rename')}
                                                />
                                            ) : (
                                                <div
                                                    title={task.title}
                                                    className={`text-xs font-medium truncate ${
                                                        task.status === 'completed'
                                                            ? 'text-stone-500 dark:text-zinc-400 line-through'
                                                            : task.status === 'failed'
                                                            ? 'text-stone-600 dark:text-zinc-400'
                                                            : 'text-stone-700 dark:text-zinc-300'
                                                    }`}
                                                >
                                                    {task.title}
                                                </div>
                                            )}
                                            <div
                                                className={`text-[9px] mt-0.5 flex items-center gap-1 ${
                                                    task.status === 'completed'
                                                        ? 'text-green-600 dark:text-green-400'
                                                        : task.status === 'failed'
                                                        ? 'text-red-600 dark:text-red-400'
                                                        : 'text-stone-400 dark:text-zinc-500'
                                                }`}
                                            >
                                                {task.status === 'completed' ? (
                                                    <span>{t('taskCompleted')}</span>
                                                ) : task.status === 'failed' ? (
                                                    <span>{t('taskFailed')}</span>
                                                ) : currentTaskId === task.id && isProcessing ? (
                                                    <span>{t('taskActive')} · {t('thinking')}</span>
                                                ) : (
                                                    <span>{t('taskActive')}</span>
                                                )}
                                                <span className="text-stone-400 dark:text-zinc-500">
                                                    · {new Date(task.updatedAt).toLocaleTimeString('zh-CN', {
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                                {/* 三个点菜单按钮 */}
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            handleContextMenu(e, task.id);
                                        }}
                                        className={`p-1.5 rounded transition-all ${
                                            contextMenuTaskId === task.id
                                                ? 'text-orange-500 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 opacity-100'
                                                : currentTaskId === task.id
                                                ? 'text-stone-500 dark:text-zinc-400 opacity-100 hover:text-stone-700 dark:hover:text-zinc-200'
                                                : 'text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 opacity-0 group-hover:opacity-100'
                                        }`}
                                        title={t('moreActions')}
                                        aria-label={t('moreActions')}
                                        aria-haspopup="true"
                                        aria-expanded={contextMenuTaskId === task.id}
                                    >
                                        <MoreVertical size={14} aria-hidden />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
        {/* 下拉菜单通过 Portal 挂到 body，避免被父级 overflow/堆叠裁剪 */}
        {contextMenuTaskId && (() => {
            const menuTask = tasks.find(t => t.id === contextMenuTaskId);
            if (!menuTask) return null;
            const menuContent = (
                <div
                    ref={contextMenuRef}
                    className="fixed bg-white dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-[99999] min-w-[120px]"
                    style={{ top: contextMenuPosition.top, left: contextMenuPosition.left }}
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleRenameTask(menuTask);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-700 flex items-center gap-2"
                    >
                        <Pencil size={10} />
                        {t('rename')}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTask(menuTask);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2"
                    >
                        <Trash2 size={10} />
                        {t('deleteTask')}
                    </button>
                </div>
            );
            return createPortal(menuContent, document.body);
        })()}
        </>
    );
}
