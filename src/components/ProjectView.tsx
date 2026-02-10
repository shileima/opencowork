import { useState, useEffect, useRef, useCallback } from 'react';
import { TaskListPanel } from './project/TaskListPanel';
import { ChatPanel } from './project/ChatPanel';
import { MultiTabEditor } from './project/MultiTabEditor';
import { FileExplorer } from './project/FileExplorer';
import { ProjectCreateDialog } from './project/ProjectCreateDialog';
import { ResizableSplitPane } from './project/ResizableSplitPane';
import Anthropic from '@anthropic-ai/sdk';
import { useI18n } from '../i18n/I18nContext';
import { useToast } from './Toast';
import type { Project, ProjectTask } from '../../electron/config/ProjectStore';

interface ProjectViewProps {
    history: Anthropic.MessageParam[];
    onSendMessage: (message: string | { content: string, images: string[] }) => void;
    onAbort: () => void;
    isProcessing: boolean;
    isDeploying?: boolean;
    onOpenSettings: () => void;
    isTaskPanelHidden: boolean;
    onToggleTaskPanel: () => void;
    isExplorerPanelHidden: boolean;
    onToggleExplorerPanel: () => void;
}

// 跟踪新任务的第一条消息，用于重命名
let pendingTaskRename: { taskId: string; projectId: string } | null = null;

/** 根据用户输入生成更有寓意的任务名称：取首句/首行、去噪、限制长度 */
const deriveTaskTitleFromMessage = (messageText: string, maxLen = 28): string => {
    if (!messageText || typeof messageText !== 'string') return '';
    let text = messageText;
    // 上下文切换格式：提取 "用户最新请求：" 后的内容作为标题
    const latestRequestMatch = text.match(/用户最新请求[：:]\s*([^\n]+)/);
    if (latestRequestMatch) {
        text = latestRequestMatch[1].trim();
    }
    // 去掉 Markdown 符号，换行统一为空格，合并多余空白
    text = text
        .replace(/[#*_`\[\]()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return '';
    // 取首句（以。！？\n 为界）或整段
    const firstSentence = text.split(/[。！？\n]/)[0]?.trim() || text;
    // 去掉常见口语前缀，让标题更贴近“做什么”
    const trimmed = firstSentence
        .replace(/^(请帮我|帮我|我想|请|能否|可以)?\s*/i, '')
        .trim() || firstSentence;
    return trimmed.slice(0, maxLen).trim() || text.slice(0, maxLen).trim();
};

export function ProjectView({
    history,
    onSendMessage,
    onAbort,
    isProcessing,
    isDeploying = false,
    onOpenSettings: _onOpenSettings,
    isTaskPanelHidden,
    onToggleTaskPanel,
    isExplorerPanelHidden,
    onToggleExplorerPanel
}: ProjectViewProps) {
    const { t } = useI18n();
    const { showToast } = useToast();
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [config, setConfig] = useState<any>(null);
    const [fileContents, setFileContents] = useState<Record<string, string>>({});
    const [splitRatio, setSplitRatio] = useState<number>(50);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [multiTabEditorRef, setMultiTabEditorRef] = useState<{
        openEditorTab: (filePath: string, content: string) => void;
        openBrowserTab?: (url?: string) => void;
        refreshBrowserTab?: () => void;
        closeAllTabs?: () => void;
        closeTabByFilePath?: (filePath: string) => void;
    } | null>(null);
    const multiTabEditorRefRef = useRef<typeof multiTabEditorRef>(null);
    const currentTaskIdRef = useRef<string | null>(null);
    const historyRef = useRef<Anthropic.MessageParam[]>([]);
    const defaultTaskTitleRef = useRef(t('newTask'));
    defaultTaskTitleRef.current = t('newTask');
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const hoverRightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    currentTaskIdRef.current = currentTaskId;
    historyRef.current = history;
    multiTabEditorRefRef.current = multiTabEditorRef;

    // 处理左侧悬停展开侧栏
    const handleLeftEdgeMouseEnter = useCallback(() => {
        if (isTaskPanelHidden) {
            // 清除之前的定时器
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
            }
            // 设置 1 秒后展开侧栏
            hoverTimeoutRef.current = setTimeout(() => {
                onToggleTaskPanel();
            }, 1000);
        }
    }, [isTaskPanelHidden, onToggleTaskPanel]);

    const handleLeftEdgeMouseLeave = useCallback(() => {
        // 清除定时器
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
    }, []);

    // 右侧悬停展开资源管理器
    const handleRightEdgeMouseEnter = useCallback(() => {
        if (isExplorerPanelHidden) {
            if (hoverRightTimeoutRef.current) clearTimeout(hoverRightTimeoutRef.current);
            hoverRightTimeoutRef.current = setTimeout(() => {
                onToggleExplorerPanel();
            }, 1000);
        }
    }, [isExplorerPanelHidden, onToggleExplorerPanel]);

    const handleRightEdgeMouseLeave = useCallback(() => {
        if (hoverRightTimeoutRef.current) {
            clearTimeout(hoverRightTimeoutRef.current);
            hoverRightTimeoutRef.current = null;
        }
    }, []);

    // 清理定时器
    useEffect(() => {
        return () => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
            if (hoverRightTimeoutRef.current) clearTimeout(hoverRightTimeoutRef.current);
        };
    }, []);

    useEffect(() => {
        // 加载配置
        window.ipcRenderer.invoke('config:get-all').then((cfg) => {
            setConfig(cfg as any);
            // 加载分割比例配置
            const ratio = (cfg as any)?.chatEditorSplitRatio ?? 50;
            setSplitRatio(ratio);
        });
        // 监听配置更新
        const removeConfigListener = window.ipcRenderer.on('config:updated', (_event, newConfig) => {
            setConfig(newConfig);
        });
        // 监听流式输出
        const removeStreamListener = window.ipcRenderer.on('agent:stream-token', (_event, ...args) => {
            const token = args[0] as string;
            setStreamingText(prev => prev + token);
        });
        // 监听历史更新
        const removeHistoryListener = window.ipcRenderer.on('agent:history-update', async (_event, ...args) => {
            const newHistory = args[0] as Anthropic.MessageParam[];
            setStreamingText('');
            setIsLoadingHistory(false); // 历史加载完成
            // 如果历史不为空，说明任务已经有消息了，清除待重命名标记
            if (newHistory.length > 0 && pendingTaskRename) {
                pendingTaskRename = null;
            }
            // 保存 session 并关联到当前任务（这样切换任务后能加载对应历史）
            if (newHistory && newHistory.length > 0) {
                const hasRealContent = newHistory.some(msg => {
                    const content = msg.content;
                    if (typeof content === 'string') return content.trim().length > 0;
                    if (Array.isArray(content)) {
                        return content.some((block: any) =>
                            block.type === 'text' ? (block.text || '').trim().length > 0 : true
                        );
                    }
                    return false;
                });
                if (hasRealContent) {
                    window.ipcRenderer.invoke('session:save', newHistory).catch((err: unknown) =>
                        console.error('[ProjectView] Failed to save session:', err)
                    );
                }
            }
        });

        // 监听项目切换事件：清空聊天/流式文本、关闭所有 tab，待任务列表加载后再加载最近一条任务
        const removeProjectSwitchListener = window.ipcRenderer.on('project:switched', () => {
            setStreamingText('');
            multiTabEditorRefRef.current?.closeAllTabs?.();
            loadCurrentProject(); // 内部会加载任务列表，再选中最近一条
        });

        // 监听项目创建事件，自动加载项目并选中新任务
        const removeProjectCreatedListener = window.ipcRenderer.on('project:created', async () => {
            // 延迟加载，确保后端任务创建完成
            setTimeout(async () => {
                await loadCurrentProject();
            }, 300);
        });

        // 监听 Agent 触发打开浏览器预览（本地启动成功后）：已有浏览器 tab 则仅切换到该 tab 并打开 URL，不关闭其他 tab
        const removeBrowserPreviewListener = window.ipcRenderer.on('agent:open-browser-preview', (_event, ...args) => {
            const url = args[0] as string;
            multiTabEditorRefRef.current?.openBrowserTab?.(url);
        });

        const removeContextSwitchedListener = window.ipcRenderer.on('agent:context-switched', async (_event, ...args) => {
            const payload = args[0] as { newSessionId?: string; newTaskId?: string; taskId?: string; projectId?: string };
            showToast(t('contextSwitchedToNewSession'), 'info');
            if (payload?.newTaskId && payload.projectId) {
                pendingTaskRename = {
                    taskId: payload.newTaskId,
                    projectId: payload.projectId
                };
                setCurrentTaskId(payload.newTaskId);
                await window.ipcRenderer.invoke('project:task:switch', payload.projectId, payload.newTaskId);
                const project = await window.ipcRenderer.invoke('project:get-current') as Project | null;
                if (project) setCurrentProject(project);
            }
        });

        // 监听对话完成：Project 模式下自动打开内置浏览器并刷新；新任务根据首条用户消息重命名
        const removeAgentDoneListener = window.ipcRenderer.on('agent:done', (_event, ...args) => {
            const payload = args[0] as { taskId?: string } | undefined;
            if (payload?.taskId && pendingTaskRename && pendingTaskRename.taskId === payload.taskId) {
                const messages = historyRef.current || [];
                const firstUser = messages.find((m) => m.role === 'user');
                const firstContent = firstUser && typeof firstUser.content === 'string'
                    ? firstUser.content
                    : Array.isArray(firstUser?.content)
                        ? (firstUser.content.find((b: any) => b.type === 'text') as any)?.text ?? ''
                        : '';
                const cleanTitle = deriveTaskTitleFromMessage(firstContent) || defaultTaskTitleRef.current;
                window.ipcRenderer.invoke('project:task:update', pendingTaskRename.projectId, pendingTaskRename.taskId, { title: cleanTitle }).catch((err) => {
                    console.error('[ProjectView] Failed to rename task on done:', err);
                });
                pendingTaskRename = null;
            }
            const ref = multiTabEditorRefRef.current;
            ref?.openBrowserTab?.(); // 无参：新建用默认 URL，已有则保留当前 URL
            ref?.refreshBrowserTab?.();
        });

        // 加载当前项目（延迟执行，确保组件已挂载）
        setTimeout(() => {
            loadCurrentProject();
        }, 0);

        return () => {
            removeConfigListener();
            removeStreamListener();
            removeHistoryListener();
            removeContextSwitchedListener();
            removeProjectSwitchListener();
            removeProjectCreatedListener();
            removeBrowserPreviewListener();
            removeAgentDoneListener();
        };
    }, [showToast, t]);

    // 监听任务创建事件，如果是当前项目的任务，自动选中
    useEffect(() => {
        if (!currentProject) return;

        const removeTaskCreatedListener = window.ipcRenderer.on('project:task:created', async (_event, ...args) => {
            const task = args[0] as ProjectTask;
            if (currentProject && task && task.id) {
                // 验证任务是否属于当前项目
                const tasks = await window.ipcRenderer.invoke('project:task:list', currentProject.id) as ProjectTask[];
                const taskExists = tasks.some(t => t.id === task.id);
                if (taskExists && currentTaskId !== task.id) {
                    // 自动选中新创建的任务
                    setCurrentTaskId(task.id);
                    await handleSelectTask(task.id);
                }
            }
        });

        return () => {
            removeTaskCreatedListener();
        };
    }, [currentProject, currentTaskId]);


    const loadCurrentProject = async () => {
        // 先检查是否有项目列表
        const projects = await window.ipcRenderer.invoke('project:list') as Project[];
        
        if (projects.length === 0) {
            // 如果没有项目，显示创建项目对话框
            setCurrentProject(null);
            setShowCreateDialog(true);
            return;
        }

        // 获取当前项目
        let project = await window.ipcRenderer.invoke('project:get-current') as Project | null;
        
        // 如果没有当前项目，选择第一个项目
        if (!project && projects.length > 0) {
            project = projects[0];
            await window.ipcRenderer.invoke('project:open', project.id);
        }
        
        setCurrentProject(project);
        
        if (project) {
            // 获取任务列表，过滤掉 400 错误导致的 failed 任务
            const tasks = (await window.ipcRenderer.invoke('project:task:list', project.id) as ProjectTask[]).filter((t) => t.status !== 'failed');
            if (tasks.length > 0) {
                // 按更新时间排序，最新的在前
                const sortedTasks = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt);
                const latestTask = sortedTasks[0];
                setCurrentTaskId(latestTask.id);
                // 切换到最新任务的聊天
                await handleSelectTask(latestTask.id);
            } else {
                // 如果有项目但没有任务，不显示对话框，等待用户点击"新建任务"
                setCurrentTaskId(null);
            }
        }
    };

    // 监听 activeView 变化，当切换到 Project 模式时加载项目
    useEffect(() => {
        // 这个 effect 会在组件挂载时执行，loadCurrentProject 已经在上面处理了
    }, []);

    const handleCreateProject = async (name: string, projectPath: string) => {
        const result = await window.ipcRenderer.invoke('project:create', { name, path: projectPath }) as { success: boolean; project?: Project; error?: string };
        if (result.success && result.project) {
            setCurrentProject(result.project);
            setShowCreateDialog(false);
            // 创建项目后，加载项目（这会检查任务）
            await loadCurrentProject();
        }
    };

    const handleCreateTask = async () => {
        if (!currentProject) return;
        
        // 先清空当前显示的历史和流式文本
        setStreamingText('');
        setIsLoadingHistory(false); // 新任务不需要加载历史
        
        // 创建任务，使用默认名称"新任务"（会在第一条消息时重命名）
        const result = await window.ipcRenderer.invoke('project:task:create', currentProject.id, t('newTask')) as { success: boolean; task?: ProjectTask };
        if (result.success && result.task) {
            // 设置当前任务ID
            setCurrentTaskId(result.task.id);
            
            // 确保清空流式文本
            setStreamingText('');
            
            // 标记这个任务等待第一条消息来重命名
            pendingTaskRename = {
                taskId: result.task.id,
                projectId: currentProject.id
            };
            
            // 切换到新任务（这会确保历史被清空，因为新任务没有 sessionId）
            await handleSelectTask(result.task.id);
            
            // 任务列表会在 TaskListPanel 中自动刷新（通过 useEffect 监听 project:task:created 事件）
        }
    };

    // 发送消息；新任务在聊天完成后（agent:done）根据首条用户消息自动重命名
    const handleSendMessageWithRename = useCallback((message: string | { content: string, images: string[] }) => {
        onSendMessage(message);
    }, [onSendMessage]);

    const handleSelectTask = async (taskId: string) => {
        if (!currentProject) return;
        
        // 切换任务时，如果不是新任务，清除待重命名标记
        if (pendingTaskRename && pendingTaskRename.taskId !== taskId) {
            pendingTaskRename = null;
        }
        
        // 标记开始加载历史（如果任务有历史记录）
        setIsLoadingHistory(true);
        
        // 切换任务（这会加载对应的 session 历史或清空历史）
        const result = await window.ipcRenderer.invoke('project:task:switch', currentProject.id, taskId) as { success: boolean };
        if (result.success) {
            setCurrentTaskId(taskId);
            setStreamingText(''); // 清空流式文本
            // project:task:switch 已经会处理 session 的加载或清空，这里不需要额外操作
            // 如果历史为空（新任务），立即取消加载状态
            setTimeout(() => {
                if (history.length === 0) {
                    setIsLoadingHistory(false);
                }
            }, 100);
        } else {
            setIsLoadingHistory(false);
        }
    };


    const handleOpenFile = async (filePath: string) => {
        const editorRef = multiTabEditorRefRef.current;
        // 检查是否已加载
        if (fileContents[filePath]) {
            // 触发 MultiTabEditor 打开编辑器标签（与智能体、终端平行）
            if (editorRef) {
                editorRef.openEditorTab(filePath, fileContents[filePath]);
            }
            return;
        }

        // 加载文件内容
        const result = await window.ipcRenderer.invoke('fs:read-file', filePath) as { success: boolean; content?: string; error?: string };
        if (result.success && result.content !== undefined) {
            setFileContents(prev => ({ ...prev, [filePath]: result.content! }));
            // 触发 MultiTabEditor 打开编辑器标签（使用 ref 避免异步后闭包过期）
            const refAfterLoad = multiTabEditorRefRef.current;
            if (refAfterLoad) {
                refAfterLoad.openEditorTab(filePath, result.content);
            }
        }
    };

    const handleFileChange = (filePath: string, content: string) => {
        setFileContents(prev => ({ ...prev, [filePath]: content }));
    };

    const handleFileSave = async (filePath: string, content: string) => {
        const result = await window.ipcRenderer.invoke('fs:write-file', filePath, content) as { success: boolean; error?: string };
        if (result.success) {
            // 更新文件内容
            setFileContents(prev => ({ ...prev, [filePath]: content }));
        }
    };

    // 检查是否需要显示创建项目对话框（当没有项目时）
    useEffect(() => {
        // 只在初始加载时检查，避免重复触发
        const checkProjects = async () => {
            const projects = await window.ipcRenderer.invoke('project:list') as Project[];
            if (projects.length === 0 && !showCreateDialog) {
                // 延迟显示，避免在加载过程中闪烁
                setTimeout(() => {
                    setShowCreateDialog(true);
                }, 100);
            }
        };
        checkProjects();
    }, []); // 只在组件挂载时执行一次

    return (
        <div className="h-full w-full flex flex-col bg-[#FAF8F5] dark:bg-zinc-950">
            {showCreateDialog && (
                <ProjectCreateDialog
                    onClose={() => {
                        if (!currentProject) {
                            // 如果没有项目，返回协作视图
                            window.location.reload();
                        } else {
                            setShowCreateDialog(false);
                        }
                    }}
                    onConfirm={handleCreateProject}
                />
            )}


            {currentProject && (
                <>
                    <div className="flex-1 flex overflow-hidden relative">
                        {/* 左侧悬停检测区域（仅在侧栏收起时显示） */}
                        {isTaskPanelHidden && (
                            <div
                                className="absolute left-0 top-0 bottom-0 w-2 z-50 cursor-pointer"
                                onMouseEnter={handleLeftEdgeMouseEnter}
                                onMouseLeave={handleLeftEdgeMouseLeave}
                                title="悬停 1 秒展开侧栏"
                            />
                        )}
                        
                        {/* 区域一：任务列表 */}
                        <div className={`transition-all duration-300 ${isTaskPanelHidden ? 'w-0 overflow-hidden' : 'w-64'}`}>
                            <TaskListPanel
                                isHidden={isTaskPanelHidden}
                                onToggleHide={onToggleTaskPanel}
                                currentProject={currentProject}
                                currentTaskId={currentTaskId}
                                isProcessing={isProcessing}
                                isDeploying={isDeploying}
                                onSelectTask={handleSelectTask}
                                onCreateTask={handleCreateTask}
                            />
                        </div>

                        {/* 中间区域：聊天 + 编辑器（左右布局，可拖拽调整） */}
                        <div className="flex-1 min-w-0">
                            <ResizableSplitPane
                                leftPanel={
                                    <div className="flex flex-col h-full min-w-0">
                                        {/* 与右侧 tab 栏同高，同款 border-b，使下边线与左侧无缝连接 */}
                                        <div className="h-10 shrink-0 border-b border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" />
                                        <div className="flex-1 min-h-0 overflow-hidden">
                                            <ChatPanel
                                                history={history}
                                                streamingText={streamingText}
                                                onSendMessage={handleSendMessageWithRename}
                                                onAbort={onAbort}
                                                isProcessing={isProcessing}
                                                workingDir={currentProject.path}
                                                config={config}
                                                setConfig={setConfig}
                                                lockedProjectName={currentProject.name}
                                                isLoadingHistory={isLoadingHistory}
                                            />
                                        </div>
                                    </div>
                                }
                                rightPanel={
                                    <MultiTabEditor
                                        projectPath={currentProject.path}
                                        agentContent={streamingText}
                                        onFileChange={handleFileChange}
                                        onFileSave={handleFileSave}
                                        onRef={setMultiTabEditorRef}
                                    />
                                }
                                initialRatio={splitRatio}
                                onRatioChange={async (ratio) => {
                                    setSplitRatio(ratio);
                                    // 保存到配置
                                    try {
                                        await window.ipcRenderer.invoke('config:set-all', {
                                            chatEditorSplitRatio: ratio
                                        });
                                    } catch (error) {
                                        console.error('[ProjectView] Failed to save split ratio:', error);
                                    }
                                }}
                                minSize={20}
                                leftMinSizePx={390}
                                rightMinSizePx={390}
                            />
                        </div>

                        {/* 右侧悬停检测区域（仅在资源管理器收起时显示） */}
                        {isExplorerPanelHidden && (
                            <div
                                className="absolute right-0 top-0 bottom-0 w-2 z-50 cursor-pointer"
                                onMouseEnter={handleRightEdgeMouseEnter}
                                onMouseLeave={handleRightEdgeMouseLeave}
                                title="悬停 1 秒展开资源管理器"
                            />
                        )}

                        {/* 区域四：资源管理器 */}
                        <div className={`transition-all duration-300 ${isExplorerPanelHidden ? 'w-0 overflow-hidden' : 'w-64'}`}>
                            <FileExplorer
                                projectPath={currentProject.path}
                                onOpenFile={handleOpenFile}
                                onFileDeleted={(path) => multiTabEditorRef?.closeTabByFilePath?.(path)}
                            />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
