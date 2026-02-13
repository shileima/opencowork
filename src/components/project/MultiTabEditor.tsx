import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Shell, HatGlasses, Globe } from 'lucide-react';
import { MonacoEditor } from './MonacoEditor';
import { getFileIconConfig } from './fileIcons';
import { TerminalPanel } from './TerminalPanel';
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
    /** 多实例：每个实例对应一个 terminal:create 的 id（兼容旧 tab 无此字段时视为单实例） */
    instanceIds?: string[];
    /** 当前选中的实例 id */
    activeInstanceId?: string;
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
    onRef?: (ref: {
        openEditorTab: (filePath: string, content: string) => void;
        openBrowserTab: (url?: string) => void;
        refreshBrowserTab: () => void;
        closeAllTabs: () => void;
        /** 根据文件路径关闭对应的编辑器 tab（如资源管理器中删除文件时调用） */
        closeTabByFilePath: (filePath: string) => void;
    }) => void;
    /** 待打开文件（ref 未就绪时由父组件暂存，挂载后由此处消费） */
    pendingOpenFile?: { filePath: string; content: string } | null;
    onConsumePendingOpenFile?: () => void;
}

export function MultiTabEditor({ projectPath, agentContent, onFileChange, onFileSave, onRef, pendingOpenFile, onConsumePendingOpenFile }: MultiTabEditorProps) {
    const { t } = useI18n();
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [browserRefreshTrigger, setBrowserRefreshTrigger] = useState(0);
    const tabsRef = useRef<Tab[]>([]);
    const tabScrollContainerRef = useRef<HTMLDivElement>(null);

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
        if (!projectPath || projectPath.trim() === '') {
            console.warn('[MultiTabEditor] Cannot open terminal: projectPath is empty');
            return;
        }
        const tabId = `terminal-${Date.now()}`;
        const newTab: TerminalTab = {
            id: tabId,
            type: 'terminal',
            cwd: projectPath.trim(),
        };
        setTabs([...tabs, newTab]);
        setActiveTabId(newTab.id);
    };

    /** 智能体只保留一个：已有则定位激活并更新内容，否则新建 */
    const openAgentTab = () => {
        const existingAgentTab = tabs.find(tab => tab.type === 'agent') as AgentTab | undefined;
        if (existingAgentTab) {
            setActiveTabId(existingAgentTab.id);
            setTabs(prev =>
                prev.map(tab =>
                    tab.id === existingAgentTab.id && tab.type === 'agent'
                        ? { ...tab, content: agentContent ?? tab.content }
                        : tab
                )
            );
            return;
        }
        const newTab: AgentTab = {
            id: `agent-${Date.now()}`,
            type: 'agent',
            content: agentContent || ''
        };
        setTabs([...tabs, newTab]);
        setActiveTabId(newTab.id);
    };

    /** 打开或切换到浏览器 tab。已有浏览器 tab 时仅切换并可选更新 URL，不关闭其他 tab。 */
    const openBrowserTab = (initialUrl?: string) => {
        const url = initialUrl ?? ''; // 默认为空，避免启动时立即尝试连接
        const existingBrowserTab = tabs.find(tab => tab.type === 'browser') as BrowserTabData | undefined;
        if (existingBrowserTab) {
            setActiveTabId(existingBrowserTab.id);
            // 仅当显式传入 URL 且与当前不同时才更新（如本地启动成功后打开 localhost:3000）
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
        const tabToClose = tabs.find(tab => tab.id === tabId);
        // 如果是终端 tab，确保至少保留一个
        if (tabToClose?.type === 'terminal') {
            const terminalTabs = tabs.filter(tab => tab.type === 'terminal');
            if (terminalTabs.length <= 1) {
                // 如果只剩一个终端 tab，不允许关闭
                return;
            }
        }
        const newTabs = tabs.filter(tab => tab.id !== tabId);
        setTabs(newTabs);
        if (activeTabId === tabId) {
            setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null);
        }
    };

    const closeAllTabs = useCallback(() => {
        setTabs([]);
        setActiveTabId(null);
    }, []);

    /** 根据文件路径关闭对应的编辑器 tab，用于资源管理器删除文件时同步关闭已打开的 tab */
    const closeTabByFilePath = useCallback((filePath: string) => {
        const tab = tabs.find(t => t.type === 'editor' && t.filePath === filePath);
        if (tab) closeTab(tab.id);
    }, [tabs]);

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

    // 暴露 openEditorTab、openBrowserTab、refreshBrowserTab、closeAllTabs、closeTabByFilePath 给父组件；若有待打开文件则打开并消费
    useEffect(() => {
        if (onRef) {
            onRef({ openEditorTab, openBrowserTab, refreshBrowserTab, closeAllTabs, closeTabByFilePath });
        }
        if (pendingOpenFile) {
            openEditorTab(pendingOpenFile.filePath, pendingOpenFile.content);
            onConsumePendingOpenFile?.();
        }
    }, [onRef, closeAllTabs, closeTabByFilePath, pendingOpenFile, onConsumePendingOpenFile]);

    // 激活 tab 时滚动到可视区域最右侧（参考 Cursor）
    useEffect(() => {
        if (!activeTabId) return;
        const raf = requestAnimationFrame(() => {
            const el = tabScrollContainerRef.current?.querySelector(`[data-tab-id="${activeTabId}"]`);
            if (el) {
                el.scrollIntoView({ inline: 'end', block: 'nearest', behavior: 'smooth' });
            }
        });
        return () => cancelAnimationFrame(raf);
    }, [activeTabId, tabs.length]);

    return (
        <div className="flex flex-col h-full bg-stone-50 dark:bg-zinc-900">
            {/* Tab Bar：固定高度，全部关闭 tab 时与打开 tab 时一致 */}
            <div className="flex items-center h-10 shrink-0 border-b border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                <div
                    ref={tabScrollContainerRef}
                    className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto overflow-y-hidden pb-0 scrollbar-hide"
                >
                    {tabs.map(tab => (
                        <div
                            key={tab.id}
                            data-tab-id={tab.id}
                            className={`group flex items-center gap-2 pl-2 pr-2 h-10 text-sm leading-none border-b transition-colors cursor-pointer shrink-0 min-w-[88px] ${
                                activeTabId === tab.id
                                    ? 'border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10'
                                    : 'border-transparent text-stone-600 dark:text-zinc-400 hover:text-stone-800 dark:hover:text-zinc-200'
                            }`}
                            onClick={() => setActiveTabId(tab.id)}
                            role="tab"
                            aria-selected={activeTabId === tab.id}
                        >
                            {tab.type === 'editor' && (() => {
                                const fileName = tab.filePath.split(/[\\/]/).pop() ?? '';
                                const { icon: FileIcon, colorClass } = getFileIconConfig(fileName);
                                return <FileIcon size={12} className={`shrink-0 inline-block align-middle ${colorClass}`} />;
                            })()}
                            {tab.type === 'terminal' && <Shell size={12} className="shrink-0 inline-block align-middle" />}
                            {tab.type === 'agent' && <HatGlasses size={12} className="shrink-0 inline-block align-middle" />}
                            {tab.type === 'browser' && <Globe size={12} className="shrink-0 inline-block align-middle" />}
                            <span className="h-[16px] max-w-[150px] truncate align-middle">
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
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeTab(tab.id);
                                }}
                                disabled={tab.type === 'terminal' && tabs.filter(t => t.type === 'terminal').length <= 1}
                                className={`ml-1 min-w-[18px] h-[18px] p-0 flex items-center justify-center hover:bg-stone-200 dark:hover:bg-zinc-700 rounded transition-opacity shrink-0 opacity-0 group-hover:opacity-100 ${
                                    activeTabId === tab.id
                                        ? tab.type === 'terminal' && tabs.filter(t => t.type === 'terminal').length <= 1
                                            ? '!opacity-30 cursor-not-allowed'
                                            : '!opacity-100'
                                        : ''
                                } ${tab.type === 'terminal' && tabs.filter(t => t.type === 'terminal').length <= 1 ? 'group-hover:!opacity-30 cursor-not-allowed' : ''}`}
                                aria-label={t('close') || '关闭'}
                            >
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>
                {/* 固定右侧：始终可见，不随 tab 滚动 */}
                <div className="flex items-center gap-1 flex-shrink-0 px-2 border-l border-stone-200 dark:border-zinc-800">
                    <button
                        type="button"
                        onClick={() => {
                            const existingTerminalTab = tabs.find(tab => tab.type === 'terminal');
                            if (existingTerminalTab) {
                                setActiveTabId(existingTerminalTab.id);
                            } else {
                                openTerminalTab();
                            }
                        }}
                        className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors"
                        title={t('terminal')}
                        aria-label={t('terminal')}
                    >
                        <Shell size={16} />
                    </button>
                    <button
                        type="button"
                        disabled
                        onClick={openAgentTab}
                        className="p-1.5 text-stone-300 dark:text-zinc-600 cursor-not-allowed opacity-60 rounded transition-colors"
                        title={t('agentComingSoon')}
                        aria-label={t('agentComingSoon')}
                    >
                        <HatGlasses size={16} />
                    </button>
                    <button
                        type="button"
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
            <div className="flex-1 min-h-0 overflow-hidden">
                {!activeTab ? (
                    <div className="h-full flex items-center justify-center text-stone-400 dark:text-zinc-500">
                        <div className="text-center">
                            <p className="text-sm mb-2">{t('noTabsOpen') || '没有打开的标签页'}</p>
                            <p className="text-xs">{t('openFileHint') || '点击文件资源管理器中的文件打开编辑器'}</p>
                        </div>
                    </div>
                ) : activeTab.type === 'editor' ? (
                    <div className="h-full pt-2 bg-[#1e1e1e]">
                        <MonacoEditor
                            filePath={activeTab.filePath}
                            content={activeTab.content}
                            onChange={(content) => handleEditorChange(activeTab.id, content)}
                            onSave={(currentContent) => handleEditorSave(activeTab.id, currentContent)}
                        />
                    </div>
                ) : activeTab.type === 'terminal' ? (
                    <TerminalPanel projectPath={activeTab.cwd} />
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
