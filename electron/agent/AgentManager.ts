/**
 * AgentManager - 统一管理所有会话的 Agent 实例
 *
 * 核心理念：
 * - 每个会话有自己独立的 Agent 实例
 * - 主窗口和悬浮球都能访问任何会话的 Agent
 * - 通过 sessionId 来区分不同的会话
 */

import { AgentRuntime } from './AgentRuntime';
import { configStore } from '../config/ConfigStore';
import { BrowserWindow } from 'electron';
import logger from '../services/Logger';

export interface AgentStats {
  total: number;
  running: number;
  sessions: string[];
}

export class AgentManager {
  private agents: Map<string, AgentRuntime> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic cleanup (every 10 minutes, clean agents idle for > 30 minutes)
    this.cleanupInterval = setInterval(() => {
      const disposed = this.cleanupIdleAgents(30 * 60 * 1000);
      if (disposed > 0) {
        logger.debug(`Periodic cleanup: disposed ${disposed} idle agents`);
      }
    }, 10 * 60 * 1000);

    logger.debug('[AgentManager] Initialized with periodic cleanup (10min interval, 30min idle timeout)');
  }

  /**
   * 获取或创建指定会话的 Agent
   */
  getOrCreateAgent(sessionId: string, windows: BrowserWindow[]): AgentRuntime {
    if (this.agents.has(sessionId)) {
      // Agent 已存在，更新其窗口列表以确保能广播到所有窗口
      const agent = this.agents.get(sessionId)!;

      // Clean up destroyed windows before adding new ones
      agent.cleanupDestroyedWindows();

      // 添加任何新的窗口（保持现有窗口，添加新窗口）
      for (const win of windows) {
        agent.addWindow(win);
      }

      return agent;
    }

    logger.debug(`Creating new Agent for session: ${sessionId}`);

    const config = configStore.getAll();
    const activeProvider = config.providers[config.activeProviderId];

    if (!activeProvider?.apiKey) {
      throw new Error('No API Key configured');
    }

    if (windows.length === 0) {
      throw new Error('No available windows');
    }

    // 创建新的 Agent 实例
    const agent = new AgentRuntime(
      activeProvider.apiKey,
      windows[0], // 使用第一个可用窗口
      activeProvider.model,
      activeProvider.apiUrl,
      activeProvider.maxTokens || 131072
    );

    // 设置会话 ID
    agent.setSessionId(sessionId);

    // 添加所有窗口（这样事件会广播到所有窗口）
    for (const win of windows) {
      agent.addWindow(win);
    }

    this.agents.set(sessionId, agent);
    logger.debug(`Agent created successfully. Total agents: ${this.agents.size}`);

    return agent;
  }

  /**
   * 获取指定会话的 Agent
   */
  getAgent(sessionId: string): AgentRuntime {
    const agent = this.agents.get(sessionId);
    if (!agent) {
      throw new Error(`Agent not found for session: ${sessionId}`);
    }
    return agent;
  }

  /**
   * 检查指定会话的 Agent 是否存在
   */
  hasAgent(sessionId: string): boolean {
    return this.agents.has(sessionId);
  }

  /**
   * 释放指定会话的 Agent
   */
  disposeAgent(sessionId: string): void {
    const agent = this.agents.get(sessionId);
    if (agent) {
      logger.debug(`Disposing Agent for session: ${sessionId}`);
      agent.dispose();
      this.agents.delete(sessionId);
      logger.debug(`Agent disposed. Remaining agents: ${this.agents.size}`);
    }
  }

  /**
   * 释放所有 Agent
   */
  disposeAll(): void {
    logger.debug(`Disposing all ${this.agents.size} agents`);

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const [sessionId, agent] of this.agents.entries()) {
      logger.debug(`Disposing agent for session: ${sessionId}`);
      try {
        agent.dispose();
      } catch (err) {
        logger.error(`Error disposing agent for session ${sessionId}:`, err);
      }
    }
    this.agents.clear();
    logger.debug('[AgentManager] All agents disposed');
  }

  /**
   * 获取所有运行中的会话 ID
   */
  getRunningSessions(): string[] {
    const running: string[] = [];
    for (const [sessionId, agent] of this.agents.entries()) {
      if (agent.isProcessingMessage()) {
        running.push(sessionId);
      }
    }
    return running;
  }

  /**
   * 获取 Agent 统计信息
   */
  getStats(): AgentStats {
    return {
      total: this.agents.size,
      running: this.getRunningSessions().length,
      sessions: Array.from(this.agents.keys())
    };
  }

  /**
   * 获取详细的 Agent 统计信息（用于监控）
   */
  getDetailedStats(): {
    total: number;
    running: number;
    idle: number;
    sessions: string[];
    idleTimeStats: {
      min: number;
      max: number;
      avg: number;
    };
  } {
    const stats = {
      total: this.agents.size,
      running: 0,
      idle: 0,
      sessions: [] as string[],
      idleTimeStats: {
        min: 0,
        max: 0,
        avg: 0
      }
    };

    const now = Date.now();
    const idleTimes: number[] = [];

    for (const [sessionId, agent] of this.agents.entries()) {
      stats.sessions.push(sessionId);

      if (agent.isProcessingMessage()) {
        stats.running++;
      } else {
        stats.idle++;
        const idleTime = now - agent.getLastProcessTime();
        idleTimes.push(idleTime);
      }
    }

    // Calculate idle time statistics
    if (idleTimes.length > 0) {
      stats.idleTimeStats.min = Math.min(...idleTimes);
      stats.idleTimeStats.max = Math.max(...idleTimes);
      stats.idleTimeStats.avg = idleTimes.reduce((a, b) => a + b, 0) / idleTimes.length;
    }

    return stats;
  }

  /**
   * 打印 Agent 状态（用于调试）
   */
  logStatus(): void {
    const stats = this.getDetailedStats();
    logger.debug('[AgentManager] Status:', {
      total: stats.total,
      running: stats.running,
      idle: stats.idle,
      sessions: stats.sessions,
      idleTime: {
        min: `${Math.round(stats.idleTimeStats.min / 1000)}s`,
        max: `${Math.round(stats.idleTimeStats.max / 1000)}s`,
        avg: `${Math.round(stats.idleTimeStats.avg / 1000)}s`
      }
    });
  }

  /**
   * 清理空闲的 Agent（可选的优化）
   * 释放超过指定时间未使用的 Agent
   */
  cleanupIdleAgents(maxIdleTime: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let disposed = 0;

    for (const [sessionId, agent] of this.agents.entries()) {
      // 如果 Agent 不在处理中，且最后处理时间超过 maxIdleTime
      if (!agent.isProcessingMessage()) {
        const lastProcessTime = agent.getLastProcessTime();
        if (now - lastProcessTime > maxIdleTime) {
          logger.debug(`Cleaning up idle agent: ${sessionId}`);
          this.disposeAgent(sessionId);
          disposed++;
        }
      }
    }

    if (disposed > 0) {
      logger.debug(`Cleaned up ${disposed} idle agents`);
    }

    return disposed;
  }
}

// 导出单例
export const agentManager = new AgentManager();
