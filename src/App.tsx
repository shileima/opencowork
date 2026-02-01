import { useState, useEffect, useRef } from 'react';
import { Minus, Square, X, MessageCircle, Zap, FolderKanban, ChevronLeft, ChevronRight, ChevronDown, FolderOpen, FolderPlus, Trash2 } from 'lucide-react';
import { CoworkView } from './components/CoworkView';
import { SettingsView } from './components/SettingsView';
import { ConfirmDialog, useConfirmations } from './components/ConfirmDialog';
import { FloatingBallPage } from './components/FloatingBallPage';
import { ProjectView } from './components/ProjectView';
import { useI18n } from './i18n/I18nContext';
import Anthropic from '@anthropic-ai/sdk';

type ViewType = 'cowork' | 'project';

function App() {
  const [history, setHistory] = useState<Anthropic.MessageParam[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');
  const [activeView, setActiveView] = useState<ViewType>('project');
  const [isTaskPanelHidden, setIsTaskPanelHidden] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [currentProject, setCurrentProject] = useState<any | null>(null);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const projectButtonRef = useRef<HTMLButtonElement>(null);
  const { pendingRequest, handleConfirm, handleDeny } = useConfirmations();
  const { t } = useI18n();

  // 当切换到 Project 模式时最大化窗口，切换回 Cowork 时恢复窗口大小
  useEffect(() => {
    window.ipcRenderer.invoke('window:set-maximized', activeView === 'project');
  }, [activeView]);

  // 从 localStorage 加载任务面板隐藏状态
  useEffect(() => {
    if (activeView === 'project') {
      const saved = localStorage.getItem('projectView:taskPanelHidden');
      if (saved === 'true') {
        setIsTaskPanelHidden(true);
      }
    }
  }, [activeView]);

  // 保存任务面板隐藏状态到 localStorage
  useEffect(() => {
    if (activeView === 'project') {
      localStorage.setItem('projectView:taskPanelHidden', String(isTaskPanelHidden));
    }
  }, [isTaskPanelHidden, activeView]);

  // 加载项目列表
  useEffect(() => {
    if (activeView === 'project') {
      loadProjects();
    }
  }, [activeView]);

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
        loadCurrentProject();
      });

      return () => {
        removeProjectCreatedListener();
        removeProjectSwitchedListener();
      };
    }
  }, [activeView]);

  // 点击外部关闭项目下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target as Node)) {
        setShowProjectDropdown(false);
      }
    };

    if (showProjectDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showProjectDropdown]);

  const loadProjects = async () => {
    try {
      const list = await window.ipcRenderer.invoke('project:list') as any[];
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
      const result = await window.ipcRenderer.invoke('project:create-new', name) as { success: boolean; error?: string; project?: unknown };
      if (result.success) {
        await loadProjects();
        await loadCurrentProject();
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
      const project = await window.ipcRenderer.invoke('project:get-current') as any | null;
      setCurrentProject(project);
      // Project 模式：确保主工作目录为 ~/.qa-cowork
      if (project) {
        window.ipcRenderer.invoke('project:ensure-working-dir');
      }
    } catch (error) {
      console.error('Failed to load current project:', error);
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

  const handleDeleteProject = async (e: React.MouseEvent, project: { id: string; name: string }) => {
    e.stopPropagation();
    if (!window.confirm(`${t('confirmDeleteProject')} "${project.name}"?`)) return;
    try {
      const result = await window.ipcRenderer.invoke('project:delete', project.id) as { success: boolean };
      if (result.success) {
        await loadProjects();
        await loadCurrentProject();
        setShowProjectDropdown(false);
        window.ipcRenderer.send('project:switched');
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  // Check if this is the floating ball window
  const isFloatingBall = window.location.hash === '#/floating-ball' || window.location.hash === '#floating-ball';

  // 获取应用版本号
  useEffect(() => {
    // 尝试从 IPC 获取版本号，如果没有则使用默认值
    window.ipcRenderer.invoke('app:get-version').then((version) => {
      setAppVersion(version as string || '');
    }).catch(() => {
      // 如果 IPC 方法不存在，使用 package.json 中的版本（在构建时注入）
      setAppVersion(import.meta.env.VITE_APP_VERSION || '');
    });
  }, []);

  useEffect(() => {
    // Listen for history updates (don't reset isProcessing here - wait for agent:done)
    const removeListener = window.ipcRenderer.on('agent:history-update', (_event, ...args) => {
      const updatedHistory = args[0] as Anthropic.MessageParam[];
      setHistory(updatedHistory);
    });

    const removeErrorListener = window.ipcRenderer.on('agent:error', (_event, ...args) => {
      const payload = args[0] as string | { message: string; taskId?: string };
      const err = typeof payload === 'string' ? payload : (payload?.message ?? '');
      const taskId = typeof payload === 'object' && payload?.taskId ? payload.taskId : undefined;
      console.error("Agent Error:", err);

      // 项目视图：将当前任务标记为失败
      if (taskId) {
        window.ipcRenderer.invoke('project:get-current').then((project: { id: string } | null) => {
          if (project?.id) {
            window.ipcRenderer.invoke('project:task:update', project.id, taskId, { status: 'failed' });
          }
        });
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

    // Only reset isProcessing when processing is truly done; 项目视图：将当前任务标记为完成
    const removeDoneListener = window.ipcRenderer.on('agent:done', (_event, ...args) => {
      const payload = args[0] as { taskId?: string } | undefined;
      if (payload?.taskId) {
        window.ipcRenderer.invoke('project:get-current').then((project: { id: string } | null) => {
          if (project?.id) {
            window.ipcRenderer.invoke('project:task:update', project.id, payload.taskId, { status: 'completed' });
          }
        });
      }
      setIsProcessing(false);
    });

    return () => {
      removeListener();
      removeErrorListener();
      removeAbortListener();
      removeDoneListener();
    };
  }, []);

  const handleSendMessage = async (msg: string | { content: string, images: string[] }) => {
    setIsProcessing(true);
    try {
      const result = await window.ipcRenderer.invoke('agent:send-message', msg) as { error?: string } | undefined;
      if (result?.error) {
        console.error(result.error);
        setIsProcessing(false);
      }
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
    }
  };

  const handleAbort = () => {
    window.ipcRenderer.invoke('agent:abort');
    setIsProcessing(false);
  };

  // If this is the floating ball window, render only the floating ball
  if (isFloatingBall) {
    return <FloatingBallPage />;
  }

  // Main App - Narrow vertical layout
  return (
    <div className="h-screen w-full bg-[#FAF8F5] dark:bg-zinc-950 flex flex-col overflow-hidden font-sans text-stone-900 dark:text-zinc-100">
      {/* Custom Titlebar */}
      <header
        className={`h-10 border-b border-stone-200/80 dark:border-zinc-800 flex items-center justify-between bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm shrink-0 transition-colors relative z-50 ${navigator.userAgent.includes('Mac') ? 'pl-20 pr-3' : 'px-3'
          }`}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-4" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <img src="./icon.png" alt="Logo" className="w-6 h-6 rounded-md object-cover" />
          <span className="font-medium text-stone-700 dark:text-zinc-200 text-sm">QACowork</span>
          
          {/* Task Panel Toggle Button - Only show in Project view */}
          {activeView === 'project' && (
            <button
              onClick={() => setIsTaskPanelHidden(!isTaskPanelHidden)}
              className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 rounded transition-colors"
              title={isTaskPanelHidden ? t('showTaskList') : t('hideTaskList')}
            >
              {isTaskPanelHidden ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          )}

          {/* Project Selector - Only show in Project view */}
          {activeView === 'project' && (
            <div className="relative" ref={projectDropdownRef}>
              <button
                ref={projectButtonRef}
                onClick={() => {
                  if (projectButtonRef.current) {
                    const rect = projectButtonRef.current.getBoundingClientRect();
                    setDropdownPosition({ top: rect.bottom + 4, left: rect.left });
                  }
                  setShowProjectDropdown(!showProjectDropdown);
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
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
                  className="fixed bg-white dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-[9999] min-w-[260px] max-w-[340px] max-h-[420px] overflow-y-auto"
                  style={{
                    top: `${dropdownPosition.top}px`,
                    left: `${dropdownPosition.left}px`
                  }}
                >
                  <button
                    type="button"
                    onClick={handleOpenFolder}
                    className="w-full text-left px-4 py-2.5 text-sm text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-700 flex items-center gap-2 transition-colors"
                  >
                    <FolderOpen size={16} />
                    {t('openFolder')}
                  </button>
                  <button
                    type="button"
                    onClick={handleNewProjectClick}
                    className="w-full text-left px-4 py-2.5 text-sm text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-700 flex items-center gap-2 transition-colors"
                  >
                    <FolderPlus size={16} />
                    {t('newProject')}
                  </button>
                  <div className="border-t border-stone-200 dark:border-zinc-700 my-1" />
                  <div className="px-3 py-1.5 text-xs font-medium text-stone-400 dark:text-zinc-500">
                    {t('recent')}
                  </div>
                  {projects.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-stone-400 dark:text-zinc-500 text-center">
                      {t('noProjects')}
                    </div>
                  ) : (
                    <>
                      {[...projects]
                        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
                        .map(project => (
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
                              className={`flex-1 w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2 ${
                                currentProject?.id === project.id
                                  ? 'text-orange-600 dark:text-orange-400 font-medium'
                                  : 'text-stone-700 dark:text-zinc-300'
                              }`}
                            >
                              <FolderOpen size={14} />
                              <span className="flex-1 truncate" title={project.path}>{project.name}</span>
                              {currentProject?.id === project.id && (
                                <span className="text-orange-500 dark:text-orange-400 shrink-0">✓</span>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteProject(e, project)}
                              className="p-1.5 mr-2 text-stone-400 hover:text-red-500 dark:hover:text-red-400 rounded transition-colors opacity-0 group-hover:opacity-100"
                              title={t('delete')}
                              aria-label={t('delete')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* Navigation Tabs */}
          <div className="flex items-center gap-0.5 bg-stone-100 dark:bg-zinc-800 rounded-lg p-0.5 ml-4">
            <button
              onClick={() => setActiveView('cowork')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeView === 'cowork'
                ? 'bg-white dark:bg-zinc-700 text-stone-800 dark:text-zinc-100 shadow-sm'
                : 'text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200'
                }`}
            >
              <Zap size={14} />
              {t('cowork')}
            </button>
            <button
              onClick={() => setActiveView('project')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeView === 'project'
                ? 'bg-white dark:bg-zinc-700 text-stone-800 dark:text-zinc-100 shadow-sm'
                : 'text-stone-500 dark:text-zinc-400 hover:text-stone-700 dark:hover:text-zinc-200'
                }`}
            >
              <FolderKanban size={14} />
              {t('project')}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Version - Always show on the right */}
          {appVersion && (
            <span className="text-xs text-stone-500 dark:text-zinc-500">{appVersion}</span>
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

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative">
        {activeView === 'cowork' ? (
          <CoworkView
            history={history}
            onSendMessage={handleSendMessage}
            onAbort={handleAbort}
            isProcessing={isProcessing}
            onOpenSettings={() => setShowSettings(true)}
          />
        ) : (
          <ProjectView
            history={history}
            onSendMessage={handleSendMessage}
            onAbort={handleAbort}
            isProcessing={isProcessing}
            onOpenSettings={() => setShowSettings(true)}
            isTaskPanelHidden={isTaskPanelHidden}
            onToggleTaskPanel={() => setIsTaskPanelHidden(!isTaskPanelHidden)}
          />
        )}
        {showSettings && (
          <div className="absolute inset-0 z-50">
            <SettingsView onClose={() => setShowSettings(false)} />
          </div>
        )}
      </main>

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
            className="bg-white dark:bg-zinc-800 rounded-xl shadow-xl border border-stone-200 dark:border-zinc-700 p-5 w-[360px] max-w-[90vw]"
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
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder={t('newProjectNamePlaceholder')}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 placeholder-stone-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 mb-4"
              autoFocus
              aria-label={t('projectName')}
            />
            <div className="flex justify-end gap-2">
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
