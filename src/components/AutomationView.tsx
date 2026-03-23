import { useState, useEffect, useRef, useCallback } from 'react';
import { RPATaskListPanel } from './project/RPATaskListPanel';
import { ChatPanel } from './project/ChatPanel';
import { ResizableSplitPane } from './project/ResizableSplitPane';
import { MonacoEditor } from './project/MonacoEditor';
import { Play, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, ChevronUp, Image as ImageIcon, X } from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import { useI18n } from '../i18n/I18nContext';
import type { TranslationKey } from '../i18n/translations';
import { useToast } from './Toast';
import type { RPAProject, RPATask } from '../../electron/config/RPAProjectStore';

/** 单次执行的一条步骤输出 */
export interface RPARunStep {
    text: string;
    stream: 'stdout' | 'stderr';
    time: number;
}

/** 一次脚本执行的运行记录（任务卡片） */
export interface RPAExecutionRun {
    runId: string;
    scriptName: string;
    status: 'running' | 'completed' | 'failed';
    steps: RPARunStep[];
    /** 从 stdout 中解析出的截图路径（如 SCREENSHOT: path 或 .png/.jpg 路径） */
    screenshotPaths: string[];
    stdout: string;
    stderr: string;
    error?: string;
    startTime: number;
    endTime?: number;
}

interface AutomationViewProps {
    history: Anthropic.MessageParam[];
    onSendMessage: (message: string | { content: string; images: string[] }) => void | Promise<{ ok: true } | { ok: false; busy?: boolean }>;
    onAbort: () => void;
    isProcessing: boolean;
    isTaskPanelHidden: boolean;
    onToggleTaskPanel: () => void;
    isNarrowWindow?: boolean;
    onExecutingChange?: (executing: boolean) => void;
}

const deriveTaskTitleFromMessage = (text: string, maxLen = 28): string => {
    if (!text || typeof text !== 'string') return '';
    let s = text.replace(/[#*_`\[\]()]/g, '').replace(/\s+/g, ' ').trim();
    const first = s.split(/[。！？\n]/)[0]?.trim() || s;
    return first.slice(0, maxLen).trim() || s.slice(0, maxLen).trim();
};

/** 自动化脚本编辑器单个 Tab */
interface AutomationScriptTab {
    id: string;
    filePath: string;
    content: string;
    isModified: boolean;
}

/** 将字节数格式化为可读大小，如 12k、1.5k、500 B */
function formatScriptSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) {
        const k = bytes / 1024;
        return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
    }
    const m = bytes / (1024 * 1024);
    return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
}

/** 从 stdout 文本中解析截图路径：SCREENSHOT: path 或 含 .png/.jpg 的绝对/相对路径 */
function parseScreenshotPathsFromStdout(stdout: string, projectPath?: string): string[] {
    const paths: string[] = [];
    const seen = new Set<string>();
    const lineRe = /SCREENSHOT:\s*([^\s\n]+)/gi;
    const pathRe = /(\S+\.(?:png|jpg|jpeg|webp))/gi;
    let m;
    while ((m = lineRe.exec(stdout)) !== null) {
        const p = m[1].trim();
        if (p && !seen.has(p)) {
            seen.add(p);
            paths.push(p);
        }
    }
    while ((m = pathRe.exec(stdout)) !== null) {
        const p = m[1].trim();
        if (p && !seen.has(p) && (p.startsWith('/') || (projectPath && p.startsWith(projectPath)))) {
            seen.add(p);
            paths.push(p);
        }
    }
    return paths;
}

/** 单次执行的任务卡片：步骤输出、进度、截图 */
function ExecutionRunCard({
    run,
    t,
    isPanelExpanded
}: {
    run: RPAExecutionRun;
    projectPath?: string;
    t: (key: TranslationKey) => string;
    /** 执行输出面板是否铺满展开，用于放宽步骤输出区域高度以展示更多 */
    isPanelExpanded?: boolean;
}) {
    const [expanded, setExpanded] = useState(true);
    const [screenshotDataUrls, setScreenshotDataUrls] = useState<Record<string, string>>({});

    useEffect(() => {
        if (run.screenshotPaths.length === 0) return;
        run.screenshotPaths.forEach((p) => {
            if (screenshotDataUrls[p]) return;
            window.ipcRenderer.invoke('fs:read-image-data-url', p).then((result: unknown) => {
                const res = result as { success: boolean; dataUrl?: string };
                if (res.success && res.dataUrl) {
                    setScreenshotDataUrls(prev => ({ ...prev, [p]: res.dataUrl! }));
                }
            }).catch(() => {});
        });
    }, [run.screenshotPaths.join(',')]);

    const statusIcon = run.status === 'running' ? (
        <Loader2 size={14} className="animate-spin text-amber-400" />
    ) : run.status === 'completed' ? (
        <CheckCircle2 size={14} className="text-green-400" />
    ) : (
        <XCircle size={14} className="text-red-400" />
    );
    const progressText = run.status === 'running'
        ? (t('running') || '运行中') + ` · ${run.steps.length} ${t('stepOutputLines') || '条输出'}`
        : `${run.steps.length} ${t('stepOutputLines') || '条输出'}` + (run.endTime ? ` · ${((run.endTime - run.startTime) / 1000).toFixed(1)}s` : '');

    return (
        <div className="rounded-lg border border-stone-600 bg-stone-800/80 overflow-hidden">
            <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs text-stone-300 hover:bg-stone-700/50"
            >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {statusIcon}
                <span className="truncate flex-1">{run.scriptName}</span>
                <span className="text-stone-500 shrink-0">{progressText}</span>
            </button>
            {expanded && (
                <div className="px-2 pb-2 space-y-2 border-t border-stone-700">
                    {/* 两条消息：1) 步骤输出 2) 进度与截图 */}
                    <div className="text-[11px] text-stone-400 mt-1">
                        <div className="font-medium text-stone-500 mb-1">{t('stepOutput') || '步骤输出'}</div>
                        <div className={`overflow-y-auto bg-black/30 rounded p-1.5 font-mono whitespace-pre-wrap break-all ${isPanelExpanded ? 'max-h-[40vh]' : 'max-h-24'}`}>
                            {run.steps.length === 0 && run.stdout === '' && run.stderr === ''
                                ? (run.status === 'running' ? (t('waitingOutput') || '等待输出...') : (run.error || '—'))
                                : run.steps.length > 0
                                    ? run.steps.map((s, i) => (
                                        <div key={i} className={s.stream === 'stderr' ? 'text-red-400/90' : 'text-stone-300'}>
                                            {s.text}
                                        </div>
                                    ))
                                    : (run.stderr || run.stdout || run.error || '—')}
                        </div>
                    </div>
                    <div className="text-[11px] text-stone-400">
                        <div className="font-medium text-stone-500 mb-1">{t('progress') || '进度'}</div>
                        <div className="text-stone-400">{progressText}</div>
                        {run.error && run.status === 'failed' && (
                            <div className="text-red-400/90 mt-1">{run.error}</div>
                        )}
                    </div>
                    {run.screenshotPaths.length > 0 && (
                        <div className="text-[11px]">
                            <div className="font-medium text-stone-500 mb-1 flex items-center gap-1">
                                <ImageIcon size={12} />
                                {t('screenshots') || '截图'}
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {run.screenshotPaths.map((p) => (
                                    <div key={p} className="rounded overflow-hidden border border-stone-600 bg-black/30">
                                        {screenshotDataUrls[p] ? (
                                            <img src={screenshotDataUrls[p]} alt="" className="h-20 w-auto max-w-[160px] object-contain" />
                                        ) : (
                                            <div className="h-20 w-[120px] flex items-center justify-center text-stone-500 text-[10px] truncate px-1">
                                                {p.replace(/^.*[/\\]/, '')}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export function AutomationView({
    history,
    onSendMessage,
    onAbort,
    isProcessing,
    isTaskPanelHidden,
    onToggleTaskPanel,
    isNarrowWindow = false,
    onExecutingChange
}: AutomationViewProps) {
    const { t } = useI18n();
    const { showToast } = useToast();
    const [currentProject, setCurrentProject] = useState<RPAProject | null>(null);
    const [isProjectLoaded, setIsProjectLoaded] = useState(false);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [isCreatingProject, setIsCreatingProject] = useState(false);
    const [needsAppUpdate, setNeedsAppUpdate] = useState(false);
    const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
    const [streamingText, setStreamingText] = useState('');
    const [config, setConfig] = useState<any>(null);
    const [splitRatio, setSplitRatio] = useState(50);
    /** 右侧编辑器多 tab；默认只展示最新一个自动化脚本（xxx_vN.js），切换项目后自动打开该脚本 */
    const [scriptTabs, setScriptTabs] = useState<AutomationScriptTab[]>([]);
    const [activeScriptTabId, setActiveScriptTabId] = useState<string | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);
    useEffect(() => { onExecutingChange?.(isExecuting); }, [isExecuting, onExecutingChange]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    /** 执行任务卡片列表：每次点击执行新增一条，展示步骤输出与进度 */
    const [executionRuns, setExecutionRuns] = useState<RPAExecutionRun[]>([]);
    /** 执行输出面板是否向上铺满展开 */
    const [executionPanelExpanded, setExecutionPanelExpanded] = useState(false);
    const currentTaskIdRef = useRef<string | null>(null);
    const historyRef = useRef<Anthropic.MessageParam[]>([]);
    /** 已做过“进入/切换项目时自动加载最近任务”的项目 ID，避免覆盖用户后续点击的任务 */
    const lastAutoLoadedProjectIdRef = useRef<string | null>(null);
    /** 当前项目 ID（每轮渲染更新），用于 effect 内判断是否已被切换/新建项目，避免旧任务的 rpa:task:switch 用旧会话覆盖聊天区 */
    const currentProjectIdRef = useRef<string | null>(null);
    /** 本次“执行”对应的 runId：仅当此次执行创建了会话任务并输出到聊天区时设置，用于在 run:output/run:end 中把输出追加到聊天区 */
    const lastExecutionRunIdForChatRef = useRef<string | null>(null);
    /** 当前点击“执行”对应的 runId，用于在 rpa:run:end 时清除执行按钮的 loading 状态 */
    const currentExecutionRunIdRef = useRef<string | null>(null);
    /** 本次“执行”对应的 (runId, projectId, taskId)，用于 rpa:run:end 时把该任务标记为 completed/failed */
    const lastExecutionTaskForRunRef = useRef<{ runId: string; projectId: string; taskId: string } | null>(null);
    /** executionRuns 的 ref，用于在事件回调中访问最新状态 */
    const executionRunsRef = useRef<RPAExecutionRun[]>([]);
    currentTaskIdRef.current = currentTaskId;
    historyRef.current = history;
    currentProjectIdRef.current = currentProject?.id ?? null;
    executionRunsRef.current = executionRuns;

    const activeScriptTab = activeScriptTabId ? scriptTabs.find(t => t.id === activeScriptTabId) : null;
    const scriptContent = activeScriptTab?.content ?? '';
    const scriptFilePath = activeScriptTab?.filePath ?? null;

    /** 只保留一个 tab（用于切换项目/任务时默认只展示最新脚本） */
    const setSingleScriptTab = useCallback((filePath: string | null, content: string) => {
        if (!filePath) {
            setScriptTabs([]);
            setActiveScriptTabId(null);
            return;
        }
        const tab: AutomationScriptTab = {
            id: `script-${Date.now()}`,
            filePath,
            content,
            isModified: false
        };
        setScriptTabs([tab]);
        setActiveScriptTabId(tab.id);
    }, []);

    /** 打开或切换到脚本 tab；若已存在同路径 tab 则切换并可选更新内容 */
    const openEditorTab = useCallback((filePath: string, content: string) => {
        setScriptTabs(prev => {
            const existing = prev.find(t => t.filePath === filePath);
            if (existing) {
                setActiveScriptTabId(existing.id);
                return prev.map(t => t.id === existing.id ? { ...t, content, isModified: false } : t);
            }
            const newTab: AutomationScriptTab = {
                id: `script-${Date.now()}`,
                filePath,
                content,
                isModified: false
            };
            setActiveScriptTabId(newTab.id);
            return [...prev, newTab];
        });
    }, []);

    useEffect(() => {
        loadCurrentProject();
    }, []);

    useEffect(() => {
        if (currentProject) {
            window.ipcRenderer.invoke('rpa:ensure-working-dir').catch(console.warn);
        }
    }, [currentProject?.id]);

    useEffect(() => {
        const remove = window.ipcRenderer.on('rpa:project:switched', () => {
            loadCurrentProject();
        });
        return () => remove();
    }, []);

    /** 打开自动化模式或切换 RPA 项目后：加载该项目最近一次聊天（最近任务）、并默认加载时间最近的脚本 */
    useEffect(() => {
        if (!currentProject) return;
        // 新建/切换项目后清空执行输出，隐藏「执行步骤和结果」面板
        setExecutionRuns([]);
        setExecutionPanelExpanded(false);
        if (lastAutoLoadedProjectIdRef.current === currentProject.id) return;

        const projectIdForThisRun = currentProject.id;
        let cancelled = false;
        lastAutoLoadedProjectIdRef.current = currentProject.id;
        setIsLoadingHistory(true);

        (async () => {
            try {
                const tasks = await window.ipcRenderer.invoke('rpa:task:list', projectIdForThisRun) as RPATask[];
                const sorted = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt);
                const latestTask = sorted[0];
                if (cancelled) {
                    setIsLoadingHistory(false);
                    return;
                }
                // 若已切换/新建项目，不再执行 switch，避免用旧会话覆盖聊天区
                if (currentProjectIdRef.current !== projectIdForThisRun) {
                    setIsLoadingHistory(false);
                    return;
                }
                // 没有任务时初始化一个新任务，主进程会清空历史并下发 agent:history-update
                if (!latestTask) {
                    const createResult = await window.ipcRenderer.invoke('rpa:task:create', projectIdForThisRun, t('newTask')) as { success: boolean; task?: RPATask };
                    if (!cancelled && createResult.success && createResult.task) {
                        setCurrentTaskId(createResult.task.id);
                        setSingleScriptTab(null, '');
                    }
                    setIsLoadingHistory(false);
                    return;
                }
                const taskId = latestTask.id;
                if (currentProjectIdRef.current !== projectIdForThisRun) {
                    setIsLoadingHistory(false);
                    return;
                }
                const result = await window.ipcRenderer.invoke('rpa:task:switch', projectIdForThisRun, taskId) as { success: boolean };
                if (cancelled || currentProjectIdRef.current !== projectIdForThisRun) {
                    setIsLoadingHistory(false);
                    return;
                }
                if (result.success) {
                    setCurrentTaskId(taskId);
                    // 只展示当前任务的主脚本：有 scriptFileName 则加载该文件，否则再按修改时间取最近一个
                    let scriptToLoad: string | null = null;
                    if (latestTask.scriptFileName) {
                        const base = currentProject.path.replace(/\/$/, '');
                        scriptToLoad = `${base}/${latestTask.scriptFileName}`;
                    }
                    if (!scriptToLoad) {
                        const latestScript = await window.ipcRenderer.invoke('rpa:get-latest-script-in-project', currentProject.path) as { path: string } | null;
                        if (!cancelled) scriptToLoad = latestScript?.path ?? null;
                    }
                    if (cancelled) {
                        setIsLoadingHistory(false);
                        return;
                    }
                    if (scriptToLoad) {
                        try {
                            const read = await window.ipcRenderer.invoke('fs:read-file', scriptToLoad) as { success: boolean; content?: string };
                            if (!cancelled) {
                                const content = read.success && read.content != null ? read.content : '';
                                setSingleScriptTab(scriptToLoad, content);
                            }
                        } catch {
                            if (!cancelled) setSingleScriptTab(null, '');
                        }
                    } else if (!cancelled) {
                        setSingleScriptTab(null, '');
                    }
                }
            } catch (e) {
                console.warn('[AutomationView] auto-load latest task/script failed:', e);
            } finally {
                if (!cancelled) setIsLoadingHistory(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [currentProject?.id, setSingleScriptTab]);

    // 新建项目后主进程会自动创建并下发 rpa:task:created，此处选中该任务并立即更新当前项目（避免 loadCurrentProject 异步未完成时任务列表仍显示旧项目）
    useEffect(() => {
        const remove = window.ipcRenderer.on('rpa:task:created', async (_: unknown, ...args: unknown[]) => {
            const task = args[0] as RPATask;
            if (!task?.id) return;
            if (currentTaskIdRef.current === task.id) return;
            const project = await window.ipcRenderer.invoke('rpa:get-current-project') as RPAProject | null;
            if (!project) return;
            const tasks = await window.ipcRenderer.invoke('rpa:task:list', project.id) as RPATask[];
            if (!tasks.some(t => t.id === task.id)) return;
            setCurrentProject(project);
            setCurrentTaskId(task.id);
            setSingleScriptTab(null, '');
        });
        return () => remove();
    }, [setSingleScriptTab]);

    // 上下文切换（400 错误自动重试）：复用同一任务、新 session，仅 toast 提示
    useEffect(() => {
        const remove = window.ipcRenderer.on('agent:context-switched', (_: unknown, ...args: unknown[]) => {
            const payload = args[0] as { newTaskId?: string; projectId?: string } | undefined;
            if (payload?.newTaskId) {
                showToast('遇到错误，正在同一任务下自动重试...');
            }
        });
        return () => remove();
    }, [showToast]);

    useEffect(() => {
        window.ipcRenderer.invoke('config:get-all').then((cfg: any) => {
            setConfig(cfg);
            setSplitRatio(cfg?.chatEditorSplitRatio ?? 50);
        });
        const remove = window.ipcRenderer.on('config:updated', (_: unknown, c: any) => setConfig(c));
        return () => remove();
    }, []);

    useEffect(() => {
        const remove = window.ipcRenderer.on('agent:stream-token', (_: unknown, ...args: unknown[]) => {
            const token = args[0] as string;
            setStreamingText(prev => prev + token);
        });
        return () => remove();
    }, []);

    /** 监听历史更新：关闭加载状态，并保存 session 以关联到当前 RPA 任务（切换任务后可加载该对话历史） */
    useEffect(() => {
        const removeHistoryListener = window.ipcRenderer.on('agent:history-update', (_event: unknown, ...args: unknown[]) => {
            const newHistory = args[0] as Anthropic.MessageParam[] | undefined;
            setStreamingText('');
            setIsLoadingHistory(false);
            if (newHistory && newHistory.length > 0 && currentProject && currentTaskIdRef.current) {
                const hasRealContent = newHistory.some(msg => {
                    const content = msg.content;
                    if (typeof content === 'string') return content.trim().length > 0;
                    if (Array.isArray(content)) {
                        return content.some((block: { type?: string; text?: string }) =>
                            block.type === 'text' ? (block.text || '').trim().length > 0 : true
                        );
                    }
                    return false;
                });
                if (hasRealContent) {
                    window.ipcRenderer.invoke('session:save', newHistory).catch((err: unknown) =>
                        console.error('[AutomationView] Failed to save session:', err)
                    );
                }
            }
        });
        return () => removeHistoryListener();
    }, [currentProject?.id]);

    /** 监听执行流式输出，更新对应任务卡片 */
    useEffect(() => {
        const removeStart = window.ipcRenderer.on('rpa:run:start', (_: unknown, ...args: unknown[]) => {
            const payload = args[0] as { runId: string; scriptPath: string };
            const scriptName = payload.scriptPath.replace(/^.*[/\\]/, '');
            setExecutionRuns(prev => [{
                runId: payload.runId,
                scriptName,
                status: 'running',
                steps: [],
                screenshotPaths: [],
                stdout: '',
                stderr: '',
                startTime: Date.now()
            }, ...prev]);
        });
        const removeOutput = window.ipcRenderer.on('rpa:run:output', (_: unknown, ...args: unknown[]) => {
            const payload = args[0] as { runId: string; data: string; stream: 'stdout' | 'stderr' };
            const { runId, data, stream } = payload;
            if (lastExecutionRunIdForChatRef.current === runId) {
                window.ipcRenderer.invoke('agent:append-to-last-assistant', data).catch(() => {});
            }
            const time = Date.now();
            const lines = data.split(/\r?\n/).filter(Boolean);
            setExecutionRuns(prev => prev.map(run => {
                if (run.runId !== runId) return run;
                const newSteps: RPARunStep[] = lines.map(text => ({ text, stream, time }));
                return {
                    ...run,
                    steps: [...run.steps, ...newSteps],
                    stdout: stream === 'stdout' ? run.stdout + data : run.stdout,
                    stderr: stream === 'stderr' ? run.stderr + data : run.stderr
                };
            }));
        });
        const removeEnd = window.ipcRenderer.on('rpa:run:end', (_: unknown, ...args: unknown[]) => {
            const payload = args[0] as { runId: string; success: boolean; error?: string; stdout?: string; stderr?: string; scriptName?: string };
            const { runId, success, error } = payload;
            if (currentExecutionRunIdRef.current === runId) {
                currentExecutionRunIdRef.current = null;
                setIsExecuting(false);
            }
            const taskForRun = lastExecutionTaskForRunRef.current;
            if (taskForRun?.runId === runId) {
                lastExecutionTaskForRunRef.current = null;
                window.ipcRenderer.invoke('rpa:task:update', taskForRun.projectId, taskForRun.taskId, { status: success ? 'completed' : 'failed' }).catch(() => {});
            }
            if (lastExecutionRunIdForChatRef.current === runId) {
                lastExecutionRunIdForChatRef.current = null;
                const runEntry = executionRunsRef.current.find(r => r.runId === runId);
                const fullStdout = payload.stdout || runEntry?.stdout || '';
                const fullStderr = payload.stderr || runEntry?.stderr || '';
                const fullOutput = fullStdout || fullStderr || '';
                const suffix = success ? '\n\n执行完成。' : `\n\n执行失败: ${error || '未知错误'}`;
                window.ipcRenderer.invoke('agent:append-to-last-assistant', suffix).then(async () => {
                    const trimmedOutput = fullOutput.trim();
                    if (trimmedOutput) {
                        const hist = await window.ipcRenderer.invoke('agent:get-history') as Anthropic.MessageParam[];
                        const lastAssistant = hist?.filter(m => m.role === 'assistant').pop();
                        const lastContent = typeof lastAssistant?.content === 'string'
                            ? lastAssistant.content
                            : Array.isArray(lastAssistant?.content)
                                ? lastAssistant.content.filter((b: { type?: string }) => b.type === 'text').map((b: unknown) => (b as { text?: string }).text || '').join('')
                                : '';
                        const outputTail = trimmedOutput.slice(-120);
                        if (!lastContent.includes(outputTail)) {
                            const name = runEntry?.scriptName || '脚本';
                            const outputBlock = success
                                ? `\n\n**执行输出** (${name}):\n\`\`\`\n${trimmedOutput}\n\`\`\``
                                : `\n\n**执行输出** (${name}):\n\`\`\`\n${trimmedOutput}${error ? '\n' + error : ''}\n\`\`\``;
                            await window.ipcRenderer.invoke('agent:append-to-last-assistant', outputBlock).catch(() => {});
                        }
                    }
                    window.ipcRenderer.invoke('session:save-current').catch(() => {});
                }).catch(() => {});
            } else {
                // AI 工具调用触发的执行：执行完成后把输出结果追加到聊天区
                const runEntry = executionRunsRef.current.find(r => r.runId === runId);
                const { stdout = '', stderr = '' } = payload;
                const outputText = stdout || runEntry?.stdout || stderr || runEntry?.stderr || '';
                if (outputText.trim()) {
                    const name = runEntry?.scriptName || payload.scriptName || '脚本';
                    const header = success
                        ? `\n\n**执行输出** (${name}):\n\`\`\`\n${outputText.trimEnd()}\n\`\`\``
                        : `\n\n**执行失败** (${name}):\n\`\`\`\n${outputText.trimEnd()}${error ? '\n' + error : ''}\n\`\`\``;
                    window.ipcRenderer.invoke('agent:append-to-last-assistant', header).then(() => {
                        window.ipcRenderer.invoke('session:save-current').catch(() => {});
                    }).catch(() => {});
                } else if (!success && error) {
                    window.ipcRenderer.invoke('agent:append-to-last-assistant', `\n\n**执行失败**: ${error}`).then(() => {
                        window.ipcRenderer.invoke('session:save-current').catch(() => {});
                    }).catch(() => {});
                }
            }
            const { stdout = '', stderr = '' } = payload;
            setExecutionRuns(prev => prev.map(run => {
                if (run.runId !== runId) return run;
                const fullStdout = stdout || run.stdout;
                const screenshotPaths = parseScreenshotPathsFromStdout(fullStdout, currentProject?.path);
                return {
                    ...run,
                    status: success ? 'completed' : 'failed',
                    error,
                    stdout: fullStdout,
                    stderr: stderr || run.stderr,
                    screenshotPaths,
                    endTime: Date.now()
                };
            }));
        });
        return () => {
            removeStart();
            removeOutput();
            removeEnd();
        };
    }, [currentProject?.path]);

    /** 当 AI 生成脚本并保存到 rpaProjects 时，加载并展示到右侧编辑器（打开新 tab 或切换到已有） */
    const openScriptInEditor = useCallback(async (filePath: string) => {
        const ext = filePath.split('.').pop()?.toLowerCase();
        if (ext !== 'js' && ext !== 'py') return;
        const result = await window.ipcRenderer.invoke('fs:read-file', filePath) as { success: boolean; content?: string };
        if (result.success && result.content != null) {
            openEditorTab(filePath, result.content);
            if (currentProject && currentTaskIdRef.current) {
                const fileName = filePath.split(/[/\\]/).pop() || '';
                if (fileName) {
                    window.ipcRenderer.invoke('rpa:task:update', currentProject.id, currentTaskIdRef.current, { scriptFileName: fileName });
                }
            }
        }
    }, [currentProject, openEditorTab]);

    /** 判断路径是否为当前 RPA 项目下的脚本（支持项目子目录及 rpaProjects 根目录） */
    const isRpaScript = useCallback((p: string) => {
        if (!currentProject || !/\.(js|py)$/i.test(p)) return false;
        const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
        const n = norm(p);
        const base = norm(currentProject.path);
        // 脚本在项目目录下，或在 rpaProjects 根目录下（项目为子目录时）
        if (n.startsWith(base + '/') || n === base) return true;
        const rpaRoot = base.includes('/rpaProjects') ? base.split('/rpaProjects')[0] + '/rpaProjects' : base;
        return n.startsWith(rpaRoot + '/');
    }, [currentProject]);

    /** 仅当 path 是当前任务的主脚本（scriptFileName）时才在右侧编辑器打开，不打开依赖代码文件 */
    const isMainScriptForCurrentTask = useCallback(async (filePath: string): Promise<boolean> => {
        if (!currentProject || !currentTaskIdRef.current) return false;
        const tasks = await window.ipcRenderer.invoke('rpa:task:list', currentProject.id) as RPATask[];
        const task = tasks.find(t => t.id === currentTaskIdRef.current);
        if (!task?.scriptFileName) return false; // 未绑定主脚本时不在 artifact/file-changed 里打开，仅由 agent:done 打开
        const basename = filePath.replace(/^.*[/\\]/, '');
        return basename === task.scriptFileName;
    }, [currentProject]);

    useEffect(() => {
        if (!currentProject) return;
        const removeArtifact = window.ipcRenderer.on('agent:artifact-created', (_: unknown, ...args: unknown[]) => {
            const artifact = args[0] as { path?: string };
            if (!artifact?.path || !isRpaScript(artifact.path)) return;
            isMainScriptForCurrentTask(artifact.path).then((ok) => {
                if (ok) setTimeout(() => openScriptInEditor(artifact.path!), 300);
            });
        });

        const removeFileChanged = window.ipcRenderer.on('fs:file-changed', (_: unknown, ...args: unknown[]) => {
            const filePath = args[0] as string;
            if (!filePath || !isRpaScript(filePath)) return;
            isMainScriptForCurrentTask(filePath).then((ok) => {
                if (ok) setTimeout(() => openScriptInEditor(filePath), 300);
            });
        });

        return () => {
            removeArtifact();
            removeFileChanged();
        };
    }, [currentProject, openScriptInEditor, isRpaScript, isMainScriptForCurrentTask]);

    /** agent:done 时根据 artifacts 加载脚本；若无匹配则扫描项目目录最近修改的脚本兜底；新脚本生成后递增版本号 */
    useEffect(() => {
        if (!currentProject) return;
        const removeDone = window.ipcRenderer.on('agent:done', async (_: unknown, ...args: unknown[]) => {
            const payload = args[0] as { artifacts?: { path: string; name: string; type: string }[]; taskId?: string };
            const artifacts = payload?.artifacts;
            let scriptPath: string | null = null;
            if (Array.isArray(artifacts) && artifacts.length > 0) {
                const scripts = artifacts.filter((a) => a.type === 'file' && isRpaScript(a.path));
                if (scripts.length > 0) scriptPath = scripts[scripts.length - 1].path;
            }
            if (!scriptPath) {
                // 兜底：artifact-created 可能未触发或路径不匹配，扫描项目目录最近 10 分钟内修改的脚本
                const recent = await window.ipcRenderer.invoke('rpa:find-recent-scripts', currentProject.path, 10) as string[];
                if (recent.length > 0) scriptPath = recent[0];
            }
            if (scriptPath) {
                setTimeout(() => openScriptInEditor(scriptPath!), 100);
                // 新脚本生成完成，递增任务版本号（下次聊天将使用 _v2、_v3...）
                if (currentTaskIdRef.current && payload?.taskId) {
                    window.ipcRenderer.invoke('rpa:task:increment-script-version', currentProject.id, payload.taskId).catch(() => {});
                }
            }
        });
        return () => removeDone();
    }, [currentProject, openScriptInEditor, isRpaScript]);

    const loadCurrentProject = async (retry = 3): Promise<void> => {
        try {
            const project = await window.ipcRenderer.invoke('rpa:get-current-project') as RPAProject | null;
            setCurrentProject(project);
            setIsProjectLoaded(true);
            if (!project) {
                setShowCreateDialog(true);
            }
        } catch (err) {
            const msg = (err as Error).message || '';
            if (msg.includes('No handler registered')) {
                setIsProjectLoaded(true);
                setNeedsAppUpdate(true);
                return;
            }
            if (retry > 0) {
                await new Promise(res => setTimeout(res, 300));
                return loadCurrentProject(retry - 1);
            }
            setIsProjectLoaded(true);
            setShowCreateDialog(true);
        }
    };

    const handleCreateProject = async () => {
        const name = newProjectName.trim();
        if (!name) return;
        setIsCreatingProject(true);
        try {
            const result = await window.ipcRenderer.invoke('rpa:project:create', name) as { success: boolean; error?: string; project?: RPAProject };
            if (result.success) {
                setNewProjectName('');
                setShowCreateDialog(false);
                await loadCurrentProject(3);
            } else {
                showToast(result.error || '创建失败');
            }
        } catch (err) {
            const msg = (err as Error).message || '';
            if (msg.includes('No handler registered')) {
                setNeedsAppUpdate(true);
                setShowCreateDialog(false);
            } else {
                showToast(msg || '创建失败');
            }
        } finally {
            setIsCreatingProject(false);
        }
    };

    const handleCreateTask = async () => {
        if (!currentProject) return;
        const title = t('newTask');
        const result = await window.ipcRenderer.invoke('rpa:task:create', currentProject.id, title) as { success: boolean; task?: RPATask };
        if (result.success && result.task) {
            setCurrentTaskId(result.task.id);
            setSingleScriptTab(null, '');
        }
    };

    const handleSelectTask = async (taskId: string) => {
        if (!currentProject) return;
        // 与 Project 模式一致：先注册监听再切换，避免主进程下发的 agent:history-update 在 await 之前就发出导致漏接
        setIsLoadingHistory(true);
        setStreamingText(''); // 切换任务时清空流式文本，避免展示上一任务的残留
        // 切换任务时清空执行输出面板，该任务的执行输出已保存在聊天历史中，切换回来时会通过 session 加载并显示在聊天区
        setExecutionRuns([]);
        setExecutionPanelExpanded(false);
        const fallbackTimer = setTimeout(() => setIsLoadingHistory(false), 400);
        const removeFallback = () => clearTimeout(fallbackTimer);
        const removeHistoryListener = window.ipcRenderer.on('agent:history-update', () => {
            removeFallback();
            setIsLoadingHistory(false);
            removeHistoryListener();
        });
        setTimeout(removeFallback, 500);

        const result = await window.ipcRenderer.invoke('rpa:task:switch', currentProject.id, taskId) as { success: boolean };
        if (!result.success) {
            removeFallback();
            removeHistoryListener();
            setIsLoadingHistory(false);
            return;
        }
        setCurrentTaskId(taskId);

        const tasks = await window.ipcRenderer.invoke('rpa:task:list', currentProject.id) as RPATask[];
        const task = tasks.find(t => t.id === taskId);
        if (task?.scriptFileName) {
            const fullPath = `${currentProject.path}/${task.scriptFileName}`;
            try {
                const result = await window.ipcRenderer.invoke('fs:read-file', fullPath) as { success: boolean; content?: string };
                const content = result.success && result.content != null ? result.content : '';
                setSingleScriptTab(fullPath, content);
            } catch {
                setSingleScriptTab(null, '');
            }
        } else {
            setSingleScriptTab(null, '');
        }
    };

    const handleSendMessageWithRename = useCallback(async (msg: string | { content: string, images: string[] }) => {
        const text = typeof msg === 'string' ? msg : (msg.content || '');
        if (currentProject && currentTaskIdRef.current && text.length > 10) {
            const title = deriveTaskTitleFromMessage(text);
            if (title) {
                window.ipcRenderer.invoke('rpa:task:update', currentProject.id, currentTaskIdRef.current, { title });
            }
        }
        onSendMessage(msg);
    }, [currentProject, onSendMessage]);

    const handleScriptChange = (content: string) => {
        if (!activeScriptTabId) return;
        setScriptTabs(prev => prev.map(t => t.id === activeScriptTabId ? { ...t, content, isModified: true } : t));
    };

    const handleScriptSave = useCallback(async (content: string) => {
        if (!currentProject || !currentTaskId || !activeScriptTabId) return;
        const tab = scriptTabs.find(t => t.id === activeScriptTabId);
        const fullPath = tab?.filePath || `${currentProject.path}/script_${currentTaskId}.js`;
        const fileName = fullPath.split(/[/\\]/).pop()!;
        try {
            const wr = await window.ipcRenderer.invoke('fs:write-file', fullPath, content, { silent: true }) as { success: boolean; error?: string };
            if (wr.success) {
                setScriptTabs(prev => prev.map(t => t.id === activeScriptTabId ? { ...t, content, isModified: false } : t));
                await window.ipcRenderer.invoke('rpa:task:update', currentProject.id, currentTaskId, { scriptFileName: fileName });
                showToast(t('saved') || '已保存');
            } else {
                showToast(wr.error || '保存失败');
            }
        } catch (e) {
            showToast((e as Error).message || '保存失败');
        }
    }, [currentProject, currentTaskId, activeScriptTabId, scriptTabs, t, showToast]);

    const closeScriptTab = useCallback((tabId: string) => {
        setScriptTabs(prev => {
            const next = prev.filter(t => t.id !== tabId);
            if (next.length === 0) {
                setActiveScriptTabId(null);
                return [];
            }
            if (activeScriptTabId === tabId) {
                const idx = prev.findIndex(t => t.id === tabId);
                const newActive = idx > 0 ? prev[idx - 1].id : next[0].id;
                setActiveScriptTabId(newActive);
            }
            return next;
        });
    }, [activeScriptTabId]);

    const handleExecute = async () => {
        if (!currentProject) return;
        const content = scriptContent.trim();
        if (!content) {
            showToast(t('describeTask') || '请先编写或生成脚本');
            return;
        }
        const ext = scriptFilePath?.endsWith('.py') ? 'py' : 'js';
        const fileName = scriptFilePath ? scriptFilePath.split(/[/\\]/).pop()! : `script_${currentTaskId || 'temp'}.${ext}`;
        const fullPath = scriptFilePath || `${currentProject.path}/${fileName}`;
        const scriptName = fileName;
        try {
            const wr = await window.ipcRenderer.invoke('fs:write-file', fullPath, content) as { success: boolean; error?: string };
            if (!wr.success) {
                showToast(wr.error || '保存失败');
                return;
            }
            if (currentTaskId) {
                await window.ipcRenderer.invoke('rpa:task:update', currentProject.id, currentTaskId, { scriptFileName: fileName });
            }
        } catch (e) {
            showToast((e as Error).message || '保存失败');
            return;
        }
        setIsExecuting(true);
        const runId = crypto.randomUUID();
        currentExecutionRunIdRef.current = runId;
        try {
            // 新增会话任务卡片，并把本次执行输出到聊天区
            const createResult = await window.ipcRenderer.invoke('rpa:task:create', currentProject.id, `${t('execute')}: ${scriptName}`) as { success: boolean; task?: RPATask; error?: string };
            if (!createResult.success || !createResult.task) {
                setIsExecuting(false);
                showToast(createResult.error || '创建任务失败');
                return;
            }
            const newTask = createResult.task;
            await window.ipcRenderer.invoke('rpa:task:switch', currentProject.id, newTask.id);
            setCurrentTaskId(newTask.id);
            await window.ipcRenderer.invoke('rpa:task:update', currentProject.id, newTask.id, { scriptFileName: fileName });
            const injectResult = await window.ipcRenderer.invoke('agent:inject-history', [{ role: 'assistant', content: `开始执行 ${scriptName}...\n\n` }]) as { success: boolean };
            if (!injectResult?.success) {
                console.warn('[AutomationView] agent:inject-history failed, output may not stream to chat');
            }
            lastExecutionRunIdForChatRef.current = runId;
            lastExecutionTaskForRunRef.current = { runId, projectId: currentProject.id, taskId: newTask.id };

            const result = await window.ipcRenderer.invoke('rpa:execute-script', fullPath, runId) as { success: boolean; error?: string; stdout?: string; stderr?: string };
            if (result.success) {
                showToast(t('execute') + ' 成功');
            } else {
                showToast(result.error || '执行失败');
            }
        } catch (e) {
            lastExecutionRunIdForChatRef.current = null;
            lastExecutionTaskForRunRef.current = null;
            showToast((e as Error).message || '执行失败');
        } finally {
            currentExecutionRunIdRef.current = null;
            setIsExecuting(false);
        }
    };

    if (!currentProject) {
        return (
            <div className="flex-1 flex items-center justify-center text-stone-500 dark:text-zinc-400">
                {!isProjectLoaded && <Loader2 size={20} className="animate-spin" />}
                {isProjectLoaded && needsAppUpdate && (
                    <div className="flex flex-col items-center gap-3 p-6 text-center max-w-sm">
                        <div className="text-amber-500 text-3xl">⚠️</div>
                        <p className="text-sm font-medium text-stone-700 dark:text-zinc-200">应用版本过旧</p>
                        <p className="text-xs text-stone-500 dark:text-zinc-400">
                            自动化项目功能需要更新应用主程序，请重新下载安装最新版本后使用。
                        </p>
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                            ⚠️ 资源热更新无法解决此问题，必须重新安装应用。
                        </p>
                        <div className="flex gap-2 mt-1">
                            <button
                                className="px-4 py-2 text-xs font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                                onClick={() => {
                                    window.ipcRenderer.invoke('app:open-external-url', 'https://github.com/shileima/opencowork/releases/latest').catch(() => {});
                                }}
                            >
                                前往下载最新版本
                            </button>
                            <button
                                className="px-4 py-2 text-xs font-medium rounded-lg border border-stone-200 dark:border-zinc-600 text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors"
                                onClick={() => setNeedsAppUpdate(false)}
                            >
                                稍后更新
                            </button>
                        </div>
                    </div>
                )}
                {isProjectLoaded && !needsAppUpdate && !showCreateDialog && (
                    <div className="flex flex-col items-center gap-3 text-center">
                        <p className="text-sm text-stone-500 dark:text-zinc-400">暂无自动化项目</p>
                        <button
                            className="px-4 py-2 text-sm font-medium rounded-lg bg-orange-500 hover:bg-orange-600 text-white transition-colors"
                            onClick={() => setShowCreateDialog(true)}
                        >
                            新建项目
                        </button>
                    </div>
                )}
                {isProjectLoaded && !needsAppUpdate && showCreateDialog && (
                    <div
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
                        role="dialog"
                        aria-modal="true"
                        onClick={() => setShowCreateDialog(false)}
                    >
                        <div
                            className="bg-white dark:bg-zinc-800 rounded-xl shadow-xl border border-stone-200 dark:border-zinc-700 p-5 w-[420px] max-w-[90vw]"
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleCreateProject();
                                if (e.key === 'Escape') setShowCreateDialog(false);
                            }}
                        >
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-base font-semibold text-stone-800 dark:text-zinc-100">
                                    新建自动化项目
                                </h2>
                                <button
                                    type="button"
                                    onClick={() => setShowCreateDialog(false)}
                                    className="text-stone-400 hover:text-stone-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
                                    aria-label="关闭"
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                        <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                    </svg>
                                </button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-stone-700 dark:text-zinc-300 mb-1">
                                        {t('projectName')}
                                    </label>
                                    <input
                                        type="text"
                                        value={newProjectName}
                                        onChange={e => setNewProjectName(e.target.value)}
                                        placeholder={t('newProjectNamePlaceholder')}
                                        className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 placeholder-stone-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400"
                                        autoFocus
                                    />
                                </div>
                                <div className="flex justify-end gap-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => setShowCreateDialog(false)}
                                        className="px-3 py-1.5 text-sm font-medium text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                                    >
                                        {t('cancel')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCreateProject}
                                        disabled={!newProjectName.trim() || isCreatingProject}
                                        className="px-3 py-1.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-1.5"
                                    >
                                        {isCreatingProject && <Loader2 size={14} className="animate-spin" />}
                                        {t('createProject')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex-1 min-h-0 flex overflow-hidden relative">
            {isTaskPanelHidden && !isNarrowWindow && (
                <div
                    className="absolute left-0 top-0 bottom-0 w-2 z-50 cursor-pointer"
                    onMouseEnter={() => setTimeout(onToggleTaskPanel, 1000)}
                    title="悬停 1 秒展开侧栏"
                />
            )}
            <div className={`transition-all duration-300 ${isTaskPanelHidden ? 'w-0 overflow-hidden' : 'w-64'}`}>
                <RPATaskListPanel
                    isHidden={isTaskPanelHidden}
                    onToggleHide={onToggleTaskPanel}
                    currentProject={currentProject}
                    currentTaskId={currentTaskId}
                    isProcessing={isProcessing || isExecuting}
                    onSelectTask={handleSelectTask}
                    onCreateTask={handleCreateTask}
                />
            </div>
            <div className="flex-1 min-w-0">
                {isNarrowWindow ? (
                    <div className="flex flex-col h-full">
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
                ) : (
                    <ResizableSplitPane
                        leftPanel={
                            <div className="flex flex-col h-full min-w-0">
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
                            <div className="flex flex-col h-full bg-[#1e1e1e]">
                                <div className="h-10 shrink-0 border-b border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between px-3">
                                    <span className="text-xs text-stone-500 dark:text-zinc-400 flex items-center gap-2 min-w-0">
                                        {!activeScriptTab && (
                                            <span className="shrink-0">{t('automationScripts')} - Playwright (.js / .py)</span>
                                        )}
                                        {activeScriptTab && (
                                            <>
                                                <span className="truncate" title={activeScriptTab.filePath.split(/[/\\]/).pop() ?? undefined}>
                                                    {activeScriptTab.filePath.split(/[/\\]/).pop()}
                                                    {activeScriptTab.isModified && <span className="text-amber-500 ml-0.5">*</span>}
                                                </span>
                                                <span className="shrink-0 text-stone-400 dark:text-zinc-500">
                                                    {formatScriptSize(new Blob([activeScriptTab.content]).size)}
                                                </span>
                                            </>
                                        )}
                                    </span>
                                    <button
                                        onClick={handleExecute}
                                        disabled={isExecuting || !scriptContent.trim()}
                                        className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                                            isExecuting || !scriptContent.trim()
                                                ? 'bg-stone-400 text-white cursor-not-allowed'
                                                : 'bg-green-600 hover:bg-green-700 text-white'
                                        }`}
                                        title={t('execute')}
                                    >
                                        {isExecuting ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <Play size={14} />
                                        )}
                                        {t('execute')}
                                    </button>
                                </div>
                                {scriptTabs.length > 0 && (
                                    <div className="shrink-0 flex items-end gap-0.5 px-2 pt-1 pb-0 border-b border-stone-700 bg-[#252526] overflow-x-auto">
                                        {scriptTabs.map((tab) => (
                                            <div
                                                key={tab.id}
                                                className={`flex items-center gap-1 px-2 py-1.5 rounded-t text-xs cursor-pointer border border-b-0 min-w-0 max-w-[160px] ${
                                                    tab.id === activeScriptTabId
                                                        ? 'bg-[#1e1e1e] text-stone-200 border-stone-600 border-b-transparent -mb-px'
                                                        : 'bg-stone-800/80 text-stone-400 border-transparent hover:bg-stone-700/80'
                                                }`}
                                                onClick={() => setActiveScriptTabId(tab.id)}
                                                title={tab.filePath}
                                            >
                                                <span className="truncate">{tab.filePath.split(/[/\\]/).pop()}</span>
                                                {tab.isModified && <span className="text-amber-500 shrink-0">*</span>}
                                                <button
                                                    type="button"
                                                    className="shrink-0 p-0.5 rounded hover:bg-stone-600 text-stone-400 hover:text-stone-200"
                                                    onClick={(e) => { e.stopPropagation(); closeScriptTab(tab.id); }}
                                                    title={t('close') || '关闭'}
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                                    <div className={executionRuns.length > 0 && executionPanelExpanded ? 'shrink-0 h-[200px] min-h-[160px] overflow-hidden' : 'flex-1 min-h-0'}>
                                        {activeScriptTab ? (
                                            <MonacoEditor
                                                key={activeScriptTab.id}
                                                filePath={activeScriptTab.filePath}
                                                content={activeScriptTab.content}
                                                onChange={handleScriptChange}
                                                onSave={handleScriptSave}
                                            />
                                        ) : (
                                            <div className="h-full flex items-center justify-center text-stone-400 dark:text-zinc-500 text-sm">
                                                {t('noTabsOpen') || '没有打开的标签页'}
                                                <br />
                                                <span className="text-xs mt-1">{t('openFileHint') || '切换项目后将自动打开最新脚本 (xxx_vN.js)'}</span>
                                            </div>
                                        )}
                                    </div>
                                    {executionRuns.length > 0 && (
                                        <div className={`border-t border-stone-700 bg-[#252526] flex flex-col min-h-0 ${executionPanelExpanded ? 'flex-1 min-h-0' : 'shrink-0 max-h-[280px]'}`}>
                                            <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-stone-700 text-xs text-stone-400 shrink-0">
                                                <span className="flex items-center gap-2">
                                                    <span>{t('executionOutput') || '执行输出'}</span>
                                                    <span className="text-stone-500">·</span>
                                                    <span>{executionRuns.length} {t('runCard') || '次执行'}</span>
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setExecutionPanelExpanded(e => !e)}
                                                    className="p-1 rounded text-stone-400 hover:text-stone-200 hover:bg-stone-600/50 transition-colors"
                                                    title={executionPanelExpanded ? (t('collapse') || '收起') : (t('expandUp') || '向上铺满展开')}
                                                >
                                                    {executionPanelExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                                                </button>
                                            </div>
                                            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
                                                {executionRuns.slice(0, 5).map((run) => (
                                                    <ExecutionRunCard
                                                        key={run.runId}
                                                        run={run}
                                                        projectPath={currentProject?.path}
                                                        t={t}
                                                        isPanelExpanded={executionPanelExpanded}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        }
                        initialRatio={splitRatio}
                        onRatioChange={async (ratio) => {
                            setSplitRatio(ratio);
                            try {
                                await window.ipcRenderer.invoke('config:set-all', { chatEditorSplitRatio: ratio });
                            } catch { /* ignore */ }
                        }}
                        minSize={20}
                        leftMinSizePx={390}
                        rightMinSizePx={390}
                    />
                )}
            </div>
        </div>
    );
}
