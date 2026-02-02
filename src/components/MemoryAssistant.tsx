import { useState, useEffect, useRef } from 'react';
import { Send, BookOpen, FolderOpen, Trash2, RefreshCw, AlertCircle, Clock, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { logger } from '../services/logger';
import { MarkdownRenderer } from './MarkdownRenderer';

interface MemoryMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

interface Memory {
    path: string;
    name: string;
    type: 'global' | 'project';
    content: string;
    size: number;
    modified: Date;
}

interface MemoryAssistantResponse {
    message: string;
    memoryCreated?: boolean;
    memoryContent?: string;
    memoryPath?: string;
    memoryName?: string;
    memoryType?: 'global' | 'project';
    memorySize?: number;
}

export function MemoryAssistant() {
    const { t: _t } = useI18n();
    const [messages, setMessages] = useState<MemoryMessage[]>([]);
    const [input, setInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [memories, setMemories] = useState<Memory[]>([]);
    const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
    const [showMemoryList, setShowMemoryList] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // 初始化欢迎消息
    useEffect(() => {
        setMessages([{
            role: 'assistant',
            content: `# 记忆助手

我是您的记忆管理助手，可以帮您：

### 核心功能

1. **创建记忆**
   - 全局记忆：在所有项目中共享的知识
   - 项目记忆：特定项目的上下文信息

2. **查看记忆**
   - 浏览所有记忆文件
   - 查看记忆详细内容

3. **管理记忆**
   - 删除不需要的记忆
   - 刷新记忆列表

### 示例对话

- "帮我创建一个全局记忆：我喜欢用 TypeScript 写代码"
- "创建一个项目记忆：这个项目使用 React + Vite"
- "显示所有的全局记忆"
- "删除名为 decisions.md 的记忆"

---

**请告诉我您想做什么？**`,
            timestamp: Date.now()
        }]);

        loadMemories();
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    };

    const loadMemories = async () => {
        try {
            setIsProcessing(true);
            const result = await window.ipcRenderer.invoke('memory:list-all-with-content') as Memory[];
            setMemories(result);
            setError(null);
        } catch (err) {
            logger.error('Failed to load memories:', err);
            setError('加载记忆失败');
        } finally {
            setIsProcessing(false);
        }
    };

    const deleteMemory = async (path: string) => {
        if (!confirm('确定要删除这个记忆吗？')) return;

        try {
            await window.ipcRenderer.invoke('memory:delete', path);
            await loadMemories();
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `✅ 已删除记忆：${path.split(/[/\\]/).pop()}`,
                timestamp: Date.now()
            }]);
        } catch (err) {
            setError('删除记忆失败');
        }
    };

    const processUserInput = async (userInput: string) => {
        // 添加用户消息
        const userMessage: MemoryMessage = {
            role: 'user',
            content: userInput,
            timestamp: Date.now()
        };
        setMessages(prev => [...prev, userMessage]);

        setIsProcessing(true);
        setError(null);

        try {
            // 调用记忆助手的处理逻辑
            const response = await window.ipcRenderer.invoke('memory:assistant-process', userInput) as MemoryAssistantResponse;

            // 添加助手回复
            const assistantMessage: MemoryMessage = {
                role: 'assistant',
                content: response.message,
                timestamp: Date.now()
            };
            setMessages(prev => [...prev, assistantMessage]);

            // 如果创建了新记忆，刷新列表
            if (response.memoryCreated) {
                await loadMemories();
            }

            // 如果返回了记忆内容，显示它
            if (response.memoryContent) {
                setSelectedMemory({
                    path: response.memoryPath || '',
                    name: response.memoryName || '',
                    type: response.memoryType || 'global',
                    content: response.memoryContent,
                    size: response.memorySize || 0,
                    modified: new Date()
                });
            }
        } catch (err: any) {
            setError(err.message || '处理失败');
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `❌ 处理失败：${err.message || '未知错误'}`,
                timestamp: Date.now()
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSend = () => {
        if (!input.trim() || isProcessing) return;
        const text = input.trim();
        setInput('');
        processUserInput(text);
    };

    const formatSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatDate = (date: Date): string => {
        return new Date(date).toLocaleString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const globalMemories = memories.filter(m => m.type === 'global');
    const projectMemories = memories.filter(m => m.type === 'project');

    return (
        <div className="flex h-full bg-stone-50 dark:bg-zinc-950">
            {/* 左侧对话区域 */}
            <div className={`flex flex-col ${showMemoryList ? 'flex-1' : 'w-full'} border-r border-stone-200 dark:border-zinc-800`}>
                {/* 头部 */}
                <div className="p-4 border-b border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                                <BookOpen size={20} className="text-white" />
                            </div>
                            <div>
                                <h1 className="text-lg font-semibold text-stone-800 dark:text-zinc-100">记忆助手</h1>
                                <p className="text-xs text-stone-500 dark:text-zinc-400">对话式记忆管理</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowMemoryList(!showMemoryList)}
                            className="p-2 text-stone-500 hover:text-stone-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                            title={showMemoryList ? '隐藏记忆列表' : '显示记忆列表'}
                        >
                            <FolderOpen size={18} />
                        </button>
                    </div>
                </div>

                {/* 消息列表 */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((msg, idx) => (
                        <div
                            key={idx}
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div
                                className={`max-w-[80%] rounded-lg px-4 py-3 ${
                                    msg.role === 'user'
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-white dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 border border-stone-200 dark:border-zinc-700'
                                }`}
                            >
                                {msg.role === 'assistant' ? (
                                    <MarkdownRenderer content={msg.content} />
                                ) : (
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
                                )}
                                <div className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-blue-100' : 'text-stone-400'}`}>
                                    {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            </div>
                        </div>
                    ))}

                    {isProcessing && (
                        <div className="flex justify-start">
                            <div className="bg-white dark:bg-zinc-800 rounded-lg px-4 py-3 border border-stone-200 dark:border-zinc-700">
                                <div className="flex items-center gap-2 text-stone-500 dark:text-zinc-400">
                                    <RefreshCw size={16} className="animate-spin" />
                                    <span className="text-sm">正在处理...</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
                            <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                        </div>
                    )}
                </div>

                {/* 输入框 */}
                <div className="p-4 border-t border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="告诉我您想做什么... (例如：创建一个全局记忆)"
                            disabled={isProcessing}
                            className="flex-1 px-4 py-2.5 bg-stone-100 dark:bg-zinc-800 border-0 rounded-lg text-sm text-stone-800 dark:text-zinc-200 placeholder-stone-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isProcessing}
                            className="px-4 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-stone-300 dark:disabled:bg-zinc-700 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
                        >
                            <Send size={18} />
                        </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {['创建全局记忆', '创建项目记忆', '查看所有记忆', '刷新列表'].map((suggestion) => (
                            <button
                                key={suggestion}
                                onClick={() => setInput(suggestion)}
                                className="text-xs px-3 py-1.5 bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 rounded-full hover:bg-stone-200 dark:hover:bg-zinc-700 transition-colors"
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* 右侧记忆列表 */}
            {showMemoryList && (
                <div className="w-80 flex flex-col bg-white dark:bg-zinc-900 border-l border-stone-200 dark:border-zinc-800">
                    {/* 列表头部 */}
                    <div className="p-4 border-b border-stone-200 dark:border-zinc-800">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm font-semibold text-stone-700 dark:text-zinc-300">记忆文件</h2>
                            <button
                                onClick={loadMemories}
                                disabled={isProcessing}
                                className="p-1.5 text-stone-500 hover:text-stone-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 rounded transition-colors disabled:opacity-50"
                                title="刷新"
                            >
                                <RefreshCw size={14} />
                            </button>
                        </div>

                        {/* 统计 */}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                                <div className="text-xs text-blue-600 dark:text-blue-400">全局记忆</div>
                                <div className="text-lg font-semibold text-blue-700 dark:text-blue-300">{globalMemories.length}</div>
                            </div>
                            <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                                <div className="text-xs text-green-600 dark:text-green-400">项目记忆</div>
                                <div className="text-lg font-semibold text-green-700 dark:text-green-300">{projectMemories.length}</div>
                            </div>
                        </div>
                    </div>

                    {/* 记忆列表 */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {memories.length === 0 ? (
                            <div className="text-center py-8 text-stone-400 dark:text-zinc-600 text-sm">
                                暂无记忆文件
                            </div>
                        ) : (
                            memories.map((memory) => (
                                <div
                                    key={memory.path}
                                    onClick={() => setSelectedMemory(memory)}
                                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                                        selectedMemory?.path === memory.path
                                            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                                            : 'bg-stone-50 dark:bg-zinc-800 border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                                    memory.type === 'global'
                                                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                                        : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                                                }`}>
                                                    {memory.type === 'global' ? '全局' : '项目'}
                                                </span>
                                                <span className="text-xs text-stone-500 dark:text-zinc-400">
                                                    {formatSize(memory.size)}
                                                </span>
                                            </div>
                                            <div className="text-sm font-medium text-stone-700 dark:text-zinc-300 truncate">
                                                {memory.name}
                                            </div>
                                            <div className="text-[10px] text-stone-500 dark:text-zinc-400 mt-1 flex items-center gap-1">
                                                <Clock size={10} />
                                                {formatDate(memory.modified)}
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                deleteMemory(memory.path);
                                            }}
                                            className="p-1 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                            title="删除"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* 选中记忆详情 */}
                    {selectedMemory && (
                        <div className="border-t border-stone-200 dark:border-zinc-800 p-4 max-h-64 overflow-y-auto">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-semibold text-stone-700 dark:text-zinc-300 truncate">
                                    {selectedMemory.name}
                                </h3>
                                <button
                                    onClick={() => setSelectedMemory(null)}
                                    className="p-1 text-stone-500 hover:text-stone-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                            <pre className="text-xs text-stone-600 dark:text-zinc-400 whitespace-pre-wrap font-mono bg-stone-50 dark:bg-zinc-800 p-3 rounded-lg">
                                {selectedMemory.content}
                            </pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
