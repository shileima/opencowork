/**
 * PlaywrightPath — Playwright 运行时路径解析与浏览器资源管理
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ 资源链路概览                                                    │
 * │                                                                 │
 * │ 构建阶段：                                                      │
 * │   prepare-playwright.mjs                                        │
 * │     → 安装 playwright 包到 resources/playwright/                │
 * │     → 下载浏览器到 resources/playwright/browsers/               │
 * │   pack-chromium.mjs                                             │
 * │     → 将 browsers/ 全部内容压缩为 chromium.tar.gz              │
 * │   electron-builder                                              │
 * │     → 将 playwright/package/ + chromium.tar.gz 打包到 app      │
 * │                                                                 │
 * │ 运行时：                                                        │
 * │   1. dev 模式：直接使用 resources/playwright/browsers/          │
 * │   2. 打包模式：首次启动解压 tar.gz → userData/playwright/browsers/ │
 * │   3. 兜底：~/.qa-cowork/skills/agent-browser/browsers/         │
 * │                                                                 │
 * │ 版本兼容：                                                      │
 * │   当 browsers 目录中的 chromium 修订号与 playwright-core 期望   │
 * │   的修订号不一致时，自动创建 symlink 保证兼容。                 │
 * └─────────────────────────────────────────────────────────────────┘
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { app } from 'electron';

const LOG_TAG = '[PlaywrightPath]';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. 常量
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 用户目录下的 Playwright 安装目录（点击「立即安装」时使用）
 * ~/.qa-cowork/skills/agent-browser/
 */
export const AGENT_BROWSER_SKILL_DIR = path.join(
  os.homedir(), '.qa-cowork', 'skills', 'agent-browser',
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. 内部工具函数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 安全地判断路径是否存在（不抛异常） */
function safeExists(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}

/** 安全地列出目录（不抛异常，失败返回空数组） */
function safeReaddir(dir: string): string[] {
  try { return fs.readdirSync(dir); } catch { return []; }
}

/** 安全地读取 JSON 文件 */
function safeReadJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 安全地创建或更新 symlink。
 *
 * - 如果 linkPath 已是指向 targetPath 的 symlink → 无操作
 * - 如果 linkPath 是指向其他位置的 symlink → 删除后重建
 * - 如果 linkPath 是真实目录 → 不覆盖
 * - 如果 linkPath 不存在 → 直接创建
 *
 * @returns 是否成功创建/已存在
 */
function ensureSymlink(linkPath: string, targetPath: string): boolean {
  try {
    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        if (fs.readlinkSync(linkPath) === targetPath) return true; // 已正确
        fs.unlinkSync(linkPath); // 指向不对，删除重建
      } else if (stat.isDirectory()) {
        return true; // 真实目录，不覆盖
      }
    } catch {
      // linkPath 不存在，继续创建
    }
    fs.symlinkSync(targetPath, linkPath);
    return true;
  } catch (err) {
    console.warn(`${LOG_TAG} ensureSymlink failed: ${linkPath} → ${targetPath}:`,
      err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * 将 chromium.tar.gz 解压到指定目录。
 * 使用系统 tar 命令，避免引入额外依赖。
 */
function extractChromiumTarGz(tarGzPath: string, destDir: string): boolean {
  try {
    console.log(`${LOG_TAG} 首次启动，解压内置 Chromium: ${tarGzPath} → ${destDir}`);
    fs.mkdirSync(destDir, { recursive: true });
    execSync(`tar -xzf "${tarGzPath}" -C "${destDir}"`, { stdio: 'pipe', timeout: 120_000 });
    console.log(`${LOG_TAG} Chromium 解压完成 ✓`);
    return true;
  } catch (err) {
    console.error(`${LOG_TAG} Chromium 解压失败:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * 读取 playwright-core 的 browsers.json，返回期望的 chromium revision（如 "1208"）。
 *
 * 查找策略（按优先级）：
 *   1. 内置 playwright 包同级的 playwright-core/browsers.json
 *   2. 项目根 node_modules/playwright-core/browsers.json（dev 模式）
 */
function getExpectedChromiumRevision(): string | null {
  const all = getAllExpectedChromiumRevisions();
  return all.length > 0 ? all[0] : null;
}

/**
 * 收集运行时所有"可能被加载的 playwright-core 期望的 chromium revision"。
 *
 * 防御性地枚举：
 *   - 内置 playwright 同级 node_modules/playwright-core/browsers.json（权威）
 *   - 项目根 node_modules/playwright-core/browsers.json（dev 模式）
 *   - 用户 agent-browser 中的 playwright-core（含 .pnpm/playwright-core@*）
 *   - 用户 $HOME/node_modules/playwright-core（用户曾经全局安装过）
 *
 * 这样 ensureBrowserVersionCompatibility 可以为每个期望的 chromium-XXXX
 * 都在 browsers 目录下建 symlink 指向实际存在的那一份浏览器，
 * 避免子进程加载到异版本 playwright 时找不到浏览器可执行文件。
 */
function getAllExpectedChromiumRevisions(): string[] {
  const moduleDir = getBuiltinPlaywrightModuleDir();
  const revisions = new Set<string>();

  const addFromJson = (jsonPath: string) => {
    if (!safeExists(jsonPath)) return;
    const data = safeReadJson(jsonPath);
    if (!data) return;
    const browsers = data.browsers as Array<{ name: string; revision: string }> | undefined;
    const chromiumEntry = browsers?.find((b) => b.name === 'chromium');
    if (chromiumEntry?.revision) revisions.add(chromiumEntry.revision);
  };

  if (moduleDir) {
    addFromJson(path.join(path.dirname(moduleDir), 'playwright-core', 'browsers.json'));
  }

  if (!app.isPackaged) {
    addFromJson(path.join(app.getAppPath(), 'node_modules', 'playwright-core', 'browsers.json'));
  }

  // 用户 agent-browser
  addFromJson(path.join(AGENT_BROWSER_SKILL_DIR, 'node_modules', 'playwright-core', 'browsers.json'));
  // agent-browser 使用 pnpm 布局时 playwright-core 会在 .pnpm 下
  try {
    const pnpmDir = path.join(AGENT_BROWSER_SKILL_DIR, 'node_modules', '.pnpm');
    for (const sub of safeReaddir(pnpmDir)) {
      if (!/^playwright-core@/.test(sub)) continue;
      addFromJson(path.join(pnpmDir, sub, 'node_modules', 'playwright-core', 'browsers.json'));
    }
  } catch { /* ignore */ }

  // 用户 HOME/node_modules（Node 向上查找兜底会命中这里）
  try {
    addFromJson(path.join(os.homedir(), 'node_modules', 'playwright-core', 'browsers.json'));
  } catch { /* ignore */ }

  return Array.from(revisions);
}

/**
 * 确保 browsers 目录中存在 Playwright 期望的 chromium-XXXX 版本目录。
 *
 * 场景：
 *   - 打包时内置 chromium-1208，但用户通过 PlaywrightManager 安装了 chromium-1217
 *   - 或反过来：内置的 playwright JS 版本更新但 tar.gz 中的浏览器版本较旧
 *
 * 处理 chromium-XXXX 和 chromium_headless_shell-XXXX 两种目录。
 */
function ensureBrowserVersionCompatibility(browsersDir: string): void {
  try {
    const expectedRevisions = getAllExpectedChromiumRevisions();
    if (expectedRevisions.length === 0) return;

    const entries = safeReaddir(browsersDir);
    if (entries.length === 0) return;

    // 实际存在的 chromium-XXXX、headless、ffmpeg 目录
    const chromiumDirs = entries.filter((d) => /^chromium-\d+$/.test(d)).sort();
    const headlessDirs = entries.filter((d) => /^chromium_headless_shell-\d+$/.test(d)).sort();
    const ffmpegDirs = entries.filter((d) => /^ffmpeg-\d+$/.test(d)).sort();

    const newestChromium = chromiumDirs[chromiumDirs.length - 1];
    const newestHeadless = headlessDirs[headlessDirs.length - 1];
    const newestFfmpeg = ffmpegDirs[ffmpegDirs.length - 1];

    for (const rev of expectedRevisions) {
      // chromium-XXXX
      if (newestChromium) {
        const expected = `chromium-${rev}`;
        if (!chromiumDirs.includes(expected)) {
          const linkPath = path.join(browsersDir, expected);
          const targetPath = path.join(browsersDir, newestChromium);
          if (ensureSymlink(linkPath, targetPath)) {
            console.log(`${LOG_TAG} 浏览器兼容 symlink: ${expected} → ${newestChromium}`);
          }
        }
      }
      // chromium_headless_shell-XXXX
      if (newestHeadless) {
        const expected = `chromium_headless_shell-${rev}`;
        if (!headlessDirs.includes(expected)) {
          const linkPath = path.join(browsersDir, expected);
          const targetPath = path.join(browsersDir, newestHeadless);
          if (ensureSymlink(linkPath, targetPath)) {
            console.log(`${LOG_TAG} headless shell 兼容 symlink: ${expected} → ${newestHeadless}`);
          }
        }
      }
      // ffmpeg-XXXX
      if (newestFfmpeg) {
        const expected = `ffmpeg-${rev}`;
        if (!ffmpegDirs.includes(expected) && !safeExists(path.join(browsersDir, expected))) {
          const linkPath = path.join(browsersDir, expected);
          const targetPath = path.join(browsersDir, newestFfmpeg);
          ensureSymlink(linkPath, targetPath);
        }
      }
    }
  } catch (err) {
    console.warn(`${LOG_TAG} ensureBrowserVersionCompatibility error:`, err);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. Playwright 包路径解析（public API）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 应用内置 Playwright 根目录。
 * - 开发模式：<项目>/resources/playwright
 * - 打包后：  <app>/Contents/Resources/playwright
 */
export function getAppPlaywrightDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'playwright');
  }
  return path.join(app.getAppPath(), 'resources', 'playwright');
}

/**
 * 获取 Playwright 包路径（node_modules/playwright 所在的父目录）。
 *
 * 查找优先级：
 *   1. 应用内置 resources/playwright/node_modules/playwright（dev 直接 install 到这里）
 *   2. 打包后 Resources/playwright/package/node_modules/playwright（electron-builder extraResources）
 *   3. 用户安装 ~/.qa-cowork/skills/agent-browser/node_modules/playwright
 *   4. 项目根 node_modules/playwright（dev 模式 devDependency 兜底）
 */
export function getBuiltinPlaywrightPath(): string | null {
  // 1. 应用内置（dev 模式）
  const appDir = getAppPlaywrightDir();
  if (safeExists(path.join(appDir, 'node_modules', 'playwright', 'package.json'))) {
    return appDir;
  }

  // 2. 打包后 extraResources 布局
  if (app.isPackaged) {
    const packagedRoot = path.join(process.resourcesPath, 'playwright', 'package');
    if (safeExists(path.join(packagedRoot, 'node_modules', 'playwright', 'package.json'))) {
      return packagedRoot;
    }
    // 兼容旧版扁平布局
    if (safeExists(path.join(packagedRoot, 'playwright', 'package.json'))) {
      return packagedRoot;
    }
  }

  // 3. 用户安装目录
  if (safeExists(path.join(AGENT_BROWSER_SKILL_DIR, 'node_modules', 'playwright', 'package.json'))) {
    return AGENT_BROWSER_SKILL_DIR;
  }

  // 4. dev 模式兜底：仓库根目录的 devDependency
  if (!app.isPackaged) {
    if (safeExists(path.join(app.getAppPath(), 'node_modules', 'playwright', 'package.json'))) {
      return app.getAppPath();
    }
  }

  return null;
}

/**
 * 内置 Playwright 包的模块目录（含 package.json 的目录）。
 * 用于 PLAYWRIGHT_REAL_PATH、确定 playwright-core 位置等。
 */
export function getBuiltinPlaywrightModuleDir(): string | null {
  const root = getBuiltinPlaywrightPath();
  if (!root) return null;

  const viaNodeModules = path.join(root, 'node_modules', 'playwright');
  if (safeExists(path.join(viaNodeModules, 'package.json'))) {
    return viaNodeModules;
  }
  // 兼容旧版扁平布局
  const viaFlat = path.join(root, 'playwright');
  if (safeExists(path.join(viaFlat, 'package.json'))) {
    return viaFlat;
  }
  return null;
}

/**
 * RPA 子进程 require('playwright') 所需的 NODE_PATH 段。
 *
 * 返回 playwright 包所在目录的父目录（即 node_modules 目录），
 * 使子进程的 require('playwright') 能正确解析到内置包。
 */
export function getPlaywrightNodePathSegmentForRpa(): string | null {
  const fromModule = getBuiltinPlaywrightModuleDir();
  if (fromModule) {
    return path.dirname(fromModule);
  }

  // 打包后兜底：直接探测 extraResources 常见布局
  if (!app.isPackaged) return null;

  const base = process.resourcesPath;
  const searchRoots = [
    path.join(base, 'playwright', 'package', 'node_modules'),
    path.join(base, 'playwright', 'package'),
    path.join(base, 'playwright'),
  ];

  for (const root of searchRoots) {
    if (safeExists(path.join(root, 'playwright', 'package.json'))) {
      return root;
    }
    const nmPath = path.join(root, 'node_modules', 'playwright', 'package.json');
    if (safeExists(nmPath)) {
      return path.join(root, 'node_modules');
    }
  }
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. 浏览器路径解析（public API）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 获取 Playwright 浏览器目录路径。
 *
 * 优先级：
 *   1. 应用内置 resources/playwright/browsers（dev 模式直接使用）
 *   2. userData/playwright/browsers（打包后从 tar.gz 首次解压）
 *   3. ~/.qa-cowork/skills/agent-browser/browsers（用户手动安装）
 *
 * 每次返回前会调用 ensureBrowserVersionCompatibility，自动为版本不匹配的
 * chromium/headless_shell 创建 symlink。
 */
export function getBuiltinPlaywrightBrowsersPath(): string | null {
  // 1. dev 模式：resources/playwright/browsers 直接存在
  const appBrowsers = path.join(getAppPlaywrightDir(), 'browsers');
  if (hasBrowserDir(appBrowsers)) {
    ensureBrowserVersionCompatibility(appBrowsers);
    return appBrowsers;
  }

  // 2. 打包模式：检查 userData 下已解压的目录，或触发首次解压
  if (app.isPackaged) {
    const userDataBrowsers = path.join(app.getPath('userData'), 'playwright', 'browsers');
    if (hasBrowserDir(userDataBrowsers)) {
      ensureBrowserVersionCompatibility(userDataBrowsers);
      return userDataBrowsers;
    }
    // 尝试从内置 tar.gz 解压
    const tarGz = path.join(process.resourcesPath, 'playwright', 'chromium.tar.gz');
    if (safeExists(tarGz)) {
      if (extractChromiumTarGz(tarGz, userDataBrowsers)) {
        ensureBrowserVersionCompatibility(userDataBrowsers);
        return userDataBrowsers;
      }
    }
  }

  // 3. 用户手动安装目录
  const userBrowsers = path.join(AGENT_BROWSER_SKILL_DIR, 'browsers');
  if (hasBrowserDir(userBrowsers)) {
    ensureBrowserVersionCompatibility(userBrowsers);
    return userBrowsers;
  }

  return null;
}

/** 判断目录是否含有 chromium-XXXX 子目录（包括 symlink） */
function hasBrowserDir(dir: string): boolean {
  if (!safeExists(dir)) return false;
  return safeReaddir(dir).some((f) => /^chromium-\d+/.test(f));
}

/**
 * 检测系统已安装的 Chrome/Chromium 可执行路径。
 * 按优先级依次尝试常见安装位置，找到即返回。
 */
export function getSystemChromePath(): string | null {
  const candidatesByPlatform: Record<string, string[]> = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
  };

  const candidates = candidatesByPlatform[process.platform] || [];
  for (const p of candidates) {
    if (safeExists(p)) return p;
  }
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. 环境变量组装（public API）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 获取 Playwright 环境变量配置。
 *
 * 返回值直接合并到子进程 env 即可：
 *  - PLAYWRIGHT_BROWSERS_PATH: 浏览器二进制文件根目录
 *  - NODE_PATH: Node.js 模块搜索路径（使子进程能 require('playwright')）
 *  - PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: 阻止 playwright 自动下载浏览器
 *  - PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: 系统 Chrome 路径（辅助 channel 模式查找）
 */
export function getPlaywrightEnvVars(): Record<string, string> {
  const env: Record<string, string> = {};

  const playwrightModuleDir = getBuiltinPlaywrightModuleDir();
  const browsersPath = getBuiltinPlaywrightBrowsersPath();

  if (playwrightModuleDir) {
    const nodePathSegment = path.dirname(playwrightModuleDir);
    const existingNodePath = process.env.NODE_PATH || '';
    env.NODE_PATH = existingNodePath
      ? `${nodePathSegment}${path.delimiter}${existingNodePath}`
      : nodePathSegment;

    env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
  }

  if (browsersPath) {
    env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  }

  // 系统 Chrome 路径（供 channel 模式或 fallback 使用）
  const systemChrome = getSystemChromePath();
  if (systemChrome) {
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = systemChrome;
  }

  return env;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. agent-browser 插件兼容（public API）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 确保 agent-browser 插件能找到正确的浏览器。
 *
 * agent-browser 使用 playwright-core 内置逻辑确定浏览器路径，
 * 在 Electron 环境中会以 Application Support/<appName>/playwright/browsers/ 作为默认路径。
 *
 * 此函数：
 *   1. 从 AGENT_BROWSER_SKILL_DIR/browsers 中找到最新的 headless shell
 *   2. 在 Electron userData 下的 playwright/browsers/ 中为所有可能需要的版本创建 symlink
 *   3. 同时处理 chromium 全量浏览器的版本兼容
 */
export function ensureAgentBrowserCanFindChromium(): void {
  try {
    const sourceBrowsersPath = path.join(AGENT_BROWSER_SKILL_DIR, 'browsers');
    if (!safeExists(sourceBrowsersPath)) return;

    // 找到可用的 headless shell 目录（按版本号降序，优先取最新）
    const available = safeReaddir(sourceBrowsersPath)
      .filter((d) => d.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse();
    if (available.length === 0) return;
    const headlessShellSource = path.join(sourceBrowsersPath, available[0]);

    // agent-browser 使用的目标目录（Electron userData 下的 playwright/browsers）
    const appSupportBase =
      process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : process.platform === 'win32'
          ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
          : path.join(os.homedir(), '.local', 'share');

    // 读取 agent-browser 自身依赖的 playwright-core 的期望 revision
    const agentBrowserPwCore = path.join(
      AGENT_BROWSER_SKILL_DIR, 'node_modules', 'playwright-core', 'browsers.json',
    );
    let targetHeadlessVersions: string[] = ['chromium_headless_shell-1200']; // 默认兜底
    const agentBrowserData = safeReadJson(agentBrowserPwCore);
    if (agentBrowserData) {
      const browsers = agentBrowserData.browsers as Array<{ name: string; revision: string }> | undefined;
      const headless = browsers?.find((b) => b.name === 'chromium-headless-shell');
      if (headless?.revision) {
        targetHeadlessVersions = [`chromium_headless_shell-${headless.revision}`];
      }
    }

    const appNames = ['qacowork', 'QACowork'];
    for (const appName of appNames) {
      const targetBrowsersDir = path.join(appSupportBase, appName, 'playwright', 'browsers');
      if (!safeExists(targetBrowsersDir)) {
        try { fs.mkdirSync(targetBrowsersDir, { recursive: true }); } catch { continue; }
      }

      for (const targetVersion of targetHeadlessVersions) {
        const targetLink = path.join(targetBrowsersDir, targetVersion);
        ensureSymlink(targetLink, headlessShellSource);
      }

      // 同时为 userData browsers 目录做版本兼容
      ensureBrowserVersionCompatibility(targetBrowsersDir);
    }
  } catch (err) {
    console.warn(`${LOG_TAG} ensureAgentBrowserCanFindChromium error:`, err);
  }
}
