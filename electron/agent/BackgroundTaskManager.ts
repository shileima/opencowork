/**
 * Background Task Manager
 * 管理后台任务的创建、执行、状态跟踪和通知
 */

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'aborted';

export interface BackgroundTask {
  id: string;
  sessionId: string;
  title: string;
  status: TaskStatus;
  messages: any[];
  result?: string;
  error?: string;
  progress?: number; // 0-100
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface TaskEvents {
  onTaskUpdate?: (task: BackgroundTask) => void;
  onTaskComplete?: (task: BackgroundTask) => void;
  onTaskFailed?: (task: BackgroundTask) => void;
}

class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private eventListeners: Set<TaskEvents> = new Set();

  /**
   * 添加事件监听器
   */
  addEventListener(listener: TaskEvents): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * 触发事件
   */
  private emitEvent(
    eventType: 'onTaskUpdate' | 'onTaskComplete' | 'onTaskFailed',
    task: BackgroundTask
  ): void {
    this.eventListeners.forEach((listener) => {
      const handler = listener[eventType];
      if (handler) {
        handler(task);
      }
    });
  }

  /**
   * 创建新的后台任务
   */
  createTask(sessionId: string, title: string, messages: any[]): BackgroundTask {
    const task: BackgroundTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId,
      title,
      status: 'pending',
      messages,
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    this.emitEvent('onTaskUpdate', task);

    return task;
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }

  /**
   * 获取会话的所有任务
   */
  getTasksBySession(sessionId: string): BackgroundTask[] {
    return this.getAllTasks().filter((task) => task.sessionId === sessionId);
  }

  /**
   * 获取运行中的任务
   */
  getRunningTasks(): BackgroundTask[] {
    return this.getAllTasks().filter((task) => task.status === 'running');
  }

  /**
   * 更新任务状态
   */
  updateTask(
    taskId: string,
    updates: Partial<BackgroundTask>
  ): BackgroundTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const updatedTask = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    };

    this.tasks.set(taskId, updatedTask);
    this.emitEvent('onTaskUpdate', updatedTask);

    // 如果任务完成或失败，触发相应事件
    if (updates.status === 'completed') {
      this.emitEvent('onTaskComplete', {
        ...updatedTask,
        completedAt: Date.now(),
      });
    } else if (updates.status === 'failed') {
      this.emitEvent('onTaskFailed', updatedTask);
    }

    return updatedTask;
  }

  /**
   * 更新任务进度
   */
  updateTaskProgress(taskId: string, progress: number): void {
    this.updateTask(taskId, { progress: Math.min(100, Math.max(0, progress)) });
  }

  /**
   * 标记任务为运行中
   */
  startTask(taskId: string): void {
    this.updateTask(taskId, { status: 'running', progress: 0 });
  }

  /**
   * 完成任务
   */
  completeTask(taskId: string, result?: string): void {
    this.updateTask(taskId, {
      status: 'completed',
      result,
      progress: 100,
    });
  }

  /**
   * 任务失败
   */
  failTask(taskId: string, error: string): void {
    this.updateTask(taskId, { status: 'failed', error });
  }

  /**
   * 中止任务
   */
  abortTask(taskId: string): void {
    this.updateTask(taskId, { status: 'aborted' });
  }

  /**
   * 删除任务
   */
  deleteTask(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }

  /**
   * 清理已完成的旧任务（保留最近N个）
   */
  cleanupOldTasks(keepCount: number = 50): void {
    const completedTasks = this.getAllTasks()
      .filter((task) => task.status === 'completed' || task.status === 'failed')
      .sort((a, b) => b.completedAt! - a.completedAt!);

    if (completedTasks.length > keepCount) {
      const toDelete = completedTasks.slice(keepCount);
      toDelete.forEach((task) => this.deleteTask(task.id));
    }
  }

  /**
   * 获取任务统计
   */
  getStats(): {
    total: number;
    running: number;
    completed: number;
    failed: number;
    aborted: number;
  } {
    const tasks = this.getAllTasks();
    return {
      total: tasks.length,
      running: tasks.filter((t) => t.status === 'running').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      aborted: tasks.filter((t) => t.status === 'aborted').length,
    };
  }
}

// 单例
export const backgroundTaskManager = new BackgroundTaskManager();
