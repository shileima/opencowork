import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Minus, Square, X, Zap, FolderKanban, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, ChevronDown, FolderOpen, FolderPlus, Trash2, Loader2, Rocket, CheckCircle, Monitor, Bot } from 'lucide-react';
import { CoworkView } from './components/CoworkView';
import { SettingsView } from './components/SettingsView';
import { ConfirmDialog, useConfirmations } from './components/ConfirmDialog';
import { FloatingBallPage } from './components/FloatingBallPage';
import { ProjectView } from './components/ProjectView';
import { AutomationView } from './components/AutomationView';
import { TerminalWindow } from './pages/TerminalWindow';
import { SplashScreen } from './components/SplashScreen';
import { SsoLoginView } from './components/SsoLoginView';
import { useI18n } from './i18n/I18nContext';
import Anthropic from '@anthropic-ai/sdk';
import api from './api';
import type { Project, RPAProject, SsoUserInfo } from './api/types';

type ViewType = 'cowork' | 'project' | 'automation';

function App() {
  const [isAppReady, setIsAppReady] = useState(false);
  const [ssoUser, setSsoUser] = useState<SsoUserInfo | null>(null);
  const [ssoChecked, setSsoChecked] = useState(false);
  const [history, setHistory] = useState<Anthropic.MessageParam[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeView, setActiveView] = useState<ViewType>('project');
  const [isTaskPanelHidden, setIsTaskPanelHidden] = useState(false);
  const [isExplorerPanelHidden, setIsExplorerPanelHidden] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [rpaProjects, setRpaProjects] = useState<RPAProject[]>([]);
  const [currentRpaProject, setCurrentRpaProject] = useState<RPAProject | null>(null);
  const [showRpaProjectDropdown, setShowRpaProjectDropdown] = useState(false);
  const [isRpaExecuting, setIsRpaExecuting] = useState(false);
  const [showNewRpaProjectDialog, setShowNewRpaProjectDialog] = useState(false);
  const [newRpaProjectName, setNewRpaProjectName] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [deployStatus, setDeployStatus] = useState<'idle' | 'deploying' | 'success' | 'error'>('idle');
  const [agentInitFailed, setAgentInitFailed] = useState<string | null>(null);
  const previewHandlerRef = useRef<(() => void) | null>(null);
  const deployHandlerRef = useRef<(() => void) | null>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const projectButtonRef = useRef<HTMLButtonElement>(null);
  const rpaProjectDropdownRef = useRef<HTMLDivElement>(null);
  const rpaProjectButtonRef = useRef<HTMLButtonElement>(null);
  const activeViewRef = useRef<ViewType>(activeView);
  activeViewRef.current = activeView;
  const { pendingRequest, handleConfirm, handleDeny } = useConfirmations();
  const { t } = useI18n();

  const NARROW_BREAKPOINT = 880;
  const [isNarrowWindow, setIsNarrowWindow] = useState(() => window.innerWidth < NARROW_BREAKPOINT);

  // 缓存排序后的项目列表,避免每次渲染都重新计算
  const sortedProjects = useMemo(() =>
    [...projects].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [projects]
  );

  const sortedRpaProjects = useMemo(() =>
    [...rpaProjects].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [rpaProjects]
  );

  useEffect(() => {
    const handleResize = () => {
      const narrow = window.innerWidth < NARROW_BREAKPOINT;
      setIsNarrowWindow(narrow);
      if (narrow) {
        setIsTaskPanelHidden(true);
        setIsExplorerPanelHidden(true);
      } else {
        // 窗口足够宽时，默认展开左侧任务列表
        setIsTaskPanelHidden(false);
      }
    };
    handleResize(); // 初始化时执行一次，确保默认展开
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 当切换视图时，合并所有窗口管理和状态更新操作，优化性能
  useEffect(() => {
    const shouldMaximize = activeView === 'project' || activeView === 'automation';

    // 合并多个 IPC 调用，减少往返次数
    Promise.all([
      api.window.setMaximized(shouldMaximize),
      api.app.setActiveView(activeView),
      activeView === 'cowork' ? api.cowork.ensureWorkingDir().catch(err => {
        console.warn('[App] cowork:ensure-working-dir failed:', err);
      }) : Promise.resolve()
    ]).catch(err => {
      console.error('[App] 视图切换失败:', err);
    });
  }, [activeView]);

  // 切换模式：先通知主进程清空并切换，再更新本地状态，确保新视图加载的是本模式的历史
  const handleModeSwitch = useCallback((newView: ViewType) => {
    if (isProcessing) return;
    if (newView === activeView) return;
    // 1. 先通知主进程切换并清空（在 re-render 之前执行，避免旧视图的异步逻辑覆盖）
    window.ipcRenderer.invoke('app:set-active-view', newView);
    // 2. 立即清空聊天区
    setHistory([]);
    // 3. 更新视图
    setActiveView(newView);
    // 4. 协作模式：加载最近会话
    if (newView === 'cowork') {
      window.ipcRenderer.invoke('session:auto-load').catch((err) => {
        console.warn('[App] session:auto-load on switch failed:', err);
      });
    }
  }, [activeView, isProcessing]);

  // 从 localStorage 加载资源管理器隐藏状态；任务列表面板默认展示，不恢复隐藏状态
  useEffect(() => {
    if (activeView === 'project' || activeView === 'automation') {
      if (activeView === 'project') {
        const savedExplorer = localStorage.getItem('projectView:explorerPanelHidden');
        setIsExplorerPanelHidden(savedExplorer === 'true');
      }
    }
  }, [activeView]);

  // 保存资源管理器隐藏状态到 localStorage（任务列表面板默认展示，不持久化隐藏状态）
  useEffect(() => {
    if (activeView === 'project') {
      localStorage.setItem('projectView:explorerPanelHidden', String(isExplorerPanelHidden));
    }
  }, [isExplorerPanelHidden, activeView]);

  // 加载项目列表
  useEffect(() => {
    if (activeView === 'project') {
      loadProjects();
    }
  }, [activeView]);

  // 加载 RPA 项目列表
  useEffect(() => {
    if (activeView === 'automation') {
      loadRpaProjects();
    }
  }, [activeView]);

  // 加载当前 RPA 项目
  useEffect(() => {
    if (activeView === 'automation') {
      loadCurrentRpaProject();
    }
  }, [activeView, rpaProjects]);

  // 加载当前项目
  useEffect(() => {
    if (activeView === 'project') {
      loadCurrentProject();
    }
  }, [activeView, projects]);

  // 监听项目创建和切换事件
  useEffect(() => {
    if (activeView === 'project') {
      const removeProjectCreatedListener = window.ipcRenderer.on('project:created', () => {
        loadProjects();
        loadCurrentProject();
      });

      const removeProjectSwitchedListener = window.ipcRenderer.on('project:switched', () => {
        setHistory([]); // 切换工程时立即清空聊天区域
        loadCurrentProject();
      });

      return () => {
        removeProjectCreatedListener();
        removeProjectSwitchedListener();
      };
    }
  }, [activeView]);

  // 监听 RPA 项目创建和切换事件
  useEffect(() => {
    if (activeView === 'automation') {
      const removeRpaCreated = window.ipcRenderer.on('rpa:project:created', () => {
        setHistory([]);
        loadRpaProjects();
        loadCurrentRpaProject();
      });
      const removeRpaSwitched = window.ipcRenderer.on('rpa:project:switched', () => {
        setHistory([]);
        loadCurrentRpaProject();
      });
      return () => {
        removeRpaCreated();
        removeRpaSwitched();
      };
    }
  }, [activeView]);

  // 窗口缩小到右下角时，自动收起左侧任务面板和右侧资源管理器
  useEffect(() => {
    const removeMiniModeListener = window.ipcRenderer.on('window:enter-mini-mode', () => {
      setIsTaskPanelHidden(true);
      setIsExplorerPanelHidden(true);
    });
    return () => {
      removeMiniModeListener();
    };
  }, []);

  // 点击外部关闭项目下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (showProjectDropdown && projectDropdownRef.current && !projectDropdownRef.current.contains(target)) {
        setShowProjectDropdown(false);
      }
      if (showRpaProjectDropdown && rpaProjectDropdownRef.current && !rpaProjectDropdownRef.current.contains(target)) {
        setShowRpaProjectDropdown(false);
      }
    };

    if (showProjectDropdown || showRpaProjectDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showProjectDropdown, showRpaProjectDropdown]);

  const loadProjects = async () => {
    try {
      const list = await api.project.list();
      setProjects(list);
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const path = await window.ipcRenderer.invoke('dialog:select-folder') as string | null;
      if (!path) return;
      const result = await window.ipcRenderer.invoke('project:open-folder', path) as { success: boolean; error?: string };
      if (result.success) {
        await loadProjects();
        await loadCurrentProject();
        setShowProjectDropdown(false);
        window.ipcRenderer.send('project:switched');
      } else {
        console.error('Open folder failed:', result.error);
      }
    } catch (error) {
      console.error('Failed to open folder:', error);
    }
  };

  const handleNewProjectClick = () => {
    setShowNewProjectDialog(true);
    setNewProjectName('');
  };

  const handleCreateNewProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const result = await api.project.create(name);
      if (result.success) {
        // 合并后续操作,减少 IPC 往返
        const [projects, currentProject] = await Promise.all([
          api.project.list(),
          api.project.getCurrent()
        ]);

        setProjects(projects);
        setCurrentProject(currentProject);
        setShowProjectDropdown(false);
        setShowNewProjectDialog(false);
        setNewProjectName('');
        window.ipcRenderer.send('project:switched');
      } else {
        console.error('Create project failed:', result.error);
        if (result.error) window.alert(result.error);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const loadCurrentProject = async () => {
    try {
      const project = await api.project.getCurrent();
      setCurrentProject(project);
      // Project 模式：确保主工作目录为 ~/.qa-cowork
      if (project) {
        window.ipcRenderer.invoke('project:ensure-working-dir');
      }
    } catch (error) {
      console.error('Failed to load current project:', error);
    }
  };

  const loadRpaProjects = async () => {
    try {
      const list = await api.rpaProject.list();
      setRpaProjects(list);
    } catch (error) {
      console.error('Failed to load RPA projects:', error);
    }
  };

  const loadCurrentRpaProject = async () => {
    try {
      const project = await api.rpaProject.getCurrent();
      setCurrentRpaProject(project);
    } catch (error) {
      console.error('Failed to load current RPA project:', error);
    }
  };

  const handleSelectRpaProject = async (projectId: string) => {
    try {
      const result = await window.ipcRenderer.invoke('rpa:project:open', projectId) as { success: boolean };
      if (result.success) {
        await loadCurrentRpaProject();
        setShowRpaProjectDropdown(false);
      }
    } catch (error) {
      console.error('Failed to switch RPA project:', error);
    }
  };

  const handleNewRpaProjectClick = () => {
    setShowNewRpaProjectDialog(true);
    setNewRpaProjectName('');
  };

  const handleDeleteRpaProject = async (e: React.MouseEvent, project: RPAProject) => {
    e.stopPropagation();
    const confirmMessage = `确定要删除 RPA 项目 "${project.name}" 吗？\n\n此操作将：\n1. 从列表中删除该项目\n2. 删除该项目的所有任务\n3. 永久删除项目目录及文件\n\n此操作无法撤销。`;
    if (!window.confirm(confirmMessage)) return;
    try {
      const result = await api.rpaProject.delete(project.id);
      if (result.success) {
        if (result.warning) window.alert(`⚠️ ${result.warning}`);

        // 合并后续操作，减少 IPC 往返
        const [updatedRpaProjects, updatedCurrentRpaProject] = await Promise.all([
          api.rpaProject.list(),
          api.rpaProject.getCurrent()
        ]);

        setRpaProjects(updatedRpaProjects);
        setCurrentRpaProject(updatedCurrentRpaProject);
        setShowRpaProjectDropdown(false);
      } else {
        if (result.error) window.alert(`删除失败：${result.error}`);
      }
    } catch (error) {
      console.error('Failed to delete RPA project:', error);
      window.alert(`删除时发生错误：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleCreateNewRpaProject = async (retryCount = 2) => {
    const name = newRpaProjectName.trim();
    if (!name) return;
    try {
      const result = await api.rpaProject.create(name);
      if (result.success) {
        setHistory([]);

        // 合并后续操作，减少 IPC 往返
        const [updatedRpaProjects, updatedCurrentRpaProject] = await Promise.all([
          api.rpaProject.list(),
          api.rpaProject.getCurrent()
        ]);

        setRpaProjects(updatedRpaProjects);
        setCurrentRpaProject(updatedCurrentRpaProject);
        setShowRpaProjectDropdown(false);
        setShowNewRpaProjectDialog(false);
        setNewRpaProjectName('');
      } else {
        if (result.error) window.alert(result.error);
      }
    } catch (error) {
      console.error('Failed to create RPA project:', error);
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('No handler registered')) {
        const confirmed = window.confirm('当前应用版本不支持此功能，需要重新下载安装最新版本。\n\n点击「确定」前往下载页面，点击「取消」稍后手动更新。');
        if (confirmed) {
          window.ipcRenderer.invoke('app:open-external-url', 'https://github.com/shileima/opencowork/releases/latest').catch(() => {});
        }
        return;
      }
      if (retryCount > 0) {
        await new Promise(res => setTimeout(res, 400));
        return handleCreateNewRpaProject(retryCount - 1);
      }
    }
  };

  const handleSelectProject = async (projectId: string) => {
    try {
      const result = await window.ipcRenderer.invoke('project:open', projectId) as { success: boolean };
      if (result.success) {
        await loadCurrentProject();
        setShowProjectDropdown(false);
        // 通知 ProjectView 刷新
        window.ipcRenderer.send('project:switched');
      }
    } catch (error) {
      console.error('Failed to switch project:', error);
    }
  };

  const handleDeleteProject = async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();

    // 显示详细的确认对话框
    const confirmMessage = `确定要删除项目 "${project.name}" 吗？\n\n⚠️ 警告：此操作将：\n1. 从项目列表中删除该项目\n2. 删除该项目的所有关联任务\n3. 永久删除项目目录及其所有文件\n\n此操作无法撤销，请谨慎操作！`;

    if (!window.confirm(confirmMessage)) return;

    // 二次确认
    const doubleConfirm = window.confirm(`最后确认：确定要删除项目 "${project.name}" 及其所有本地文件吗？\n\n项目路径：${project.path || '未知'}\n\n点击"确定"将永久删除，无法恢复！`);
    if (!doubleConfirm) return;

    try {
      const result = await api.project.delete(project.id);

      if (result.success) {
        // 如果有警告，显示警告信息
        if (result.warning) {
          window.alert(`⚠️ ${result.warning}`);
        }

        // 合并后续操作，减少 IPC 往返
        const [updatedProjects, updatedCurrentProject] = await Promise.all([
          api.project.list(),
          api.project.getCurrent()
        ]);

        setProjects(updatedProjects);
        setCurrentProject(updatedCurrentProject);
        setShowProjectDropdown(false);
        window.ipcRenderer.send('project:switched');
      } else {
        console.error('Delete project failed:', result.error);
        if (result.error) {
          window.alert(`删除项目失败：${result.error}`);
        }
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
      window.alert(`删除项目时发生错误：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Check if this is the floating ball window
  const isFloatingBall = window.location.hash === '#/floating-ball' || window.location.hash === '#floating-ball';
  
  // Check if this is a terminal window
  const isTerminalWindow = window.location.hash.includes('terminal-window');

  // SSO 登录成功回调
  const handleSsoLoginSuccess = (userInfo: SsoUserInfo) => {
    setSsoUser(userInfo);
    setSsoChecked(true);
  };

  // 处理启动加载完成：先做 SSO 检查，再标记 isAppReady
  const handleSplashComplete = async (payload?: unknown) => {
    if (payload && typeof payload === 'object' && payload !== null && 'id' in payload && 'name' in payload) {
      setCurrentProject(payload as Project);
    }

    // SSO 静默检查：有本地 token 则直接恢复，无则展示登录页
    try {
      const result = await window.ipcRenderer.invoke('sso:check-session') as {
        loggedIn: boolean;
        userInfo: SsoUserInfo | null;
      };
      if (result.loggedIn && result.userInfo) {
        setSsoUser(result.userInfo);
        setSsoChecked(true);
      }
      // 若未登录，setSsoChecked 保持 false → 展示 SsoLoginView
    } catch {
      // SSO 检查失败不阻断启动（离线等情况下允许跳过）
      setSsoChecked(true);
    }

    setIsAppReady(true);
  };


  useEffect(() => {
    // Listen for history updates (don't reset isProcessing here - wait for agent:done)
    const removeListener = window.ipcRenderer.on('agent:history-update', (_event, ...args) => {
      const updatedHistory = args[0] as Anthropic.MessageParam[];
      setHistory(updatedHistory);
    });

    const removeErrorListener = window.ipcRenderer.on('agent:error', (_event, ...args) => {
      const payload = args[0] as string | { message: string; taskId?: string; projectId?: string };
      const err = typeof payload === 'string' ? payload : (payload?.message ?? '');
      const taskId = typeof payload === 'object' && payload?.taskId ? payload.taskId : undefined;
      const projectId = typeof payload === 'object' && payload?.projectId ? payload.projectId : undefined;
      console.error("Agent Error:", err);

      // 项目/自动化视图：将当前任务标记为失败
      const view = activeViewRef.current;
      if (taskId) {
        if (projectId) {
          if (view === 'automation') {
            window.ipcRenderer.invoke('rpa:task:update', projectId, taskId, { status: 'failed' });
          } else {
            window.ipcRenderer.invoke('project:task:update', projectId, taskId, { status: 'failed' });
          }
        } else {
          const store = view === 'automation' ? 'rpa:get-current-project' : 'project:get-current';
          window.ipcRenderer.invoke(store).then((result: unknown) => {
            const r = result as { id: string } | null;
            if (r?.id) {
              if (view === 'automation') {
                window.ipcRenderer.invoke('rpa:task:update', r.id, taskId, { status: 'failed' });
              } else {
                window.ipcRenderer.invoke('project:task:update', r.id, taskId, { status: 'failed' });
              }
            }
          });
        }
      }

      // Add error message to chat history so user can see it
      const errorMessage: Anthropic.MessageParam = {
        role: 'assistant',
        content: `⚠️ **错误发生**

${err}

请检查配置后重试。如果问题持续存在，请查看控制台日志获取更多信息。`
      };
      setHistory(prev => [...prev, errorMessage]);
      setIsProcessing(false);
    });

    const removeAbortListener = window.ipcRenderer.on('agent:aborted', () => {
      setIsProcessing(false);
    });

    // Only reset isProcessing when processing is truly done; 项目/自动化视图：将当前任务标记为完成
    const removeDoneListener = window.ipcRenderer.on('agent:done', (_event, ...args) => {
      const payload = args[0] as { taskId?: string; projectId?: string; hadError?: boolean } | undefined;
      const view = activeViewRef.current;
      // 有错误时任务状态已由 agent:error 处理器设为 failed，此处不覆盖为 completed
      if (payload?.taskId && !payload?.hadError) {
        const projectId = payload.projectId;
        if (projectId) {
          if (view === 'automation') {
            window.ipcRenderer.invoke('rpa:task:update', projectId, payload.taskId, { status: 'completed' });
          } else {
            window.ipcRenderer.invoke('project:task:update', projectId, payload.taskId, { status: 'completed' });
          }
        } else {
          const store = view === 'automation' ? 'rpa:get-current-project' : 'project:get-current';
          window.ipcRenderer.invoke(store).then((result: unknown) => {
            const r = result as { id: string } | null;
            if (r?.id) {
              if (view === 'automation') {
                window.ipcRenderer.invoke('rpa:task:update', r.id, payload.taskId!, { status: 'completed' });
              } else {
                window.ipcRenderer.invoke('project:task:update', r.id, payload.taskId!, { status: 'completed' });
              }
            }
          });
        }
      }
      setIsProcessing(false);
    });

    const removeAgentReadyListener = window.ipcRenderer.on('agent:ready', () => {
      setAgentInitFailed(null);
      // Agent 就绪后，若当前处于 cowork 模式，自动加载最近一次历史会话
      window.ipcRenderer.invoke('session:auto-load').catch((err) => {
        console.warn('[App] session:auto-load on agent:ready failed:', err);
      });
    });

    const removeAgentInitFailedListener = window.ipcRenderer.on('agent:init-failed', (_event, ...args) => {
      const payload = args[0] as { reason?: string } | undefined;
      const reason = payload?.reason || 'unknown';
      console.warn('[App] Agent init failed, reason:', reason);
      setAgentInitFailed(reason);
    });

    return () => {
      removeListener();
      removeErrorListener();
      removeAbortListener();
      removeDoneListener();
      removeAgentReadyListener();
      removeAgentInitFailedListener();
    };
  }, []);

  /** 供代码质量自动修复等逻辑判断：主进程是否因「助手正忙」拒绝发送 */
  const handleSendMessage = async (
    msg: string | { content: string; images: string[] }
  ): Promise<{ ok: true } | { ok: false; busy?: boolean }> => {
    console.log('[Preview:Debug] handleSendMessage called, activeView:', activeView, 'msg type:', typeof msg);
    setIsProcessing(true);
    try {
      console.log('[Preview:Debug] invoking agent:send-message...');
      const result = await window.ipcRenderer.invoke('agent:send-message', msg, activeView) as
        | { error?: string; ok?: boolean; status?: number }
        | undefined;
      console.log('[Preview:Debug] agent:send-message returned:', result);
      if (result && 'ok' in result && result.ok === false) {
        console.error('[App] agent:send-message API error:', result.status, result.error);
        setIsProcessing(false);
        return { ok: false };
      }
      if (result?.error) {
        console.error(result.error);
        if (result.error === 'Agent not initialized') {
          window.alert('AI 引擎尚未就绪，请稍候几秒后重试。\n\n如果问题持续，请检查 Settings 中的 API Key 是否已配置。');
        }
        setIsProcessing(false);
        return { ok: false };
      }
      return { ok: true };
    } catch (err) {
      console.error('[Preview:Debug] agent:send-message threw:', err);
      setIsProcessing(false);
      const em = err instanceof Error ? err.message : String(err);
      const busy = /already processing|Task .+ is already processing/i.test(em);
      return { ok: false, busy };
    }
  };

  const handleAbort = () => {
    window.ipcRenderer.invoke('agent:abort');
    setIsProcessing(false);
  };

  // Preview handler: delegates to ProjectView's internal handlePreview via ref
  const handlePreview = () => {
    previewHandlerRef.current?.();
  };

  // Deploy handler: delegates to ProjectView's internal handleDeploy via ref
  const handleDeploy = () => {
    deployHandlerRef.current?.();
  };

  // If this is the floating ball window, render only the floating ball
  if (isFloatingBall) {
    return <FloatingBallPage />;
  }

  // If this is a terminal window, render only the terminal
  if (isTerminalWindow) {
    return <TerminalWindow />;
  }

  // Show splash screen during initialization
  if (!isAppReady) {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  // SSO 未登录 → 展示登录页（全屏）
  if (!ssoChecked) {
    return (
      <div className="h-screen w-full bg-[#FAF8F5] dark:bg-zinc-950 flex flex-col overflow-hidden font-sans">
        <SsoLoginView onLoginSuccess={handleSsoLoginSuccess} />
      </div>
    );
  }

  // Main App - Narrow vertical layout
  return (
    <div className="h-screen w-full bg-[#FAF8F5] dark:bg-zinc-950 flex flex-col overflow-hidden font-sans text-stone-900 dark:text-zinc-100">
      {/* Custom Titlebar */}
      <header
        className={`h-10 border-b border-stone-200/80 dark:border-zinc-800 flex items-center bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm shrink-0 transition-colors relative z-50 ${navigator.userAgent.includes('Mac') ? 'pl-20 pr-3' : 'px-3'
          }`}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        onDoubleClick={() => window.ipcRenderer.invoke('window:maximize')}
      >
        {/* Left section: Logo + title + panel toggles */}
        <div className="flex items-center gap-2 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <img src="./icon.png" alt="Logo" className="w-4 h-4 rounded-sm object-cover" />
          <span className="font-medium text-stone-700 dark:text-zinc-200 text-xs mr-2">QACowork</span>
          
          {/* Task Panel Toggle Button - Show in Project and Automation view */}
          {(activeView === 'project' || activeView === 'automation') && (
            <button
              onClick={() => setIsTaskPanelHidden(!isTaskPanelHidden)}
              className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 rounded transition-colors"
              title={isTaskPanelHidden ? t('showTaskList') : t('hideTaskList')}
              aria-label={isTaskPanelHidden ? t('showTaskList') : t('hideTaskList')}
            >
              {isTaskPanelHidden ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          )}

          {/* RPA Project Selector - Only show in Automation view when wide enough */}
          {activeView === 'automation' && !isNarrowWindow && (
            <div className="relative" ref={rpaProjectDropdownRef}>
              <button
                ref={rpaProjectButtonRef}
                disabled={isProcessing || isRpaExecuting}
                title={isProcessing || isRpaExecuting ? '执行中，请等待完成后再切换项目' : undefined}
                onClick={() => {
                  if (isProcessing || isRpaExecuting) return;
                  if (rpaProjectButtonRef.current) {
                    const rect = rpaProjectButtonRef.current.getBoundingClientRect();
                    setDropdownPosition({ top: rect.bottom + 4, left: rect.left });
                  }
                  setShowRpaProjectDropdown(!showRpaProjectDropdown);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  isProcessing || isRpaExecuting
                    ? 'text-stone-400 dark:text-zinc-500 opacity-50 cursor-not-allowed'
                    : 'text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Bot size={14} />
                <span className="max-w-[200px] truncate">
                  {currentRpaProject?.name || t('noProjectSelected')}
                </span>
                <ChevronDown size={14} className={`transition-transform ${showRpaProjectDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showRpaProjectDropdown && (
                <div
                  className="fixed bg-white dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-lg shadow-lg px-3 py-2 z-[9999] min-w-[260px] max-w-[340px] max-h-[420px] overflow-y-auto"
                  style={{
                    top: `${dropdownPosition.top}px`,
                    left: `${dropdownPosition.left}px`
                  }}
                >
                  <button
                    type="button"
                    onClick={handleNewRpaProjectClick}
                    className="w-full text-left px-2 py-1.5 text-sm text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-700 flex items-center gap-2 transition-colors rounded-md"
                  >
                    <Bot size={16} />
                    {t('newProject')}
                  </button>
                  <div className="border-t border-stone-200 dark:border-zinc-700 my-2" />
                  <div className="px-2 py-2 text-xs font-medium text-stone-400 dark:text-zinc-500">
                    {t('recent')}
                  </div>
                  {rpaProjects.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-stone-400 dark:text-zinc-500 text-center">
                      {t('noProjects')}
                    </div>
                  ) : (
                    sortedRpaProjects.map(project => (
                        <div
                          key={project.id}
                          className={`group relative flex items-center rounded-md ${
                            currentRpaProject?.id === project.id
                              ? 'bg-orange-50 dark:bg-orange-500/10'
                              : 'hover:bg-stone-50 dark:hover:bg-zinc-700'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleSelectRpaProject(project.id)}
                            className={`flex-1 w-full text-left px-2 py-2 text-sm transition-colors flex items-center gap-1.5 ${
                              currentRpaProject?.id === project.id
                                ? 'text-orange-600 dark:text-orange-400 font-medium'
                                : 'text-stone-700 dark:text-zinc-300'
                            }`}
                          >
                            <Bot size={12} />
                            <span className="flex-1 truncate" title={project.path}>{project.name}</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.ipcRenderer.invoke('directory:open-path', project.path);
                            }}
                            className="p-1 text-stone-400 hover:text-amber-500 dark:hover:text-amber-400 rounded transition-colors opacity-0 group-hover:opacity-100"
                            title={t('openFolder')}
                            aria-label={t('openFolder')}
                          >
                            <FolderOpen size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteRpaProject(e, project)}
                            className="p-1 text-stone-400 hover:text-red-500 dark:hover:text-red-400 rounded transition-colors opacity-0 group-hover:opacity-100"
                            title={t('delete')}
                            aria-label={t('delete')}
                          >
                            <Trash2 size={12} />
                          </button>
                          {currentRpaProject?.id === project.id && (
                            <span className="text-orange-500 dark:text-orange-400 shrink-0 mr-1.5 ml-1 text-xs" aria-hidden>✓</span>
                          )}
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* Project Selector - Only show in Project view when wide enough */}
          {activeView === 'project' && !isNarrowWindow && (
            <div className="relative" ref={projectDropdownRef}>
              <button
                ref={projectButtonRef}
                disabled={isProcessing}
                title={isProcessing ? '任务执行中，请等待完成后再切换项目' : undefined}
                onClick={() => {
                  if (isProcessing) return;
                  if (projectButtonRef.current) {
                    const rect = projectButtonRef.current.getBoundingClientRect();
                    setDropdownPosition({ top: rect.bottom + 4, left: rect.left });
                  }
                  setShowProjectDropdown(!showProjectDropdown);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  isProcessing
                    ? 'text-stone-400 dark:text-zinc-500 opacity-50 cursor-not-allowed'
                    : 'text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800'
                }`}
              >
                <FolderOpen size={14} />
                <span className="max-w-[200px] truncate">
                  {currentProject?.name || t('noProjectSelected')}
                </span>
                <ChevronDown size={14} className={`transition-transform ${showProjectDropdown ? 'rotate-180' : ''}`} />
              </button>
              
              {/* Project Dropdown Menu */}
              {showProjectDropdown && (
                <div
                  ref={projectDropdownRef}
                  className="fixed bg-white dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-lg shadow-lg px-3 py-2 z-[9999] min-w-[260px] max-w-[340px] max-h-[420px] overflow-y-auto"
                  style={{
                    top: `${dropdownPosition.top}px`,
                    left: `${dropdownPosition.left}px`
                  }}
                >
                  <button
                    type="button"
                    onClick={handleOpenFolder}
                    className="w-full text-left px-2 py-1.5 text-sm text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-700 flex items-center gap-2 transition-colors rounded-md"
                  >
                    <FolderOpen size={16} />
                    {t('openFolder')}
                  </button>
                  <button
                    type="button"
                    onClick={handleNewProjectClick}
                    className="w-full text-left px-2 py-1.5 text-sm text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-700 flex items-center gap-2 transition-colors rounded-md"
                  >
                    <FolderPlus size={16} />
                    {t('newProject')}
                  </button>
                  <div className="border-t border-stone-200 dark:border-zinc-700 my-2" />
                  <div className="px-2 py-2 text-xs font-medium text-stone-400 dark:text-zinc-500">
                    {t('recent')}
                  </div>
                  {projects.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-stone-400 dark:text-zinc-500 text-center">
                      {t('noProjects')}
                    </div>
                  ) : (
                    <>
                      {sortedProjects.map(project => (
                          <div
                            key={project.id}
                            className={`group relative flex items-center rounded-md ${
                              currentProject?.id === project.id
                                ? 'bg-orange-50 dark:bg-orange-500/10'
                                : 'hover:bg-stone-50 dark:hover:bg-zinc-700'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => handleSelectProject(project.id)}
                              className={`flex-1 w-full text-left px-2 py-2 text-sm transition-colors flex items-center gap-1.5 ${
                                currentProject?.id === project.id
                                  ? 'text-orange-600 dark:text-orange-400 font-medium'
                                  : 'text-stone-700 dark:text-zinc-300'
                              }`}
                            >
                              <FolderOpen size={12} />
                              <span className="flex-1 truncate" title={project.path}>{project.name}</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.ipcRenderer.invoke('directory:open-path', project.path);
                              }}
                              className="p-1 text-stone-400 hover:text-amber-500 dark:hover:text-amber-400 rounded transition-colors opacity-0 group-hover:opacity-100"
                              title={t('openFolder')}
                              aria-label={t('openFolder')}
                            >
                              <FolderOpen size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteProject(e, project)}
                              className="p-1 text-stone-400 hover:text-red-500 dark:hover:text-red-400 rounded transition-colors opacity-0 group-hover:opacity-100"
                              title={t('delete')}
                              aria-label={t('delete')}
                            >
                              <Trash2 size={12} />
                            </button>
                            {currentProject?.id === project.id && (
                              <span className="text-orange-500 dark:text-orange-400 shrink-0 mr-1.5 ml-1 text-xs" aria-hidden>✓</span>
                            )}
                          </div>
                        ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          
        </div>

        {/* Center drag region (fills remaining space, fully draggable) */}
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

        {/* Right section: Navigation tabs + version + action buttons */}
        <div className="flex items-center gap-3 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Navigation Tabs */}
          <div
            className="flex items-center gap-0.5 bg-stone-100 dark:bg-zinc-800 rounded-lg p-0.5"
            title={isProcessing ? '任务执行中，请等待完成后再切换模式' : undefined}
          >
            <button
              onClick={() => handleModeSwitch('cowork')}
              title={isProcessing ? '任务执行中，请等待完成后再切换模式' : t('cowork')}
              disabled={isProcessing}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all whitespace-nowrap ${activeView === 'cowork'
                ? 'bg-white dark:bg-zinc-700 text-stone-800 dark:text-zinc-100 shadow-sm'
                : 'text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200'
                } ${isProcessing && activeView !== 'cowork' ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`}
            >
              <Zap size={12} />
              <span className="max-[480px]:hidden">{t('cowork')}</span>
            </button>
            <button
              onClick={() => handleModeSwitch('project')}
              title={isProcessing ? '任务执行中，请等待完成后再切换模式' : t('project')}
              disabled={isProcessing}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all whitespace-nowrap ${activeView === 'project'
                ? 'bg-white dark:bg-zinc-700 text-stone-800 dark:text-zinc-100 shadow-sm'
                : 'text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200'
                } ${isProcessing && activeView !== 'project' ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`}
            >
              <FolderKanban size={12} />
              <span className="max-[480px]:hidden">{t('project')}</span>
            </button>
            <button
              onClick={() => handleModeSwitch('automation')}
              title={isProcessing ? '任务执行中，请等待完成后再切换模式' : t('automation')}
              disabled={isProcessing}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all whitespace-nowrap ${activeView === 'automation'
                ? 'bg-white dark:bg-zinc-700 text-stone-800 dark:text-zinc-100 shadow-sm'
                : 'text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200'
                } ${isProcessing && activeView !== 'automation' ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`}
            >
              <Bot size={12} />
              <span className="max-[480px]:hidden">{t('automation')}</span>
            </button>
          </div>
          {/* SSO 用户信息 */}
          {ssoUser && !isNarrowWindow && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-stone-100 dark:bg-zinc-800 cursor-default">
              <div className="w-5 h-5 rounded-full bg-orange-400 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                {ssoUser.name.charAt(0)}
              </div>
              <span className="text-xs text-stone-600 dark:text-zinc-300 max-w-[80px] truncate">{ssoUser.name}</span>
            </div>
          )}

          {/* Explorer Panel Toggle - Only show in Project view when wide enough */}
          {activeView === 'project' && !isNarrowWindow && (
            <button
              onClick={() => setIsExplorerPanelHidden(!isExplorerPanelHidden)}
              className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 rounded transition-colors"
              title={isExplorerPanelHidden ? t('showExplorer') : t('hideExplorer')}
              aria-label={isExplorerPanelHidden ? t('showExplorer') : t('hideExplorer')}
            >
              {isExplorerPanelHidden ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
            </button>
          )}
          {/* Preview Button - Only show in Project view when wide enough */}
          {activeView === 'project' && currentProject && !isNarrowWindow && (
            <button
              onClick={handlePreview}
              disabled={isProcessing}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                isProcessing
                  ? 'bg-stone-400 text-white cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
              title={t('previewButtonTitle')}
              aria-label={t('preview')}
            >
              {isProcessing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Monitor size={14} />
              )}
              {t('preview') || '预览'}
            </button>
          )}
          {/* Deploy Button - Only show in Project view when wide enough */}
          {activeView === 'project' && currentProject && !isNarrowWindow && (
            <button
              onClick={handleDeploy}
              disabled={deployStatus === 'deploying'}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                deployStatus === 'deploying'
                  ? 'bg-orange-400 text-white cursor-not-allowed'
                  : deployStatus === 'success'
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : deployStatus === 'error'
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-orange-500 hover:bg-orange-600 text-white'
              }`}
              title={t('deployButtonTitle')}
              aria-label={t('deploy')}
            >
              {deployStatus === 'deploying' ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t('deploying')}
                </>
              ) : deployStatus === 'success' ? (
                <>
                  <CheckCircle size={14} />
                  {t('deploySuccess')}
                </>
              ) : (
                <>
                  <Rocket size={14} />
                  {t('deploy')}
                </>
              )}
            </button>
          )}

          {!navigator.userAgent.includes('Mac') && (
            <div className="flex items-center gap-1">
              {/* Window Controls - Windows/Linux Only */}
              <button
                onClick={() => window.ipcRenderer.invoke('window:minimize')}
                className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded transition-colors"
                title="Minimize"
              >
                <Minus size={14} />
              </button>
              <button
                onClick={() => window.ipcRenderer.invoke('window:maximize')}
                className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded transition-colors"
                title="Maximize"
              >
                <Square size={12} />
              </button>
              <button
                onClick={() => window.ipcRenderer.invoke('window:close')}
                className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-red-100 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Agent Init Failed Banner */}
      {agentInitFailed && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>
              {agentInitFailed === 'no_api_key'
                ? 'AI 引擎未启动：API Key 未配置。'
                : `AI 引擎启动失败（${agentInitFailed}）。`}
            </span>
            <button
              onClick={() => setShowSettings(true)}
              className="underline font-medium hover:text-amber-900 dark:hover:text-amber-200 transition-colors"
            >
              前往 Settings 配置
            </button>
          </div>
          <button
            onClick={() => setAgentInitFailed(null)}
            className="p-0.5 hover:text-amber-900 dark:hover:text-amber-200 transition-colors shrink-0"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {activeView === 'cowork' ? (
          <CoworkView
            history={history}
            onSendMessage={handleSendMessage}
            onAbort={handleAbort}
            isProcessing={isProcessing}
            onOpenSettings={() => setShowSettings(true)}
          />
        ) : activeView === 'automation' ? (
          <AutomationView
            history={history}
            onSendMessage={handleSendMessage}
            onAbort={handleAbort}
            isProcessing={isProcessing}
            isTaskPanelHidden={isTaskPanelHidden}
            onToggleTaskPanel={() => setIsTaskPanelHidden(!isTaskPanelHidden)}
            isNarrowWindow={isNarrowWindow}
            onExecutingChange={setIsRpaExecuting}
          />
        ) : (
          <ProjectView
            history={history}
            onSendMessage={handleSendMessage}
            onAbort={handleAbort}
            isProcessing={isProcessing}
            isDeploying={deployStatus === 'deploying'}
            onOpenSettings={() => setShowSettings(true)}
            isTaskPanelHidden={isTaskPanelHidden}
            onToggleTaskPanel={() => setIsTaskPanelHidden(!isTaskPanelHidden)}
            isExplorerPanelHidden={isExplorerPanelHidden}
            onToggleExplorerPanel={() => setIsExplorerPanelHidden(!isExplorerPanelHidden)}
            isNarrowWindow={isNarrowWindow}
            appCurrentProject={currentProject}
            onRegisterPreviewHandler={(handler) => { previewHandlerRef.current = handler; }}
            onRegisterDeployHandler={(handler) => { deployHandlerRef.current = handler; }}
            onDeployStatusChange={(status) => setDeployStatus(status)}
          />
        )}
        {showSettings && (
          <div className="absolute inset-0 z-50">
            <SettingsView onClose={() => setShowSettings(false)} />
          </div>
        )}
      </main>

      {/* New RPA Project Dialog */}
      {showNewRpaProjectDialog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-rpa-project-dialog-title"
          onClick={() => {
            setShowNewRpaProjectDialog(false);
            setNewRpaProjectName('');
          }}
        >
          <div
            className="bg-white dark:bg-zinc-800 rounded-xl shadow-xl border border-stone-200 dark:border-zinc-700 p-5 w-[460px] max-w-[95vw]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowNewRpaProjectDialog(false);
                setNewRpaProjectName('');
              }
              if (e.key === 'Enter') handleCreateNewRpaProject();
            }}
          >
            <h2 id="new-rpa-project-dialog-title" className="text-base font-semibold text-stone-800 dark:text-zinc-100 mb-3">
              新建自动化项目
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-zinc-300 mb-2">
                  {t('projectName')}
                </label>
                <input
                  type="text"
                  value={newRpaProjectName}
                  onChange={(e) => setNewRpaProjectName(e.target.value)}
                  placeholder={t('newProjectNamePlaceholder')}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 placeholder-stone-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400"
                  autoFocus
                  aria-label={t('projectName')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-zinc-300 mb-2">
                  创建位置
                </label>
                <div className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-600 bg-stone-50 dark:bg-zinc-900/50 text-stone-600 dark:text-zinc-400 text-sm whitespace-nowrap overflow-x-auto min-w-0">
                  ~/Library/Application Support/qacowork/rpaProjects
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => {
                  setShowNewRpaProjectDialog(false);
                  setNewRpaProjectName('');
                }}
                className="px-3 py-1.5 text-sm text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleCreateNewRpaProject()}
                disabled={!newRpaProjectName.trim()}
                className="px-3 py-1.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {t('createProject')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Project Dialog */}
      {showNewProjectDialog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-project-dialog-title"
          onClick={() => {
            setShowNewProjectDialog(false);
            setNewProjectName('');
          }}
        >
          <div
            className="bg-white dark:bg-zinc-800 rounded-xl shadow-xl border border-stone-200 dark:border-zinc-700 p-5 w-[420px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowNewProjectDialog(false);
                setNewProjectName('');
              }
              if (e.key === 'Enter') handleCreateNewProject();
            }}
          >
            <h2 id="new-project-dialog-title" className="text-base font-semibold text-stone-800 dark:text-zinc-100 mb-3">
              {t('createNewProject')}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-zinc-300 mb-2">
                  {t('projectName')}
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder={t('newProjectNamePlaceholder')}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 placeholder-stone-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400"
                  autoFocus
                  aria-label={t('projectName')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-zinc-300 mb-2">
                  创建位置
                </label>
                <div className="px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-600 bg-stone-50 dark:bg-zinc-900/50 text-stone-600 dark:text-zinc-400 text-sm">
                  ~/Library/Application Support/qacowork/projects
                </div>
                <p className="mt-1 text-xs text-stone-500 dark:text-zinc-500">
                  项目将创建在上述目录下，不支持修改
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => {
                  setShowNewProjectDialog(false);
                  setNewProjectName('');
                }}
                className="px-3 py-1.5 text-sm text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={handleCreateNewProject}
                disabled={!newProjectName.trim()}
                className="px-3 py-1.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {t('createProject')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        request={pendingRequest}
        onConfirm={handleConfirm}
        onDeny={handleDeny}
      />
    </div>
  );
}

export default App;
