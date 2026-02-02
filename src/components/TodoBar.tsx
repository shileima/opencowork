import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, Circle, Loader2 } from 'lucide-react';

export interface TodoItem {
    id: string;
    content: string;
    activeForm: string;
    status: 'pending' | 'in_progress' | 'completed';
}

interface TodoBarProps {
    todos: TodoItem[];
    onTodosChange: (todos: TodoItem[]) => void;
    isProcessing: boolean;
}

export function TodoBar({ todos, onTodosChange, isProcessing }: TodoBarProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    // 自动展开当有 todos 时，自动收起当没有 todos 时
    useEffect(() => {
        if (todos.length > 0 && !isExpanded) {
            setIsExpanded(true);
        } else if (todos.length === 0 && isExpanded) {
            setIsExpanded(false);
        }
    }, [todos.length]);

    // 如果没有 todos，不显示
    if (todos.length === 0 && !isProcessing) {
        return null;
    }

    const completedCount = todos.filter(t => t.status === 'completed').length;
    const progress = todos.length > 0 ? (completedCount / todos.length) * 100 : 0;

    return (
        <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-lg shadow-sm overflow-hidden">
            {/* Header - 始终显示 */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-stone-700 dark:text-zinc-200">
                        任务进度
                    </span>
                    <span className="text-[10px] text-stone-500 dark:text-zinc-400">
                        {completedCount}/{todos.length}
                    </span>
                    {/* Mini Progress Bar */}
                    <div className="w-16 h-1 bg-stone-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {isExpanded ? (
                        <ChevronUp size={14} className="text-stone-500 dark:text-zinc-400" />
                    ) : (
                        <ChevronDown size={14} className="text-stone-500 dark:text-zinc-400" />
                    )}
                </div>
            </button>

            {/* Todo List - 展开时显示 */}
            {isExpanded && (
                <div className="px-2 pb-2 max-h-40 overflow-y-auto">
                    {todos.length === 0 ? (
                        isProcessing ? (
                            <div className="text-center py-3 text-stone-400 dark:text-zinc-500 text-xs flex items-center justify-center gap-2">
                                <Loader2 size={12} className="animate-spin" />
                                <span>AI 正在规划任务...</span>
                            </div>
                        ) : null
                    ) : (
                        <div className="space-y-1">
                            {todos.map((todo) => (
                                <div
                                    key={todo.id}
                                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                                        todo.status === 'completed'
                                            ? 'text-stone-400 dark:text-zinc-500'
                                            : todo.status === 'in_progress'
                                            ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/10'
                                            : 'text-stone-600 dark:text-zinc-300'
                                    }`}
                                >
                                    <button
                                        onClick={() => {
                                            const nextStatus: TodoItem['status'] =
                                                todo.status === 'pending' ? 'in_progress' :
                                                todo.status === 'in_progress' ? 'completed' : 'pending';
                                            onTodosChange(todos.map(t => t.id === todo.id ? { ...t, status: nextStatus } : t));
                                        }}
                                        className="flex-shrink-0"
                                    >
                                        {todo.status === 'completed' ? (
                                            <CheckCircle2 size={12} />
                                        ) : todo.status === 'in_progress' ? (
                                            <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                            <Circle size={12} />
                                        )}
                                    </button>
                                    <span className={todo.status === 'completed' ? 'line-through' : ''}>
                                        {todo.content}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
