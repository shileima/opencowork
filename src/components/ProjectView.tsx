import { useState, useEffect, useRef, useCallback } from 'react';
import { TaskListPanel } from './project/TaskListPanel';
import { ChatPanel } from './project/ChatPanel';
import { MultiTabEditor } from './project/MultiTabEditor';
import { FileExplorer } from './project/FileExplorer';
import { ProjectCreateDialog } from './project/ProjectCreateDialog';
import { ResizableSplitPane } from './project/ResizableSplitPane';
import { UpdateNotification } from './project/UpdateNotification';
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
    /** App 已加载的当前项目，用于尽早渲染资源管理器，不等 ProjectView 自身 loadCurrentProject 完成 */
    appCurrentProject?: Project | null;
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
    onToggleExplorerPanel,
    appCurrentProject
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
    const [resourceUpdateAvailable, setResourceUpdateAvailable] = useState<{
        currentVersion: string;
        latestVersion: string;
        updateSize?: number;
    } | null>(null);
    const [multiTabEditorRef, setMultiTabEditorRef] = useState<{
        openEditorTab: (filePath: string, content: string) => void;
        openBrowserTab?: (url?: string) => void;
        refreshBrowserTab?: () => void;
        closeAllTabs?: () => void;
        closeTabByFilePath?: (filePath: string) => void;
    } | null>(null);
    const [pendingOpenFile, setPendingOpenFile] = useState<{ filePath: string; content: string } | null>(null);
    const multiTabEditorRefRef = useRef<typeof multiTabEditorRef>(null);
    const currentTaskIdRef = useRef<string | null>(null);
    const currentProjectRef = useRef<Project | null>(null);
    const historyRef = useRef<Anthropic.MessageParam[]>([]);
    const defaultTaskTitleRef = useRef(t('newTask'));
    defaultTaskTitleRef.current = t('newTask');
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const hoverRightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    currentTaskIdRef.current = currentTaskId;
    currentProjectRef.current = currentProject;
    historyRef.current = history;
    multiTabEditorRefRef.current = multiTabEditorRef;

    // 用 App 的 currentProject 尽早驱动渲染；删除项目后 App 置为 null 时也同步清空，避免资源管理器仍显示已删项目
    useEffect(() => {
        setCurrentProject(appCurrentProject ?? null);
    }, [appCurrentProject?.id, appCurrentProject?.path]);

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
        console.log('[ProjectView] Component mounted, registering event listeners...');
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
        // 监听资源更新通知
        const removeUpdateListener = window.ipcRenderer.on('resource:update-available', (_event, ...args) => {
            const updateInfo = args[0] as { currentVersion: string; latestVersion: string; updateSize?: number };
            console.log('[ProjectView] Resource update available:', updateInfo);
            setResourceUpdateAvailable({
                currentVersion: updateInfo.currentVersion,
                latestVersion: updateInfo.latestVersion,
                updateSize: updateInfo.updateSize
            });
        });
        // 组件挂载时主动检查一次更新
        window.ipcRenderer.invoke('resource:check-update').then((result: unknown) => {
            const updateInfo = result as { success: boolean; hasUpdate: boolean; currentVersion: string; latestVersion: string; updateSize?: number };
            console.log('[ProjectView] Manual update check result:', updateInfo);
            if (updateInfo && updateInfo.hasUpdate) {
                setResourceUpdateAvailable({
                    currentVersion: updateInfo.currentVersion,
                    latestVersion: updateInfo.latestVersion,
                    updateSize: updateInfo.updateSize
                });
            }
        }).catch((err: unknown) => {
            console.error('[ProjectView] Failed to check for updates:', err);
        });
        // 监听历史更新
        const removeHistoryListener = window.ipcRenderer.on('agent:history-update', async (_event, ...args) => {
            const newHistory = args[0] as Anthropic.MessageParam[];
            setStreamingText('');
            setIsLoadingHistory(false); // 历史加载完成
            // 不在此处清除 pendingTaskRename：用户发送首条消息后 agent:history-update 会立即触发，
            // 若此时清除则 agent:done 时无法根据首条消息重命名。清除逻辑已在 handleSelectTask（切换任务）和 agent:done（重命名完成）中处理。
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

        // 监听项目创建事件：先同步当前项目（保证路径正确），再延迟加载任务列表
        const removeProjectCreatedListener = window.ipcRenderer.on('project:created', async () => {
            const project = await window.ipcRenderer.invoke('project:get-current') as Project | null;
            if (project?.path) setCurrentProject(project);
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

        // 监听 Agent 就绪：启动时若曾因 Agent 未就绪导致 project:task:switch 失败，此处重新执行加载以拉取最新任务历史
        const removeAgentReadyListener = window.ipcRenderer.on('agent:ready', () => {
            loadCurrentProject();
        });

        // 监听对话完成：Project 模式下自动打开内置浏览器并刷新；新任务根据首条用户消息重命名
        const removeAgentDoneListener = window.ipcRenderer.on('agent:done', (_event, ...args) => {
            const payload = args[0] as { taskId?: string; skipBrowserRefresh?: boolean } | undefined;
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
            if (!payload?.skipBrowserRefresh) {
                ref?.refreshBrowserTab?.();
            }
        });

        // 加载当前项目（延迟执行，确保组件已挂载）
        setTimeout(() => {
            loadCurrentProject();
        }, 0);

        return () => {
            removeConfigListener();
            removeStreamListener();
            removeHistoryListener();
            removeAgentReadyListener();
            removeContextSwitchedListener();
            removeProjectSwitchListener();
            removeProjectCreatedListener();
            removeBrowserPreviewListener();
            removeAgentDoneListener();
            removeUpdateListener();
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
            // 仅当 App 未传入当前项目时才清空并弹出创建对话框，避免覆盖 app:init-complete 下发的 project
            if (!appCurrentProject) {
                setCurrentProject(null);
                setShowCreateDialog(true);
            }
            return;
        }

        // 获取当前项目
        let project = await window.ipcRenderer.invoke('project:get-current') as Project | null;
        
        // 如果没有当前项目，选择第一个项目
        if (!project && projects.length > 0) {
            project = projects[0];
            await window.ipcRenderer.invoke('project:open', project.id);
        }
        
        // 确保项目路径已加入授权列表，资源管理器才能加载文件（fs:list-dir 依赖 authorizedFolders）
        if (project) {
            await window.ipcRenderer.invoke('project:ensure-working-dir');
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
                // 用本地 project/latestTask 直接切换，不依赖 currentProject state，避免首屏或 agent:ready 时闭包中 currentProject 仍为 null 导致不加载历史
                setIsLoadingHistory(true);
                const result = await window.ipcRenderer.invoke('project:task:switch', project.id, latestTask.id) as { success?: boolean };
                if (!result?.success) {
                    setIsLoadingHistory(false);
                } else {
                    // 兜底：若 agent:history-update 延迟或未触发，短延迟后关闭「历史加载中」，避免新任务/空历史一直显示「历史会话加载中...」
                    const fallbackTimer = setTimeout(() => {
                        setIsLoadingHistory(false);
                    }, 400);
                    const removeFallback = () => clearTimeout(fallbackTimer);
                    const removeHistoryListener = window.ipcRenderer.on('agent:history-update', () => {
                        removeFallback();
                        removeHistoryListener();
                    });
                    setTimeout(removeFallback, 500);
                }
            } else {
                // 如果有项目但没有任务，清空聊天区域并等待用户点击"新建任务"
                setCurrentTaskId(null);
                window.ipcRenderer.invoke('project:clear-chat').catch(() => {});
            }
        }
    };

    // 监听 activeView 变化，当切换到 Project 模式时加载项目
    useEffect(() => {
        // 这个 effect 会在组件挂载时执行，loadCurrentProject 已经在上面处理了
    }, []);

    const handleCreateProject = async (name: string) => {
        const result = await window.ipcRenderer.invoke('project:create-new', name) as { success: boolean; project?: Project; error?: string };
        if (result.success && result.project) {
            setCurrentProject(result.project);
            setShowCreateDialog(false);
            await loadCurrentProject();
        }
    };

    const handleCreateTask = async () => {
        if (!currentProject) return;
        
        // 先清空当前显示的历史和流式文本，新任务不显示「历史会话加载中」
        setStreamingText('');
        setIsLoadingHistory(false);
        
        // 创建任务（主进程会清空历史并发送 agent:history-update []，无需再调用 handleSelectTask 避免出现加载中）
        const result = await window.ipcRenderer.invoke('project:task:create', currentProject.id, t('newTask')) as { success: boolean; task?: ProjectTask };
        if (result.success && result.task) {
            setCurrentTaskId(result.task.id);
            setStreamingText('');
            pendingTaskRename = {
                taskId: result.task.id,
                projectId: currentProject.id
            };
            // 不调用 handleSelectTask：主进程已在 project:task:create 中设置 currentTaskIdForSession 并下发空历史，直接展示「开始一段对话」
            // 任务列表会在 TaskListPanel 中通过 project:task:created 自动刷新
        }
    };

    // 发送消息；新任务在聊天完成后（agent:done）根据首条用户消息自动重命名
    const handleSendMessageWithRename = useCallback((message: string | { content: string, images: string[] }) => {
        if (currentProject && currentTaskId && history.length === 0 && (!pendingTaskRename || pendingTaskRename.taskId !== currentTaskId)) {
            pendingTaskRename = { taskId: currentTaskId, projectId: currentProject.id };
        }
        onSendMessage(message);
    }, [onSendMessage, currentProject, currentTaskId, history.length]);

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
            } else {
                // ref 未就绪（如 MultiTabEditor 尚未挂载），暂存待打开，由 MultiTabEditor 挂载后消费
                setPendingOpenFile({ filePath, content: result.content });
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
            {/* Resource Update Notification */}
            {resourceUpdateAvailable && (
                <UpdateNotification
                    currentVersion={resourceUpdateAvailable.currentVersion}
                    latestVersion={resourceUpdateAvailable.latestVersion}
                    updateSize={resourceUpdateAvailable.updateSize}
                    onClose={() => setResourceUpdateAvailable(null)}
                />
            )}

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
                <div key={currentProject.id} className="contents">
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
                                        pendingOpenFile={pendingOpenFile}
                                        onConsumePendingOpenFile={() => setPendingOpenFile(null)}
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
                        <div className={`transition-all duration-300 flex flex-col h-full ${isExplorerPanelHidden ? 'w-0 overflow-hidden' : 'w-64'} bg-white dark:bg-zinc-900`}>
                            <FileExplorer
                                projectPath={currentProject.path}
                                onOpenFile={handleOpenFile}
                                onFileDeleted={(path) => multiTabEditorRef?.closeTabByFilePath?.(path)}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
