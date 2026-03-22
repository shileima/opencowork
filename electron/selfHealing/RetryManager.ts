/**
 * 重试管理器 - 管理重试逻辑
 */

import { RetryConfig, RetryState, BuildError, FixResult } from './types';

export class RetryManager {
  private config: RetryConfig;
  private state: RetryState;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 2000, // 2 秒
      exponentialBackoff: config.exponentialBackoff ?? true,
      backoffMultiplier: config.backoffMultiplier ?? 2
    };

    this.state = this.createInitialState();
  }

  /**
   * 创建初始状态
   */
  private createInitialState(): RetryState {
    return {
      attempt: 0,
      errors: [],
      fixes: [],
      startTime: Date.now(),
      operation: 'preview'
    };
  }

  /**
   * 重置状态
   */
  reset(operation: 'preview' | 'deploy' = 'preview'): void {
    this.state = this.createInitialState();
    this.state.operation = operation;
  }

  /**
   * 判断是否应该继续重试
   */
  shouldRetry(): boolean {
    // 检查是否超过最大重试次数
    if (this.state.attempt >= this.config.maxRetries) {
      return false;
    }

    // 检查是否有相同的错误重复出现
    if (this.hasRepeatingError()) {
      return false;
    }

    return true;
  }

  /**
   * 检查是否有重复的错误
   */
  private hasRepeatingError(): boolean {
    if (this.state.errors.length < 2) {
      return false;
    }

    const lastError = this.state.errors[this.state.errors.length - 1];
    const secondLastError = this.state.errors[this.state.errors.length - 2];

    // 如果最后两个错误的消息相同,认为是重复错误
    return (
      lastError.message === secondLastError.message &&
      lastError.file === secondLastError.file &&
      lastError.line === secondLastError.line
    );
  }

  /**
   * 获取下次重试的延迟时间
   */
  getNextDelay(): number {
    if (!this.config.exponentialBackoff) {
      return this.config.retryDelay;
    }

    // 指数退避
    const delay = this.config.retryDelay * Math.pow(
      this.config.backoffMultiplier,
      this.state.attempt
    );

    // 最大延迟不超过 30 秒
    return Math.min(delay, 30000);
  }

  /**
   * 记录一次尝试
   */
  recordAttempt(error: BuildError, fix: FixResult): void {
    this.state.attempt += 1;
    this.state.errors.push(error);
    this.state.fixes.push(fix);
  }

  /**
   * 获取当前状态
   */
  getState(): RetryState {
    return { ...this.state };
  }

  /**
   * 获取尝试次数
   */
  getAttemptCount(): number {
    return this.state.attempt;
  }

  /**
   * 获取总耗时
   */
  getElapsedTime(): number {
    return Date.now() - this.state.startTime;
  }

  /**
   * 获取成功修复的次数
   */
  getSuccessfulFixCount(): number {
    return this.state.fixes.filter(f => f.success).length;
  }

  /**
   * 获取失败修复的次数
   */
  getFailedFixCount(): number {
    return this.state.fixes.filter(f => !f.success).length;
  }

  /**
   * 判断是否所有修复都失败了
   */
  allFixesFailed(): boolean {
    return this.state.fixes.length > 0 &&
           this.state.fixes.every(f => !f.success);
  }

  /**
   * 获取摘要信息
   */
  getSummary(): string {
    const elapsed = Math.round(this.getElapsedTime() / 1000);
    const successful = this.getSuccessfulFixCount();
    const failed = this.getFailedFixCount();

    return `尝试 ${this.state.attempt} 次, ` +
           `成功 ${successful} 次, ` +
           `失败 ${failed} 次, ` +
           `耗时 ${elapsed} 秒`;
  }

  /**
   * 获取最后一个错误
   */
  getLastError(): BuildError | null {
    return this.state.errors[this.state.errors.length - 1] || null;
  }

  /**
   * 获取最后一次修复结果
   */
  getLastFix(): FixResult | null {
    return this.state.fixes[this.state.fixes.length - 1] || null;
  }

  /**
   * 获取所有错误
   */
  getAllErrors(): BuildError[] {
    return [...this.state.errors];
  }

  /**
   * 获取所有修复结果
   */
  getAllFixes(): FixResult[] {
    return [...this.state.fixes];
  }

  /**
   * 判断是否达到超时
   */
  isTimeout(maxTimeMs: number = 300000): boolean {
    // 默认最大时间 5 分钟
    return this.getElapsedTime() > maxTimeMs;
  }
}
