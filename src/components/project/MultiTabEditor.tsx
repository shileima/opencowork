import { useState, useEffect, useRef } from 'react';
import { X, Code, Terminal as TerminalIcon, Bot, Globe } from 'lucide-react';
import { MonacoEditor } from './MonacoEditor';
import { Terminal } from './Terminal';
import { BrowserTab } from './BrowserTab';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { useI18n } from '../../i18n/I18nContext';

interface EditorTab {
    id: string;
    type: 'editor';
    filePath: string;
    content: string;
    isModified: boolean;
}

interface TerminalTab {
    id: string;
    type: 'terminal';
    cwd: string;
}

interface AgentTab {
    id: string;
    type: 'agent';
    content: string;
}

interface BrowserTabData {
    id: string;
    type: 'browser';
    url: string;
}

type Tab = EditorTab | TerminalTab | AgentTab | BrowserTabData;

interface MultiTabEditorProps {
    projectPath: string | null;
    agentContent?: string;
    onFileChange: (filePath: string, content: string) => void;
    onFileSave: (filePath: string, content: string) => void;
    onRef?: (ref: { openEditorTab: (filePath: string, content: string) => void; openBrowserTab: (url?: string) => void; refreshBrowserTab: () => void }) => void;
}

export function MultiTabEditor({ projectPath, agentContent, onFileChange, onFileSave, onRef }: MultiTabEditorProps) {
    const { t } = useI18n();
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [browserRefreshTrigger, setBrowserRefreshTrigger] = useState(0);
    const tabsRef = useRef<Tab[]>([]);
    
    // 保持 tabsRef 与 tabs 同步
    useEffect(() => {
        tabsRef.current = tabs;
    }, [tabs]);

    const openEditorTab = (filePath: string, content: string) => {
        setTabs(prevTabs => {
            // 检查是否已打开
            const existingTab = prevTabs.find(tab => tab.type === 'editor' && tab.filePath === filePath);
            if (existingTab) {
                // 更新内容（如果不同）
                if (existingTab.type === 'editor' && existingTab.content !== content) {
                    const updatedTabs = prevTabs.map(tab => 
                        tab.id === existingTab.id 
                            ? { ...tab, content, isModified: false } as EditorTab
                            : tab
                    );
                    setActiveTabId(existingTab.id);
                    return updatedTabs;
                }
                setActiveTabId(existingTab.id);
                return prevTabs;
            }

            // 创建新 tab
            const newTab: EditorTab = {
                id: `editor-${Date.now()}`,
                type: 'editor',
                filePath,
                content,
                isModified: false
            };
            setActiveTabId(newTab.id);
            return [...prevTabs, newTab];
        });
    };

    const openTerminalTab = () => {
        if (!projectPath) return;
        const newTab: TerminalTab = {
            id: `terminal-${Date.now()}`,
            type: 'terminal',
            cwd: projectPath
        };
        setTabs([...tabs, newTab]);
        setActiveTabId(newTab.id);
    };

    const openAgentTab = () => {
        const newTab: AgentTab = {
            id: `agent-${Date.now()}`,
            type: 'agent',
            content: agentContent || ''
        };
        setTabs([...tabs, newTab]);
        setActiveTabId(newTab.id);
    };

    const openBrowserTab = (initialUrl?: string) => {
        const url = initialUrl ?? 'http://localhost:3000';
        const existingBrowserTab = tabs.find(tab => tab.type === 'browser') as BrowserTabData | undefined;
        if (existingBrowserTab) {
            setActiveTabId(existingBrowserTab.id);
            // 仅当显式传入 URL 且与当前不同时才更新
            if (initialUrl !== undefined && existingBrowserTab.url !== url) {
                setTabs(prev => prev.map(tab =>
                    tab.id === existingBrowserTab.id && tab.type === 'browser'
                        ? { ...tab, url }
                        : tab
                ));
            }
            return;
        }
        const newTab: BrowserTabData = {
            id: `browser-${Date.now()}`,
            type: 'browser',
            url
        };
        setTabs([...tabs, newTab]);
        setActiveTabId(newTab.id);
    };

    const refreshBrowserTab = () => {
        setBrowserRefreshTrigger(prev => prev + 1);
    };

    const closeTab = (tabId: string) => {
        const newTabs = tabs.filter(tab => tab.id !== tabId);
        setTabs(newTabs);
        if (activeTabId === tabId) {
            setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null);
        }
    };

    const handleEditorChange = (tabId: string, content: string) => {
        setTabs(tabs.map(tab => {
            if (tab.id === tabId && tab.type === 'editor') {
                return { ...tab, content, isModified: true };
            }
            return tab;
        }));
        const tab = tabs.find(t => t.id === tabId);
        if (tab && tab.type === 'editor') {
            onFileChange(tab.filePath, content);
        }
    };

    const handleEditorSave = (tabId: string, contentFromEditor?: string) => {
        const tab = tabs.find(t => t.id === tabId);
        if (tab && tab.type === 'editor') {
            const contentToSave = contentFromEditor ?? tab.content;
            onFileSave(tab.filePath, contentToSave);
            setTabs(prevTabs =>
                prevTabs.map(t => {
                    if (t.id === tabId && t.type === 'editor') {
                        return { ...t, content: contentToSave, isModified: false };
                    }
                    return t;
                })
            );
        }
    };

    const activeTab = tabs.find(tab => tab.id === activeTabId);

    // 监听文件系统变化，自动刷新已打开的文件
    useEffect(() => {
        if (!projectPath) return;

        const removeFileChangedListener = window.ipcRenderer.on('fs:file-changed', async (_event, ...args) => {
            const filePath = args[0] as string;
            if (!filePath || !filePath.startsWith(projectPath || '')) return;

            // 使用 ref 获取最新的 tabs，避免闭包问题
            const currentTabs = tabsRef.current;
            const editorTab = currentTabs.find(tab => tab.type === 'editor' && tab.filePath === filePath) as EditorTab | undefined;
            
            if (editorTab) {
                // 如果文件正在被用户编辑，不自动覆盖（避免丢失用户的修改）
                if (editorTab.isModified) {
                    // 可以选择提示用户或静默跳过
                    console.log(`File ${filePath} has been modified externally but is being edited, skipping auto-reload`);
                    return;
                }

                // 延迟一下，确保文件写入完成
                setTimeout(async () => {
                    try {
                        const result = await window.ipcRenderer.invoke('fs:read-file', filePath) as { success: boolean; content?: string; error?: string };
                        if (result.success && result.content !== undefined) {
                            // 再次检查标签页是否还存在且未被修改
                            const latestTabs = tabsRef.current;
                            const latestTab = latestTabs.find(tab => tab.id === editorTab.id && tab.type === 'editor') as EditorTab | undefined;
                            
                            if (latestTab && !latestTab.isModified) {
                                // 更新标签页内容
                                setTabs(prevTabs =>
                                    prevTabs.map(tab =>
                                        tab.id === editorTab.id && tab.type === 'editor'
                                            ? { ...tab, content: result.content!, isModified: false }
                                            : tab
                                    )
                                );
                                // 更新父组件的文件内容缓存
                                onFileChange(filePath, result.content);
                            }
                        }
                    } catch (error) {
                        console.error(`Failed to reload file ${filePath}:`, error);
                    }
                }, 300);
            }
        });

        return () => {
            removeFileChangedListener();
        };
    }, [projectPath, onFileChange]);

    // 暴露 openEditorTab、openBrowserTab、refreshBrowserTab 给父组件
    useEffect(() => {
        if (onRef) {
            onRef({ openEditorTab, openBrowserTab, refreshBrowserTab });
        }
    }, [onRef]);

    return (
        <div className="flex flex-col h-full bg-stone-50 dark:bg-zinc-900">
            {/* Tab Bar */}
            <div className="flex items-center gap-1 border-b border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 overflow-x-auto">
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        className={`flex items-center gap-2 px-3 py-2 text-sm border-b-2 transition-colors cursor-pointer ${
                            activeTabId === tab.id
                                ? 'border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10'
                                : 'border-transparent text-stone-600 dark:text-zinc-400 hover:text-stone-800 dark:hover:text-zinc-200'
                        }`}
                        onClick={() => setActiveTabId(tab.id)}
                    >
                        {tab.type === 'editor' && <Code size={14} />}
                        {tab.type === 'terminal' && <TerminalIcon size={14} />}
                        {tab.type === 'agent' && <Bot size={14} />}
                        {tab.type === 'browser' && <Globe size={14} />}
                        <span className="max-w-[150px] truncate">
                            {tab.type === 'editor' 
                                ? tab.filePath.split(/[\\/]/).pop() || tab.filePath
                                : tab.type === 'terminal'
                                ? t('terminal')
                                : tab.type === 'agent'
                                ? t('agent')
                                : t('browser')
                            }
                            {tab.type === 'editor' && tab.isModified && ' •'}
                        </span>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                closeTab(tab.id);
                            }}
                            className="ml-1 p-0.5 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded transition-opacity"
                        >
                            <X size={12} />
                        </button>
                    </div>
                ))}
                
                {/* Add Tab Buttons */}
                <div className="flex items-center gap-1 ml-auto px-2">
                    <button
                        onClick={openTerminalTab}
                        className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors"
                        title={t('terminal')}
                    >
                        <TerminalIcon size={16} />
                    </button>
                    <button
                        onClick={openAgentTab}
                        className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors"
                        title={t('agent')}
                    >
                        <Bot size={16} />
                    </button>
                    <button
                        onClick={() => openBrowserTab()}
                        className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors"
                        title={t('browser') || '浏览器'}
                        aria-label={t('browser') || '浏览器'}
                    >
                        <Globe size={16} />
                    </button>
                </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden">
                {!activeTab ? (
                    <div className="h-full flex items-center justify-center text-stone-400 dark:text-zinc-500">
                        <div className="text-center">
                            <p className="text-sm mb-2">{t('noTabsOpen') || '没有打开的标签页'}</p>
                            <p className="text-xs">{t('openFileHint') || '点击文件资源管理器中的文件打开编辑器'}</p>
                        </div>
                    </div>
                ) : activeTab.type === 'editor' ? (
                    <MonacoEditor
                        filePath={activeTab.filePath}
                        content={activeTab.content}
                        onChange={(content) => handleEditorChange(activeTab.id, content)}
                        onSave={(currentContent) => handleEditorSave(activeTab.id, currentContent)}
                    />
                ) : activeTab.type === 'terminal' ? (
                    <Terminal terminalId={activeTab.id} cwd={activeTab.cwd} />
                ) : activeTab.type === 'browser' ? (
                    <BrowserTab initialUrl={activeTab.url} refreshTrigger={browserRefreshTrigger} />
                ) : (
                    <div className="h-full overflow-y-auto p-4">
                        <MarkdownRenderer content={activeTab.content} isDark={true} />
                    </div>
                )}
            </div>
        </div>
    );
}
