/**
 * 自愈协调器 - 协调整个自愈流程
 */

import { ErrorDetector } from './ErrorDetector';
import { ErrorAnalyzer } from './ErrorAnalyzer';
import { AutoFixer } from './AutoFixer';
import { RetryManager } from './RetryManager';
import {
  BuildError,
  HealingOptions,
  HealingResult,
  HealingPhase,
  ErrorAnalysis,
  FixResult
} from './types';

export class SelfHealingCoordinator {
  private detector: ErrorDetector;
  private analyzer: ErrorAnalyzer;
  private fixer: AutoFixer;
  private retryManager: RetryManager;

  constructor() {
    this.detector = new ErrorDetector();
    this.analyzer = new ErrorAnalyzer();
    this.fixer = new AutoFixer();
    this.retryManager = new RetryManager();
  }

  /**
   * 执行带自愈功能的操作
   */
  async executeWithHealing(
    operation: () => Promise<{ success: boolean; exitCode: number; output: string }>,
    options: HealingOptions,
    agentCallback: (prompt: string) => Promise<string>
  ): Promise<HealingResult> {
    // 重置重试管理器
    this.retryManager.reset(options.operation);

    const startTime = Date.now();
    const allErrors: BuildError[] = [];
    const allFixes: FixResult[] = [];

    while (true) {
      // 报告进度: 执行操作
      this.reportProgress(options, '正在执行操作...', HealingPhase.DETECTING);

      // 执行操作
      const result = await operation();

      // 如果成功,返回
      if (result.success) {
        return {
          success: true,
          attempts: this.retryManager.getAttemptCount(),
          errors: allErrors,
          fixes: allFixes,
          finalMessage: this.retryManager.getAttemptCount() > 0
            ? `操作成功! ${this.retryManager.getSummary()}`
            : '操作成功!',
          totalTime: Date.now() - startTime
        };
      }

      // 检测错误
      this.reportProgress(options, '检测到错误,正在分析...', HealingPhase.ANALYZING);

      const error = this.detector.detectError(result.output, result.exitCode);

      if (!error) {
        // 无法检测到具体错误
        return {
          success: false,
          attempts: this.retryManager.getAttemptCount(),
          errors: allErrors,
          fixes: allFixes,
          finalMessage: '操作失败,但无法检测到具体错误',
          totalTime: Date.now() - startTime
        };
      }

      allErrors.push(error);

      // 分析错误
      const analysis = this.analyzer.analyze(error, options.projectPath);

      // 判断是否可修复
      if (!analysis.isFixable) {
        return {
          success: false,
          attempts: this.retryManager.getAttemptCount(),
          errors: allErrors,
          fixes: allFixes,
          finalMessage: `错误无法自动修复: ${error.message}\n建议: ${analysis.suggestion}`,
          totalTime: Date.now() - startTime
        };
      }

      // 判断是否应该重试
      if (!this.retryManager.shouldRetry()) {
        return {
          success: false,
          attempts: this.retryManager.getAttemptCount(),
          errors: allErrors,
          fixes: allFixes,
          finalMessage: `已达到最大重试次数 (${this.retryManager.getAttemptCount()}),无法修复`,
          totalTime: Date.now() - startTime
        };
      }

      // 如果是手动模式,可以在这里添加用户确认逻辑
      if (!options.autoMode) {
        // TODO: 实现用户确认逻辑
        // const confirmed = await askUserConfirmation(error, analysis);
        // if (!confirmed) return failure result;
      }

      // 报告进度: 开始修复
      this.reportProgress(
        options,
        `正在修复错误 (${analysis.confidence * 100}% 置信度)...`,
        HealingPhase.FIXING
      );

      // 修复错误
      const fixResult = await this.heal(error, analysis, options, agentCallback);

      allFixes.push(fixResult);
      this.retryManager.recordAttempt(error, fixResult);

      if (!fixResult.success) {
        // 修复失败
        return {
          success: false,
          attempts: this.retryManager.getAttemptCount(),
          errors: allErrors,
          fixes: allFixes,
          finalMessage: `修复失败: ${fixResult.message}`,
          totalTime: Date.now() - startTime
        };
      }

      // 如果需要安装依赖
      if (fixResult.needsDependencyInstall && fixResult.dependencies) {
        this.reportProgress(
          options,
          `正在安装依赖: ${fixResult.dependencies.join(', ')}...`,
          HealingPhase.FIXING
        );

        await this.fixer.installDependencies(
          options.projectPath,
          fixResult.dependencies
        );
      }

      // 报告进度: 准备重试
      const delay = this.retryManager.getNextDelay();
      this.reportProgress(
        options,
        `修复完成,${delay / 1000} 秒后重试...`,
        HealingPhase.RETRYING
      );

      // 等待重试延迟
      await this.sleep(delay);
    }
  }

  /**
   * 修复单个错误
   */
  private async heal(
    error: BuildError,
    analysis: ErrorAnalysis,
    options: HealingOptions,
    agentCallback: (prompt: string) => Promise<string>
  ): Promise<FixResult> {
    try {
      // 调用自动修复器
      const fixResult = await this.fixer.fix(
        error,
        analysis,
        options.projectPath,
        agentCallback
      );

      if (fixResult.success) {
        this.reportProgress(
          options,
          `成功修复 ${fixResult.changes.length} 个文件`,
          HealingPhase.COMPLETED
        );
      }

      return fixResult;
    } catch (err) {
      console.error('[SelfHealingCoordinator] Heal failed:', err);
      return {
        success: false,
        changes: [],
        message: err instanceof Error ? err.message : '修复过程出错'
      };
    }
  }

  /**
   * 报告进度
   */
  private reportProgress(
    options: HealingOptions,
    message: string,
    phase: HealingPhase
  ): void {
    if (options.onProgress) {
      options.onProgress(message, phase);
    }
    console.log(`[SelfHealing:${phase}] ${message}`);
  }

  /**
   * 睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取重试管理器(用于测试和监控)
   */
  getRetryManager(): RetryManager {
    return this.retryManager;
  }

  /**
   * 批量修复多个错误
   */
  async healMultiple(
    errors: BuildError[],
    options: HealingOptions,
    agentCallback: (prompt: string) => Promise<string>
  ): Promise<FixResult[]> {
    const results: FixResult[] = [];

    for (const error of errors) {
      const analysis = this.analyzer.analyze(error, options.projectPath);

      if (!analysis.isFixable) {
        results.push({
          success: false,
          changes: [],
          message: `错误无法自动修复: ${analysis.suggestion}`
        });
        continue;
      }

      const fixResult = await this.heal(error, analysis, options, agentCallback);
      results.push(fixResult);

      // 如果修复失败,停止后续修复
      if (!fixResult.success) {
        break;
      }
    }

    return results;
  }

  /**
   * 干运行(只分析不修复)
   */
  async dryRun(
    output: string,
    exitCode: number,
    projectPath: string
  ): Promise<{
    errors: BuildError[];
    analyses: ErrorAnalysis[];
  }> {
    const errors = this.detector.detectMultipleErrors(output, exitCode);
    const analyses = errors.map(error =>
      this.analyzer.analyze(error, projectPath)
    );

    return { errors, analyses };
  }
}
