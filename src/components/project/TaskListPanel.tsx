import { useState, useEffect, useRef } from 'react';
import { Plus, Loader2, CircleCheckBig, XCircle, Circle, X } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import type { Project, ProjectTask } from '../../../electron/config/ProjectStore';

interface TaskListPanelProps {
    isHidden: boolean;
    onToggleHide: () => void;
    currentProject: Project | null;
    currentTaskId: string | null;
    isProcessing: boolean;
    isDeploying?: boolean;
    onSelectTask: (taskId: string) => void;
    onCreateTask: () => void;
}

export function TaskListPanel({
    isHidden,
    onToggleHide,
    currentProject,
    currentTaskId,
    isProcessing,
    isDeploying = false,
    onSelectTask,
    onCreateTask
}: TaskListPanelProps) {
    const isBusy = isProcessing || isDeploying;
    const { t } = useI18n();
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    /** 原地重命名：正在编辑的任务 id，不弹框 */
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
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
        // 过滤掉 400 错误导致的 failed 任务，不再展示
        const filtered = taskList.filter((t) => t.status !== 'failed');
        // 按更新时间倒序排序，最新的任务在最上面
        const sortedTasks = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
        setTasks(sortedTasks);
    };

    /** 进入原地重命名：在名称处显示输入框（双击任务标题触发） */
    const handleRenameTask = (task: ProjectTask) => {
        if (!currentProject) return;
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
                                                    : t('taskActive')
                                            }
                                            aria-label={
                                                task.status === 'completed'
                                                    ? t('taskCompleted')
                                                    : task.status === 'failed'
                                                    ? t('taskFailed')
                                                    : t('taskActive')
                                            }
                                        >
                                            {task.status === 'completed' ? (
                                                <CircleCheckBig size={18} className="text-green-500 dark:text-green-400 shrink-0" aria-hidden />
                                            ) : task.status === 'failed' ? (
                                                <XCircle size={18} className="text-red-500 dark:text-red-400 shrink-0" aria-hidden />
                                            ) : currentTaskId === task.id && isBusy ? (
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
                                                    title={`${task.title}（双击重命名）`}
                                                    onDoubleClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRenameTask(task);
                                                    }}
                                                    className={`text-xs font-medium truncate ${
                                                        task.status === 'completed'
                                                            ? 'text-stone-500 dark:text-zinc-400'
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
                                                        ? 'text-stone-400 dark:text-zinc-500'
                                                        : task.status === 'failed'
                                                        ? 'text-red-600 dark:text-red-400'
                                                        : 'text-stone-400 dark:text-zinc-500'
                                                }`}
                                            >
                                                {task.status === 'completed' ? (
                                                    <span>{t('taskCompleted')}</span>
                                                ) : task.status === 'failed' ? (
                                                    <span>{t('taskFailed')}</span>
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
                                {/* 删除按钮（与权限列表删除样式一致） */}
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            handleDeleteTask(task);
                                        }}
                                        className={`p-1.5 text-stone-300 dark:text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-all ${
                                            currentTaskId === task.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                        }`}
                                        title={t('deleteTask')}
                                        aria-label={t('deleteTask')}
                                    >
                                        <X size={14} aria-hidden />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
        </>
    );
}
