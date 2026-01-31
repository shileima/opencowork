import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';

/**
 * 获取内置 Playwright 包路径
 * 
 * @returns Playwright 包路径，如果不存在则返回 null
 */
export function getBuiltinPlaywrightPath(): string | null {
  if (!app.isPackaged) {
    // 开发环境：使用 node_modules 中的 playwright
    return null;
  }

  const playwrightPackagePath = path.join(process.resourcesPath, 'playwright', 'package');
  
  if (fs.existsSync(playwrightPackagePath)) {
    return playwrightPackagePath;
  }

  return null;
}

/**
 * 获取 Playwright 浏览器路径
 *
 * 打包后：使用 userData 目录，避免将未签名的 Chromium 打入 app bundle（会导致 macOS Hardened Runtime 拒绝启动）
 * 开发环境：返回 null，使用默认路径（~/.cache/ms-playwright/）
 *
 * @returns Playwright 浏览器路径
 */
export function getBuiltinPlaywrightBrowsersPath(): string | null {
  if (!app.isPackaged) {
    return null;
  }
  return path.join(app.getPath('userData'), 'playwright', 'browsers');
}

/**
 * 获取 Playwright 环境变量配置
 * 
 * 返回需要在执行脚本时设置的环境变量，包括：
 * - PLAYWRIGHT_BROWSERS_PATH: 浏览器二进制文件路径
 * - NODE_PATH: Node.js 模块搜索路径（用于找到 playwright 包）
 * 
 * @returns 环境变量对象
 */
export function getPlaywrightEnvVars(): Record<string, string> {
  const env: Record<string, string> = {};
  
  const playwrightPath = getBuiltinPlaywrightPath();
  const browsersPath = getBuiltinPlaywrightBrowsersPath();
  
  if (playwrightPath) {
    // 设置 NODE_PATH 让 require('playwright') 能找到内置包
    // 注意：NODE_PATH 需要包含 playwright 包的父目录（package 目录）
    // 这样 require('playwright') 会在 package/playwright 中找到
    const playwrightParentPath = path.dirname(playwrightPath);
    const existingNodePath = process.env.NODE_PATH || '';
    env.NODE_PATH = existingNodePath 
      ? `${playwrightParentPath}${path.delimiter}${existingNodePath}`
      : playwrightParentPath;
    
    // 同时设置 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 避免自动下载
    env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
  }
  
  if (browsersPath) {
    // 设置 PLAYWRIGHT_BROWSERS_PATH（打包后为 userData/playwright/browsers，需首次运行时下载）
    env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  }
  
  return env;
}
