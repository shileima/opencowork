import { useState } from 'react';
import { Brain, ChevronDown, ChevronUp, CheckCircle2, Circle, Loader2, Plus, Edit2, Trash2 } from 'lucide-react';

export interface TodoItem {
    id: string;
    content: string;
    activeForm: string;
    status: 'pending' | 'in_progress' | 'completed';
}

interface ThinkingPanelProps {
    thinkingText: string;
    todos: TodoItem[];
    onTodosChange: (todos: TodoItem[]) => void;
    isProcessing: boolean;
}

export function ThinkingPanel({ thinkingText, todos, onTodosChange, isProcessing }: ThinkingPanelProps) {
    const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
    const [isTodosExpanded, setIsTodosExpanded] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');

    const handleUpdateTodo = (id: string, status: TodoItem['status']) => {
        const updated = todos.map(t => t.id === id ? { ...t, status } : t);
        onTodosChange(updated);
    };

    const handleEditTodo = (id: string, content: string) => {
        const updated = todos.map(t => t.id === id ? { ...t, content, activeForm: content.replace(/^(我|请)/, '正在') } : t);
        onTodosChange(updated);
        setEditingId(null);
    };

    const handleAddTodo = () => {
        const newTodo: TodoItem = {
            id: `todo-${Date.now()}`,
            content: '新任务',
            activeForm: '正在执行新任务',
            status: 'pending'
        };
        onTodosChange([...todos, newTodo]);
        setEditingId(newTodo.id);
        setEditText('新任务');
    };

    const handleDeleteTodo = (id: string) => {
        const updated = todos.filter(t => t.id !== id);
        onTodosChange(updated);
    };

    const completedCount = todos.filter(t => t.status === 'completed').length;
    const progress = todos.length > 0 ? (completedCount / todos.length) * 100 : 0;

    return (
        <div className="space-y-3 mb-4">
            {/* Thinking Section */}
            {thinkingText && (
                <div className="bg-stone-50 dark:bg-zinc-800/50 rounded-xl border border-stone-200 dark:border-zinc-700 overflow-hidden">
                    <button
                        onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-stone-100/50 dark:hover:bg-zinc-700/50 transition-colors"
                    >
                        <div className="flex items-center gap-2 text-sm">
                            <Brain size={16} className="text-stone-500 dark:text-zinc-400" />
                            <span className="font-medium text-stone-700 dark:text-zinc-300">
                                AI 思考过程
                            </span>
                            {isProcessing && <Loader2 size={12} className="animate-spin text-stone-400" />}
                        </div>
                        {isThinkingExpanded ? (
                            <ChevronUp size={16} className="text-stone-500 dark:text-zinc-400" />
                        ) : (
                            <ChevronDown size={16} className="text-stone-500 dark:text-zinc-400" />
                        )}
                    </button>
                    {isThinkingExpanded && (
                        <div className="px-4 pb-3">
                            <div className="bg-white dark:bg-black/30 rounded-lg p-3 text-sm text-stone-600 dark:text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed">
                                {thinkingText}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Todo Section */}
            {(todos.length > 0 || isProcessing) && (
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-stone-200 dark:border-zinc-800 overflow-hidden shadow-sm">
                    <button
                        onClick={() => setIsTodosExpanded(!isTodosExpanded)}
                        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors border-b border-stone-200 dark:border-zinc-800"
                    >
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-stone-700 dark:text-zinc-200">
                                任务清单
                            </span>
                            <span className="text-xs text-stone-500 dark:text-zinc-400">
                                {completedCount}/{todos.length} 完成
                            </span>
                            {/* Progress Bar */}
                            <div className="w-20 h-1.5 bg-stone-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddTodo();
                                }}
                                className="p-1 text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                                title="添加任务"
                            >
                                <Plus size={14} />
                            </button>
                            {isTodosExpanded ? (
                                <ChevronUp size={16} className="text-stone-500 dark:text-zinc-400" />
                            ) : (
                                <ChevronDown size={16} className="text-stone-500 dark:text-zinc-400" />
                            )}
                        </div>
                    </button>

                    {isTodosExpanded && (
                        <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
                            {todos.length === 0 ? (
                                <div className="text-center py-6 text-stone-400 dark:text-zinc-500 text-sm">
                                    {isProcessing ? (
                                        <div className="flex items-center justify-center gap-2">
                                            <Loader2 size={14} className="animate-spin" />
                                            <span>AI 正在规划任务...</span>
                                        </div>
                                    ) : (
                                        <span>暂无任务，点击 + 添加新任务</span>
                                    )}
                                </div>
                            ) : (
                                todos.map((todo) => (
                                    <div
                                        key={todo.id}
                                        className={`group flex items-start gap-2 p-2.5 rounded-lg border transition-all ${
                                            todo.status === 'completed'
                                                ? 'bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800/30'
                                                : todo.status === 'in_progress'
                                                ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/30'
                                                : 'bg-stone-50 dark:bg-zinc-800/50 border-stone-200 dark:border-zinc-700'
                                        }`}
                                    >
                                        <button
                                            onClick={() => {
                                                const nextStatus: TodoItem['status'] =
                                                    todo.status === 'pending' ? 'in_progress' :
                                                    todo.status === 'in_progress' ? 'completed' : 'pending';
                                                handleUpdateTodo(todo.id, nextStatus);
                                            }}
                                            className="mt-0.5 flex-shrink-0"
                                        >
                                            {todo.status === 'completed' ? (
                                                <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
                                            ) : todo.status === 'in_progress' ? (
                                                <Loader2 size={16} className="text-blue-600 dark:text-blue-400 animate-spin" />
                                            ) : (
                                                <Circle size={16} className="text-stone-400 dark:text-zinc-500" />
                                            )}
                                        </button>

                                        <div className="flex-1 min-w-0">
                                            {editingId === todo.id ? (
                                                <input
                                                    type="text"
                                                    value={editText}
                                                    onChange={(e) => setEditText(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            handleEditTodo(todo.id, editText);
                                                        } else if (e.key === 'Escape') {
                                                            setEditingId(null);
                                                        }
                                                    }}
                                                    onBlur={() => handleEditTodo(todo.id, editText)}
                                                    className="w-full px-2 py-1 text-sm bg-white dark:bg-zinc-900 border border-blue-300 dark:border-blue-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    autoFocus
                                                />
                                            ) : (
                                                <p
                                                    className={`text-sm break-words ${
                                                        todo.status === 'completed'
                                                            ? 'line-through text-stone-500 dark:text-zinc-500'
                                                            : 'text-stone-700 dark:text-zinc-300'
                                                    }`}
                                                >
                                                    {todo.content}
                                                </p>
                                            )}
                                            {todo.status === 'in_progress' && (
                                                <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                                                    {todo.activeForm}
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => {
                                                    setEditingId(todo.id);
                                                    setEditText(todo.content);
                                                }}
                                                className="p-1 text-stone-400 hover:text-blue-600 rounded transition-colors"
                                                title="编辑"
                                            >
                                                <Edit2 size={12} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteTodo(todo.id)}
                                                className="p-1 text-stone-400 hover:text-red-600 rounded transition-colors"
                                                title="删除"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
