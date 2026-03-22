/**
 * 代码自愈系统 - 类型定义
 */

export enum ErrorType {
  SYNTAX_ERROR = 'syntax',
  TYPE_ERROR = 'type',
  MODULE_NOT_FOUND = 'module',
  DEPENDENCY_ERROR = 'dependency',
  RUNTIME_ERROR = 'runtime',
  BUILD_ERROR = 'build',
  CONFIG_ERROR = 'config',
  UNKNOWN = 'unknown'
}

export interface BuildError {
  type: ErrorType;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  stack?: string;
  fullLog: string;
  timestamp: number;
  rawError?: any;
}

export interface ParsedError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface ErrorAnalysis {
  isFixable: boolean;
  errorType: ErrorType;
  affectedFiles: string[];
  suggestion: string;
  confidence: number; // 0-1, 修复成功的置信度
  priority: 'high' | 'medium' | 'low';
}

export interface FileChange {
  file: string;
  before: string;
  after: string;
  description?: string;
}

export interface FixResult {
  success: boolean;
  changes: FileChange[];
  message: string;
  needsDependencyInstall?: boolean;
  dependencies?: string[];
}

export interface FixContext {
  projectPath: string;
  error: BuildError;
  analysis: ErrorAnalysis;
  fileContent?: string;
  codeContext?: string;
}

export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  exponentialBackoff: boolean;
  backoffMultiplier: number;
}

export interface RetryState {
  attempt: number;
  errors: BuildError[];
  fixes: FixResult[];
  startTime: number;
  operation: 'preview' | 'deploy';
}

export interface HealingOptions {
  operation: 'preview' | 'deploy';
  projectPath: string;
  maxRetries?: number;
  autoMode?: boolean; // true: 自动修复, false: 询问用户
  onProgress?: (message: string, phase: HealingPhase) => void;
}

export enum HealingPhase {
  DETECTING = 'detecting',
  ANALYZING = 'analyzing',
  FIXING = 'fixing',
  VERIFYING = 'verifying',
  RETRYING = 'retrying',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface HealingResult {
  success: boolean;
  attempts: number;
  errors: BuildError[];
  fixes: FixResult[];
  finalMessage: string;
  totalTime: number;
}

export interface SelfHealingConfig {
  enabled: boolean;
  autoMode: boolean;
  maxRetries: number;
  retryDelay: number;
  exponentialBackoff: boolean;
  notifyOnFix: boolean;
  backupBeforeFix: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
