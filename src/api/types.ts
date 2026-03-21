/**
 * IPC 通信类型定义
 * 定义所有主进程和渲染进程之间的通信接口
 */

// ==================== 项目相关类型 ====================

export interface ProjectTask {
  id: string;
  title: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'completed' | 'failed';
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  tasks: ProjectTask[];
  description?: string;
}

export interface ProjectListResult {
  success: boolean;
  projects: Project[];
}

export interface ProjectOperationResult {
  success: boolean;
  project?: Project;
  error?: string;
}

// ==================== RPA 项目相关类型 ====================

export interface RPATask {
  id: string;
  title: string;
  description?: string;
  script?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  updatedAt: number;
  result?: string;
}

export interface RPAProject {
  id: string;
  name: string;
  description?: string;
  path?: string;
  tasks: RPATask[];
  createdAt: number;
  updatedAt: number;
}

export interface RPAProjectListResult {
  success: boolean;
  projects: RPAProject[];
}

export interface RPAProjectOperationResult {
  success: boolean;
  project?: RPAProject;
  error?: string;
}

export interface RPATaskOperationResult {
  success: boolean;
  task?: RPATask;
  error?: string;
}

// ==================== 会话相关类型 ====================

export interface Session {
  id: string;
  mode: 'cowork' | 'project' | 'automation';
  messages: any[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionListResult {
  success: boolean;
  sessions: Session[];
}

// ==================== 配置相关类型 ====================

export interface AppConfig {
  theme: 'light' | 'dark' | 'system';
  language: 'zh-CN' | 'en-US';
  apiKey?: string;
  apiBaseUrl?: string;
  model?: string;
  autoSave: boolean;
  [key: string]: any;
}

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  [key: string]: any;
}

// ==================== 窗口相关类型 ====================

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  isMaximized: boolean;
  isMinimized: boolean;
  isFullScreen: boolean;
  bounds: WindowBounds;
}

// ==================== 文件系统相关类型 ====================

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: number;
}

export interface FileOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}

// ==================== 对话框相关类型 ====================

export interface DialogResult {
  canceled: boolean;
  filePaths?: string[];
  filePath?: string;
}

// ==================== Agent 相关类型 ====================

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface AgentResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: any;
}

// ==================== SSO 相关类型 ====================

export interface SsoUserInfo {
  name: string;
  subject: string;
  mtEmpId: number;
  expire: number;
}

export interface SsoLoginResult {
  success: boolean;
  user?: SsoUserInfo;
  error?: string;
}

// ==================== 部署相关类型 ====================

export interface DeployResult {
  success: boolean;
  url?: string;
  error?: string;
}

// ==================== 更新相关类型 ====================

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes: string;
}

export interface UpdateCheckResult {
  available: boolean;
  info?: UpdateInfo;
}

// ==================== IPC 事件类型 ====================

export type IPCEvent =
  | 'project:switched'
  | 'project:created'
  | 'project:updated'
  | 'project:deleted'
  | 'rpa:project:created'
  | 'rpa:project:updated'
  | 'rpa:project:deleted'
  | 'rpa:task:created'
  | 'rpa:task:updated'
  | 'rpa:task:deleted'
  | 'rpa:task:started'
  | 'rpa:task:completed'
  | 'agent:message'
  | 'agent:error'
  | 'window:resized'
  | 'window:maximized'
  | 'window:minimized'
  | 'app:ready'
  | 'update:available'
  | 'update:downloaded'
  | 'sso:login:success'
  | 'sso:login:failed';

// ==================== 类型守卫 ====================

export function isProject(obj: any): obj is Project {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.path === 'string'
  );
}

export function isRPAProject(obj: any): obj is RPAProject {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    Array.isArray(obj.tasks)
  );
}

export function isRPATask(obj: any): obj is RPATask {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.title === 'string' &&
    ['pending', 'running', 'completed', 'failed'].includes(obj.status)
  );
}
