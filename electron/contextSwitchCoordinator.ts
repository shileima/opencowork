/**
 * 上下文切换时协调 main 进程的 currentTaskIdForSession。
 * AgentRuntime 在创建新任务并切换时调用，确保后续 session 保存到正确任务。
 */
let setCurrentTaskIdFn: ((taskId: string | null) => void) | null = null;

export function registerContextSwitchHandler(fn: (taskId: string | null) => void): void {
    setCurrentTaskIdFn = fn;
}

export function setCurrentTaskIdForContextSwitch(taskId: string | null): void {
    if (setCurrentTaskIdFn) {
        setCurrentTaskIdFn(taskId);
    }
}
