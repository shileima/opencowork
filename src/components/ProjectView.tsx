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

export type SendMessageResult = { ok: true } | { ok: false; busy?: boolean };

interface ProjectViewProps {
    history: Anthropic.MessageParam[];
    onSendMessage: (message: string | { content: string; images: string[] }) => void | Promise<SendMessageResult>;
    onAbort: () => void;
    isProcessing: boolean;
    isDeploying?: boolean;
    onOpenSettings: () => void;
    isTaskPanelHidden: boolean;
    onToggleTaskPanel: () => void;
    isExplorerPanelHidden: boolean;
    onToggleExplorerPanel: () => void;
    isNarrowWindow?: boolean;
    /** App 已加载的当前项目，用于尽早渲染资源管理器，不等 ProjectView 自身 loadCurrentProject 完成 */
    appCurrentProject?: Project | null;
    /** 注册预览处理函数，供父组件（App.tsx 预览按钮）调用 */
    onRegisterPreviewHandler?: (handler: () => void) => void;
    /** 注册部署处理函数，供父组件（App.tsx 部署按钮）调用 */
    onRegisterDeployHandler?: (handler: () => void) => void;
    /** 部署状态变更回调，供父组件更新按钮样式 */
    onDeployStatusChange?: (status: 'idle' | 'deploying' | 'success' | 'error') => void;
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

/** 自动发给助手的日志不宜过长，保留末尾（通常含 TS/构建报错） */
const MAX_QUALITY_LOG_CHARS_FOR_AI = 28000;
/** 构建失败后：助手修复 → 再跑构建，最多轮次（含首轮失败后的每一轮「发消息 + 再构建」） */
const MAX_BUILD_FIX_ROUNDS = 10;
function truncateQualityLogForAiPrompt(raw: string, maxChars: number): string {
    const s = raw || '';
    if (s.length <= maxChars) return s;
    return `【已截断：仅保留末尾 ${maxChars} 字符，完整输出见对话中上一条「代码质量检查」代码块】\n\n${s.slice(-maxChars)}`;
}

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
    isNarrowWindow = false,
    appCurrentProject,
    onRegisterPreviewHandler,
    onRegisterDeployHandler,
    onDeployStatusChange,
}: ProjectViewProps) {
    const { t } = useI18n();
    const { showToast } = useToast();
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
    const [processingTaskId, setProcessingTaskId] = useState<string | null>(null);
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
        closeBrowserTab?: () => void;
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
    const isExplorerPanelHiddenRef = useRef(isExplorerPanelHidden);
    const onToggleExplorerPanelRef = useRef(onToggleExplorerPanel);
    const explorerAutoHiddenByBrowserRef = useRef(false);
    currentTaskIdRef.current = currentTaskId;
    currentProjectRef.current = currentProject;
    historyRef.current = history;
    multiTabEditorRefRef.current = multiTabEditorRef;
    isExplorerPanelHiddenRef.current = isExplorerPanelHidden;
    onToggleExplorerPanelRef.current = onToggleExplorerPanel;

    // 用 App 的 currentProject 尽早驱动渲染；删除项目后 App 置为 null 时也同步清空，避免资源管理器仍显示已删项目
    const prevAppProjectIdRef = useRef<string | null>(null);
    useEffect(() => {
        setCurrentProject(appCurrentProject ?? null);
        const nextId = appCurrentProject?.id ?? null;
        // 仅当从 A 项目切换到 B 项目时重新加载任务列表并拉取该项目的聊天历史，避免切换项目后历史不加载
        if (prevAppProjectIdRef.current !== null && prevAppProjectIdRef.current !== nextId) {
            loadCurrentProject();
        }
        prevAppProjectIdRef.current = nextId;
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
        // 同时自动收起右侧资源管理器，让浏览器预览获得更多空间
        const removeBrowserPreviewListener = window.ipcRenderer.on('agent:open-browser-preview', (_event, ...args) => {
            const url = args[0] as string;
            console.log('[Preview:Debug] ProjectView received agent:open-browser-preview, url:', url, 'multiTabEditorRef:', !!multiTabEditorRefRef.current);
            multiTabEditorRefRef.current?.openBrowserTab?.(url);
            if (!isExplorerPanelHiddenRef.current) {
                onToggleExplorerPanelRef.current();
                explorerAutoHiddenByBrowserRef.current = true;
            }
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
            setProcessingTaskId(null);
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
            if (payload?.skipBrowserRefresh) {
                // 停止本地服务后：关闭内置浏览器 tab，不刷新
                ref?.closeBrowserTab?.();
            } else {
                // 正常完成：打开/保留浏览器 tab 并刷新
                ref?.openBrowserTab?.();
                ref?.refreshBrowserTab?.();
            }
        });

        // 监听中止和错误事件，清除正在处理的任务 ID
        const removeAbortListener = window.ipcRenderer.on('agent:aborted', () => {
            setProcessingTaskId(null);
        });
        const removeErrorListener = window.ipcRenderer.on('agent:error', () => {
            setProcessingTaskId(null);
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
            removeAbortListener();
            removeErrorListener();
        };
    }, [showToast, t]);

    // 监听任务创建事件，如果是当前项目的任务，自动选中
    // 使用 ref 读取 currentTaskId 避免闭包陈旧，并跳过 handlePreview/handleCreateTask 等已自行切换的场景
    useEffect(() => {
        if (!currentProject) return;

        const removeTaskCreatedListener = window.ipcRenderer.on('project:task:created', async (_event, ...args) => {
            const task = args[0] as ProjectTask;
            if (currentProject && task && task.id) {
                // 使用 ref 获取最新的 currentTaskId，避免闭包陈旧导致误判
                const latestCurrentTaskId = currentTaskIdRef.current;
                // 若已经是当前任务，跳过（handlePreview/handleCreateTask 已在 IPC 返回前调用 setCurrentTaskId）
                if (latestCurrentTaskId === task.id) return;
                // 验证任务是否属于当前项目
                const tasks = await window.ipcRenderer.invoke('project:task:list', currentProject.id) as ProjectTask[];
                const taskExists = tasks.some(t => t.id === task.id);
                if (taskExists && currentTaskIdRef.current !== task.id) {
                    // 自动选中新创建的任务
                    setCurrentTaskId(task.id);
                    await handleSelectTask(task.id);
                }
            }
        });

        return () => {
            removeTaskCreatedListener();
        };
    }, [currentProject]);


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
                // 如果有项目但没有任务，新建一个空任务并加载空对话
                const createResult = await window.ipcRenderer.invoke('project:task:create', project.id, t('newTask')) as { success: boolean; task?: ProjectTask };
                if (createResult.success && createResult.task) {
                    setCurrentTaskId(createResult.task.id);
                } else {
                    setCurrentTaskId(null);
                    window.ipcRenderer.invoke('project:clear-chat').catch(() => {});
                }
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

    const handlePreview = useCallback(async () => {
        console.log('[Preview:Debug] handlePreview called, currentProject:', currentProject?.id, 'isProcessing:', isProcessing);
        if (!currentProject || isProcessing) return;

        // 检查 Agent 是否已就绪，避免竞态条件
        const agentStatus = await window.ipcRenderer.invoke('agent:is-ready') as { ready: boolean };
        if (!agentStatus.ready) {
            window.alert('AI 引擎尚未就绪，请稍候几秒后重试。\n\n如果问题持续，请检查 Settings 中的 API Key 是否已配置。');
            return;
        }

        setStreamingText('');
        setIsLoadingHistory(false);

        const result = await window.ipcRenderer.invoke('project:task:create', currentProject.id, t('preview') || '预览') as { success: boolean; task?: ProjectTask };
        console.log('[Preview:Debug] project:task:create result:', result);
        if (!result.success || !result.task) return;

        setCurrentTaskId(result.task.id);
        setProcessingTaskId(result.task.id);
        setStreamingText('');
        pendingTaskRename = {
            taskId: result.task.id,
            projectId: currentProject.id
        };

        console.log('[Preview:Debug] Sending preview message, taskId:', result.task.id);
        onSendMessage(`预览：
            1. 先在项目目录运行 pnpm install 安装依赖；
            2. 检查当前项目状态并修复错误；
            3. pnpm install 完成后，运行 pnpm dev 启动本地开发服务；
            4. 服务成功启动后，调用 open_browser_preview 打开内置浏览器预览；
            5. 若 open_browser_preview 返回后仍有 Vite 红屏或 esbuild 构建错误，则自动修复代码，修复后 Vite 会热更新。
            全程不要重启开发服务器。
            `);
    }, [currentProject, isProcessing, t, onSendMessage]);

    useEffect(() => {
        if (onRegisterPreviewHandler) {
            onRegisterPreviewHandler(() => {
                void handlePreview();
            });
        }
    }, [onRegisterPreviewHandler, handlePreview]);

    // ─── 部署逻辑 ────────────────────────────────────────────────────────────────
    const deployLogRef = useRef<string>('');
    const qualityLogRef = useRef<string>('');

    const stripAnsi = (text: string): string =>
        text
            .replace(/\x1B\]8;;[^\x1B]*\x1B\\([^\x1B]*)\x1B\]8;;\x1B\\/g, '$1')
            .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');

    const buildDeployLog = (rawLog: string): string => {
        const clean = stripAnsi(rawLog).trimEnd();
        return `**🚀 ${t('deployLogTitle')}**\n\n\`\`\`deploy-log\n${clean}\n\`\`\``;
    };

    const buildQualityLogMd = useCallback((rawLog: string): string => {
        const clean = stripAnsi(rawLog).trimEnd();
        return `**🔍 ${t('codeQualityLogTitle')}**\n\n\`\`\`quality-log\n${clean || '…'}\n\`\`\``;
    }, [t]);

    /** 把部署日志同步到 Agent history，并触发 session:save 持久化 */
    const saveDeployHistory = useCallback((messages: Anthropic.MessageParam[]) => {
        if (messages.length > 0) {
            window.ipcRenderer.invoke('session:save', messages).catch((err: unknown) =>
                console.error('[ProjectView] Failed to save deploy session:', err)
            );
        }
    }, []);

    /** 构建验证：仅跑 pnpm/npm/yarn build；失败后自动多轮「助手修复 → 再构建」直至成功或达上限 */
    const handleCodeQualityCheck = useCallback(async () => {
        if (!currentProject?.path?.trim()) {
            showToast(t('noProjectSelected'), 'error');
            return;
        }
        const projectPath = currentProject.path.trim();
        showToast(t('codeQualityRunning'), 'info');

        const normalizeSendResult = (x: unknown): SendMessageResult => {
            if (x && typeof x === 'object' && 'ok' in x) return x as SendMessageResult;
            return { ok: true };
        };

        const scheduleQueuedQualityAutoFix = (payload: string) => {
            let finished = false;
            const doneUnsub = window.ipcRenderer.on('agent:done', () => {
                if (finished) return;
                finished = true;
                window.clearTimeout(toid);
                doneUnsub();
                void (async () => {
                    const r2 = normalizeSendResult(await onSendMessage(payload));
                    if (r2.ok) {
                        await window.ipcRenderer
                            .invoke('agent:append-assistant', `**→** ${t('codeQualityAutoFixSentAfterQueue')}`)
                            .catch(() => {});
                        const m = (await window.ipcRenderer.invoke('agent:get-history')) as Anthropic.MessageParam[];
                        saveDeployHistory(m);
                        showToast(t('codeQualityAutoFixTriggered'), 'info');
                    } else {
                        showToast(t('codeQualityAutoFixSendFailedToast'), 'error');
                    }
                })();
            });
            const toid = window.setTimeout(() => {
                if (finished) return;
                finished = true;
                doneUnsub();
                showToast(t('codeQualityAutoFixQueueTimeout'), 'error');
            }, 10 * 60 * 1000) as unknown as number;
        };

        /** 流式把 project:quality:log 写入当前最后一条助手消息（先 append 占位或沿用已有） */
        const streamBuildCheck = async (opts: { preambleText?: string } = {}): Promise<{
            success: boolean;
            summary: string;
            log: string;
        }> => {
            qualityLogRef.current = '';
            let rafId: number | null = null;
            const flushLogToChat = () => {
                window.ipcRenderer.invoke('agent:update-last-assistant', buildQualityLogMd(qualityLogRef.current)).catch(() => {});
            };
            const scheduleFlush = () => {
                if (rafId !== null) return;
                rafId = requestAnimationFrame(() => {
                    rafId = null;
                    flushLogToChat();
                });
            };
            if (opts.preambleText) {
                await window.ipcRenderer
                    .invoke('agent:append-assistant', buildQualityLogMd(opts.preambleText))
                    .catch(() => {});
            }
            const unsub = window.ipcRenderer.on('project:quality:log', (_event, ...args) => {
                const chunk = args[0];
                if (typeof chunk === 'string') {
                    qualityLogRef.current += chunk;
                    scheduleFlush();
                }
            });
            try {
                const r = (await window.ipcRenderer.invoke('project:quality-check', projectPath)) as {
                    success: boolean;
                    summary: string;
                    log: string;
                };
                if (rafId !== null) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                qualityLogRef.current = r.log || qualityLogRef.current;
                await window.ipcRenderer.invoke('agent:update-last-assistant', buildQualityLogMd(qualityLogRef.current)).catch(() => {});
                return r;
            } finally {
                unsub();
            }
        };

        try {
            await window.ipcRenderer
                .invoke('agent:append-assistant', buildQualityLogMd(t('codeQualityStarting')))
                .catch(() => {});

            let buildResult = await streamBuildCheck();

            if (buildResult.success) {
                const outcome = `**✅ ${t('codeQualityChatOutcomeSuccess')}**`;
                await window.ipcRenderer.invoke('agent:append-assistant', outcome).catch(() => {});
                const msgsOk = (await window.ipcRenderer.invoke('agent:get-history')) as Anthropic.MessageParam[];
                saveDeployHistory(msgsOk);
                showToast(t('codeQualitySuccess'), 'success');
                return;
            }

            let partBase = '';
            for (let attempt = 1; attempt <= MAX_BUILD_FIX_ROUNDS; attempt++) {
                const logForAi = truncateQualityLogForAiPrompt(buildResult.log, MAX_QUALITY_LOG_CHARS_FOR_AI);
                const roundTag = t('codeQualityFixRound')
                    .replace(/\{a\}/g, String(attempt))
                    .replace(/\{m\}/g, String(MAX_BUILD_FIX_ROUNDS));
                const userPayload = `${t('codeQualityAutoFixPromptIntro')}\n\n**${roundTag}**\n\n\`\`\`build-log\n${logForAi}\n\`\`\``;

                if (attempt === 1) {
                    partBase = `**❌ ${t('codeQualityChatOutcomeFail')}**\n\n${buildResult.summary}\n\n${t('codeQualityFailWhyNoAutoFix')}`;
                    await window.ipcRenderer
                        .invoke('agent:append-assistant', `${partBase}\n\n**→** ${t('codeQualityAutoFixSending')}`)
                        .catch(() => {});
                } else {
                    const hdr = t('codeQualityFixRoundHeader').replace(/\{a\}/g, String(attempt));
                    await window.ipcRenderer
                        .invoke('agent:append-assistant', `**🔧 ${hdr}**\n\n**→** ${t('codeQualityAutoFixSending')}`)
                        .catch(() => {});
                }
                let msgsMid = (await window.ipcRenderer.invoke('agent:get-history')) as Anthropic.MessageParam[];
                saveDeployHistory(msgsMid);

                const sendRes = normalizeSendResult(await onSendMessage(userPayload));
                let arrow: string;
                if (sendRes.ok) {
                    arrow = t('codeQualityAutoFixSentHint');
                    showToast(t('codeQualityAutoFixTriggered'), 'info');
                } else if (sendRes.busy) {
                    arrow = t('codeQualityAutoFixQueuedHint');
                    showToast(t('codeQualityAutoFixQueuedToast'), 'info');
                    scheduleQueuedQualityAutoFix(userPayload);
                } else {
                    arrow = t('codeQualityAutoFixSendFailed');
                    showToast(t('codeQualityAutoFixSendFailedToast'), 'error');
                }

                if (attempt === 1) {
                    await window.ipcRenderer.invoke('agent:update-last-assistant', `${partBase}\n\n**→** ${arrow}`).catch(() => {});
                } else {
                    const hdr = t('codeQualityFixRoundHeader').replace(/\{a\}/g, String(attempt));
                    await window.ipcRenderer
                        .invoke('agent:update-last-assistant', `**🔧 ${hdr}**\n\n**→** ${arrow}`)
                        .catch(() => {});
                }
                msgsMid = (await window.ipcRenderer.invoke('agent:get-history')) as Anthropic.MessageParam[];
                saveDeployHistory(msgsMid);

                if (!sendRes.ok) {
                    break;
                }

                const verifyPreamble = t('codeQualityPostFixVerify')
                    .replace(/\{a\}/g, String(attempt))
                    .replace(/\{m\}/g, String(MAX_BUILD_FIX_ROUNDS));
                buildResult = await streamBuildCheck({ preambleText: verifyPreamble });
                msgsMid = (await window.ipcRenderer.invoke('agent:get-history')) as Anthropic.MessageParam[];
                saveDeployHistory(msgsMid);

                if (buildResult.success) {
                    await window.ipcRenderer
                        .invoke(
                            'agent:append-assistant',
                            `**✅ ${t('codeQualityChatOutcomeSuccess')}**\n\n${t('codeQualityRebuildSuccessAfterRounds').replace(/\{a\}/g, String(attempt))}`
                        )
                        .catch(() => {});
                    saveDeployHistory((await window.ipcRenderer.invoke('agent:get-history')) as Anthropic.MessageParam[]);
                    showToast(t('codeQualitySuccess'), 'success');
                    return;
                }

                if (attempt === MAX_BUILD_FIX_ROUNDS) {
                    const maxMsg = t('codeQualityMaxRoundsReached').replace(/\{m\}/g, String(MAX_BUILD_FIX_ROUNDS));
                    await window.ipcRenderer.invoke('agent:append-assistant', `**❌** ${maxMsg}`).catch(() => {});
                    saveDeployHistory((await window.ipcRenderer.invoke('agent:get-history')) as Anthropic.MessageParam[]);
                    showToast(t('codeQualityFailedToast'), 'error');
                    return;
                }
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const userMsg = /no handler registered/i.test(msg) ? t('codeQualityNoHandler') : msg;
            await window.ipcRenderer
                .invoke('agent:append-assistant', `**❌ ${t('codeQualityCheck')}**\n\n${userMsg}`)
                .catch(() => {});
            const msgs = (await window.ipcRenderer.invoke('agent:get-history').catch(() => [])) as Anthropic.MessageParam[];
            saveDeployHistory(msgs);
            showToast(userMsg, 'error');
        }
    }, [currentProject, t, showToast, buildQualityLogMd, saveDeployHistory, onSendMessage]);

    const handleDeploy = useCallback(async () => {
        if (!currentProject || isProcessing) return;

        onDeployStatusChange?.('deploying');
        deployLogRef.current = '';

        // 创建独立任务（与预览逻辑一致）
        const result = await window.ipcRenderer.invoke('project:task:create', currentProject.id, t('deploy') || '部署') as { success: boolean; task?: ProjectTask };
        if (!result.success || !result.task) {
            onDeployStatusChange?.('error');
            return;
        }

        setCurrentTaskId(result.task.id);
        setProcessingTaskId(result.task.id);
        setStreamingText('');
        setIsLoadingHistory(false);

        // 写入"部署开始"消息到 Agent history（通过主进程），使其可被 session:save 持久化
        const startMsg: Anthropic.MessageParam = { role: 'assistant', content: buildDeployLog(t('deployStarting')) };
        await window.ipcRenderer.invoke('agent:inject-history', [startMsg]).catch(() => {});

        try {
            await window.ipcRenderer.invoke('deploy:start', currentProject.path);
        } catch (err) {
            console.error('[ProjectView] Deploy invoke error:', err);
            onDeployStatusChange?.('error');
        }
    }, [currentProject, isProcessing, t, onDeployStatusChange]);

    useEffect(() => {
        if (onRegisterDeployHandler) {
            onRegisterDeployHandler(() => {
                void handleDeploy();
            });
        }
    }, [onRegisterDeployHandler, handleDeploy]);

    // 监听部署事件，把日志实时更新到 history 并保存 session
    useEffect(() => {
        const removeDeployLog = window.ipcRenderer.on('deploy:log', (_event, ...args) => {
            const chunk = args[0] as string;
            deployLogRef.current += chunk;
            const logContent = buildDeployLog(deployLogRef.current);
            // 直接通知主进程更新 Agent history 中的最后一条 assistant 消息
            window.ipcRenderer.invoke('agent:update-last-assistant', logContent).catch(() => {});
        });

        const removeDeployDone = window.ipcRenderer.on('deploy:done', (_event, ...args) => {
            const url = args[0] as string;
            onDeployStatusChange?.('success');
            const successContent = `**✅ ${t('deploySuccessMessage')}**\n\n[${url}](${url})`;
            window.ipcRenderer.invoke('agent:append-assistant', successContent).then(() => {
                // 部署完成后获取最新 history 并保存
                window.ipcRenderer.invoke('agent:get-history').then((msgs: unknown) => {
                    saveDeployHistory(msgs as Anthropic.MessageParam[]);
                }).catch(() => {});
            }).catch(() => {});
            setTimeout(() => onDeployStatusChange?.('idle'), 3000);
        });

        const removeDeployError = window.ipcRenderer.on('deploy:error', (_event, ...args) => {
            const errMsg = args[0] as string;
            onDeployStatusChange?.('error');
            const cleanErr = stripAnsi(errMsg || 'Unknown error');
            const errorContent = `**❌ ${t('deployFailedMessage')}**\n\n\`\`\`deploy-log\n${cleanErr}\n\`\`\``;
            window.ipcRenderer.invoke('agent:append-assistant', errorContent).then(() => {
                window.ipcRenderer.invoke('agent:get-history').then((msgs: unknown) => {
                    saveDeployHistory(msgs as Anthropic.MessageParam[]);
                }).catch(() => {});
            }).catch(() => {});
            setTimeout(() => onDeployStatusChange?.('idle'), 3000);
        });

        return () => {
            removeDeployLog();
            removeDeployDone();
            removeDeployError();
        };
    }, [t, onDeployStatusChange, saveDeployHistory]);
    // ─────────────────────────────────────────────────────────────────────────────

    // 发送消息；新任务在聊天完成后（agent:done）根据首条用户消息自动重命名
    const handleSendMessageWithRename = useCallback((message: string | { content: string, images: string[] }) => {
        if (currentProject && currentTaskId && history.length === 0 && (!pendingTaskRename || pendingTaskRename.taskId !== currentTaskId)) {
            pendingTaskRename = { taskId: currentTaskId, projectId: currentProject.id };
        }
        if (currentTaskId) {
            setProcessingTaskId(currentTaskId);
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
        const result = await window.ipcRenderer.invoke('fs:write-file', filePath, content, { silent: true }) as { success: boolean; error?: string };
        if (result.success) {
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
        <div className="flex-1 min-h-0 flex flex-col bg-[#FAF8F5] dark:bg-zinc-950">
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
                        {/* 左侧悬停检测区域（仅在侧栏收起且非窄窗口时显示） */}
                        {isTaskPanelHidden && !isNarrowWindow && (
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
                                processingTaskId={processingTaskId}
                                onSelectTask={handleSelectTask}
                                onCreateTask={handleCreateTask}
                            />
                        </div>

                        {/* 中间区域：窄窗口仅聊天，宽窗口聊天 + 编辑器（左右布局，可拖拽调整） */}
                        <div className="flex-1 min-w-0">
                            {isNarrowWindow ? (
                                <div className="flex flex-col h-full min-w-0">
                                    <div className="flex-1 min-h-0 overflow-hidden">
                                        <ChatPanel
                                            history={history}
                                            streamingText={streamingText}
                                            onSendMessage={handleSendMessageWithRename}
                                            onAbort={onAbort}
                                            isProcessing={isProcessing && (processingTaskId == null || processingTaskId === currentTaskId)}
                                            workingDir={currentProject.path}
                                            config={config}
                                            setConfig={setConfig}
                                            lockedProjectName={currentProject.name}
                                            isLoadingHistory={isLoadingHistory}
                                        />
                                    </div>
                                </div>
                            ) : (
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
                                                    isProcessing={isProcessing && (processingTaskId == null || processingTaskId === currentTaskId)}
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
                                            onCodeQualityCheck={handleCodeQualityCheck}
                                            pendingOpenFile={pendingOpenFile}
                                            onConsumePendingOpenFile={() => setPendingOpenFile(null)}
                                            onBrowserTabClose={() => {
                                                if (explorerAutoHiddenByBrowserRef.current) {
                                                    explorerAutoHiddenByBrowserRef.current = false;
                                                    if (isExplorerPanelHiddenRef.current) {
                                                        onToggleExplorerPanelRef.current();
                                                    }
                                                }
                                            }}
                                        />
                                    }
                                    initialRatio={splitRatio}
                                    onRatioChange={async (ratio) => {
                                        setSplitRatio(ratio);
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
                            )}
                        </div>

                        {/* 右侧悬停检测区域（仅在资源管理器收起且非窄窗口时显示） */}
                        {isExplorerPanelHidden && !isNarrowWindow && (
                            <div
                                className="absolute right-0 top-0 bottom-0 w-2 z-50 cursor-pointer"
                                onMouseEnter={handleRightEdgeMouseEnter}
                                onMouseLeave={handleRightEdgeMouseLeave}
                                title="悬停 1 秒展开资源管理器"
                            />
                        )}

                        {/* 区域四：资源管理器（窄窗口下隐藏） */}
                        {!isNarrowWindow && (
                            <div className={`transition-all duration-300 flex flex-col h-full ${isExplorerPanelHidden ? 'w-0 overflow-hidden' : 'w-64'} bg-white dark:bg-zinc-900`}>
                                <FileExplorer
                                    projectPath={currentProject.path}
                                    onOpenFile={handleOpenFile}
                                    onFileDeleted={(path) => multiTabEditorRef?.closeTabByFilePath?.(path)}
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
