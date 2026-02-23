/**
 * 自动化执行前确保 Playwright 与浏览器已就绪（静默安装，不弹窗）
 */

import type { PlaywrightManager } from './PlaywrightManager';

let manager: PlaywrightManager | null = null;

export function setPlaywrightManager(m: PlaywrightManager | null): void {
  manager = m;
}

/**
 * 在需要执行 Playwright/自动化脚本前调用：若未安装则自动安装，不打扰用户。
 * 由 FileSystemTools 在检测到自动化命令时调用。
 */
export async function ensurePlaywrightForAutomation(): Promise<void> {
  if (!manager) return;
  await manager.ensureInstalled();
}
