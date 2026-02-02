import { useState, useEffect, useRef, useCallback } from 'react';
import { TaskListPanel } from './project/TaskListPanel';
import { ChatPanel } from './project/ChatPanel';
import { MultiTabEditor } from './project/MultiTabEditor';
import { FileExplorer } from './project/FileExplorer';
import { ProjectCreateDialog } from './project/ProjectCreateDialog';
import Anthropic from '@anthropic-ai/sdk';
import { useI18n } from '../i18n/I18nContext';
import type { Project, ProjectTask } from '../../electron/config/ProjectStore';

interface ProjectViewProps {
    history: Anthropic.MessageParam[];
    onSendMessage: (message: string | { content: string, images: string[] }) => void;
    onAbort: () => void;
    isProcessing: boolean;
    onOpenSettings: () => void;
    isTaskPanelHidden: boolean;
    onToggleTaskPanel: () => void;
}

// 跟踪新任务的第一条消息，用于重命名
let pendingTaskRename: { taskId: string; projectId: string } | null = null;

export function ProjectView({
    history,
    onSendMessage,
    onAbort,
    isProcessing,
    onOpenSettings: _onOpenSettings,
    isTaskPanelHidden,
    onToggleTaskPanel
}: ProjectViewProps) {
    const { t } = useI18n();
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [config, setConfig] = useState<any>(null);
    const [fileContents, setFileContents] = useState<Record<string, string>>({});
    const [multiTabEditorRef, setMultiTabEditorRef] = useState<{
        openEditorTab: (filePath: string, content: string) => void;
        openBrowserTab?: (url?: string) => void;
        refreshBrowserTab?: () => void;
    } | null>(null);
    const multiTabEditorRefRef = useRef<typeof multiTabEditorRef>(null);
    const currentTaskIdRef = useRef<string | null>(null);
    currentTaskIdRef.current = currentTaskId;
    multiTabEditorRefRef.current = multiTabEditorRef;

    useEffect(() => {
        // 加载配置
        window.ipcRenderer.invoke('config:get-all').then((cfg) => {
            setConfig(cfg as any);
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

        // 监听项目切换事件
        const removeProjectSwitchListener = window.ipcRenderer.on('project:switched', () => {
            loadCurrentProject();
        });

        // 监听 Agent 触发打开浏览器预览（启动 dev 服务器后自动打开）
        const removeBrowserPreviewListener = window.ipcRenderer.on('agent:open-browser-preview', (_event, ...args) => {
            const url = args[0] as string;
            multiTabEditorRefRef.current?.openBrowserTab?.(url);
        });

        // 监听对话完成：Project 模式下自动打开内置浏览器并刷新（不改变已有 Tab 的 URL）
        const removeAgentDoneListener = window.ipcRenderer.on('agent:done', () => {
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
            removeProjectSwitchListener();
            removeBrowserPreviewListener();
            removeAgentDoneListener();
        };
    }, []);


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
            // 获取任务列表
            const tasks = await window.ipcRenderer.invoke('project:task:list', project.id) as ProjectTask[];
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

    // 包装 onSendMessage：发送第一条消息时用消息内容重命名任务（用 ref 避免闭包导致 currentTaskId 陈旧）
    const handleSendMessageWithRename = useCallback(async (message: string | { content: string, images: string[] }) => {
        const taskIdNow = currentTaskIdRef.current;
        const shouldRename = pendingTaskRename && currentProject && taskIdNow === pendingTaskRename.taskId;
        if (shouldRename && pendingTaskRename) {
            const toRename = pendingTaskRename;
            pendingTaskRename = null;
            const messageText = typeof message === 'string' ? message : message.content;
            const cleanText = (messageText || '').replace(/[#*_`\[\]()]/g, '').trim().slice(0, 50) || t('newTask');
            try {
                await window.ipcRenderer.invoke('project:task:update', toRename.projectId, toRename.taskId, { title: cleanText });
            } catch (error) {
                console.error('Failed to rename task:', error);
                pendingTaskRename = toRename;
            }
        }
        onSendMessage(message);
    }, [currentProject, onSendMessage, t]);

    const handleSelectTask = async (taskId: string) => {
        if (!currentProject) return;
        
        // 切换任务时，如果不是新任务，清除待重命名标记
        if (pendingTaskRename && pendingTaskRename.taskId !== taskId) {
            pendingTaskRename = null;
        }
        
        // 切换任务（这会加载对应的 session 历史或清空历史）
        const result = await window.ipcRenderer.invoke('project:task:switch', currentProject.id, taskId) as { success: boolean };
        if (result.success) {
            setCurrentTaskId(taskId);
            setStreamingText(''); // 清空流式文本
            // project:task:switch 已经会处理 session 的加载或清空，这里不需要额外操作
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
                    <div className="flex-1 flex overflow-hidden">
                        {/* 区域一：任务列表 */}
                        <div className={`transition-all duration-300 ${isTaskPanelHidden ? 'w-0 overflow-hidden' : 'w-64'}`}>
                            <TaskListPanel
                                isHidden={isTaskPanelHidden}
                                onToggleHide={onToggleTaskPanel}
                                currentProject={currentProject}
                                currentTaskId={currentTaskId}
                                isProcessing={isProcessing}
                                onSelectTask={handleSelectTask}
                                onCreateTask={handleCreateTask}
                            />
                        </div>

                        {/* 中间区域：聊天 + 编辑器（左右布局） */}
                        <div className="flex-1 flex flex-row min-w-0">
                            {/* 区域二：聊天交互（左侧） */}
                            <div className="w-1/2 border-r border-stone-200 dark:border-zinc-800 flex flex-col min-w-0">
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
                            />
                            </div>

                            {/* 区域三：多Tab编辑器（右侧） */}
                            <div className="flex-1 min-w-0">
                                <MultiTabEditor
                                    projectPath={currentProject.path}
                                    agentContent={streamingText}
                                    onFileChange={handleFileChange}
                                    onFileSave={handleFileSave}
                                    onRef={setMultiTabEditorRef}
                                />
                            </div>
                        </div>

                        {/* 区域四：资源管理器 */}
                        <FileExplorer
                            projectPath={currentProject.path}
                            onOpenFile={handleOpenFile}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
