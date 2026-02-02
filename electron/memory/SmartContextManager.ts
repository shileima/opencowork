import { AutoMemoryManager } from './AutoMemoryManager';
import logger from '../services/Logger';

// ============================================================
// 智能上下文管理器 - 自动清理和恢复上下文
// ============================================================

export class SmartContextManager {
    private autoMemory: AutoMemoryManager;
    private currentTokens: number = 0;

    // 上下文阈值配置
    private readonly WARNING_THRESHOLD = 150000;   // 警告阈值
    private readonly CRITICAL_THRESHOLD = 180000;  // 危险阈值
    private readonly MAX_TOKENS = 200000;          // 最大限制

    // 工具结果保留数量
    private readonly KEEP_RECENT_TOOL_RESULTS = 3;  // 正常情况保留最近 3 个
    private readonly EMERGENCY_KEEP = 1;             // 紧急情况只保留 1 个

    constructor(autoMemory: AutoMemoryManager) {
        this.autoMemory = autoMemory;
    }

    // ============================================================
    // 监控上下文使用情况
    // ============================================================

    onTokensUsed(count: number): void {
        this.currentTokens = count;

        if (this.currentTokens > this.CRITICAL_THRESHOLD) {
            logger.warn(`⚠️  CRITICAL: Context at ${this.currentTokens} tokens`);
            this.emergencyCleanup();
        } else if (this.currentTokens > this.WARNING_THRESHOLD) {
            logger.warn(`⚠️  Warning: Context at ${this.currentTokens} tokens`);
            this.preventiveCleanup();
        }
    }

    getCurrentTokens(): number {
        return this.currentTokens;
    }

    getUsagePercentage(): number {
        return (this.currentTokens / this.MAX_TOKENS) * 100;
    }

    // ============================================================
    // 预防性清理（用户无感知）
    // ============================================================

    private async preventiveCleanup(): Promise<void> {
        try {
            logger.debug('[ContextManager] Starting preventive cleanup...');

            // 1. 提取并保存重要信息到记忆
            const saved = await this.extractAndSaveImportantInfo();
            if (saved) {
                logger.debug(`✅ Saved important info to memory`);
            }

            // 2. 清理旧的工具结果（保留最近 3 个）
            // 注意：这里只做标记，实际的清理需要在 AgentRuntime 中执行
            logger.debug(`📝 Ready to clear old tool results (keep ${this.KEEP_RECENT_TOOL_RESULTS})`);
        } catch (error) {
            logger.error('[ContextManager] Preventive cleanup failed:', error);
        }
    }

    // ============================================================
    // 紧急清理（用户无感知）
    // ============================================================

    private async emergencyCleanup(): Promise<void> {
        try {
            logger.warn('[ContextManager] 🚨 Starting EMERGENCY cleanup...');

            // 1. 快速保存所有重要信息
            await this.extractAndSaveImportantInfo(true);

            // 2. 激进清理（只保留最近 1 个工具结果）
            logger.debug(`📝 Emergency: clear all but ${this.EMERGENCY_KEEP} recent tool results`);
        } catch (error) {
            logger.error('[ContextManager] Emergency cleanup failed:', error);
        }
    }

    // ============================================================
    // 提取并保存重要信息
    // ============================================================

    private async extractAndSaveImportantInfo(emergency: boolean = false): Promise<boolean> {
        try {
            // 创建上下文快照
            const timestamp = new Date().toISOString();
            const snapshot = {
                timestamp,
                tokenCount: this.currentTokens,
                type: emergency ? 'emergency' : 'preventive'
            };

            // 保存快照到记忆
            const content = `
# Context Snapshot - ${timestamp}

## Token Usage
- Current: ${this.currentTokens}
- Percentage: ${this.getUsagePercentage().toFixed(1)}%
- Type: ${snapshot.type}

## Note
This snapshot was automatically created when context exceeded threshold.
Important information should have been saved to other memory files.
`;

            // 保存到项目记忆（如果有）或全局记忆
            const snapshotPath = emergency
                ? 'context_snapshots/emergency.md'
                : 'context_snapshots/periodic.md';

            await this.autoMemory.appendMemory(snapshotPath, content);

            return true;
        } catch (error) {
            logger.error('[ContextManager] Failed to extract and save:', error);
            return false;
        }
    }

    // ============================================================
    // 估算当前上下文的 Token 数量
    // ============================================================

    estimateTokens(messages: any[]): number {
        let total = 0;

        for (const message of messages) {
            // 粗略估算：1 token ≈ 4 字符（英文）或 2 字符（中文）
            const content = JSON.stringify(message);
            const charCount = content.length;

            // 简单的估算公式
            total += Math.ceil(charCount / 3);
        }

        // 加上系统提示的开销
        total += 1000;

        return total;
    }

    // ============================================================
    // 判断是否需要清理
    // ============================================================

    needsCleanup(): boolean {
        return this.currentTokens > this.WARNING_THRESHOLD;
    }

    isNearLimit(): boolean {
        return this.currentTokens > this.CRITICAL_THRESHOLD;
    }

    // ============================================================
    // 获取清理建议
    // ============================================================

    getCleanupRecommendation(): {
        action: 'keep' | 'preventive' | 'emergency';
        keepToolResults: number;
        message: string;
    } {
        if (this.currentTokens > this.CRITICAL_THRESHOLD) {
            return {
                action: 'emergency',
                keepToolResults: this.EMERGENCY_KEEP,
                message: `Context critical (${this.currentTokens}/${this.MAX_TOKENS} tokens). Emergency cleanup recommended.`
            };
        } else if (this.currentTokens > this.WARNING_THRESHOLD) {
            return {
                action: 'preventive',
                keepToolResults: this.KEEP_RECENT_TOOL_RESULTS,
                message: `Context warning (${this.currentTokens}/${this.MAX_TOKENS} tokens). Preventive cleanup recommended.`
            };
        }

        return {
            action: 'keep',
            keepToolResults: -1,
            message: `Context OK (${this.currentTokens}/${this.MAX_TOKENS} tokens).`
        };
    }
}
