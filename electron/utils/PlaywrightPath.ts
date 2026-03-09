import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { app } from 'electron';

/**
 * 用户目录下的 Playwright 安装目录（点击「立即安装」时使用）
 * ~/.qa-cowork/skills/agent-browser/
 */
export const AGENT_BROWSER_SKILL_DIR = path.join(os.homedir(), '.qa-cowork', 'skills', 'agent-browser');

/**
 * 应用内置 Playwright 目录（优先使用，与内置 Node 一致，不依赖用户本机 npm）
 * 开发：<项目>/resources/playwright，打包后：<app>/Contents/Resources/playwright
 */
export function getAppPlaywrightDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'playwright');
  }
  return path.join(app.getAppPath(), 'resources', 'playwright');
}

/**
 * 获取 Playwright 包路径（node_modules/playwright 所在的父目录）
 * 优先使用应用内置 resources/playwright，否则使用用户目录 ~/.qa-cowork/skills/agent-browser/
 */
export function getBuiltinPlaywrightPath(): string | null {
  const appDir = getAppPlaywrightDir();
  const appPkg = path.join(appDir, 'node_modules', 'playwright', 'package.json');
  if (fs.existsSync(appPkg)) {
    return appDir;
  }
  const userPkg = path.join(AGENT_BROWSER_SKILL_DIR, 'node_modules', 'playwright', 'package.json');
  if (fs.existsSync(userPkg)) {
    return AGENT_BROWSER_SKILL_DIR;
  }
  return null;
}

/**
 * 获取 Playwright 浏览器路径
 *
 * 优先级：
 *  1. 应用内置 resources/playwright/browsers（dev 模式直接使用）
 *  2. userData playwright/browsers（打包后解压目标目录）
 *  3. ~/.qa-cowork/skills/agent-browser/browsers（用户手动安装）
 *
 * 打包模式下，内置的是 chromium.tar.gz 而非展开的目录。
 * 首次调用时会自动将 tar.gz 解压到 userData playwright/browsers/，后续直接复用。
 */
export function getBuiltinPlaywrightBrowsersPath(): string | null {
  // 1. dev 模式：resources/playwright/browsers 直接存在
  const appBrowsers = path.join(getAppPlaywrightDir(), 'browsers');
  if (fs.existsSync(appBrowsers)) {
    const hasChromium = fs.readdirSync(appBrowsers).some((f) => f.startsWith('chromium-'));
    if (hasChromium) return appBrowsers;
  }

  // 2. 打包模式：检查 userData 下已解压的目录，或触发首次解压
  if (app.isPackaged) {
    const userDataBrowsers = path.join(app.getPath('userData'), 'playwright', 'browsers');
    if (fs.existsSync(userDataBrowsers)) {
      const hasChromium = fs.readdirSync(userDataBrowsers).some((f) => f.startsWith('chromium-'));
      if (hasChromium) return userDataBrowsers;
    }
    // 尝试从内置 tar.gz 解压
    const tarGz = path.join(process.resourcesPath, 'playwright', 'chromium.tar.gz');
    if (fs.existsSync(tarGz)) {
      const extracted = extractChromiumTarGz(tarGz, userDataBrowsers);
      if (extracted) return userDataBrowsers;
    }
  }

  // 3. 用户手动安装目录
  const userBrowsers = path.join(AGENT_BROWSER_SKILL_DIR, 'browsers');
  if (fs.existsSync(userBrowsers)) {
    const hasChromium = fs.readdirSync(userBrowsers).some((f) => f.startsWith('chromium-'));
    if (hasChromium) return userBrowsers;
  }
  return null;
}

/**
 * 将 chromium.tar.gz 解压到指定目录，返回是否成功。
 * 使用系统 tar 命令，避免引入额外依赖。
 */
function extractChromiumTarGz(tarGzPath: string, destDir: string): boolean {
  try {
    console.log(`[PlaywrightPath] 首次启动，解压内置 Chromium: ${tarGzPath} → ${destDir}`);
    fs.mkdirSync(destDir, { recursive: true });
    execSync(`tar -xzf "${tarGzPath}" -C "${destDir}"`, { stdio: 'pipe', timeout: 120_000 });
    console.log('[PlaywrightPath] Chromium 解压完成 ✓');
    return true;
  } catch (err) {
    console.error('[PlaywrightPath] Chromium 解压失败:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * 检测系统已安装的 Chrome/Chromium 可执行路径（优先使用系统浏览器）
 * 按优先级依次尝试常见安装位置，找到即返回，否则返回 null。
 */
export function getSystemChromePath(): string | null {
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  } else if (process.platform === 'linux') {
    const candidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  } else if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * 获取 Playwright 环境变量配置
 *
 * 返回需要在执行脚本时设置的环境变量，包括：
 * - PLAYWRIGHT_BROWSERS_PATH: 浏览器二进制文件路径
 * - NODE_PATH: Node.js 模块搜索路径（用于找到 playwright 包）
 * - PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: 系统 Chrome 路径（优先使用系统浏览器）
 *
 * @returns 环境变量对象
 */
export function getPlaywrightEnvVars(): Record<string, string> {
  const env: Record<string, string> = {};

  const playwrightPath = getBuiltinPlaywrightPath();
  const browsersPath = getBuiltinPlaywrightBrowsersPath();

  if (playwrightPath) {
    // NODE_PATH 指向安装根目录，让 require('playwright') 找到 node_modules/playwright
    const existingNodePath = process.env.NODE_PATH || '';
    const nodeModulesPath = path.join(playwrightPath, 'node_modules');
    env.NODE_PATH = existingNodePath
      ? `${nodeModulesPath}${path.delimiter}${existingNodePath}`
      : nodeModulesPath;

    env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
  }

  if (browsersPath) {
    env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  }

  // 优先使用系统已安装的 Chrome，避免下载 Chromium
  const systemChrome = getSystemChromePath();
  if (systemChrome) {
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = systemChrome;
  }

  return env;
}

/**
 * 确保 agent-browser 0.15.x 能找到正确的浏览器。
 *
 * agent-browser 0.15.x 使用 playwright-core 内置逻辑确定浏览器路径，在 Electron 环境中
 * 会将 Application Support/<appName>/playwright/browsers/ 作为默认路径。
 * 此函数在该路径下为 chromium_headless_shell-1200 创建指向已安装的 headless shell 的 symlink。
 */
export function ensureAgentBrowserCanFindChromium(): void {
  try {
    const sourceBrowsersPath = path.join(AGENT_BROWSER_SKILL_DIR, 'browsers');
    if (!fs.existsSync(sourceBrowsersPath)) return;

    // 找到可用的 headless shell 目录（按版本号降序，优先取最新）
    const available = fs.readdirSync(sourceBrowsersPath).filter((d) =>
      d.startsWith('chromium_headless_shell-')
    );
    if (available.length === 0) return;
    available.sort().reverse();
    const headlessShellSource = path.join(sourceBrowsersPath, available[0]);

    // agent-browser 0.15.x 使用的目标目录（Electron userData 下的 playwright/browsers）
    // macOS: ~/Library/Application Support/<appName>/playwright/browsers/
    const appSupportBase =
      process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : process.platform === 'win32'
          ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
          : path.join(os.homedir(), '.local', 'share');

    // agent-browser 0.15.x 要求的固定版本目录名
    const TARGET_HEADLESS_VERSION = 'chromium_headless_shell-1200';

    // 尝试多个可能的 appName（qacowork 及其他可能名称）
    const appNames = ['qacowork', 'QACowork'];
    for (const appName of appNames) {
      const targetBrowsersDir = path.join(appSupportBase, appName, 'playwright', 'browsers');
      const targetLink = path.join(targetBrowsersDir, TARGET_HEADLESS_VERSION);

      if (!fs.existsSync(targetBrowsersDir)) {
        fs.mkdirSync(targetBrowsersDir, { recursive: true });
      }

      // 若链接已正确指向源目录，跳过
      try {
        const stat = fs.lstatSync(targetLink);
        if (stat.isSymbolicLink()) {
          const linkTarget = fs.readlinkSync(targetLink);
          if (linkTarget === headlessShellSource) continue;
          fs.unlinkSync(targetLink);
        } else if (stat.isDirectory()) {
          // 真实目录，不替换
          continue;
        }
      } catch {
        // targetLink 不存在，继续创建
      }

      fs.symlinkSync(headlessShellSource, targetLink);
    }
  } catch (err) {
    // 非关键路径，不打断主流程
    console.warn('[PlaywrightPath] ensureAgentBrowserCanFindChromium error:', err);
  }
}
