/**
 * 类型化的 IPC API 封装
 * 提供类型安全的主进程通信接口,替换直接的 window.ipcRenderer 调用
 */

import type {
  Project,
  ProjectOperationResult,
  RPAProject,
  RPAProjectOperationResult,
  RPATask,
  RPATaskOperationResult,
  Session,
  AppConfig,
  AppInfo,
  WindowState,
  FileItem,
  FileOperationResult,
  AgentResponse,
  SsoUserInfo,
  SsoLoginResult,
  DeployResult,
  UpdateCheckResult,
} from './types';

/**
 * 通用的 IPC 调用封装
 */
function invoke<T = any>(channel: string, ...args: any[]): Promise<T> {
  return window.ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

/**
 * 通用的 IPC 事件监听
 */
function on(
  channel: string,
  listener: (event: any, ...args: any[]) => void
): () => void {
  return window.ipcRenderer.on(channel, listener);
}

// ==================== 项目管理 API ====================

export const projectApi = {
  /**
   * 获取所有项目列表
   */
  list(): Promise<Project[]> {
    return invoke<Project[]>('project:list');
  },

  /**
   * 获取当前项目
   */
  getCurrent(): Promise<Project | null> {
    return invoke<Project | null>('project:get-current');
  },

  /**
   * 创建新项目
   */
  create(name: string, path?: string): Promise<ProjectOperationResult> {
    return invoke<ProjectOperationResult>('project:create-new', name, path);
  },

  /**
   * 切换项目
   */
  switch(projectId: string): Promise<ProjectOperationResult> {
    return invoke<ProjectOperationResult>('project:switch', projectId);
  },

  /**
   * 删除项目
   */
  delete(projectId: string): Promise<{ success: boolean; error?: string; warning?: string }> {
    return invoke<{ success: boolean; error?: string; warning?: string }>('project:delete', projectId);
  },

  /**
   * 更新项目信息
   */
  update(projectId: string, updates: Partial<Project>): Promise<ProjectOperationResult> {
    return invoke<ProjectOperationResult>('project:update', projectId, updates);
  },

  /**
   * 监听项目切换事件
   */
  onSwitched(callback: (project: Project) => void): () => void {
    return on('project:switched', (_, project) => callback(project));
  },

  /**
   * 监听项目创建事件
   */
  onCreated(callback: (project: Project) => void): () => void {
    return on('project:created', (_, project) => callback(project));
  },

  /**
   * 监听项目删除事件
   */
  onDeleted(callback: (projectId: string) => void): () => void {
    return on('project:deleted', (_, projectId) => callback(projectId));
  },
};

// ==================== RPA 项目管理 API ====================

export const rpaProjectApi = {
  /**
   * 获取所有 RPA 项目列表
   */
  list(): Promise<RPAProject[]> {
    return invoke<RPAProject[]>('rpa:project:list');
  },

  /**
   * 获取当前 RPA 项目
   */
  getCurrent(): Promise<RPAProject | null> {
    return invoke<RPAProject | null>('rpa:get-current-project');
  },

  /**
   * 创建新 RPA 项目
   */
  create(name: string, description?: string): Promise<RPAProjectOperationResult> {
    return invoke<RPAProjectOperationResult>('rpa:project:create', name, description);
  },

  /**
   * 切换 RPA 项目
   */
  switch(projectId: string): Promise<RPAProjectOperationResult> {
    return invoke<RPAProjectOperationResult>('rpa:project:switch', projectId);
  },

  /**
   * 删除 RPA 项目
   */
  delete(projectId: string): Promise<{ success: boolean; error?: string; warning?: string }> {
    return invoke<{ success: boolean; error?: string; warning?: string }>('rpa:project:delete', projectId);
  },

  /**
   * 更新 RPA 项目信息
   */
  update(projectId: string, updates: Partial<RPAProject>): Promise<RPAProjectOperationResult> {
    return invoke<RPAProjectOperationResult>('rpa:project:update', projectId, updates);
  },

  /**
   * 监听 RPA 项目创建事件
   */
  onCreated(callback: (project: RPAProject) => void): () => void {
    return on('rpa:project:created', (_, project) => callback(project));
  },

  /**
   * 监听 RPA 项目删除事件
   */
  onDeleted(callback: (projectId: string) => void): () => void {
    return on('rpa:project:deleted', (_, projectId) => callback(projectId));
  },
};

// ==================== RPA 任务管理 API ====================

export const rpaTaskApi = {
  /**
   * 创建新任务
   */
  create(projectId: string, title: string, description?: string): Promise<RPATaskOperationResult> {
    return invoke<RPATaskOperationResult>('rpa:task:create', projectId, title, description);
  },

  /**
   * 更新任务
   */
  update(projectId: string, taskId: string, updates: Partial<RPATask>): Promise<RPATaskOperationResult> {
    return invoke<RPATaskOperationResult>('rpa:task:update', projectId, taskId, updates);
  },

  /**
   * 删除任务
   */
  delete(projectId: string, taskId: string): Promise<{ success: boolean; error?: string }> {
    return invoke<{ success: boolean; error?: string }>('rpa:task:delete', projectId, taskId);
  },

  /**
   * 开始执行任务
   */
  start(projectId: string, taskId: string): Promise<AgentResponse> {
    return invoke<AgentResponse>('rpa:task:start', projectId, taskId);
  },

  /**
   * 停止任务执行
   */
  stop(projectId: string, taskId: string): Promise<{ success: boolean }> {
    return invoke<{ success: boolean }>('rpa:task:stop', projectId, taskId);
  },

  /**
   * 监听任务创建事件
   */
  onCreated(callback: (task: RPATask) => void): () => void {
    return on('rpa:task:created', (_, task) => callback(task));
  },

  /**
   * 监听任务更新事件
   */
  onUpdated(callback: (task: RPATask) => void): () => void {
    return on('rpa:task:updated', (_, task) => callback(task));
  },

  /**
   * 监听任务删除事件
   */
  onDeleted(callback: (taskId: string) => void): () => void {
    return on('rpa:task:deleted', (_, taskId) => callback(taskId));
  },

  /**
   * 监听任务开始事件
   */
  onStarted(callback: (taskId: string) => void): () => void {
    return on('rpa:task:started', (_, taskId) => callback(taskId));
  },

  /**
   * 监听任务完成事件
   */
  onCompleted(callback: (taskId: string, result: any) => void): () => void {
    return on('rpa:task:completed', (_, taskId, result) => callback(taskId, result));
  },
};

// ==================== 会话管理 API ====================

export const sessionApi = {
  /**
   * 获取所有会话列表
   */
  list(): Promise<Session[]> {
    return invoke<Session[]>('session:list');
  },

  /**
   * 获取当前会话
   */
  getCurrent(): Promise<Session | null> {
    return invoke<Session | null>('session:get-current');
  },

  /**
   * 创建新会话
   */
  create(mode: 'cowork' | 'project' | 'automation'): Promise<Session> {
    return invoke<Session>('session:create', mode);
  },

  /**
   * 切换会话
   */
  switch(sessionId: string): Promise<Session> {
    return invoke<Session>('session:switch', sessionId);
  },

  /**
   * 保存会话
   */
  save(sessionId: string, messages: any[]): Promise<{ success: boolean }> {
    return invoke<{ success: boolean }>('session:save', sessionId, messages);
  },

  /**
   * 删除会话
   */
  delete(sessionId: string): Promise<{ success: boolean }> {
    return invoke<{ success: boolean }>('session:delete', sessionId);
  },
};

// ==================== 应用配置 API ====================

export const appApi = {
  /**
   * 获取应用信息
   */
  getInfo(): Promise<AppInfo> {
    return invoke<AppInfo>('app:get-info');
  },

  /**
   * 获取应用配置
   */
  getConfig(): Promise<AppConfig> {
    return invoke<AppConfig>('app:get-config');
  },

  /**
   * 更新应用配置
   */
  updateConfig(config: Partial<AppConfig>): Promise<{ success: boolean }> {
    return invoke<{ success: boolean }>('app:update-config', config);
  },

  /**
   * 设置当前视图
   */
  setActiveView(view: 'cowork' | 'project' | 'automation'): Promise<void> {
    return invoke<void>('app:set-active-view', view);
  },

  /**
   * 检查更新
   */
  checkUpdate(): Promise<UpdateCheckResult> {
    return invoke<UpdateCheckResult>('app:check-update');
  },

  /**
   * 退出应用
   */
  quit(): Promise<void> {
    return invoke<void>('app:quit');
  },

  /**
   * 监听应用就绪事件
   */
  onReady(callback: () => void): () => void {
    return on('app:ready', callback);
  },
};

// ==================== 窗口管理 API ====================

export const windowApi = {
  /**
   * 最小化窗口
   */
  minimize(): Promise<void> {
    return invoke<void>('window:minimize');
  },

  /**
   * 最大化/还原窗口
   */
  toggleMaximize(): Promise<void> {
    return invoke<void>('window:toggle-maximize');
  },

  /**
   * 设置窗口最大化状态
   */
  setMaximized(maximized: boolean): Promise<void> {
    return invoke<void>('window:set-maximized', maximized);
  },

  /**
   * 关闭窗口
   */
  close(): Promise<void> {
    return invoke<void>('window:close');
  },

  /**
   * 获取窗口状态
   */
  getState(): Promise<WindowState> {
    return invoke<WindowState>('window:get-state');
  },

  /**
   * 监听窗口大小变化事件
   */
  onResized(callback: (bounds: any) => void): () => void {
    return on('window:resized', (_, bounds) => callback(bounds));
  },
};

// ==================== 对话框 API ====================

export const dialogApi = {
  /**
   * 选择文件夹
   */
  selectFolder(): Promise<string | null> {
    return invoke<string | null>('dialog:select-folder');
  },

  /**
   * 选择文件
   */
  selectFile(filters?: any[]): Promise<string | null> {
    return invoke<string | null>('dialog:select-file', filters);
  },

  /**
   * 保存文件对话框
   */
  saveFile(defaultPath?: string): Promise<string | null> {
    return invoke<string | null>('dialog:save-file', defaultPath);
  },

  /**
   * 显示消息框
   */
  showMessage(options: any): Promise<number> {
    return invoke<number>('dialog:show-message', options);
  },
};

// ==================== 文件系统 API ====================

export const fileApi = {
  /**
   * 读取文件内容
   */
  read(filePath: string): Promise<string> {
    return invoke<string>('file:read', filePath);
  },

  /**
   * 写入文件内容
   */
  write(filePath: string, content: string): Promise<FileOperationResult> {
    return invoke<FileOperationResult>('file:write', filePath, content);
  },

  /**
   * 删除文件
   */
  delete(filePath: string): Promise<FileOperationResult> {
    return invoke<FileOperationResult>('file:delete', filePath);
  },

  /**
   * 列出目录内容
   */
  listDirectory(dirPath: string): Promise<FileItem[]> {
    return invoke<FileItem[]>('file:list-directory', dirPath);
  },

  /**
   * 创建目录
   */
  createDirectory(dirPath: string): Promise<FileOperationResult> {
    return invoke<FileOperationResult>('file:create-directory', dirPath);
  },

  /**
   * 检查文件是否存在
   */
  exists(filePath: string): Promise<boolean> {
    return invoke<boolean>('file:exists', filePath);
  },
};

// ==================== SSO 登录 API ====================

export const ssoApi = {
  /**
   * 获取 SSO 用户信息
   */
  getUserInfo(): Promise<SsoUserInfo | null> {
    return invoke<SsoUserInfo | null>('sso:get-user-info');
  },

  /**
   * SSO 登录
   */
  login(): Promise<SsoLoginResult> {
    return invoke<SsoLoginResult>('sso:login');
  },

  /**
   * SSO 登出
   */
  logout(): Promise<{ success: boolean }> {
    return invoke<{ success: boolean }>('sso:logout');
  },

  /**
   * 监听登录成功事件
   */
  onLoginSuccess(callback: (user: SsoUserInfo) => void): () => void {
    return on('sso:login:success', (_, user) => callback(user));
  },

  /**
   * 监听登录失败事件
   */
  onLoginFailed(callback: (error: string) => void): () => void {
    return on('sso:login:failed', (_, error) => callback(error));
  },
};

// ==================== 部署 API ====================

export const deployApi = {
  /**
   * 部署项目
   */
  deploy(projectId: string): Promise<DeployResult> {
    return invoke<DeployResult>('deploy:start', projectId);
  },

  /**
   * 获取部署状态
   */
  getStatus(projectId: string): Promise<any> {
    return invoke<any>('deploy:get-status', projectId);
  },
};

// ==================== Agent API ====================

export const agentApi = {
  /**
   * 发送消息给 Agent
   */
  sendMessage(message: string, history?: any[]): Promise<AgentResponse> {
    return invoke<AgentResponse>('agent:send-message', message, history);
  },

  /**
   * 停止 Agent 执行
   */
  stop(): Promise<{ success: boolean }> {
    return invoke<{ success: boolean }>('agent:stop');
  },

  /**
   * 监听 Agent 消息事件
   */
  onMessage(callback: (message: any) => void): () => void {
    return on('agent:message', (_, message) => callback(message));
  },

  /**
   * 监听 Agent 错误事件
   */
  onError(callback: (error: string) => void): () => void {
    return on('agent:error', (_, error) => callback(error));
  },
};

// ==================== 协作模式 API ====================

export const coworkApi = {
  /**
   * 确保工作目录存在
   */
  ensureWorkingDir(): Promise<void> {
    return invoke<void>('cowork:ensure-working-dir');
  },
};

// 导出默认 API 对象
export default {
  project: projectApi,
  rpaProject: rpaProjectApi,
  rpaTask: rpaTaskApi,
  session: sessionApi,
  app: appApi,
  window: windowApi,
  dialog: dialogApi,
  file: fileApi,
  sso: ssoApi,
  deploy: deployApi,
  agent: agentApi,
  cowork: coworkApi,
};
