import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Playwright 安装根目录（固定）：~/.qa-cowork/skills/agent-browser/
 * PlaywrightManager 安装时也使用此目录，保证路径一致。
 */
const AGENT_BROWSER_SKILL_DIR = path.join(os.homedir(), '.qa-cowork', 'skills', 'agent-browser');

/**
 * 获取 Playwright 包路径（node_modules/playwright 所在的父目录）
 * 固定为 ~/.qa-cowork/skills/agent-browser/
 */
export function getBuiltinPlaywrightPath(): string | null {
  const nodeModulesPlaywright = path.join(AGENT_BROWSER_SKILL_DIR, 'node_modules', 'playwright', 'package.json');
  if (fs.existsSync(nodeModulesPlaywright)) {
    return AGENT_BROWSER_SKILL_DIR;
  }
  return null;
}

/**
 * 获取 Playwright 浏览器路径
 * 固定为 ~/.qa-cowork/skills/agent-browser/browsers/
 */
export function getBuiltinPlaywrightBrowsersPath(): string | null {
  const browsersPath = path.join(AGENT_BROWSER_SKILL_DIR, 'browsers');
  if (fs.existsSync(browsersPath)) {
    const hasChromium = fs.readdirSync(browsersPath).some((f) => f.startsWith('chromium-'));
    if (hasChromium) {
      return browsersPath;
    }
  }
  return null;
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
