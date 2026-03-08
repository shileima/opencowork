import { useState, useEffect, useRef } from 'react';
import { Plus, Loader2, CircleCheckBig, XCircle, Circle, X } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { decodeDisplayText } from '../../utils/decodeDisplayText';
import type { RPAProject, RPATask } from '../../../electron/config/RPAProjectStore';

interface RPATaskListPanelProps {
    isHidden: boolean;
    onToggleHide: () => void;
    currentProject: RPAProject | null;
    currentTaskId: string | null;
    isProcessing: boolean;
    onSelectTask: (taskId: string) => void;
    onCreateTask: () => void;
}

export function RPATaskListPanel({
    isHidden,
    onToggleHide,
    currentProject,
    currentTaskId,
    isProcessing,
    onSelectTask,
    onCreateTask
}: RPATaskListPanelProps) {
    const { t } = useI18n();
    const TASK_LIST_PAGE_SIZE = 10;
    const [tasks, setTasks] = useState<RPATask[]>([]);
    const [displayedCount, setDisplayedCount] = useState(TASK_LIST_PAGE_SIZE);
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

    useEffect(() => {
        if (!currentProject) return;
        const removeCreated = window.ipcRenderer.on('rpa:task:created', async () => {
            // 新建项目后主进程会先发 rpa:project:switched 再发 rpa:task:created，此时 currentProject 可能尚未更新，用当前项目 id 刷新确保显示新项目的任务列表
            const project = await window.ipcRenderer.invoke('rpa:get-current-project') as { id: string } | null;
            if (project?.id) loadTasks(project.id);
        });
        const removeUpdated = window.ipcRenderer.on('rpa:task:updated', (_event, ...args) => {
            const payload = args[0] as { projectId: string };
            if (payload?.projectId === currentProject.id) loadTasks(currentProject.id);
        });
        return () => {
            removeCreated();
            removeUpdated();
        };
    }, [currentProject]);

    const loadTasks = async (projectId: string) => {
        const list = await window.ipcRenderer.invoke('rpa:task:list', projectId) as RPATask[];
        setTasks([...list].sort((a, b) => b.updatedAt - a.updatedAt));
        setDisplayedCount(TASK_LIST_PAGE_SIZE);
    };

    const handleRenameTask = (task: RPATask) => {
        if (!currentProject) return;
        setEditingTaskId(task.id);
        setEditValue(task.title);
    };

    useEffect(() => {
        if (editingTaskId && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [editingTaskId]);

    const handleRenameConfirm = async () => {
        if (!currentProject || !editingTaskId) return;
        const task = tasks.find(t => t.id === editingTaskId);
        const newTitle = editValue.trim();
        setEditingTaskId(null);
        setEditValue('');
        if (!task || newTitle === task.title || !newTitle) return;
        await window.ipcRenderer.invoke('rpa:task:update', currentProject.id, task.id, { title: newTitle });
        loadTasks(currentProject.id);
    };

    const handleDeleteTask = async (task: RPATask) => {
        if (!currentProject) return;
        if (!confirm(`${t('delete')} "${task.title}"?`)) return;
        const remaining = tasks.filter(t => t.id !== task.id);
        const wasCurrent = currentTaskId === task.id;
        const result = await window.ipcRenderer.invoke('rpa:task:delete', currentProject.id, task.id) as { success: boolean };
        if (result.success) {
            await loadTasks(currentProject.id);
            if (wasCurrent && remaining.length > 0) {
                const latest = remaining.sort((a, b) => b.updatedAt - a.updatedAt)[0];
                onSelectTask(latest.id);
            }
        }
    };

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.shiftKey && (e.ctrlKey || e.metaKey)) && e.key === 'T') {
                e.preventDefault();
                onToggleHide();
            }
        };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onToggleHide]);

    if (isHidden) return null;

    return (
        <div className="w-64 bg-white dark:bg-zinc-900 border-r border-stone-200 dark:border-zinc-800 flex flex-col transition-all duration-300 overflow-hidden h-full">
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
            <div className="flex-1 overflow-y-auto p-2 min-h-0 task-list-scroll">
                {!currentProject ? (
                    <div className="text-center py-8 text-sm text-stone-400 dark:text-zinc-500">
                        {t('loading')}
                    </div>
                ) : tasks.length === 0 ? (
                    <div className="text-center py-8 text-sm text-stone-400 dark:text-zinc-500">
                        {t('noTasks')}
                    </div>
                ) : (() => {
                    const visibleTasks = tasks.slice(0, displayedCount);
                    const now = Date.now();
                    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
                    const within7 = visibleTasks.filter(t => t.updatedAt >= now - sevenDaysMs);
                    const olderTasks = visibleTasks.filter(t => t.updatedAt < now - sevenDaysMs);

                    const renderTask = (task: RPATask) => (
                        <div
                            key={task.id}
                            className={`group relative w-full text-left p-2 rounded-lg transition-colors border ${
                                currentTaskId === task.id
                                    ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/30'
                                    : 'bg-stone-50 dark:bg-zinc-800 border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700'
                            }`}
                        >
                            <button onClick={() => onSelectTask(task.id)} className="w-full text-left pr-10">
                                <div className="flex items-start gap-2">
                                    <div className="mt-0.5 flex items-center justify-center w-5 h-5 shrink-0">
                                        {task.status === 'completed' ? (
                                            <CircleCheckBig size={18} className="text-green-500 dark:text-green-400" />
                                        ) : task.status === 'failed' ? (
                                            <XCircle size={18} className="text-red-500 dark:text-red-400" />
                                        ) : currentTaskId === task.id && isProcessing ? (
                                            <Loader2 size={18} className="text-amber-500 animate-spin" />
                                        ) : (
                                            <Circle size={18} className="text-stone-300 dark:text-zinc-500" strokeWidth={2} />
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
                                                    if (e.key === 'Escape') { setEditingTaskId(null); setEditValue(''); }
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-full px-1 py-0.5 text-xs font-medium bg-white dark:bg-zinc-900 border border-orange-500 rounded focus:outline-none focus:ring-1 focus:ring-orange-500 text-stone-700 dark:text-zinc-300"
                                            />
                                        ) : (
                                            <div
                                                onDoubleClick={(e) => { e.stopPropagation(); handleRenameTask(task); }}
                                                className="text-xs font-medium truncate text-stone-700 dark:text-zinc-300"
                                            >
                                                {decodeDisplayText(task.title)}
                                            </div>
                                        )}
                                        <div className="text-[9px] mt-0.5 text-stone-400 dark:text-zinc-500">
                                            {new Date(task.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                </div>
                            </button>
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10">
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteTask(task); }}
                                    className={`p-1.5 text-stone-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded ${currentTaskId === task.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                    title={t('delete')}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        </div>
                    );

                    return (
                        <div className="space-y-2">
                            {within7.length > 0 && (
                                <>
                                    <div className="text-xs font-medium text-stone-400 dark:text-zinc-500 px-2 py-1">
                                        {t('withinSevenDays')}
                                    </div>
                                    {within7.map(renderTask)}
                                </>
                            )}
                            {olderTasks.length > 0 && (
                                <>
                                    <div className="text-xs font-medium text-stone-400 dark:text-zinc-500 px-2 py-1">
                                        {t('older')}
                                    </div>
                                    {olderTasks.map(renderTask)}
                                </>
                            )}
                            {tasks.length > displayedCount && (
                                <button
                                    type="button"
                                    onClick={() => setDisplayedCount(c => c + TASK_LIST_PAGE_SIZE)}
                                    className="w-full py-2 text-center text-xs text-stone-500 dark:text-zinc-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors"
                                >
                                    {t('taskListMore')}
                                </button>
                            )}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}
