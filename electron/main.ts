import { app, BrowserWindow, shell, ipcMain, screen, dialog, globalShortcut, Tray, Menu, nativeImage, webContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawn as cpSpawn } from 'node:child_process'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'
import { AgentRuntime } from './agent/AgentRuntime'
import { configStore, TrustLevel } from './config/ConfigStore'
import { sessionStore, SessionMode } from './config/SessionStore'
import { scriptStore } from './config/ScriptStore'
import { projectStore } from './config/ProjectStore'
import { rpaProjectStore } from './config/RPAProjectStore'
import { directoryManager } from './config/DirectoryManager'
import { permissionService } from './config/PermissionService'
import { ssoStore } from './config/SsoStore'

import { getBuiltinNodePath, getBuiltinPnpmPath, getSystemNpxPath } from './utils/NodePath'
import { resolveDeployEnv } from './utils/DeployEnvResolver'
import { runProjectQualityCheck } from './utils/ProjectQualityCheck'
import { resolveShellPath, validateShellPath, getShellCandidates, resolveShellForCommand } from './utils/ShellResolver'
import https from 'node:https'
import { ResourceUpdater } from './updater/ResourceUpdater'
import { PlaywrightManager } from './utils/PlaywrightManager'
import { setPlaywrightManager } from './utils/PlaywrightEnsure'
import { ensureAgentBrowserCanFindChromium, getPlaywrightEnvVars, getPlaywrightNodePathSegmentForRpa } from './utils/PlaywrightPath'
import { compareAppSemver } from './utils/appSemverCompare'
import { registerContextSwitchHandler, registerRpaContextSwitchHandler } from './contextSwitchCoordinator'
import Anthropic from '@anthropic-ai/sdk'

// Extend App type to include isQuitting property
declare global {
  namespace Electron {
    interface App {
      isQuitting?: boolean
    }
  }
}

// 打包后：dotenv 固定从可执行文件目录加载 .env，避免因 cwd 不同（双击 .app vs 直接运行 MacOS/QACowork）导致行为不一致
if (app.isPackaged) {
  const envPath = path.join(path.dirname(process.execPath), '.env');
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

/**
 * 比较版本号，用于决定是否使用热更新目录
 * 仅在此处使用，避免与后面的 compareVersions 重复
 */
function compareVersionsForDist(a: string, b: string): number {
  const parts1 = a.split('.').map(Number)
  const parts2 = b.split('.').map(Number)
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] ?? 0
    const p2 = parts2[i] ?? 0
    if (p1 > p2) return 1
    if (p1 < p2) return -1
  }
  return 0
}

/**
 * 获取前端资源目录路径
 * 生产环境下：若热更新目录存在且版本不低于应用版本则用热更新，否则用内置资源。
 * 这样在「整包更新」（如 GitHub Actions 安装新版本）后，会使用新内置前端，避免被旧热更新目录覆盖。
 *
 * 兼容性保护：若热更新版本的主版本号（major）或次版本号（minor）超过了主程序版本，
 * 说明前端包含了主进程尚未支持的 IPC handler（如 rpa:project:create 等），
 * 此时应拒绝加载热更新，回退到内置前端，避免"当前应用版本不支持此功能"的错误。
 */
function getRendererDistPath(): string {
  if (VITE_DEV_SERVER_URL) {
    return RENDERER_DIST
  }

  const hotUpdateDistDir = directoryManager.getHotUpdateDistDir()
  const hotUpdateIndexPath = path.join(hotUpdateDistDir, 'index.html')
  if (!fs.existsSync(hotUpdateIndexPath)) {
    console.log('[Main] Using built-in dist directory (no hot-update index)')
    return RENDERER_DIST
  }

  const appVersion = app.getVersion()
  const hotUpdateVersion = directoryManager.getHotUpdateVersion()
  // 热更新无清单或版本落后于应用版本（例如用户刚做了整包更新）→ 用内置，避免旧热更新覆盖新前端
  if (!hotUpdateVersion || compareVersionsForDist(hotUpdateVersion, appVersion) < 0) {
    console.log(`[Main] Using built-in dist directory (app=${appVersion}, hot-update=${hotUpdateVersion ?? 'none'}, prefer built-in after full app update)`)
    return RENDERER_DIST
  }

  // 兼容性保护（加强）：
  // 只要热更新版本高于主程序版本（包含 patch），都回退到内置前端。
  // 原先仅拦截 major/minor 超前，无法覆盖 "1.0.27 前端 + 1.0.26 主进程" 这类 patch 级不兼容。
  // 例如本次 webview 升级：前端依赖主进程开启 webviewTag，若主进程未更新会导致内置预览失效。
  if (compareVersionsForDist(hotUpdateVersion, appVersion) > 0) {
    console.warn(`[Main] Hot-update version (${hotUpdateVersion}) is newer than app (${appVersion}), falling back to built-in dist to avoid renderer/main incompatibility`)
    return RENDERER_DIST
  }

  console.log('[Main] Using hot-update dist directory')
  return hotUpdateDistDir
}

/**
 * 生成 renderer 加载指纹，用于生产环境 loadFile 的 query 参数。
 * 目标：当整包更新或热更新内容变化时，强制 Electron 重新拉取入口页面，避免命中旧缓存。
 */
function getRendererLoadVersionToken(): string {
  const appVersion = app.getVersion()
  const hotUpdateVersion = directoryManager.getHotUpdateVersion() || 'builtin'
  const distPath = getRendererDistPath()
  const indexPath = path.join(distPath, 'index.html')

  let indexFingerprint = 'missing'
  try {
    const stat = fs.statSync(indexPath)
    indexFingerprint = `${Math.floor(stat.mtimeMs)}-${stat.size}`
  } catch (error) {
    console.warn('[Main] Failed to stat renderer index.html for cache token:', error)
  }

  return `${appVersion}-${hotUpdateVersion}-${indexFingerprint}`
}

// Helper to get icon path for both dev and prod
function getIconPath(): string {
  // Try PNG first as it's always available
  const pngName = 'icon.png'

  if (app.isPackaged) {
    // In production, icon is in extraResources
    const pngPath = path.join(process.resourcesPath, pngName)
    if (fs.existsSync(pngPath)) return pngPath
    // Fallback to app.asar.unpacked
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', pngName)
    if (fs.existsSync(unpackedPath)) return unpackedPath
    // Last resort: return the expected primary path so the error message is clear
    console.error(`[Main] icon.png not found at ${pngPath} or ${unpackedPath}`)
    return pngPath
  } else {
    // In development, use public folder
    return path.join(process.env.APP_ROOT!, 'public', 'icon.png')
  }
}

// [Fix] Set specific userData path for dev mode to avoid permission/locking issues
if (VITE_DEV_SERVER_URL) {
  const devUserData = path.join(process.env.APP_ROOT, '.vscode', 'electron-userdata');
  if (!fs.existsSync(devUserData)) {
    fs.mkdirSync(devUserData, { recursive: true });
  }
  app.setPath('userData', devUserData);
}

// [Fix] 抑制 GPU/网络服务崩溃相关错误（M 系列 Mac 内置 iframe 预览时常见）
app.commandLine.appendSwitch('disable-gpu-sandbox');

// Internal MCP Server Runner
// MiniMax startup removed
// --- Normal App Initialization ---

let mainWin: BrowserWindow | null = null
let floatingBallWin: BrowserWindow | null = null
const terminalWindows: Map<string, BrowserWindow> = new Map()
let tray: Tray | null = null
let mainAgent: AgentRuntime | null = null  // Agent for main window
let floatingBallAgent: AgentRuntime | null = null  // Independent agent for floating ball
let resourceUpdater: ResourceUpdater | null = null  // Resource updater
let playwrightManager: PlaywrightManager | null = null  // Playwright manager

// Ball state
let isBallExpanded = false
const BALL_SIZE = 64
const EXPANDED_WIDTH = 340    // Match w-80 (320px) + padding
const EXPANDED_HEIGHT = 320   // Compact height for less dramatic expansion

// 右下角小窗模式：记录收缩前的位置/尺寸，便于还原
const MINI_WINDOW_WIDTH = 430
const MINI_WINDOW_HEIGHT = 560
const MINI_WINDOW_MARGIN = 16
let mainWinPreMiniState: { x: number; y: number; width: number; height: number } | null = null

/**
 * 将主窗口缩小并移至屏幕右下角，同时置顶。
 * 仅在打开客户端外部的浏览器或应用时调用，方便用户对照查看。
 * 打开客户端内置浏览器时不调用此函数。
 */
function shrinkMainWindowToBottomRight() {
  if (!mainWin || mainWin.isDestroyed()) return
  if (mainWin.isMinimized()) mainWin.restore()

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  // 记录还原状态（仅在未处于小窗模式时记录）
  if (!mainWinPreMiniState) {
    const [wx, wy] = mainWin.getPosition()
    const [ww, wh] = mainWin.getSize()
    mainWinPreMiniState = { x: wx, y: wy, width: ww, height: wh }
  }

  const targetX = sw - MINI_WINDOW_WIDTH - MINI_WINDOW_MARGIN
  const targetY = sh - MINI_WINDOW_HEIGHT - MINI_WINDOW_MARGIN

  mainWin.setBounds({ x: targetX, y: targetY, width: MINI_WINDOW_WIDTH, height: MINI_WINDOW_HEIGHT }, true)
  mainWin.setAlwaysOnTop(true, 'floating')
  mainWin.show()
  mainWin.focus()

  mainWin.webContents.send('window:enter-mini-mode')
}

/**
 * 延迟若干毫秒后通过 AppleScript 将 Google Chrome for Testing 窗口最大化。
 * 仅在 macOS 上生效；agent-browser --headed 启动后浏览器需要一小段时间初始化，
 * 所以延迟 1.5 秒再执行最大化，确保窗口已创建。
 */
function maximizeChromeForTesting(delayMs = 1500) {
  if (process.platform !== 'darwin') return
  setTimeout(async () => {
    const { spawn } = await import('node:child_process')
    // 使用 spawn 传递多个 -e 参数，避免单引号转义问题
    // 通过点击缩放按钮（绿色按钮）最大化窗口，而非全屏
    const child = spawn('osascript', [
      '-e', 'tell application "System Events"',
      '-e', 'set chromeProcs to every process whose name contains "Google Chrome for Testing"',
      '-e', 'repeat with proc in chromeProcs',
      '-e', 'set frontmost of proc to true',
      '-e', 'repeat with win in windows of proc',
      '-e', 'try',
      '-e', 'set zoomBtn to (first button of win whose subrole is "AXZoomButton")',
      '-e', 'click zoomBtn',
      '-e', 'end try',
      '-e', 'end repeat',
      '-e', 'end repeat',
      '-e', 'end tell',
    ])
    child.on('error', (err: Error) => {
      console.warn('[Main] maximizeChromeForTesting error:', err.message)
    })
    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) console.warn('[Main] maximizeChromeForTesting AppleScript:', msg)
    })
  }, delayMs)
}

/**
 * 将主窗口从右下角小窗模式还原到之前的位置和大小。
 */
function restoreMainWindowFromMini() {
  if (!mainWin || mainWin.isDestroyed()) return
  mainWin.setAlwaysOnTop(false)
  if (mainWinPreMiniState) {
    mainWin.setBounds(mainWinPreMiniState, true)
    mainWinPreMiniState = null
  }
}

app.on('before-quit', async () => {
  app.isQuitting = true
  console.log('[Main] Application is quitting, starting cleanup...');
  
  // 1. 关闭所有浏览器（通过 agent-browser）
  try {
    console.log('[Main] Closing browser sessions...');
    // 使用 agent-browser close 命令关闭浏览器
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    try {
      // 关闭默认浏览器会话
      await execAsync('agent-browser close', {
        timeout: 5000,
        encoding: 'utf-8'
      });
      console.log('[Main] Browser session closed');
    } catch (browserError) {
      // 浏览器可能未运行，忽略错误
      console.log('[Main] Browser cleanup skipped (browser may not be running)');
    }
  } catch (error) {
    console.warn('[Main] Error closing browser:', error);
  }
  
  // 2. 清理所有终端会话
  console.log('[Main] Cleaning up terminal sessions...');
  terminalSessions.forEach((session, id) => {
    try {
      if (session.pty) {
        console.log(`[Main] Killing terminal PTY session ${id}`);
        session.pty.kill('SIGKILL');
      } else if (session.process && session.process.pid) {
        console.log(`[Main] Killing terminal process ${id} (PID: ${session.process.pid})`);
        if (process.platform === 'win32') {
          // Windows: 使用 taskkill 强制终止进程树
          cpSpawn('taskkill', ['/PID', session.process.pid.toString(), '/T', '/F'], {
            stdio: 'ignore'
          });
        } else {
          // Unix: 发送 SIGKILL 信号
          session.process.kill('SIGKILL');
        }
      }
    } catch (error) {
      console.warn(`[Main] Error killing terminal session ${id}:`, error);
    }
  });
  terminalSessions.clear();
  console.log('[Main] Terminal sessions cleaned up');
  
  // 3. 清理所有子进程和端口（通过 FileSystemTools）
  try {
    console.log('[Main] Cleaning up child processes and ports...');
    const { FileSystemTools } = await import('./agent/tools/FileSystemTools');
    await FileSystemTools.cleanupAll();
    
    // 额外清理常用的开发端口（3000, 5173, 8080 等）
    console.log('[Main] Cleaning up common development ports...');
    const commonPorts = [3000, 5173, 8080, 4200, 8000];
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    for (const port of commonPorts) {
      try {
        if (process.platform === 'darwin' || process.platform === 'linux') {
          const { stdout } = await execAsync(`lsof -ti :${port}`, {
            timeout: 2000,
            encoding: 'utf-8'
          });
          const pids = stdout.trim().split(/\s+/).filter(Boolean);
          if (pids.length > 0) {
            console.log(`[Main] Killing processes on port ${port}: ${pids.join(', ')}`);
            for (const pid of pids) {
              await execAsync(`kill -9 ${pid}`, { timeout: 2000 });
            }
          }
        } else if (process.platform === 'win32') {
          const { stdout } = await execAsync(`netstat -ano | findstr ":${port}"`, {
            timeout: 2000,
            encoding: 'utf-8',
            shell: 'cmd.exe'
          });
          const lines = stdout.trim().split(/\r?\n/).filter((line: string) => line.includes(`:${port}`) && line.includes('LISTENING'));
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid) {
              console.log(`[Main] Killing process ${pid} on port ${port}`);
              await execAsync(`taskkill /PID ${pid} /F`, {
                timeout: 2000,
                shell: 'cmd.exe'
              });
            }
          }
        }
      } catch (portError) {
        // 端口可能未被占用，忽略错误
      }
    }
    
    console.log('[Main] Child processes and ports cleaned up');
  } catch (error) {
    console.warn('[Main] Error cleaning up child processes:', error);
  }
  
  // 4. 清理 Agent 资源
  const agents = [mainAgent, floatingBallAgent].filter((agent): agent is AgentRuntime => agent !== null)
  if (agents.length > 0) {
    console.log('[Main] Cleaning up agent resources...');
    for (const agentInstance of agents) {
      try {
        await agentInstance.dispose();
      } catch (err) {
        console.error('[Main] Error disposing agent:', err);
      }
    }
    mainAgent = null;
    floatingBallAgent = null;
  }

  // 5. 停止资源更新器
  if (resourceUpdater) {
    resourceUpdater.stopAutoUpdateCheck()
  }
  
  console.log('[Main] Cleanup completed, application will now quit');
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// [Fix] Prevent crash on EPIPE (broken pipe) when child processes die unexpectedly during reload
process.on('uncaughtException', (err: any) => {
  if (err.code === 'EPIPE' || err.message?.includes('EPIPE')) {
    console.warn('[Main] Detected EPIPE error (likely from MCP child process). Ignoring to prevent crash.');
    return;
  }
  console.error('Uncaught Exception:', err);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  }
})

app.whenReady().then(() => {
  // Set App User Model ID for Windows notifications
  // app.setAppUserModelId('com.opencowork.app')

  // Register Protocol Client
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('opencowork')
  } else {
    console.log('Skipping protocol registration in Dev mode.')
  }

  // Log version information on startup
  const appVersion = app.getVersion()
  const hotUpdateVersion = directoryManager.getHotUpdateVersion()
  const effectiveVersion = resourceUpdater?.getCurrentVersion() || appVersion
  console.log(`[Main] App started - appVersion: ${appVersion}, hotUpdateVersion: ${hotUpdateVersion}, effectiveVersion: ${effectiveVersion}`)

  // 清理过期热更新 dist：整包安装新版本后，若热更新目录版本低于应用版本，删除旧的 hot-update/dist
  // 避免旧版前端资源遗留在热更新目录中，导致下次启动时 ResourceUpdater.getCurrentVersion 返回旧版本号
  if (hotUpdateVersion && compareVersionsForDist(hotUpdateVersion, appVersion) < 0) {
    try {
      const staleDistDir = directoryManager.getHotUpdateDistDir()
      if (fs.existsSync(staleDistDir)) {
        fs.rmSync(staleDistDir, { recursive: true, force: true })
        console.log(`[Main] Cleaned stale hot-update dist (hotUpdate=${hotUpdateVersion} < app=${appVersion})`)
      }
    } catch (cleanupErr) {
      console.error('[Main] Failed to clean stale hot-update dist:', cleanupErr)
    }
  }

  // #region agent log - launch mode debug (H1,H2,H5)
  try {
    const userDataPath = app.getPath('userData');
    const cwd = process.cwd();
    const appName = app.getName();
    const execDir = path.dirname(process.execPath);
    const envInCwd = path.join(cwd, '.env');
    const envInExecDir = path.join(execDir, '.env');
    const payload = {
      location: 'main.ts:app.whenReady',
      message: 'Launch context',
      data: {
        cwd,
        userDataPath,
        appName,
        execDir,
        isPackaged: app.isPackaged,
        hasEnvKey: !!process.env.ANTHROPIC_API_KEY,
        envExistsInCwd: fs.existsSync(envInCwd),
        envExistsInExecDir: fs.existsSync(envInExecDir)
      },
      timestamp: Date.now(),
      hypothesisId: 'H1,H2,H5'
    };
    fs.appendFileSync(path.join(userDataPath, 'debug-launch.log'), JSON.stringify(payload) + '\n');
    fetch('http://127.0.0.1:7242/ingest/c9da8242-409a-4cac-8926-c6d816aecb2e', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  } catch (_e) {}
  // #endregion

  // 1. Setup IPC handlers FIRST
  // 1. Setup IPC handlers FIRST
  // setupIPCHandlers() - handlers are defined at top level now

  // 2. Create windows
  createMainWindow()
  createFloatingBallWindow()

  // 3. Quick synchronous setup (non-blocking, fast)
  ensureBuiltinMcpConfig()
  permissionService.getUserRole()
  sessionStore.cleanupEmptySessions()

  // 4. Initialize resource updater (fast, just creates instance)
  resourceUpdater = new ResourceUpdater()
  
  const notifyUpdateFound = (updateInfo: any) => {
    console.log('[Main] Resource update found, notifying renderer...')
    mainWin?.webContents.send('resource:update-available', updateInfo)
    floatingBallWin?.webContents.send('resource:update-available', updateInfo)
  }
  
  if (app.isPackaged) {
    resourceUpdater.startAutoUpdateCheck(1 / 60, notifyUpdateFound)
  } else {
    resourceUpdater.startAutoUpdateCheck(1 / 60, notifyUpdateFound)
  }

  // 7.5 Initialize Playwright manager（不再弹窗提示安装；自动化执行时自动判断并静默安装）
  playwrightManager = new PlaywrightManager()
  setPlaywrightManager(playwrightManager)

  // 确保 agent-browser 0.15.x 能在 Electron 环境中找到 chromium headless shell
  ensureAgentBrowserCanFindChromium()

  // 4. Create system tray
  createTray()

  // 5. Register global shortcut
  globalShortcut.register('Alt+Space', () => {
    if (floatingBallWin) {
      if (floatingBallWin.isVisible()) {
        if (isBallExpanded) {
          toggleFloatingBallExpanded()
        }
        floatingBallWin.hide()
      } else {
        floatingBallWin.show()
        floatingBallWin.focus()
      }
    }
  })

  // Show main window and bring to front
  mainWin?.show()
  mainWin?.focus()

  console.log('OpenCowork started. Press Alt+Space to toggle floating ball.')
})


//Functions defined outside the block to ensure proper hoisiting and scope access (vars are global to file)

// IPC Handlers

ipcMain.handle('agent:send-message', async (event, message: string | { content: string, images: string[] }, viewContext?: 'cowork' | 'project' | 'automation') => {
  // Determine which agent to use based on sender window
  const isFloatingBall = event.sender === floatingBallWin?.webContents
  const targetAgent = isFloatingBall ? floatingBallAgent : mainAgent
  console.log('[Preview:Debug] agent:send-message received, viewContext:', viewContext, 'isFloatingBall:', isFloatingBall, 'targetAgent exists:', !!targetAgent, 'currentTaskIdForSession:', currentTaskIdForSession, 'currentRpaTaskIdForSession:', currentRpaTaskIdForSession)
  if (!targetAgent) return { error: 'Agent not initialized' }
  // 协作视图：无项目/任务；代码视图：projectStore；自动化视图：rpaProjectStore
  const isCoworkView = viewContext === 'cowork' || isFloatingBall
  const isAutomationView = viewContext === 'automation'
  let currentProject = null
  let taskId: string | undefined
  let projectId: string | undefined
  if (isCoworkView) {
    // 协作模式：无项目/任务
  } else if (isAutomationView) {
    const rpaProject = rpaProjectStore.getCurrentProject()
    currentProject = rpaProject ? { id: rpaProject.id, path: rpaProject.path } : null
    taskId = rpaProject && currentRpaTaskIdForSession ? currentRpaTaskIdForSession : undefined
    projectId = currentProject?.id
    if (projectId && taskId) {
      rpaProjectStore.updateTask(projectId, taskId, { status: 'active' })
      const targetWindow = isFloatingBall ? floatingBallWin : mainWin
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('rpa:task:updated', { projectId, taskId, updates: { status: 'active' } })
      }
    }
  } else {
    currentProject = projectStore.getCurrentProject()
    taskId = currentProject && currentTaskIdForSession ? currentTaskIdForSession : undefined
    projectId = currentProject?.id
    if (projectId && taskId) {
      projectStore.updateTask(projectId, taskId, { status: 'active' })
      const targetWindow = isFloatingBall ? floatingBallWin : mainWin
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('project:task:updated', { projectId, taskId, updates: { status: 'active' } })
      }
    }
  }
  const viewCtx: 'cowork' | 'project' | 'automation' = isCoworkView ? 'cowork' : (isAutomationView ? 'automation' : 'project')
  try {
    return await targetAgent.processUserMessage(message, taskId, projectId, isFloatingBall, viewCtx)
  } catch (apiError: unknown) {
    const err = apiError as { status?: number; message?: string; error?: { message?: string } }
    const targetWindow = (isFloatingBall && floatingBallWin && !floatingBallWin.isDestroyed()) ? floatingBallWin : mainWin
    const status = err?.status

    // 常见 API 状态码：AgentRuntime.processMessageWithContext 已 broadcast agent:error，此处不再重复发送、也不再 throw，
    // 避免主进程「Error occurred in handler for 'agent:send-message'」及双重错误提示
    if (typeof status === 'number' && [400, 401, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504].includes(status)) {
      return { ok: false as const, status }
    }

    const payload = { message: err?.message || (apiError instanceof Error ? apiError.message : String(apiError)), taskId, projectId }
    if (targetWindow?.webContents && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('agent:error', payload)
    }
    throw apiError
  }
})

ipcMain.handle('agent:is-ready', (event) => {
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  return { ready: !!targetAgent }
})

ipcMain.handle('agent:abort', (event) => {
  // Determine which agent to abort based on sender window
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  targetAgent?.abort()
})

ipcMain.handle('app:set-active-view', (_, view: 'cowork' | 'project' | 'automation') => {
  const prevView = currentActiveView
  currentActiveView = view

  // 切换到 project 或 automation 时：清空两个模式的 task 上下文，清空 agent，等待新视图加载本模式第一条任务
  if (view === 'project' || view === 'automation') {
    currentTaskIdForSession = null
    currentRpaTaskIdForSession = null
    sessionStore.setSessionId(null, false)
    if (mainAgent) {
      mainAgent.clearHistory()
    }
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('agent:history-update', [])
    }
    console.log(`[Main] Switched to ${view} mode, cleared chat (prev: ${prevView})`)
  }
})

ipcMain.handle('agent:confirm-response', (_, { id, approved, remember, tool, path }: { id: string, approved: boolean, remember?: boolean, tool?: string, path?: string }) => {
  if (approved && remember && tool) {
    configStore.addPermission(tool, path)
    console.log(`[Permission] Saved: ${tool} for path: ${path || '*'}`)
  }
  // Both agents can handle confirmations (they share the same permission requests)
  mainAgent?.handleConfirmResponse(id, approved)
  floatingBallAgent?.handleConfirmResponse(id, approved)
})

ipcMain.handle('agent:new-session', (event) => {
  // Determine which agent to use based on sender window
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  const isFloatingBall = event.sender === floatingBallWin?.webContents
  targetAgent?.clearHistory()
  // 清除当前会话ID，确保下次保存时创建新会话
  sessionStore.setSessionId(null, isFloatingBall)
  // Don't create session immediately - wait for actual messages
  // This prevents empty sessions from cluttering the history
  return { success: true, sessionId: null }
})

/** 向 Agent history 注入初始消息（不触发 AI 处理），并通知前端更新聊天区 */
ipcMain.handle('agent:inject-history', (event, messages: Anthropic.MessageParam[]) => {
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  const isFloatingBall = event.sender === floatingBallWin?.webContents
  if (!targetAgent || !Array.isArray(messages)) return { success: false }
  targetAgent.loadHistory(messages)
  const targetWindow = isFloatingBall ? floatingBallWin : mainWin
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('agent:history-update', messages)
  }
  return { success: true }
})

/** 部署专用：更新 history 中最后一条 assistant 消息的内容（用于实时刷新部署日志） */
ipcMain.handle('agent:update-last-assistant', (event, content: string) => {
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  const isFloatingBall = event.sender === floatingBallWin?.webContents
  if (!targetAgent) return { success: false }
  const history = targetAgent.getHistory()
  const updated = [...history]
  for (let i = updated.length - 1; i >= 0; i--) {
    if (updated[i].role === 'assistant') {
      updated[i] = { role: 'assistant', content }
      break
    }
  }
  targetAgent.loadHistory(updated)
  const targetWindow = isFloatingBall ? floatingBallWin : mainWin
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('agent:history-update', updated)
  }
  return { success: true }
})

/** 部署专用：向 Agent history 追加一条 assistant 消息 */
ipcMain.handle('agent:append-assistant', (event, content: string) => {
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  const isFloatingBall = event.sender === floatingBallWin?.webContents
  if (!targetAgent) return { success: false }
  const history = targetAgent.getHistory()
  const updated = [...history, { role: 'assistant' as const, content }]
  targetAgent.loadHistory(updated)
  const targetWindow = isFloatingBall ? floatingBallWin : mainWin
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('agent:history-update', updated)
  }
  return { success: true }
})

/** 向当前最后一条 assistant 消息内容末尾追加文本（用于自动化执行输出到聊天区） */
ipcMain.handle('agent:append-to-last-assistant', (event, text: string) => {
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  const isFloatingBall = event.sender === floatingBallWin?.webContents
  if (!targetAgent || typeof text !== 'string') return { success: false }
  const history = targetAgent.getHistory()
  const updated = history.slice()
  for (let i = updated.length - 1; i >= 0; i--) {
    if (updated[i].role === 'assistant') {
      const msg = updated[i] as { role: 'assistant'; content: string | Anthropic.ContentBlock[] }
      if (typeof msg.content === 'string') {
        updated[i] = { role: 'assistant', content: msg.content + text }
      } else if (Array.isArray(msg.content)) {
        const blocks = msg.content.slice()
        const lastText = blocks.findIndex((b: { type?: string }) => b.type === 'text')
        if (lastText !== -1) {
          const block = blocks[lastText] as Anthropic.TextBlock
          blocks[lastText] = { ...block, text: block.text + text }
        } else {
          blocks.push({ type: 'text', text, citations: [] } as Anthropic.TextBlock)
        }
        updated[i] = { role: 'assistant', content: blocks }
      } else {
        updated[i] = { role: 'assistant', content: String(msg.content || '') + text }
      }
      break
    }
  }
  targetAgent.loadHistory(updated)
  const targetWindow = isFloatingBall ? floatingBallWin : mainWin
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('agent:history-update', updated)
  }
  return { success: true }
})

/** 部署专用：获取 Agent 当前 history */
ipcMain.handle('agent:get-history', (event) => {
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  return targetAgent?.getHistory() ?? []
})

// Session Management
ipcMain.handle('session:list', (_, mode?: SessionMode) => {
  const coworkDir = directoryManager.getCoworkWorkspaceDir()
  return sessionStore.getSessions(mode, coworkDir)
})

/** Cowork 模式挂载时按需加载最近会话，避免 Project 模式被 Cowork 历史覆盖 */
ipcMain.handle('session:auto-load', () => {
  autoLoadLatestSession()
  return { success: true }
})

ipcMain.handle('session:get', (_, id: string) => {
  return sessionStore.getSession(id)
})

ipcMain.handle('session:load', (event, id: string) => {
  const session = sessionStore.getSession(id)
  // Determine which agent to use based on sender window
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  const isFloatingBall = event.sender === floatingBallWin?.webContents
  if (session && targetAgent) {
    // 设置当前会话ID（在加载历史之前设置，确保后续保存使用正确的会话ID）
    sessionStore.setSessionId(id, isFloatingBall)
    // 加载历史（这会触发 agent:history-update 事件）
    targetAgent.loadHistory(session.messages)
    return { success: true }
  }
  return { error: 'Session not found' }
})

ipcMain.handle('session:save', (event, messages: Anthropic.MessageParam[]) => {
  // Determine which window is making the request
  const isFloatingBall = event.sender === floatingBallWin?.webContents

  // Get the appropriate current session ID based on window
  const currentId = sessionStore.getSessionId(isFloatingBall)

  // Capture current primary working directory for session binding
  const authorizedFolders = configStore.getAll().authorizedFolders || []
  const currentWorkspaceDir = authorizedFolders.length > 0 ? authorizedFolders[0].path : undefined

  console.log(`[Session] Saving session for ${isFloatingBall ? 'floating ball' : 'main window'}: ${messages.length} messages, workspaceDir: ${currentWorkspaceDir}`)

  try {
    // 根据当前视图模式来标记 session 来源并关联任务
    // 直接使用 currentActiveView 决定 sessionMode，避免切换到 cowork 模式后仍用旧 projectStore 状态判断
    const sessionMode: SessionMode = currentActiveView
    const isAutomation = currentActiveView === 'automation'
    const currentProject = isAutomation ? rpaProjectStore.getCurrentProject() : projectStore.getCurrentProject()
    const taskIdForSession = isAutomation ? currentRpaTaskIdForSession : currentTaskIdForSession

    // Use the smart save method that only saves if there's meaningful content
    const sessionId = sessionStore.saveSession(currentId, messages, currentWorkspaceDir, sessionMode)

    // Update the appropriate current session ID
    if (sessionId) {
      sessionStore.setSessionId(sessionId, isFloatingBall)
      
      // 如果是项目/自动化视图，尝试更新当前任务的 sessionId
      if (currentProject && taskIdForSession) {
        const tasks = isAutomation ? rpaProjectStore.getTasks(currentProject.id) : projectStore.getTasks(currentProject.id)
        const task = tasks.find((t: { id: string; sessionId?: string }) => t.id === taskIdForSession)
        if (task && (!task.sessionId || task.sessionId === '')) {
          if (isAutomation) {
            rpaProjectStore.updateTask(currentProject.id, taskIdForSession, { sessionId })
          } else {
            projectStore.updateTask(currentProject.id, taskIdForSession, { sessionId })
          }
          console.log(`[${isAutomation ? 'RPA' : 'Project'}] Associated session ${sessionId} with task ${taskIdForSession} (${task.title})`)
        }
      } else if (currentProject) {
        const tasks = isAutomation ? rpaProjectStore.getTasks(currentProject.id) : projectStore.getTasks(currentProject.id)
        const tasksWithoutSession = tasks.filter((t: { sessionId?: string; updatedAt: number }) => !t.sessionId || t.sessionId === '').sort((a: { updatedAt: number }, b: { updatedAt: number }) => b.updatedAt - a.updatedAt)
        if (tasksWithoutSession.length > 0) {
          const taskToUpdate = tasksWithoutSession[0]
          if (isAutomation) {
            rpaProjectStore.updateTask(currentProject.id, taskToUpdate.id, { sessionId })
          } else {
            projectStore.updateTask(currentProject.id, taskToUpdate.id, { sessionId })
          }
          console.log(`[${isAutomation ? 'RPA' : 'Project'}] Associated session ${sessionId} with latest task without session ${taskToUpdate.id} (${taskToUpdate.title})`)
        }
      }
    }

    return { success: true, sessionId: sessionId || undefined }
  } catch (error) {
    console.error('[Session] Error saving session:', error)
    return { success: false, error: (error as Error).message }
  }
})

/** 使用当前 Agent 的 history 保存会话（用于执行结束后把输出持久化到当前任务） */
ipcMain.handle('session:save-current', (event) => {
  const isFloatingBall = event.sender === floatingBallWin?.webContents
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  if (!targetAgent) return { success: false, error: 'Agent not initialized' }
  const messages = targetAgent.getHistory()
  const currentId = sessionStore.getSessionId(isFloatingBall)
  const authorizedFolders = configStore.getAll().authorizedFolders || []
  const currentWorkspaceDir = authorizedFolders.length > 0 ? authorizedFolders[0].path : undefined
  try {
    const sessionMode: SessionMode = currentActiveView
    const isAutomation = currentActiveView === 'automation'
    const currentProject = isAutomation ? rpaProjectStore.getCurrentProject() : projectStore.getCurrentProject()
    const taskIdForSession = isAutomation ? currentRpaTaskIdForSession : currentTaskIdForSession
    const sessionId = sessionStore.saveSession(currentId, messages, currentWorkspaceDir, sessionMode)
    if (sessionId) {
      sessionStore.setSessionId(sessionId, isFloatingBall)
      if (currentProject && taskIdForSession) {
        const tasks = isAutomation ? rpaProjectStore.getTasks(currentProject.id) : projectStore.getTasks(currentProject.id)
        const task = tasks.find((t: { id: string; sessionId?: string }) => t.id === taskIdForSession)
        // 自动化模式：始终把当前任务关联到刚保存的 session，保证执行输出等聊天历史切换任务卡片后仍可加载
        if (task) {
          if (isAutomation) {
            rpaProjectStore.updateTask(currentProject.id, taskIdForSession, { sessionId })
          } else if (!task.sessionId || task.sessionId === '') {
            projectStore.updateTask(currentProject.id, taskIdForSession, { sessionId })
          }
        }
      } else if (currentProject) {
        const tasks = isAutomation ? rpaProjectStore.getTasks(currentProject.id) : projectStore.getTasks(currentProject.id)
        const tasksWithoutSession = tasks.filter((t: { sessionId?: string; updatedAt: number }) => !t.sessionId || t.sessionId === '').sort((a: { updatedAt: number }, b: { updatedAt: number }) => b.updatedAt - a.updatedAt)
        if (tasksWithoutSession.length > 0) {
          const taskToUpdate = tasksWithoutSession[0]
          if (isAutomation) {
            rpaProjectStore.updateTask(currentProject.id, taskToUpdate.id, { sessionId })
          } else {
            projectStore.updateTask(currentProject.id, taskToUpdate.id, { sessionId })
          }
        }
      }
    }
    return { success: true, sessionId: sessionId || undefined }
  } catch (error) {
    console.error('[Session] Error saving current session:', error)
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('session:delete', (_, id: string) => {
  sessionStore.deleteSession(id)
  return { success: true }
})

ipcMain.handle('session:current', () => {
  const id = sessionStore.getCurrentSessionId()
  return id ? sessionStore.getSession(id) : null
})

// Script Management
ipcMain.handle('script:list', () => {
  return scriptStore.getScripts()
})

ipcMain.handle('script:delete', (_, id: string) => {
  const script = scriptStore.getScript(id)
  if (!script) {
    return { success: false, error: 'Script not found' }
  }

  // 权限检查：只有管理员可以删除脚本
  if (!permissionService.canDeleteScript(id, script.isOfficial)) {
    return { success: false, error: 'Permission denied: Only administrators can delete scripts' }
  }

  const success = scriptStore.deleteScript(id)
  return { success, error: success ? undefined : 'Failed to delete script' }
})

ipcMain.handle('script:rename', (_, id: string, newName: string) => {
  const script = scriptStore.getScript(id)
  if (!script) {
    return { success: false, error: 'Script not found' }
  }

  // 权限检查：只有管理员可以重命名脚本
  if (!permissionService.canRenameScript(id, script.isOfficial)) {
    return { success: false, error: 'Permission denied: Only administrators can rename scripts' }
  }

  // 验证新名称
  if (!newName || newName.trim().length === 0) {
    return { success: false, error: 'Invalid script name' }
  }

  const success = scriptStore.renameScript(id, newName.trim())
  return { success, error: success ? undefined : 'Failed to rename script' }
})

/**
 * 检测用户输入中是否包含"关闭浏览器"的意图
 */
function shouldCloseBrowser(userInput: string): boolean {
  if (!userInput) return false;
  
  const closeKeywords = [
    '关闭浏览器',
    '关闭窗口',
    '关闭页面',
    'close browser',
    'close window',
    'close page',
    'browser.close',
    'context.close',
    'page.close',
    '退出浏览器',
    '退出窗口'
  ];
  
  const inputLower = userInput.toLowerCase();
  return closeKeywords.some(keyword => inputLower.includes(keyword.toLowerCase()));
}

ipcMain.handle('script:execute', async (event, scriptId: string, userMessage?: string) => {
  const script = scriptStore.getScript(scriptId)
  if (!script) {
    return { success: false, error: 'Script not found' }
  }

  // 确定使用哪个 agent
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  if (!targetAgent) {
    return { success: false, error: 'Agent not initialized' }
  }

  try {
    // 确定是浮动球窗口还是主窗口
    const isFloatingBall = event.sender === floatingBallWin?.webContents
    
    // 获取当前会话ID（如果存在），否则创建新会话
    let currentSessionId = sessionStore.getSessionId(isFloatingBall)
    const sessionTitle = `执行脚本: ${script.name}`
    
    if (!currentSessionId) {
      // 如果没有当前会话，创建新会话
      const newSession = sessionStore.createSession(sessionTitle)
      currentSessionId = newSession.id
      sessionStore.setSessionId(currentSessionId, isFloatingBall)
    } else {
      // 如果有当前会话，更新会话标题（但不清空历史，让执行结果追加到当前会话）
      const currentSession = sessionStore.getSession(currentSessionId)
      if (currentSession) {
        // 更新标题，但保留现有消息（不清空）
        sessionStore.updateSession(currentSessionId, currentSession.messages, sessionTitle)
      }
    }
    
    // 清空 agent 历史（这样执行脚本时不会显示之前的对话）
    // 但保持在当前会话中，执行结果会追加到当前会话
    targetAgent.clearHistory()
    
    // 通知前端历史已清空（这样前端会显示空状态，等待新的执行结果）
    const targetWindow = isFloatingBall ? floatingBallWin : mainWin
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('agent:history-update', [])
    }
    
    // 构建执行命令
    const scriptDir = path.dirname(script.filePath)
    const scriptName = path.basename(script.filePath)
    const nodePath = getBuiltinNodePath()
    // 使用引号包裹 node 路径，防止路径中包含空格
    const nodeCommand = nodePath.includes(' ') ? `"${nodePath}"` : nodePath
    const command = `cd "${scriptDir}" && ${nodeCommand} "${scriptName}"`
    
    // 检测用户输入中是否包含"关闭浏览器"的意图
    const userInput = userMessage || '';
    const shouldClose = shouldCloseBrowser(userInput);
    
    // 构建执行消息
    let executeMessage = `请执行以下自动化脚本：\n\n\`\`\`bash\n${command}\n\`\`\`\n\n脚本路径：${script.filePath}`;
    executeMessage += `\n\n📌 **数据时效**：若本脚本依赖本地数据文件（如 .json）生成 PDF/报表，且用户需要「每次生成新内容、用最新数据」，请先执行抓取最新数据的步骤或脚本，再执行本脚本；不要默认使用本地已有 JSON 作为数据源。详见 ai-playwright 与 generate-file 技能。`;
    
    // 如果没有明确要求关闭浏览器，添加提示保持浏览器打开
    if (!shouldClose) {
      executeMessage += `\n\n⚠️ 重要提示：脚本执行完成后请保持浏览器打开，不要自动调用 browser.close()、context.close() 或 page.close()。除非用户明确要求"关闭浏览器"，否则浏览器应该保持打开状态以便用户查看结果或继续操作。`;
    } else {
      executeMessage += `\n\n✅ 用户要求关闭浏览器，脚本执行完成后可以关闭浏览器。`;
    }
    
    // 先返回 sessionId，让前端可以立即设置运行状态
    // 然后异步执行脚本，不阻塞返回
    setImmediate(async () => {
      try {
        // 使用 agent 的 processUserMessage 方法，传递 taskId 以支持并发执行
        // 使用当前会话 ID 作为 taskId，保持在当前会话中
        await targetAgent.processUserMessage(executeMessage, currentSessionId, undefined, isFloatingBall)
      } catch (error) {
        console.error('[Script] Error executing script:', error)
        const errorMsg = (error as Error).message
        
        // 检查是否是脚本执行成功但后续 AI 调用失败的情况
        // 这种情况下不应该显示错误弹窗
        const isNonCriticalError = errorMsg.includes('脚本执行已完成') || 
                                   errorMsg.includes('状态码 400') ||
                                   errorMsg.includes('状态码 429') ||
                                   errorMsg.includes('状态码 500') ||
                                   errorMsg.includes('状态码 503')
        
        if (!isNonCriticalError) {
          // 只有真正的错误才发送错误事件
          const targetWindow = isFloatingBall ? floatingBallWin : mainWin
          if (targetWindow && !targetWindow.isDestroyed()) {
            targetWindow.webContents.send('agent:error', errorMsg)
          }
        } else {
          console.log('[Script] Non-critical error after successful script execution, skipping error notification')
        }
      }
    })
    
    return { success: true, sessionId: currentSessionId }
  } catch (error) {
    console.error('[Script] Error executing script:', error)
    return { success: false, error: (error as Error).message }
  }
})

// 打开外部链接（在系统默认浏览器中打开，并缩小主窗口至右下角）
ipcMain.handle('app:open-external-url', async (_event, url: string) => {
  try {
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return { success: false, error: 'Invalid URL' }
    }
    await shell.openExternal(url)
    shrinkMainWindowToBottomRight()
    return { success: true }
  } catch (error) {
    console.error('[Main] Error opening external URL:', error)
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('browser:open-devtools', (_event, pageWebContentsId: number, devtoolsWebContentsId: number) => {
  try {
    const pageWc = webContents.fromId(pageWebContentsId)
    const devtoolsWc = webContents.fromId(devtoolsWebContentsId)
    if (pageWc && devtoolsWc) {
      pageWc.setDevToolsWebContents(devtoolsWc)
      pageWc.openDevTools()
      return { success: true }
    }
    return { success: false, error: 'WebContents not found' }
  } catch (err) {
    console.error('[Main] Error opening devtools:', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('browser:close-devtools', (_event, pageWebContentsId: number) => {
  try {
    const pageWc = webContents.fromId(pageWebContentsId)
    if (pageWc?.isDevToolsOpened()) {
      pageWc.closeDevTools()
    }
    return { success: true }
  } catch (err) {
    console.error('[Main] Error closing devtools:', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('agent:authorize-folder', (_, folderPath: string) => {
  const folders = configStore.getAll().authorizedFolders || []
  if (!folders.some(f => f.path === folderPath)) {
    folders.push({ path: folderPath, trustLevel: 'strict' as TrustLevel, addedAt: Date.now() })
    configStore.set('authorizedFolders', folders)
  }
  return true
})

ipcMain.handle('agent:get-authorized-folders', () => {
  return configStore.getAll().authorizedFolders || []
})

// Folder Trust Level Management
ipcMain.handle('folder:trust:set', (_, { folderPath, level }: { folderPath: string, level: 'strict' | 'standard' | 'trust' }) => {
  configStore.setFolderTrustLevel(folderPath, level)
  return { success: true }
})

ipcMain.handle('folder:trust:get', (_, folderPath: string) => {
  return configStore.getFileTrustLevel(folderPath)
})

// Permission Management
ipcMain.handle('permissions:list', () => {
  return configStore.getAllowedPermissions()
})

ipcMain.handle('permissions:revoke', (_, { tool, pathPattern }: { tool: string, pathPattern?: string }) => {
  configStore.removePermission(tool, pathPattern)
  return { success: true }
})

ipcMain.handle('permissions:clear', () => {
  configStore.clearAllPermissions()
  return { success: true }
})

// Get automation scripts root directory path (~/.qa-cowork/scripts/)
ipcMain.handle('agent:get-scripts-dir', () => {
  return directoryManager.getScriptsDir()
})

// 获取协作/会话模式默认工作空间目录路径 (~/.qa-cowork/)
ipcMain.handle('agent:get-cowork-workspace-dir', () => {
  return directoryManager.getCoworkWorkspaceDir()
})

ipcMain.handle('agent:set-working-dir', (_, folderPath: string) => {
  // Set as first (primary) in the list
  const folders = configStore.getAll().authorizedFolders || []
  const existing = folders.find(f => f.path === folderPath)
  const otherFolders = folders.filter(f => f.path !== folderPath)
  const newFolders = existing ? [existing, ...otherFolders] : [{ path: folderPath, trustLevel: 'strict' as TrustLevel, addedAt: Date.now() }, ...otherFolders]
  configStore.set('authorizedFolders', newFolders)
  return true
})

ipcMain.handle('agent:set-language', (_, lang: string) => {
  mainAgent?.setLanguage(lang)
  floatingBallAgent?.setLanguage(lang)
})

ipcMain.handle('config:get-all', () => configStore.getAll())
ipcMain.handle('config:set-all', (_, cfg) => {
  configStore.setAll(cfg)

  // Hot-Swap capability: Update both agents without destroying context
  const agents = [mainAgent, floatingBallAgent].filter((agent): agent is AgentRuntime => agent !== null)
  agents.forEach(agentInstance => {
    agentInstance.updateConfig(
      configStore.getModel(),
      configStore.getApiUrl(),
      configStore.getApiKey(),
      configStore.getMaxTokens()
    );
  });

  // [Fix] Broadcast config update to all windows so UI can refresh immediately
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('config:updated', cfg);
  });

  // If no agents exist, initialize them
  if (!mainAgent && !floatingBallAgent) {
    initializeAgent();
  }
})

ipcMain.handle('config:test-connection', async (_, { apiKey, apiUrl, model }) => {
  try {
    console.log(`[Config] Testing connection to ${apiUrl} with model ${model}`);
    const tempClient = new Anthropic({
      apiKey,
      baseURL: apiUrl || 'https://api.anthropic.com'
    });

    const response = await tempClient.messages.create({
      model: model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hello' }]
    });

    console.log('[Config] Test successful:', response.id);
    return { success: true, message: 'Connection successful!' };
  } catch (error: any) {
    console.error('[Config] Test failed:', error);
    return { success: false, message: error.message || 'Connection failed' };
  }
})

ipcMain.handle('app:info', () => {
  const appVersion = app.getVersion()
  const hotUpdateVersion = directoryManager.getHotUpdateVersion()
  const effectiveVersion = resourceUpdater?.getCurrentVersion() || appVersion
  return {
    name: 'QACowork',
    version: effectiveVersion,
    appVersion: appVersion,
    hotUpdateVersion: hotUpdateVersion,
    author: 'shileima',
    homepage: 'https://github.com/shileima/opencowork'
  };
})

ipcMain.handle('app:get-version', () => {
  return resourceUpdater?.getCurrentVersion() || app.getVersion()
})

// ─── SSO 登录相关 IPC ────────────────────────────────────────────────────────

/** 检查本地是否有有效 SSO 会话 */
ipcMain.handle('sso:check-session', async () => {
  const session = await ssoStore.tryRestoreSession();
  if (session) {
    return { loggedIn: true, userInfo: session.userInfo };
  }
  return { loggedIn: false, userInfo: null };
})

/** 获取扫码登录页 URL（兼容旧调用，实际登录由 sso:start-login 通过 SDK 完成） */
ipcMain.handle('sso:get-login-url', () => {
  return { loginUrl: 'https://ssosv.sankuai.com/sson/login' };
})

/**
 * 启动 SSO 登录流程（@mtfe/sso-web-oidc-cli 方案）：
 * 1. 调用 ssoStore.login() → SDK 自动打开系统浏览器访问 ssosv.sankuai.com
 * 2. 用户扫码后 SSO 回调本地端口（9152/10152）
 * 3. SDK 完成授权码交换，写入标准 AT token（有效期 3 天，含 refresh_token）
 * 4. 获取 userinfo 并通知前端
 */
ipcMain.handle('sso:start-login', async (_event) => {
  try {
    console.log('[SSO] Starting login via @mtfe/sso-web-oidc-cli...');
    await ssoStore.login();
    console.log('[SSO] Token obtained, fetching userinfo...');
    const userInfo = await ssoStore.fetchUserInfo();
    if (userInfo) {
      mainWin?.webContents.send('sso:login-success', { userInfo });
      return { success: true, userInfo };
    }
    return { success: false, error: '登录成功但获取用户信息失败，请重试' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[SSO] Login failed:', msg);
    return { success: false, error: msg || '登录失败，请重试' };
  }
})

/** 获取当前登录用户信息 */
ipcMain.handle('sso:get-user-info', async () => {
  return ssoStore.readUserInfo();
})

/** 登出：清除本地 token 和 userinfo */
ipcMain.handle('sso:logout', () => {
  ssoStore.logout();
  mainWin?.webContents.send('sso:logged-out');
  return { success: true };
})

// ──────────────────────────────────────────────────────────────────────────────
// App Auto-Updater (electron-updater)
// ──────────────────────────────────────────────────────────────────────────────

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

// macOS: Squirrel.Mac requires code signing that CI builds lack.
// We bypass Squirrel by downloading the DMG directly and opening it.
let macPendingDmgUrl: string | null = null
let macDownloadedDmgPath: string | null = null

autoUpdater.on('update-available', (info) => {
  const current = app.getVersion()
  if (compareAppSemver(info.version, current) <= 0) {
    console.log(`[autoUpdater] Ignoring update-available (remote ${info.version} <= local ${current})`)
    return
  }
  const win = mainWin || floatingBallWin
  win?.webContents.send('app:update-available', {
    version: info.version,
    releaseNotes: info.releaseNotes,
    releaseDate: info.releaseDate,
  })
})

autoUpdater.on('update-not-available', () => {
  const win = mainWin || floatingBallWin
  win?.webContents.send('app:update-not-available', { version: app.getVersion() })
})

autoUpdater.on('download-progress', (progress) => {
  const win = mainWin || floatingBallWin
  win?.webContents.send('app:update-download-progress', {
    percent: Math.round(progress.percent),
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond,
  })
})

autoUpdater.on('update-downloaded', (info) => {
  const win = mainWin || floatingBallWin
  win?.webContents.send('app:update-downloaded', { version: info.version })
})

autoUpdater.on('error', (err) => {
  console.error('[autoUpdater] Error:', err)
  const win = mainWin || floatingBallWin
  win?.webContents.send('app:update-error', { message: err.message })
})

ipcMain.handle('app:check-update', async () => {
  try {
    const result = await autoUpdater.checkForUpdates()
    const currentVersion = app.getVersion()
    if (!result) {
      return { success: true, hasUpdate: false, currentVersion }
    }
    const latestVersion = result.updateInfo.version
    const hasUpdate = compareAppSemver(latestVersion, currentVersion) > 0

    // macOS: store DMG URL for direct download (bypasses Squirrel.Mac signing check)
    if (process.platform === 'darwin' && hasUpdate) {
      const dmgFile = result.updateInfo.files?.find((f: any) => f.url.endsWith('.dmg'))
      if (dmgFile) {
        macPendingDmgUrl = `https://github.com/shileima/opencowork/releases/download/v${latestVersion}/${dmgFile.url}`
      }
    }
    return {
      success: true,
      hasUpdate,
      currentVersion,
      latestVersion,
      releaseUrl: `https://github.com/shileima/opencowork/releases/tag/v${latestVersion}`,
    }
  } catch (error: any) {
    console.error('[autoUpdater] Check update failed:', error)
    return { success: false, error: error.message }
  }
})

/** 失败时抛出，以便渲染进程 invoke catch 并结束「下载中」状态 */
ipcMain.handle('app:download-update', async () => {
  if (process.platform === 'darwin' && macPendingDmgUrl) {
    // macOS: download DMG directly to bypass Squirrel.Mac code-signing check
    await downloadMacDmg(macPendingDmgUrl)
    return
  }
  await autoUpdater.downloadUpdate()
})

ipcMain.handle('app:install-update', () => {
  if (process.platform === 'darwin' && macDownloadedDmgPath) {
    // macOS: open the DMG so the user can drag-install (Squirrel not involved)
    shell.openPath(macDownloadedDmgPath)
    return
  }
  autoUpdater.quitAndInstall(false, true)
})

/**
 * Download the DMG file directly, emitting the same progress/downloaded events
 * that electron-updater would emit, so the existing UI works unchanged.
 */
function downloadMacDmg(dmgUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const win = mainWin || floatingBallWin
    const downloadsPath = app.getPath('downloads')
    const filename = dmgUrl.split('/').pop() ?? 'QACowork-update.dmg'
    const destPath = path.join(downloadsPath, filename)
    macDownloadedDmgPath = destPath

    const file = require('fs').createWriteStream(destPath)
    let redirectUrl = dmgUrl

    const doRequest = (url: string) => {
      const protocol = url.startsWith('https') ? require('https') : require('http')
      protocol.get(url, (res: any) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close()
          doRequest(res.headers.location)
          return
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let transferred = 0
        const startTime = Date.now()

        res.on('data', (chunk: Buffer) => {
          transferred += chunk.length
          file.write(chunk)
          const elapsed = (Date.now() - startTime) / 1000 || 1
          win?.webContents.send('app:update-download-progress', {
            percent: total ? Math.round((transferred / total) * 100) : 0,
            transferred,
            total,
            bytesPerSecond: Math.round(transferred / elapsed),
          })
        })

        res.on('end', () => {
          file.end()
          win?.webContents.send('app:update-downloaded', { version: filename })
          resolve()
        })

        res.on('error', (err: Error) => {
          file.destroy()
          reject(err)
        })
      }).on('error', (err: Error) => {
        file.destroy()
        reject(err)
      })
    }

    doRequest(redirectUrl)
  })
}

// 检查资源更新
ipcMain.handle('resource:check-update', async () => {
  try {
    if (!resourceUpdater) {
      return { success: false, error: 'Resource updater not initialized' }
    }
    const result = await resourceUpdater.checkForUpdates()
    return { success: true, ...result }
  } catch (error: any) {
    console.error('Resource update check failed:', error)
    return { success: false, error: error.message }
  }
})

// 执行资源更新
ipcMain.handle('resource:perform-update', async () => {
  try {
    if (!resourceUpdater) {
      return { success: false, error: 'Resource updater not initialized' }
    }
    const success = await resourceUpdater.performUpdate((progress) => {
      mainWin?.webContents.send('resource:update-progress', progress)
      floatingBallWin?.webContents.send('resource:update-progress', progress)
    })
    if (success) {
      const newVersion = resourceUpdater.getCurrentVersion()
      console.log(`[Main] Resource update completed. New version: ${newVersion}`)
      setTimeout(() => {
        console.log('[Main] Auto-restarting after resource update...')
        try {
          app.relaunch()
          app.quit()
        } catch (restartError) {
          console.error('[Main] app.relaunch() failed:', restartError)
          try {
            app.exit(0)
          } catch (exitError) {
            console.error('[Main] app.exit() also failed:', exitError)
          }
        }
      }, 1500)
      return { success: true, willRestart: true, message: `资源更新完成！新版本: v${newVersion}`, version: newVersion }
    }
    return { success: false, error: '更新失败：未知错误' }
  } catch (error: any) {
    console.error('[Main] Resource update failed:', error)
    return { success: false, error: `更新失败: ${error?.message || '未知错误'}` }
  }
})

// 清理热更新目录（回退到内置资源，解决整包更新后仍加载旧前端的问题）
ipcMain.handle('resource:clear-hot-update', async () => {
  try {
    if (!resourceUpdater) {
      return { success: false, error: 'Resource updater not initialized' }
    }
    await resourceUpdater.clearHotUpdate()
    console.log('[Main] Hot update directory cleared by user')
    return { success: true, message: '已清理热更新目录，重启后将使用内置资源版本。' }
  } catch (error: any) {
    console.error('[Main] Clear hot update failed:', error)
    return { success: false, error: error?.message ?? '清理失败' }
  }
})

// 应用更新后重启
ipcMain.handle('resource:restart-app', () => {
  try {
    app.relaunch()
    app.quit()
  } catch (error) {
    console.error('[Main] resource:restart-app failed:', error)
    app.exit(0)
  }
})

// ========== Playwright 管理 ==========

// 不再在启动时通知前端“需要安装”；改为在自动化执行时自动判断并静默安装

// 获取 Playwright 安装状态
ipcMain.handle('playwright:get-status', async () => {
  try {
    if (!playwrightManager) {
      return { success: false, error: 'Playwright manager not initialized' }
    }

    const status = await playwrightManager.getInstallStatus()
    return { success: true, ...status }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Get Playwright status failed:', error)
    return { success: false, error: errorMessage }
  }
})

// 安装 Playwright 和浏览器
ipcMain.handle('playwright:install', async () => {
  try {
    if (!playwrightManager) {
      return { success: false, error: 'Playwright manager not initialized' }
    }

    // 发送进度更新
    const onProgress = (message: string) => {
      mainWin?.webContents.send('playwright:install-progress', message)
    }

    const result = await playwrightManager.installAll(onProgress)
    
    if (result.success) {
      // 通知前端安装完成
      mainWin?.webContents.send('playwright:status', {
        installed: true,
        playwrightInstalled: true,
        browserInstalled: true,
        needsInstall: false
      })
    }

    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Install Playwright failed:', error)
    return { success: false, error: errorMessage }
  }
})

// 卸载 Playwright
ipcMain.handle('playwright:uninstall', async () => {
  try {
    if (!playwrightManager) {
      return { success: false, error: 'Playwright manager not initialized' }
    }

    const result = await playwrightManager.uninstall()
    
    if (result.success) {
      mainWin?.webContents.send('playwright:status', {
        installed: false,
        playwrightInstalled: false,
        browserInstalled: false,
        needsInstall: true
      })
    }

    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Uninstall Playwright failed:', error)
    return { success: false, error: errorMessage }
  }
})

// Shortcut update handler
ipcMain.handle('shortcut:update', (_, newShortcut: string) => {
  try {
    globalShortcut.unregisterAll()
    globalShortcut.register(newShortcut, () => {
      if (floatingBallWin) {
        if (floatingBallWin.isVisible()) {
          if (isBallExpanded) {
            toggleFloatingBallExpanded()
          }
          floatingBallWin.hide()
        } else {
          floatingBallWin.show()
          floatingBallWin.focus()
        }
      }
    })
    configStore.set('shortcut', newShortcut)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
})

ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWin!, {
    properties: ['openDirectory']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('shell:open-path', async (_, filePath: string) => {
  return shell.showItemInFolder(filePath)
})

// Floating Ball specific handlers
ipcMain.handle('floating-ball:toggle', () => {
  toggleFloatingBallExpanded()
})

ipcMain.handle('floating-ball:show-main', () => {
  mainWin?.show()
  mainWin?.focus()
})

ipcMain.handle('floating-ball:start-drag', () => {
  // Enable window dragging
  if (floatingBallWin) {
    floatingBallWin.setMovable(true)
  }
})

ipcMain.handle('floating-ball:move', (_, { deltaX, deltaY }: { deltaX: number, deltaY: number }) => {
  if (floatingBallWin) {
    const [x, y] = floatingBallWin.getPosition()
    floatingBallWin.setPosition(x + deltaX, y + deltaY)
    // Enforce fixed size when expanded to prevent any resizing
    if (isBallExpanded) {
      floatingBallWin.setSize(EXPANDED_WIDTH, EXPANDED_HEIGHT)
    }
  }
})

// Window controls for custom titlebar
ipcMain.handle('floating-ball:set-height', (_, arg: number | { height: number, anchorBottom?: boolean }) => {
  if (!floatingBallWin) return

  const targetHeight = typeof arg === 'number' ? arg : arg.height
  const anchorBottom = typeof arg === 'object' && arg.anchorBottom

  const bounds = floatingBallWin.getBounds()

  if (anchorBottom) {
    const newY = bounds.y + bounds.height - targetHeight
    floatingBallWin.setBounds({
      x: bounds.x,
      y: Math.max(0, newY), // Safety clamp
      width: bounds.width,
      height: targetHeight
    })
  } else {
    floatingBallWin.setSize(bounds.width, targetHeight)
  }
})

ipcMain.handle('window:minimize', () => mainWin?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWin?.isMaximized()) {
    mainWin.unmaximize()
  } else {
    mainWin?.maximize()
  }
})
ipcMain.handle('window:close', () => mainWin?.hide())
ipcMain.handle('window:set-maximized', (_event, maximized: boolean) => {
  if (mainWin) {
    if (maximized) {
      mainWin.maximize()
    } else {
      mainWin.unmaximize()
    }
  }
})

// 右下角小窗：前端主动触发缩小 / 还原
ipcMain.handle('window:shrink-to-bottom-right', () => shrinkMainWindowToBottomRight())
ipcMain.handle('window:restore-from-mini', () => restoreMainWindowFromMini())


// MCP Configuration Handlers

/**
 * 获取内置MCP配置文件路径
 * 优先使用热更新目录，否则使用内置资源
 */
function getBuiltinMcpConfigPath(): string | null {
  const hotUpdateMcpDir = directoryManager.getHotUpdateMcpDir()
  const hotUpdateMcpConfig = path.join(hotUpdateMcpDir, 'builtin-mcp.json')
  if (fs.existsSync(hotUpdateMcpConfig)) {
    console.log('[MCP] Using hot-update MCP config')
    return hotUpdateMcpConfig
  }
  const builtinPath = directoryManager.getBuiltinMcpConfigPath()
  if (fs.existsSync(builtinPath)) {
    return builtinPath
  }

  return null
}

// Ensure built-in MCP config exists
function ensureBuiltinMcpConfig() {
  try {
    const mcpConfigPath = directoryManager.getUserMcpConfigPath();
    
    // If config already exists, do nothing
    if (fs.existsSync(mcpConfigPath)) return;

    console.log('[MCP] Initializing default configuration...');

    // 获取内置MCP配置文件路径（优先热更新）
    const sourcePath = getBuiltinMcpConfigPath();

    if (sourcePath && fs.existsSync(sourcePath)) {
      const configContent = fs.readFileSync(sourcePath, 'utf-8');

      // Ensure directory exists
      const configDir = directoryManager.getMcpDir();
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(mcpConfigPath, configContent, 'utf-8');
      console.log(`[MCP] Created default config at ${mcpConfigPath}`);
    } else {
      console.warn(`[MCP] Could not find builtin-mcp.json`);
    }
  } catch (err) {
    console.error('[MCP] Failed to ensure builtin config:', err);
  }
}

ipcMain.handle('mcp:get-config', async () => {
  try {
    const mcpConfigPath = directoryManager.getUserMcpConfigPath();
    if (!fs.existsSync(mcpConfigPath)) return '{}';
    return fs.readFileSync(mcpConfigPath, 'utf-8');
  } catch (e) {
    console.error('Failed to read MCP config:', e);
    return '{}';
  }
});

ipcMain.handle('mcp:save-config', async (_, content: string) => {
  try {
    const mcpConfigPath = directoryManager.getUserMcpConfigPath();
    const dir = directoryManager.getMcpDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(mcpConfigPath, content, 'utf-8');

    // Update agent services
    if (mainAgent || floatingBallAgent) {
      // We might need to reload MCP client here, but for now just saving is enough.
      // The user might need to restart app or we can add a reload capability later.
      // Note: Both agents will pick up the new config on their next initialization
    }
    return { success: true };
  } catch (e) {
    console.error('Failed to save MCP config:', e);
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('mcp:open-config-folder', async () => {
  const mcpConfigPath = directoryManager.getUserMcpConfigPath();
  if (fs.existsSync(mcpConfigPath)) {
    shell.showItemInFolder(mcpConfigPath);
  } else {
    // If file doesn't exist, try opening the directory
    const dir = path.dirname(mcpConfigPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  }
});

// Skills Management Handlers
// 使用 DirectoryManager 获取技能目录（在需要时获取，避免在模块加载时初始化）
const getSkillsDir = () => directoryManager.getSkillsDir();

/**
 * 获取内置技能目录路径
 * 优先使用热更新目录，否则使用内置资源
 */
const getBuiltinSkillsSourceDir = (): string | null => {
  const hotUpdateSkillsDir = directoryManager.getHotUpdateSkillsDir()
  if (fs.existsSync(hotUpdateSkillsDir)) {
    console.log('[Skills] Using hot-update skills directory')
    return hotUpdateSkillsDir
  }
  if (app.isPackaged) {
    const possiblePaths = [
      path.join(process.resourcesPath, 'resources', 'skills'),
      path.join(process.resourcesPath, 'skills')
    ]
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p
    }
  } else {
    const devPath = path.join(process.cwd(), 'resources', 'skills')
    if (fs.existsSync(devPath)) return devPath
  }
  return null
}

// Helper to get built-in skill names
const getBuiltinSkillNames = () => {
  try {
    const sourceDir = getBuiltinSkillsSourceDir()
    if (sourceDir && fs.existsSync(sourceDir)) {
      return fs.readdirSync(sourceDir).filter(f => fs.statSync(path.join(sourceDir, f)).isDirectory());
    }
  } catch (e) { console.error(e) }
  return [];
};

// ensureBuiltinSkills logic moved to SkillManager (async) to prevent startup blocking
// See SkillManager.initializeDefaults()

ipcMain.handle('skills:list', async () => {
  try {
    const skillsDir = getSkillsDir();
    if (!fs.existsSync(skillsDir)) return [];
    const builtinSkills = getBuiltinSkillNames();
    const files = fs.readdirSync(skillsDir);

    return files.filter(f => {
      try { return fs.statSync(path.join(skillsDir, f)).isDirectory(); } catch { return false; }
    }).map(f => ({
      id: f,
      name: f,
      path: path.join(skillsDir, f),
      isBuiltin: builtinSkills.includes(f)
    }));
  } catch (e) {
    console.error('Failed to list skills:', e);
    return [];
  }
});

ipcMain.handle('skills:get', async (_, skillId: string) => {
  try {
    const skillsDir = getSkillsDir();
    const skillPath = path.join(skillsDir, skillId);
    if (!fs.existsSync(skillPath)) return '';

    // Look for MD file inside
    const files = fs.readdirSync(skillPath);
    const mdFile = files.find(f => f.toLowerCase().endsWith('.md'));

    if (!mdFile) return '';
    return fs.readFileSync(path.join(skillPath, mdFile), 'utf-8');
  } catch (e) {
    console.error('Failed to read skill:', e);
    return '';
  }
});

ipcMain.handle('skills:save', async (_, { filename, content }: { filename: string, content: string }) => {
  try {
    const skillId = filename.replace('.md', ''); // normalized id

    // Check if built-in
    const builtinSkills = getBuiltinSkillNames();
    const isBuiltin = builtinSkills.includes(skillId);

    // 权限检查：内置技能只有管理员可以编辑
    if (isBuiltin && !permissionService.canEditSkill(skillId, true)) {
      return { success: false, error: 'Permission denied: Only administrators can edit built-in skills' };
    }

    // 用户技能所有用户都可以编辑（但删除需要权限检查）
    if (!isBuiltin && !permissionService.canEditSkill(skillId, false)) {
      return { success: false, error: 'Permission denied' };
    }

    const skillsDir = getSkillsDir();
    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
    const skillPath = path.join(skillsDir, skillId);
    if (!fs.existsSync(skillPath)) fs.mkdirSync(skillPath, { recursive: true });

    // Save to README.md or existing md
    let targetFile = 'README.md';
    if (fs.existsSync(skillPath)) {
      const existing = fs.readdirSync(skillPath).find(f => f.toLowerCase().endsWith('.md'));
      if (existing) targetFile = existing;
    }

    fs.writeFileSync(path.join(skillPath, targetFile), content, 'utf-8');

    return { success: true };
  } catch (e) {
    console.error('Failed to save skill:', e);
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('skills:delete', async (_, skillId: string) => {
  try {
    // Check if built-in
    const builtinSkills = getBuiltinSkillNames();
    const isBuiltin = builtinSkills.includes(skillId);

    // 权限检查：只有管理员可以删除技能，且内置技能不能被删除
    if (!permissionService.canDeleteSkill(skillId, isBuiltin)) {
      return { success: false, error: isBuiltin 
        ? 'Cannot delete built-in skills' 
        : 'Permission denied: Only administrators can delete skills' };
    }

    const skillsDir = getSkillsDir();
    const skillPath = path.join(skillsDir, skillId);
    if (fs.existsSync(skillPath)) {
      fs.rmSync(skillPath, { recursive: true, force: true });
      return { success: true };
    }
    return { success: false, error: 'Skill not found' };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('skill:mark-builtin', async (_, skillId: string) => {
  try {
    // 权限检查：只有管理员可以标记技能为内置
    if (!permissionService.canMarkSkillBuiltin(skillId)) {
      return { success: false, error: 'Permission denied: Only administrators can mark skills as built-in' };
    }

    const skillsDir = getSkillsDir();
    const skillPath = path.join(skillsDir, skillId);
    
    if (!fs.existsSync(skillPath)) {
      return { success: false, error: 'Skill not found' };
    }

    // 检查是否已经是内置技能
    const builtinSkills = getBuiltinSkillNames();
    if (builtinSkills.includes(skillId)) {
      return { success: false, error: 'Skill is already built-in' };
    }

    // 获取内置技能目录
    const builtinSkillsDir = directoryManager.getBuiltinSkillsDir();
    if (!fs.existsSync(builtinSkillsDir)) {
      fs.mkdirSync(builtinSkillsDir, { recursive: true });
    }

    // 复制技能目录到内置技能目录
    const targetPath = path.join(builtinSkillsDir, skillId);
    if (fs.existsSync(targetPath)) {
      return { success: false, error: 'Built-in skill with same name already exists' };
    }

    // 复制整个技能目录
    fs.cpSync(skillPath, targetPath, { recursive: true });
    console.log(`[Skills] Copied skill to built-in directory: ${skillId}`);

    // 从用户目录删除技能
    fs.rmSync(skillPath, { recursive: true, force: true });
    console.log(`[Skills] Removed skill from user directory: ${skillId}`);

    return { success: true };
  } catch (e) {
    console.error('Failed to mark skill as built-in:', e);
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('skills:open-folder', () => {
  const skillsDir = getSkillsDir();
  if (fs.existsSync(skillsDir)) {
    shell.openPath(skillsDir);
  } else {
    fs.mkdirSync(skillsDir, { recursive: true });
    shell.openPath(skillsDir);
  }
});

// Directory Management Handlers
ipcMain.handle('directory:get-all-paths', () => {
  return directoryManager.getAllPaths();
});

ipcMain.handle('directory:open-path', (_, dirPath: string) => {
  if (fs.existsSync(dirPath)) {
    shell.openPath(dirPath);
  } else {
    // If directory doesn't exist, try opening parent directory
    const parentDir = path.dirname(dirPath);
    if (fs.existsSync(parentDir)) {
      shell.openPath(parentDir);
    }
  }
});

// Permission Management Handlers
ipcMain.handle('permission:get-role', () => {
  return permissionService.getUserRole();
});

ipcMain.handle('permission:set-role', (_, role: 'user' | 'admin') => {
  // 权限检查：只有当前管理员或预设管理员可以设置角色为管理员
  if (!permissionService.isAdmin() && role === 'admin') {
    // 检查是否为预设管理员
    if (!permissionService.isCurrentUserPresetAdmin()) {
      return { success: false, error: 'Permission denied: Only administrators or preset admins can grant admin role' };
    }
  }
  permissionService.setUserRole(role);
  return { success: true };
});

ipcMain.handle('permission:is-admin', () => {
  return permissionService.isAdmin();
});

ipcMain.handle('permission:get-user-identifier', () => {
  return permissionService.getCurrentUserIdentifier();
});

ipcMain.handle('permission:get-user-account-info', () => {
  return permissionService.getUserAccountInfo();
});

ipcMain.handle('permission:get-preset-admins', () => {
  return permissionService.getPresetAdminUsers();
});

ipcMain.handle('permission:add-preset-admin', (_, username: string) => {
  const success = permissionService.addPresetAdmin(username);
  return { success, error: success ? undefined : 'Failed to add preset admin' };
});

ipcMain.handle('permission:remove-preset-admin', (_, username: string) => {
  const success = permissionService.removePresetAdmin(username);
  return { success, error: success ? undefined : 'Failed to remove preset admin' };
});

// Project Management Handlers
ipcMain.handle('project:create', async (event, { name, path: projectPath }: { name: string, path: string }) => {
  try {
    // 确保目录存在
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }
    const project = projectStore.createProject(name, projectPath);
    // Project 模式：授权目录，主工作目录为 ~/.qa-cowork
    notifyProjectSwitched(event, project);
    const targetWindow = event.sender === floatingBallWin?.webContents ? floatingBallWin : mainWin;
    const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent;
    const isFloatingBall = event.sender === floatingBallWin?.webContents;
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('project:created', project);
      targetWindow.webContents.send('project:switched', project);
    }
    // 新建项目后自动初始化一个任务卡片
    try {
      const taskTitle = '新任务';
      const task = projectStore.createTask(project.id, taskTitle, '');
      if (task) {
        currentTaskIdForSession = task.id;
        if (targetAgent) {
          targetAgent.clearHistory();
          sessionStore.setSessionId(null, isFloatingBall);
        }
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('agent:history-update', []);
          targetWindow.webContents.send('project:task:created', task);
        }
      }
    } catch (taskError) {
      console.error('[Project] Failed to auto-create initial task:', taskError);
    }
    return { success: true, project };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('project:list', () => {
  return projectStore.getProjects();
});

/** 将路径转为绝对路径并规范化（展开 ~），便于与 fs:list-dir 的解析规则一致 */
const toAbsoluteFolderPath = (p: string): string => {
  const expanded = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
  return path.normalize(path.resolve(expanded)).replace(/[/\\]$/, '');
};

// Project 模式：主工作目录优先使用当前已选项目的目录，其次 ~/.qa-cowork
const applyProjectWorkingDirs = (project: { path: string }) => {
  const folders = configStore.getAll().authorizedFolders || [];
  const baseDir = directoryManager.getBaseDir();
  const normalizedBase = toAbsoluteFolderPath(baseDir);
  const normalizedProject = toAbsoluteFolderPath(project.path);
  const ensureFolder = (p: string, trust: TrustLevel = 'standard') => {
    const np = toAbsoluteFolderPath(p);
    const existing = folders.find((f: { path: string }) => toAbsoluteFolderPath(f.path) === np);
    return existing || { path: np, trustLevel: trust, addedAt: Date.now() };
  };
  const baseFolder = ensureFolder(baseDir, 'strict');
  const projectFolder = ensureFolder(project.path, 'standard');
  const otherFolders = folders.filter((f: { path: string }) => {
    const np = toAbsoluteFolderPath(f.path);
    return np !== normalizedBase && np !== normalizedProject;
  });
  // 已选项目路径作为 Primary，确保启动/关闭服务、文件操作等优先作用于当前项目
  const primaryFolders = normalizedBase === normalizedProject
    ? [baseFolder]
    : [projectFolder, baseFolder];
  configStore.setAll({ ...configStore.getAll(), authorizedFolders: [...primaryFolders, ...otherFolders] });
};

const notifyProjectSwitched = (event: Electron.IpcMainInvokeEvent, project: { id: string; name: string; path: string }) => {
  applyProjectWorkingDirs(project);
  const targetWindow = event.sender === floatingBallWin?.webContents ? floatingBallWin : mainWin;
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('project:switched', project);
  }
};

ipcMain.handle('project:open', (event, id: string) => {
  const success = projectStore.openProject(id);
  if (success) {
    const project = projectStore.getProject(id);
    if (project) {
      projectStore.updateProject(id, { updatedAt: Date.now() });
      notifyProjectSwitched(event, project);
    }
  }
  return { success };
});

ipcMain.handle('project:open-folder', async (event, dirPath: string) => {
  if (!dirPath || typeof dirPath !== 'string') return { success: false, error: 'Invalid path' };
  const normalized = path.normalize(dirPath).replace(/\/$/, '');
  try {
    const existing = projectStore.getProjectByPath(normalized);
    if (existing) {
      projectStore.openProject(existing.id);
      projectStore.updateProject(existing.id, { updatedAt: Date.now() });
      const project = projectStore.getProject(existing.id);
      if (project) notifyProjectSwitched(event, project);
      return { success: true };
    }
    if (!fs.existsSync(normalized)) {
      fs.mkdirSync(normalized, { recursive: true });
    }
    const name = path.basename(normalized) || 'Project';
    const project = projectStore.createProject(name, normalized);
    notifyProjectSwitched(event, project);
    const targetWindow = event.sender === floatingBallWin?.webContents ? floatingBallWin : mainWin;
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('project:created', project);
      targetWindow.webContents.send('project:switched', project);
    }
    return { success: true, project };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// 新建项目：在 ~/Library/Application Support/qacowork/projects 下创建目录，从模板拷贝，重名则加后缀 -1、-2…
ipcMain.handle('project:create-new', async (event, name: string) => {
  if (!name || typeof name !== 'string') return { success: false, error: 'Invalid project name' };
  const sanitized = name.trim().replace(/[/\\:*?"<>|]/g, '-').replace(/-+/g, '-') || 'project';

  // 模板路径：
  // - 开发环境：优先使用仓库内模板，避免本地热更新缓存覆盖最新代码
  // - 打包环境：优先热更新目录，再回退到内置
  const hotUpdateTemplatesDir = directoryManager.getHotUpdateTemplatesDir()
  const hotUpdateReactVite = path.join(hotUpdateTemplatesDir, 'react-vite')
  let templateDir: string
  if (!app.isPackaged) {
    templateDir = path.join(app.getAppPath(), 'resources', 'templates', 'react-vite');
  } else if (fs.existsSync(hotUpdateReactVite)) {
    templateDir = hotUpdateReactVite
  } else {
    templateDir = path.join(process.resourcesPath, 'templates', 'react-vite');
  }

  if (!fs.existsSync(templateDir)) {
    console.error(`[Project] Template not found: ${templateDir}`);
    return { success: false, error: 'Project template not found' };
  }

  // 使用固定的项目目录：~/Library/Application Support/qacowork/projects
  const homeDir = os.homedir();
  const projectsDir = path.join(homeDir, 'Library', 'Application Support', 'qacowork', 'projects');

  try {
    if (!fs.existsSync(projectsDir)) {
      fs.mkdirSync(projectsDir, { recursive: true });
    }
    let dirName = sanitized;
    let dirPath = path.join(projectsDir, dirName);
    let n = 1;
    while (fs.existsSync(dirPath)) {
      dirName = `${sanitized}-${n}`;
      dirPath = path.join(projectsDir, dirName);
      n += 1;
    }
    fs.cpSync(templateDir, dirPath, { recursive: true });

    // 替换占位符 {{PROJECT_NAME}}
    const replaceInFile = (filePath: string) => {
      const fullPath = path.join(dirPath, filePath);
      if (fs.existsSync(fullPath)) {
        let content = fs.readFileSync(fullPath, 'utf-8');
        content = content.replace(/\{\{PROJECT_NAME\}\}/g, dirName);
        fs.writeFileSync(fullPath, content);
      }
    };
    replaceInFile('package.json');
    replaceInFile('index.html');
    const project = projectStore.createProject(dirName, dirPath);
    notifyProjectSwitched(event, project);
    const targetWindow = event.sender === floatingBallWin?.webContents ? floatingBallWin : mainWin;
    const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent;
    const isFloatingBall = event.sender === floatingBallWin?.webContents;
    
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('project:created', project);
      targetWindow.webContents.send('project:switched', project);
    }
    
    // 自动创建一个新任务
    try {
      const taskTitle = '新任务';
      const task = projectStore.createTask(project.id, taskTitle, '');
      if (task) {
        // 设置当前任务ID，用于后续 session 绑定
        currentTaskIdForSession = task.id;
        
        // 清空历史并设置 session 为 null（新任务）
        if (targetAgent) {
          targetAgent.clearHistory();
          sessionStore.setSessionId(null, isFloatingBall);
        }
        
        // 通知前端任务已创建和历史已清空
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('agent:history-update', []);
          targetWindow.webContents.send('project:task:created', task);
        }
        
        console.log(`[Project] Auto-created initial task "${taskTitle}" for project "${dirName}"`);
      }
    } catch (taskError) {
      console.error(`[Project] Failed to auto-create initial task:`, taskError);
      // 即使创建任务失败，项目创建仍然成功
    }
    
    console.log(`[Project] Created new project "${dirName}" at ${dirPath}`);
    return { success: true, project };
  } catch (err) {
    console.error(`[Project] Failed to create project:`, err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('project:get-current', () => {
  return projectStore.getCurrentProject();
});

ipcMain.handle('project:quality-check', async (event, projectPath: string) => {
  try {
    return await runProjectQualityCheck(String(projectPath || ''), event.sender);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, summary: msg, log: msg };
  }
});

// Code 模式：切换到代码视图时，确保主工作目录为 ~/.qa-cowork（不发送 project:switched 事件）
ipcMain.handle('project:ensure-working-dir', () => {
  const project = projectStore.getCurrentProject();
  if (project) applyProjectWorkingDirs(project);
});

// 自动化模式：切换到 automation 视图时，将工作目录设置为当前 RPA 项目路径
ipcMain.handle('rpa:ensure-working-dir', () => {
  const currentProject = rpaProjectStore.getCurrentProject();
  const projectPath = currentProject?.path || rpaProjectStore.ensureRpaProjectsDir();
  const folders = configStore.getAll().authorizedFolders || [];
  const normalizedRpa = path.resolve(projectPath);
  const toAbs = (p: string) => path.resolve(p);
  const existing = folders.find((f: { path: string }) => toAbs(f.path) === normalizedRpa);
  const rpaFolder = existing || { path: normalizedRpa, trustLevel: 'strict' as TrustLevel, addedAt: Date.now() };
  const otherFolders = folders.filter((f: { path: string }) => toAbs(f.path) !== normalizedRpa);
  configStore.setAll({ ...configStore.getAll(), authorizedFolders: [rpaFolder, ...otherFolders] });
});

// 协作/会话模式：切换到 cowork 视图时，将默认工作目录设置为 ~/.qa-cowork
ipcMain.handle('cowork:ensure-working-dir', () => {
  const coworkWorkspaceDir = directoryManager.getCoworkWorkspaceDir();
  const folders = configStore.getAll().authorizedFolders || [];
  const normalizedCowork = toAbsoluteFolderPath(coworkWorkspaceDir);
  const existing = folders.find((f: { path: string }) => toAbsoluteFolderPath(f.path) === normalizedCowork);
  const coworkFolder = existing || { path: normalizedCowork, trustLevel: 'strict' as TrustLevel, addedAt: Date.now() };
  const otherFolders = folders.filter((f: { path: string }) => toAbsoluteFolderPath(f.path) !== normalizedCowork);
  // 将 .qa-cowork 设为首位（primary）
  configStore.setAll({ ...configStore.getAll(), authorizedFolders: [coworkFolder, ...otherFolders] });
});

ipcMain.handle('project:delete', async (event, id: string, projectPath?: string) => {
  try {
    // 获取项目信息
    const project = projectStore.getProject(id);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }

    // 使用传入的路径或项目中的路径
    const pathToDelete = projectPath || project.path;

    // 删除项目记录(包含所有关联任务,并自动切换到最近的项目)
    const deleteResult = projectStore.deleteProject(id);
    if (!deleteResult.success) {
      return { success: false, error: 'Failed to delete project record' };
    }

    console.log(`[Project] Deleted project ${id}, tasks automatically deleted with project`);
    if (deleteResult.switchedToProjectId) {
      console.log(`[Project] Switched to most recent project: ${deleteResult.switchedToProjectId}`);
    }

    // 删除本地文件目录
    if (pathToDelete && fs.existsSync(pathToDelete)) {
      try {
        console.log(`[Project] Deleting project directory: ${pathToDelete}`);
        fs.rmSync(pathToDelete, { recursive: true, force: true });
        console.log(`[Project] Successfully deleted project directory: ${pathToDelete}`);
      } catch (error) {
        console.error(`[Project] Failed to delete project directory: ${pathToDelete}`, error);
        // 即使删除文件失败，项目记录已经删除，返回成功但记录警告
        return { 
          success: true,
          switchedToProjectId: deleteResult.switchedToProjectId,
          warning: `项目记录已删除，但删除本地文件时出错：${error instanceof Error ? error.message : String(error)}` 
        };
      }
    } else if (pathToDelete) {
      console.warn(`[Project] Project directory does not exist: ${pathToDelete}`);
    }

    // 通知渲染进程刷新：删除/切换项目后，资源管理器需同步清空或切换
    const win = BrowserWindow.fromWebContents(event.sender as Electron.WebContents);
    if (win && !win.isDestroyed()) {
      win.webContents.send('project:switched');
    }

    return { 
      success: true,
      switchedToProjectId: deleteResult.switchedToProjectId
    };
  } catch (error) {
    console.error('[Project] Error deleting project:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Project Task Handlers
ipcMain.handle('project:task:create', async (event, projectId: string, title: string) => {
  try {
    const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent;
    const isFloatingBall = event.sender === floatingBallWin?.webContents;
    const targetWindow = isFloatingBall ? floatingBallWin : mainWin;
    
    // 创建任务（先创建任务，不关联 session）
    const task = projectStore.createTask(projectId, title, '');
    if (!task) return { success: false, error: 'Project not found' };

    // 设置当前任务ID，用于后续 session 绑定
    currentTaskIdForSession = task.id;

    // 清空历史并设置 session 为 null（新任务）
    if (targetAgent) {
      targetAgent.clearHistory(); // 这会触发 agent:history-update 事件，发送空历史
      sessionStore.setSessionId(null, isFloatingBall);
    }

    // 确保前端收到历史更新通知（显示空状态）
    if (targetWindow && !targetWindow.isDestroyed() && targetAgent) {
      targetWindow.webContents.send('agent:history-update', []);
      targetWindow.webContents.send('project:task:created', task);
    }

    return { success: true, task };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('project:task:list', (_, projectId: string) => {
  return projectStore.getTasks(projectId);
});

// 存储当前任务ID，用于 session 绑定
let currentTaskIdForSession: string | null = null;
let currentRpaTaskIdForSession: string | null = null;
let currentActiveView: 'cowork' | 'project' | 'automation' = 'cowork';

registerContextSwitchHandler((taskId) => {
    currentTaskIdForSession = taskId;
});

registerRpaContextSwitchHandler((taskId) => {
    currentRpaTaskIdForSession = taskId;
});

/** 在项目无任务时清空聊天区域 */
ipcMain.handle('project:clear-chat', async (event) => {
  try {
    const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent;
    const isFloatingBall = event.sender === floatingBallWin?.webContents;
    const targetWindow = isFloatingBall ? floatingBallWin : mainWin;
    if (targetAgent) {
      targetAgent.clearHistory();
      sessionStore.setSessionId(null, isFloatingBall);
      currentTaskIdForSession = null;
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('agent:history-update', []);
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('project:task:switch', async (event, projectId: string, taskId: string) => {
  try {
    const task = projectStore.getTasks(projectId).find(t => t.id === taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }
    const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent;
    const isFloatingBall = event.sender === floatingBallWin?.webContents;
    if (!targetAgent) {
      return { success: false, error: 'Agent not initialized' };
    }

    const previousTaskId = currentTaskIdForSession;
    // 设置当前任务ID，用于后续 session 绑定
    currentTaskIdForSession = taskId;
    
    const targetWindow = isFloatingBall ? floatingBallWin : mainWin;
    
    // 加载关联的 session
    if (task.sessionId) {
      const session = sessionStore.getSession(task.sessionId);
      if (session) {
        sessionStore.setSessionId(task.sessionId, isFloatingBall);
        targetAgent.loadHistory(session.messages);
        // loadHistory 会触发 notifyUpdate，但为了确保前端收到更新，我们再次发送
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('agent:history-update', session.messages);
        }
      } else {
        // Session 不存在（可能未持久化或已被清理），清空历史并打日志便于排查「聊天历史未加载」问题
        console.warn(`[Project] Task "${task.id}" (${task.title}) has sessionId ${task.sessionId} but session not found in store; clearing chat.`);
        targetAgent.clearHistory();
        sessionStore.setSessionId(null, isFloatingBall);
        // clearHistory 会触发 notifyUpdate，但为了确保前端收到更新，我们再次发送
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('agent:history-update', []);
        }
      }
    } else {
      // 任务没有 sessionId：若正在“切换”到当前任务（如 loadCurrentProject 重选同一任务），
      // 且 session:save 尚未把 session 关联到任务，保留当前 agent 历史，避免聊天区域被清空
      if (previousTaskId === taskId) {
        const currentHistory = targetAgent.getHistory();
        if (currentHistory.length > 0 && targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('agent:history-update', currentHistory);
        }
      } else {
        targetAgent.clearHistory();
        sessionStore.setSessionId(null, isFloatingBall);
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('agent:history-update', []);
        }
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('project:task:update', (event, projectId: string, taskId: string, updates: { title?: string, status?: 'active' | 'completed' | 'failed' }) => {
  const success = projectStore.updateTask(projectId, taskId, updates);
  if (success) {
    const targetWindow = event.sender === floatingBallWin?.webContents ? floatingBallWin : mainWin;
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('project:task:updated', { projectId, taskId, updates });
    }
  }
  return { success };
});

ipcMain.handle('project:task:delete', (_, projectId: string, taskId: string) => {
  return { success: projectStore.deleteTask(projectId, taskId) };
});

/** 将当前任务标题改为指定文案（如部署开始时改为「部署」） */
ipcMain.handle('project:rename-current-task', (event, title: string) => {
  const project = projectStore.getCurrentProject();
  if (!project || !currentTaskIdForSession) return { success: false };
  const success = projectStore.updateTask(project.id, currentTaskIdForSession, { title });
  if (success) {
    const targetWindow = event.sender === floatingBallWin?.webContents ? floatingBallWin : mainWin;
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('project:task:updated', { projectId: project.id, taskId: currentTaskIdForSession, updates: { title } });
    }
  }
  return { success };
});

// ═══════════════════════════════════════
// RPA / Automation Handlers
// ═══════════════════════════════════════

ipcMain.handle('rpa:get-current-project', () => {
  return rpaProjectStore.getCurrentProject();
});

/** 匹配自动化脚本命名：xxx_v${number}.js 或 .py，并解析出版本号 */
const RPA_VERSIONED_SCRIPT_RE = /^(.+)_v(\d+)\.(js|py)$/i;
function getVersionFromScriptPath(filePath: string): number | null {
  const name = path.basename(filePath);
  const m = name.match(RPA_VERSIONED_SCRIPT_RE);
  return m ? parseInt(m[2], 10) : null;
}

/** 查找 RPA 项目目录下最近修改的 xxx_vN.js/.py 脚本（用于 agent:done 后兜底加载；仅返回符合命名规范的脚本） */
ipcMain.handle('rpa:find-recent-scripts', async (_, projectPath: string, withinMinutes = 10) => {
  try {
    const dir = path.resolve(projectPath);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
    const cutoff = Date.now() - withinMinutes * 60 * 1000;
    const files: { path: string; version: number; mtime: number }[] = [];
    const walk = (d: string) => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else {
          const version = getVersionFromScriptPath(full);
          if (version != null) {
            const stat = fs.statSync(full);
            if (stat.mtimeMs >= cutoff) files.push({ path: full, version, mtime: stat.mtimeMs });
          }
        }
      }
    };
    walk(dir);
    return files.sort((a, b) => b.version - a.version || b.mtime - a.mtime).map(f => f.path);
  } catch {
    return [];
  }
});

/** 返回项目目录下「最新」的自动化脚本路径：仅考虑 xxx_v${number}.js/.py 格式，按版本号取最大（最新生成的） */
ipcMain.handle('rpa:get-latest-script-in-project', async (_, projectPath: string): Promise<{ path: string } | null> => {
  try {
    const dir = path.resolve(projectPath);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
    const files: { path: string; version: number; mtime: number }[] = [];
    const walk = (d: string) => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else {
          const version = getVersionFromScriptPath(full);
          if (version != null) {
            const stat = fs.statSync(full);
            files.push({ path: full, version, mtime: stat.mtimeMs });
          }
        }
      }
    };
    walk(dir);
    if (files.length === 0) return null;
    const sorted = files.sort((a, b) => b.version - a.version || b.mtime - a.mtime);
    return { path: sorted[0].path };
  } catch {
    return null;
  }
});

ipcMain.handle('rpa:project:list', () => {
  // 确保至少有一个默认项目（首次使用时）
  rpaProjectStore.getCurrentProject();
  return rpaProjectStore.getProjects();
});

ipcMain.handle('rpa:project:open', (event, id: string) => {
  const success = rpaProjectStore.setCurrentProject(id);
  if (success) {
    const project = rpaProjectStore.getProject(id);
    if (project) {
      const targetWindow = event.sender === floatingBallWin?.webContents ? floatingBallWin : mainWin;
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('rpa:project:switched', project);
      }
    }
  }
  return { success };
});

ipcMain.handle('rpa:project:create', async (event, name: string) => {
  if (!name || typeof name !== 'string') return { success: false, error: 'Invalid project name' };
  const project = rpaProjectStore.createProject(name);
  if (!project) return { success: false, error: 'Failed to create project' };
  const targetWindow = event.sender === floatingBallWin?.webContents ? floatingBallWin : mainWin;
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent;
  const isFloatingBall = event.sender === floatingBallWin?.webContents;
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('rpa:project:created', project);
    targetWindow.webContents.send('rpa:project:switched', project);
  }
  // 新建自动化项目后自动初始化一个任务卡片，便于直接在聊天里输入描述生成脚本
  try {
    const taskTitle = '新任务';
    const task = rpaProjectStore.createTask(project.id, taskTitle, '');
    if (task) {
      currentRpaTaskIdForSession = task.id;
      if (targetAgent) {
        targetAgent.clearHistory();
        sessionStore.setSessionId(null, isFloatingBall);
      }
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('agent:history-update', []);
        targetWindow.webContents.send('rpa:task:created', task);
      }
    }
  } catch (taskError) {
    console.error('[RPA] Failed to auto-create initial task:', taskError);
  }
  return { success: true, project };
});

ipcMain.handle('rpa:project:delete', async (event, id: string) => {
  try {
    const project = rpaProjectStore.getProject(id);
    if (!project) return { success: false, error: 'Project not found' };

    const deleteResult = rpaProjectStore.deleteProject(id);
    if (!deleteResult.success) return { success: false, error: 'Failed to delete project' };

    // 删除项目目录（仅当 path 是 rpaProjects 下的子目录时）
    const baseDir = rpaProjectStore.getDefaultRpaPath();
    if (project.path && project.path !== baseDir && project.path.startsWith(baseDir + path.sep)) {
      try {
        if (fs.existsSync(project.path)) {
          fs.rmSync(project.path, { recursive: true, force: true });
        }
      } catch (err) {
        console.error('[RPA] Failed to delete project directory:', project.path, err);
        return {
          success: true,
          switchedToProjectId: deleteResult.switchedToProjectId,
          warning: `项目记录已删除，但删除本地目录时出错：${err instanceof Error ? err.message : String(err)}`
        };
      }
    }

    const targetWindow = event.sender === floatingBallWin?.webContents ? floatingBallWin : mainWin;
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('rpa:project:deleted', id);
      if (deleteResult.switchedToProjectId) {
        const next = rpaProjectStore.getProject(deleteResult.switchedToProjectId);
        if (next) targetWindow.webContents.send('rpa:project:switched', next);
      }
    }

    return { success: true, switchedToProjectId: deleteResult.switchedToProjectId };
  } catch (error) {
    console.error('[RPA] Error deleting project:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('rpa:task:create', async (event, projectId: string, title: string) => {
  try {
    const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent;
    const isFloatingBall = event.sender === floatingBallWin?.webContents;
    const targetWindow = isFloatingBall ? floatingBallWin : mainWin;

    const task = rpaProjectStore.createTask(projectId, title, '');
    if (!task) return { success: false, error: 'Project not found' };

    currentRpaTaskIdForSession = task.id;

    if (targetAgent) {
      targetAgent.clearHistory();
      sessionStore.setSessionId(null, isFloatingBall);
    }
    if (targetWindow && !targetWindow.isDestroyed() && targetAgent) {
      targetWindow.webContents.send('agent:history-update', []);
      targetWindow.webContents.send('rpa:task:created', task);
    }
    return { success: true, task };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('rpa:task:list', (_, projectId: string) => {
  return rpaProjectStore.getTasks(projectId);
});

ipcMain.handle('rpa:task:switch', async (event, projectId: string, taskId: string) => {
  try {
    const tasks = rpaProjectStore.getTasks(projectId);
    const task = tasks.find(t => t.id === taskId);
    if (!task) return { success: false, error: 'Task not found' };

    const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent;
    const isFloatingBall = event.sender === floatingBallWin?.webContents;
    const previousTaskId = currentRpaTaskIdForSession;
    currentRpaTaskIdForSession = taskId;
    const targetWindow = isFloatingBall ? floatingBallWin : mainWin;

    if (task.sessionId) {
      const session = sessionStore.getSession(task.sessionId);
      if (session) {
        sessionStore.setSessionId(task.sessionId, isFloatingBall);
        targetAgent?.loadHistory(session.messages);
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('agent:history-update', session.messages);
        }
      } else {
        targetAgent?.clearHistory();
        sessionStore.setSessionId(null, isFloatingBall);
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('agent:history-update', []);
        }
      }
    } else {
      if (previousTaskId === taskId) {
        const currentHistory = targetAgent?.getHistory() ?? [];
        if (currentHistory.length > 0 && targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('agent:history-update', currentHistory);
        }
      } else {
        targetAgent?.clearHistory();
        sessionStore.setSessionId(null, isFloatingBall);
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('agent:history-update', []);
        }
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('rpa:task:update', (event, projectId: string, taskId: string, updates: { title?: string; status?: 'active' | 'completed' | 'failed'; scriptFileName?: string; scriptVersion?: number }) => {
  const success = rpaProjectStore.updateTask(projectId, taskId, updates);
  if (success) {
    const targetWindow = event.sender === floatingBallWin?.webContents ? floatingBallWin : mainWin;
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('rpa:task:updated', { projectId, taskId, updates });
    }
  }
  return { success };
});

ipcMain.handle('rpa:task:increment-script-version', (_, projectId: string, taskId: string) => {
  rpaProjectStore.incrementScriptVersion(projectId, taskId);
  return { success: true };
});

ipcMain.handle('rpa:task:get-next-script-version', (_, projectId: string, taskId: string) => {
  return rpaProjectStore.getNextScriptVersion(projectId, taskId);
});

ipcMain.handle('rpa:task:delete', (_, projectId: string, taskId: string) => {
  return { success: rpaProjectStore.deleteTask(projectId, taskId) };
});

/** 执行完成后默认等待时长（毫秒），然后关闭 Playwright 浏览器再标记完成 */
const RPA_POST_EXECUTE_WAIT_MS = 10_000;

/**
 * 当 RPA 脚本因缺少文件（如 ENOENT + .json）失败时，在错误信息后追加友好提示。
 */
function enhanceRpaMissingFileError(rawError: string): string {
  const isENOENT = /ENOENT|no such file or directory/i.test(rawError);
  const hasJson = /\.json['"]?\s*\)?$/m.test(rawError) || /\b[\w.-]+\.json\b/.test(rawError);
  if (isENOENT && hasJson) {
    return (
      rawError +
      '\n\n💡 若本脚本依赖前置任务生成的数据文件（如 .json），请先运行对应前置任务生成该文件后再执行本脚本；生成 PDF/文件请使用 generate-file 技能或独立脚本。'
    );
  }
  return rawError;
}

/**
 * 对 .js 脚本注入：执行完成后等待 RPA_POST_EXECUTE_WAIT_MS，再关闭 context/browser，避免浏览器常驻。
 * 若脚本末尾为 })();（async IIFE），则链上 .then(等待).then(关闭).catch(退出)。
 */
function injectRpaAutoClose(scriptContent: string, waitMs: number): string {
  if (scriptContent.includes('RPA_AUTO_CLOSE_AFTER')) return scriptContent;
  // 必须保留 })() 里的调用括号，让 IIFE 执行后返回 Promise，再链 .then；否则 .then 会挂在函数对象上导致 .then is not a function
  const closeSnippet = `})().then(() => { console.log('\\n__RPA_SCRIPT_DONE__\\n'); return new Promise(r => setTimeout(r, ${waitMs})); }).then(async () => { try { if (typeof context !== 'undefined' && context.close) await context.close(); } catch(e){} try { if (typeof browser !== 'undefined' && browser.close) await browser.close(); } catch(e){} }).catch(e => { console.error(e); process.exit(1); });`;
  const replaced = scriptContent.replace(/\}\s*\)\s*\(\s*\)\s*;\s*$/, closeSnippet);
  return replaced !== scriptContent ? replaced : scriptContent;
}

/** 执行 RPA Playwright 脚本：支持 .js 和 .py，优先使用 Node.js 执行（更高效） */
/** 向发起执行的窗口发送运行输出（若提供了 runId） */
function sendRunOutput(sender: Electron.WebContents, runId: string | undefined, event: 'rpa:run:start' | 'rpa:run:output' | 'rpa:run:end', payload: object) {
  if (!runId || sender.isDestroyed()) return;
  sender.send(event, payload);
}

ipcMain.handle('rpa:execute-script', async (event, scriptPath: string, runId?: string) => {
  const sender = event.sender;
  try {
    if (!scriptPath || !fs.existsSync(scriptPath)) {
      return { success: false, error: 'Script file not found' };
    }

    // 只要会打开浏览器或本地应用就缩小到右下角：有头 Playwright（headless:false 或 .launch 且未显式 headless:true）
    try {
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
      const hasHeadedBrowser = /headless\s*:\s*false/.test(scriptContent) ||
        (/\bchromium\.launch\(|playwright.*\.launch\s*\(/.test(scriptContent) && !/headless\s*:\s*true/.test(scriptContent));
      if (hasHeadedBrowser) {
        shrinkMainWindowToBottomRight();
      }
    } catch { /* ignore read error */ }

    sendRunOutput(sender, runId, 'rpa:run:start', { runId, scriptPath });

    const ext = path.extname(scriptPath).toLowerCase();
    const scriptDir = path.dirname(scriptPath);
    const nodePath = getBuiltinNodePath();
    const playwrightEnv = getPlaywrightEnvVars();
    const agentBrowserModules = path.join(os.homedir(), '.qa-cowork', 'skills', 'agent-browser', 'node_modules');
    const localModules = path.join(scriptDir, 'node_modules');
    /** 与 FileSystemTools 一致：内置 resources/playwright + 用户 agent-browser + 项目本地 node_modules */
    const nodePathSegments: string[] = [];
    if (fs.existsSync(localModules)) nodePathSegments.push(localModules);
    const rpaPwSeg = getPlaywrightNodePathSegmentForRpa();
    if (rpaPwSeg) nodePathSegments.push(rpaPwSeg);
    if (playwrightEnv.NODE_PATH) {
      for (const seg of playwrightEnv.NODE_PATH.split(path.delimiter)) {
        if (seg) nodePathSegments.push(seg);
      }
    }
    if (fs.existsSync(agentBrowserModules)) nodePathSegments.push(agentBrowserModules);
    const seenNodePath = new Set<string>();
    const nodePathEnv = nodePathSegments
      .filter((s) => {
        if (!s || seenNodePath.has(s)) return false;
        seenNodePath.add(s);
        return true;
      })
      .join(path.delimiter);

    if (ext === '.js') {
      let content = fs.readFileSync(scriptPath, 'utf-8');
      const injected = injectRpaAutoClose(content, RPA_POST_EXECUTE_WAIT_MS);
      const useTmp = injected !== content;
      const scriptToRun = useTmp
        ? (() => {
            const tmpFile = path.join(scriptDir, `.rpa-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.js`);
            fs.writeFileSync(tmpFile, injected, 'utf-8');
            return tmpFile;
          })()
        : scriptPath;
      const rpaChildEnv: NodeJS.ProcessEnv = { ...process.env, ...playwrightEnv };
      if (nodePathEnv) {
        rpaChildEnv.NODE_PATH = nodePathEnv;
      }
      const child = cpSpawn(nodePath, [path.basename(scriptToRun)], {
        cwd: scriptDir,
        env: rpaChildEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      if (useTmp) {
        const tmpFile = scriptToRun;
        const cleanup = () => { try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {} };
        child.on('close', () => cleanup());
      }
      let stdout = '';
      let stderr = '';
      let runEndSent = false;
      const sendRunEndIfNeeded = (success: boolean, error?: string) => {
        if (runEndSent) return;
        runEndSent = true;
        sendRunOutput(sender, runId, 'rpa:run:end', { runId, success, error, stdout, stderr });
      };
      child.stdout?.on('data', (d) => {
        const s = d.toString();
        stdout += s;
        const dataToShow = s.replace(/__RPA_SCRIPT_DONE__/g, '');
        if (dataToShow.length > 0) {
          sendRunOutput(sender, runId, 'rpa:run:output', { runId, data: dataToShow, stream: 'stdout' });
        }
        if (s.includes('__RPA_SCRIPT_DONE__')) {
          sendRunEndIfNeeded(true);
        }
      });
      child.stderr?.on('data', (d) => {
        const s = d.toString();
        stderr += s;
        sendRunOutput(sender, runId, 'rpa:run:output', { runId, data: s, stream: 'stderr' });
      });
      return new Promise<{ success: boolean; error?: string; stdout?: string; stderr?: string }>((resolve) => {
        child.on('close', (code) => {
          const success = code === 0;
          const error = !success ? enhanceRpaMissingFileError(stderr || stdout || `Exit code ${code}`) : undefined;
          sendRunEndIfNeeded(success, error);
          if (!success) {
            resolve({ success: false, error, stdout, stderr });
          } else {
            resolve({ success: true, stdout, stderr });
          }
        });
      });
    } else if (ext === '.py') {
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      const child = cpSpawn(pythonCmd, [path.basename(scriptPath)], {
        cwd: scriptDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => {
        const s = d.toString();
        stdout += s;
        sendRunOutput(sender, runId, 'rpa:run:output', { runId, data: s, stream: 'stdout' });
      });
      child.stderr?.on('data', (d) => {
        const s = d.toString();
        stderr += s;
        sendRunOutput(sender, runId, 'rpa:run:output', { runId, data: s, stream: 'stderr' });
      });
      return new Promise<{ success: boolean; error?: string; stdout?: string; stderr?: string }>((resolve) => {
        child.on('close', (code) => {
          const success = code === 0;
          const error = !success ? enhanceRpaMissingFileError(stderr || stdout || `Exit code ${code}`) : undefined;
          sendRunOutput(sender, runId, 'rpa:run:end', { runId, success, error, stdout, stderr });
          if (!success) {
            resolve({ success: false, error, stdout, stderr });
          } else {
            resolve({ success: true, stdout, stderr });
          }
        });
      });
    } else {
      return { success: false, error: `Unsupported script type: ${ext}. Use .js or .py` };
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    sendRunOutput(sender, runId, 'rpa:run:end', { runId, success: false, error: errMsg, stdout: '', stderr: '' });
    return { success: false, error: errMsg };
  }
});

ipcMain.handle('rpa:get-projects-path', () => {
  return rpaProjectStore.getDefaultRpaPath();
});

// ═══════════════════════════════════════
// Deploy Handler: generate deploy.sh, execute, stream logs
// ═══════════════════════════════════════

/** 部署结束时更新当前任务状态，并广播 project:task:updated */
function updateDeployTaskStatus(status: 'completed' | 'failed', senderContents: Electron.WebContents) {
  const project = projectStore.getCurrentProject();
  if (!project || !currentTaskIdForSession) return;
  projectStore.updateTask(project.id, currentTaskIdForSession, { status });
  const targetWindow = senderContents === floatingBallWin?.webContents ? floatingBallWin : mainWin;
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('project:task:updated', { projectId: project.id, taskId: currentTaskIdForSession, updates: { status } });
  }
}

ipcMain.handle('deploy:start', async (event, projectPath: string) => {
  try {
    const sender = event.sender;

    // Step 1: Read package.json to get name and version
    const pkgPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      updateDeployTaskStatus('failed', sender);
      sender.send('deploy:error', 'package.json not found in project root');
      return { success: false, error: 'package.json not found' };
    }
    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const projectName = pkgJson.name || 'unknown-project';

    // Step 1.5: Bump patch version (0.0.1 -> 0.0.2)
    const currentVersion = pkgJson.version || '0.0.0';
    const versionParts = currentVersion.split('.').map(Number);
    if (versionParts.length === 3) {
      versionParts[2] += 1; // bump patch
    } else {
      versionParts.push(1);
    }
    const version = versionParts.join('.');
    pkgJson.version = version;
    fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf-8');
    sender.send('deploy:log', `Version bumped: ${currentVersion} -> ${version}\n`);

    // Step 2: Resolve deploy env（部署强制使用内置 Node 20，避免缓存/项目 Node 触发 npm 内部错误）
    const deployEnvResult = await resolveDeployEnv(projectPath, true);
    sender.send('deploy:log', `Using ${deployEnvResult.packageManager}, Node: ${deployEnvResult.nodePath} (built-in)\n`);
    sender.send('deploy:log', `✓ webstatic (via npx @bfe/webstatic)\n\n`);
    sender.send('deploy:log', `── CDN Deploy: ${projectName} v${version} ──\n\n`);

    // Step 2.5: Generate complete vite.config for CDN deployment
    // According to SKILL.md requirements, vite.config must include:
    // - tailwindcss() plugin before federation
    // - base: CDN URL
    // - build.outDir: CDN output directory
    // - build.assetsDir: ''
    // - build.target: 'esnext'
    // - build.minify: false
    // - build.sourcemap: false
    // - build.emptyOutDir: true
    // - rollupOptions with complete configuration
    const cdnBase = `https://aie.sankuai.com/rdc_host/code/${projectName}/vite/${version}/`;
    const cdnOutDir = `dist/code/${projectName}/vite/${version}/`;

    // Find vite config file (support .ts, .mts, .js, .mjs)
    const viteConfigCandidates = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'];
    let viteConfigPath: string | null = null;
    for (const candidate of viteConfigCandidates) {
      const candidatePath = path.join(projectPath, candidate);
      if (fs.existsSync(candidatePath)) {
        viteConfigPath = candidatePath;
        break;
      }
    }

    if (viteConfigPath) {
      const originalContent = fs.readFileSync(viteConfigPath, 'utf-8');

      // Strategy: Smart patching to preserve existing plugins while ensuring SKILL.md requirements
      let viteConfigContent = originalContent;

      // Step 1: Extract existing imports and plugins
      const importLines: string[] = [];
      const otherLines: string[] = [];
      
      originalContent.split('\n').forEach(line => {
        if (line.trim().startsWith('import ')) {
          importLines.push(line);
        } else {
          otherLines.push(line);
        }
      });

      // Step 2: Ensure required imports exist
      const hasDefineConfig = importLines.some(l => l.includes('defineConfig'));
      const hasTailwindImport = importLines.some(l => l.includes('@tailwindcss/vite') || l.includes('tailwindcss'));
      const hasFederationImport = importLines.some(l => l.includes('federation'));

      if (!hasDefineConfig) {
        importLines.unshift("import { defineConfig } from 'vite'");
      }
      if (!hasTailwindImport) {
        sender.send('deploy:log', `⚠️  Warning: @tailwindcss/vite not imported. Add it if using Tailwind CSS.\n`);
      }
      if (!hasFederationImport) {
        sender.send('deploy:log', `⚠️  Warning: Module Federation plugin not imported. Add it if needed.\n`);
      }

      // Step 3: Build the complete config with SKILL.md requirements
      const configContent = otherLines.join('\n');
      
      // Remove existing base, build sections to rebuild them
      const cleanedConfig = configContent
        .replace(/^\s*base\s*:\s*[`'"].*?[`'"],?\s*$/gm, '')
        .replace(/^\s*build\s*:\s*\{[\s\S]*?\n\s*\},?\s*$/gm, '');

      // Find the defineConfig call and inject complete configuration
      const defineConfigMatch = cleanedConfig.match(/(export\s+default\s+defineConfig\s*\(\s*\{)([\s\S]*?)(\}\s*\))/);
      
      if (defineConfigMatch) {
        const beforeConfig = defineConfigMatch[1];
        const existingConfig = defineConfigMatch[2];
        const afterConfig = defineConfigMatch[3];

        // Extract plugins section if exists; for CDN build use only web-safe plugins to avoid
        // "Class extends value undefined is not a constructor or null" when loading electron plugin in Node-only context
        const pluginsMatch = existingConfig.match(/(plugins\s*:\s*\[[\s\S]*?\])/);
        const originalPluginsSection = pluginsMatch ? pluginsMatch[0] : 'plugins: []';
        const hasReact = importLines.some(l => l.includes('@vitejs/plugin-react')) || originalPluginsSection.includes('react()');
        const cdnPluginsSection = hasReact ? 'plugins: [react()],' : 'plugins: [],';

        // Build complete config according to SKILL.md
        const completeConfig = `${beforeConfig}
  // ========================================
  // CDN Deployment Configuration (SKILL.md)
  // ========================================
  base: '${cdnBase}',
  
  ${cdnPluginsSection}

  build: {
    outDir: '${cdnOutDir}',
    target: 'esnext',
    minify: false,
    sourcemap: false,
    emptyOutDir: true,
    assetsDir: '', // All files at same level as index.html
    rollupOptions: {
      output: {
        format: 'esm',
        chunkFileNames: '[name].[hash].js',
        assetFileNames: '[name].[hash].[ext]',
        manualChunks: {
          tailwind: ['tailwindcss'],
        },
      },
      external: [],
    },
  },
${afterConfig}`;

        viteConfigContent = importLines.join('\n') + '\n\n' + completeConfig;
      } else {
        // Fallback: generate minimal config (web-only plugins to avoid electron in Node context)
        const hasReactFallback = importLines.some((l: string) => l.includes('@vitejs/plugin-react'));
        const fallbackPlugins = hasReactFallback ? 'plugins: [react()],' : 'plugins: [],';
        viteConfigContent = `${importLines.join('\n')}

export default defineConfig({
  base: '${cdnBase}',
  ${fallbackPlugins}
  build: {
    outDir: '${cdnOutDir}',
    target: 'esnext',
    minify: false,
    sourcemap: false,
    emptyOutDir: true,
    assetsDir: '',
    rollupOptions: {
      output: {
        format: 'esm',
        chunkFileNames: '[name].[hash].js',
        assetFileNames: '[name].[hash].[ext]',
      },
      external: [],
    },
  },
})
`;
      }

      // Save backup of original config
      const backupPath = viteConfigPath + '.deploy-backup';
      fs.writeFileSync(backupPath, originalContent, 'utf-8');

      // Write patched config
      fs.writeFileSync(viteConfigPath, viteConfigContent, 'utf-8');

      sender.send('deploy:log', `✓ Patched vite.config with complete CDN deployment configuration\n`);
      sender.send('deploy:log', `  base: ${cdnBase}\n`);
      sender.send('deploy:log', `  outDir: ${cdnOutDir}\n`);
      sender.send('deploy:log', `  assetsDir: '' (flat structure)\n`);
      sender.send('deploy:log', `  target: esnext, minify: false, sourcemap: false\n`);
      sender.send('deploy:log', `  rollupOptions: complete ESM configuration\n`);
      sender.send('deploy:log', `  plugins: web-only (electron excluded to avoid "Class extends value undefined")\n`);
      sender.send('deploy:log', `  Backup: ${path.basename(viteConfigPath)}.deploy-backup\n\n`);
    } else {
      updateDeployTaskStatus('failed', sender);
      sender.send('deploy:error', 'No vite.config found, cannot proceed with deployment');
      return { success: false, error: 'No vite.config found' };
    }

    // Step 3: Execute webstatic publish (env from DeployEnvResolver)
    const expectedDeployUrl = `https://${projectName}.autocode.test.sankuai.com/`;
    const expectedBuildPath = path.join(projectPath, 'dist', 'code', projectName, 'vite', version);
    let allOutput = '';

    const restoreViteConfig = () => {
      if (viteConfigPath) {
        const backupPath = viteConfigPath + '.deploy-backup';
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, viteConfigPath);
          fs.unlinkSync(backupPath);
          sender.send('deploy:log', `\nRestored original ${path.basename(viteConfigPath)}\n`);
        }
      }
    };

    // 使用内置 Node 直接执行 tsc + vite build，避免 webstatic 内部调用 npm/pnpm 触发 "Class extends value undefined"
    const nodePath = deployEnvResult.nodePath;
    const deployEnv = deployEnvResult.env;
    const runBuildWithNode = (): Promise<boolean> => {
      return new Promise((resolve) => {
        const tscJs = path.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc.js');
        const tscPath = fs.existsSync(tscJs) ? tscJs : path.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc');
        const vitePath = path.join(projectPath, 'node_modules', 'vite', 'bin', 'vite.js');
        const hasTsc = fs.existsSync(tscPath);
        const hasVite = fs.existsSync(vitePath);

        const runStep = (args: string[], _name: string, onDone: (code: number | null) => void) => {
          const proc = cpSpawn(nodePath, args, { cwd: projectPath, env: deployEnv });
          proc.stdout?.on('data', (d: Buffer) => { allOutput += d.toString(); sender.send('deploy:log', d.toString()); });
          proc.stderr?.on('data', (d: Buffer) => { allOutput += d.toString(); sender.send('deploy:log', d.toString()); });
          proc.on('close', (code) => onDone(code));
        };

        if (hasTsc && hasVite) {
          sender.send('deploy:log', `Running build with built-in Node (tsc + vite build)...\n`);
          runStep([tscPath], 'tsc', (tscCode) => {
            if (tscCode !== 0) {
              resolve(false);
              return;
            }
            runStep([vitePath, 'build'], 'vite build', (viteCode) => resolve(viteCode === 0));
          });
        } else {
          // Fallback: 使用 shell 执行包管理器命令（可能仍会触发 npm 错误）
          const pm = deployEnvResult.packageManager;
          const cmd = pm === 'yarn' ? 'yarn exec tsc && yarn exec vite build' : `${pm} exec tsc && ${pm} exec vite build`;
          sender.send('deploy:log', `Running build (fallback): ${cmd}\n`);
          const shell = process.platform === 'win32' ? 'cmd' : 'sh';
          const shellArg = process.platform === 'win32' ? '/c' : '-c';
          const proc = cpSpawn(shell, [shellArg, cmd], { cwd: projectPath, env: deployEnv });
          proc.stdout?.on('data', (d: Buffer) => { allOutput += d.toString(); sender.send('deploy:log', d.toString()); });
          proc.stderr?.on('data', (d: Buffer) => { allOutput += d.toString(); sender.send('deploy:log', d.toString()); });
          proc.on('close', (code) => resolve(code === 0));
        }
      });
    };

    runBuildWithNode().then((buildOk) => {
      if (!buildOk) {
        restoreViteConfig();
        updateDeployTaskStatus('failed', sender);
        sender.send('deploy:error', `Build failed.\n\n${allOutput.slice(-800)}`);
        return;
      }
      sender.send('deploy:log', `✓ Build completed, uploading via webstatic...\n\n`);

      // 优先使用内置 Node 20 + 内置 pnpm（不依赖 npx，DMG 下也无 PATH 问题）
      const webstaticArgs = [
        '@bfe/webstatic', 'publish',
        '--appkey=com.sankuai.waimaiqafc.aie',
        '--env=prod',
        '--artifact=dist',
        '--build-command=true',
        '--token=269883ad-b7b0-4431-b5e7-5886cd1d590f',
      ];
      const builtinPnpm = getBuiltinPnpmPath();
      let uploadEnv: NodeJS.ProcessEnv;
      let uploadExecPath: string;
      let uploadExecArgs: string[];
      if (builtinPnpm) {
        uploadExecPath = nodePath;
        uploadExecArgs = [builtinPnpm, 'dlx', ...webstaticArgs];
        uploadEnv = deployEnv;
        sender.send('deploy:log', `Using built-in Node + pnpm: ${builtinPnpm}\n`);
      } else {
        const systemNpx = getSystemNpxPath();
        uploadExecPath = systemNpx || 'npx';
        uploadExecArgs = uploadExecPath === 'npx' ? webstaticArgs : webstaticArgs;
        uploadEnv = { ...deployEnv, PATH: process.env.PATH };
        sender.send('deploy:log', systemNpx ? `Using system npx: ${systemNpx}\n` : `Using npx from PATH\n`);
      }

      const child = cpSpawn(uploadExecPath, uploadExecArgs, {
        cwd: projectPath,
        env: uploadEnv,
      });

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        allOutput += text;
        sender.send('deploy:log', text);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        allOutput += text;
        sender.send('deploy:log', text);
      });

      child.on('close', async (code: number | null) => {
        restoreViteConfig();

        if (code !== 0) {
          const errSnippet = allOutput.slice(-500);
          const isNodeInstallDirError = /Could not determine Node\.js install directory/i.test(allOutput);
          const hint = isNodeInstallDirError
            ? '\n\n💡 提示：Node 环境解析失败。请确保项目已执行 pnpm install 安装依赖。'
            : '';
          updateDeployTaskStatus('failed', sender);
          sender.send('deploy:error', `Upload script exited with code ${code}\n\n${errSnippet}${hint}`);
          return;
        }

        // Verify build output
        const indexPath = path.join(expectedBuildPath, 'index.html');
        const altIndexPath = path.join(projectPath, 'dist', 'index.html');
        let buildPath: string | null = null;
        if (fs.existsSync(indexPath)) {
          buildPath = expectedBuildPath;
        } else if (fs.existsSync(altIndexPath)) {
          buildPath = path.join(projectPath, 'dist');
          sender.send('deploy:log', `⚠ 构建产物在 dist/，预期为 dist/code/${projectName}/vite/${version}\n`);
        }
        if (!buildPath || !fs.existsSync(path.join(buildPath, 'index.html'))) {
          updateDeployTaskStatus('failed', sender);
          sender.send('deploy:error', `Build output missing: ${expectedBuildPath}\n请检查 vite.config.ts 中 outDir 配置`);
          return;
        }
        const countFiles = (dir: string): number => {
          let n = 0;
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isFile()) n += 1;
            else if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
          }
          return n;
        };
        const fileCount = countFiles(buildPath);
        sender.send('deploy:log', `✓ Build verified: ${fileCount} files\n`);

        // Register proxy
        const deployBaseUrl = `https://aie.sankuai.com/rdc_host/code/${projectName}/vite/${version}`;
        const proxyUrl = `https://digitalgateway.waimai.test.sankuai.com/testgenius/open/agent/claudeProject/updateProjectProxyTarget?projectId=${projectName}&proxyType=publish&targetUrl=${encodeURIComponent(deployBaseUrl)}`;
        try {
          const proxyRes = await new Promise<number>((resolve) => {
            const req = https.request(proxyUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            }, (res) => resolve(res.statusCode ?? 0));
            req.write('{}');
            req.end();
          });
          if (proxyRes === 200) {
            sender.send('deploy:log', `✓ Proxy registered\n\n✓ Deploy successful!\n  URL: ${expectedDeployUrl}\n`);
          } else {
            updateDeployTaskStatus('failed', sender);
            sender.send('deploy:error', `Proxy registration failed (HTTP ${proxyRes})`);
            return;
          }
        } catch (err) {
          updateDeployTaskStatus('failed', sender);
          sender.send('deploy:error', `Proxy registration failed: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }

        updateDeployTaskStatus('completed', sender);
        sender.send('deploy:done', expectedDeployUrl);
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('agent:open-browser-preview', expectedDeployUrl);
        }
      });

      child.on('error', (err: Error & { code?: string }) => {
        restoreViteConfig();
        const isNpxEnovent = err.code === 'ENOENT' || /spawn npx ENOENT/i.test(err.message);
        const hint = isNpxEnovent
          ? '\n\n💡 未找到 npx（DMG 安装后 GUI 启动时 PATH 可能不含 Node）。请：\n  • 安装 Node.js（https://nodejs.org）或使用 nvm/fnm；或\n  • 从终端执行 open -a QACowork 启动应用后再试部署。'
          : '';
        updateDeployTaskStatus('failed', sender);
        sender.send('deploy:error', `Failed to execute deploy: ${err.message}${hint}`);
      });
    });

    return { success: true };
  } catch (error) {
    updateDeployTaskStatus('failed', event.sender);
    event.sender.send('deploy:error', error instanceof Error ? error.message : String(error));
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// File System Handlers
ipcMain.handle('fs:read-file', async (_, filePath: string) => {
  try {
    // 权限检查
    const folders = configStore.getAll().authorizedFolders || [];
    const isAuthorized = folders.some(f => filePath.startsWith(f.path));
    if (!isAuthorized) {
      return { success: false, error: 'Path not authorized' };
    }
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('fs:write-file', async (_, filePath: string, content: string, options?: { silent?: boolean }) => {
  try {
    // 权限检查
    const folders = configStore.getAll().authorizedFolders || [];
    const isAuthorized = folders.some(f => filePath.startsWith(f.path));
    if (!isAuthorized) {
      return { success: false, error: 'Path not authorized' };
    }
    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    await fs.promises.writeFile(filePath, content, 'utf-8');
    // silent 模式跳过通知（用户手动保存时内容已在内存中，无需触发刷新链路）
    if (!options?.silent) {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('fs:file-changed', filePath);
      }
      if (floatingBallWin && !floatingBallWin.isDestroyed()) {
        floatingBallWin.webContents.send('fs:file-changed', filePath);
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/** 读取图片文件为 data URL，用于执行卡片中展示截图 */
ipcMain.handle('fs:read-image-data-url', async (_, filePath: string) => {
  try {
    const folders = configStore.getAll().authorizedFolders || [];
    const isAuthorized = folders.some((f: { path: string }) => filePath.startsWith(f.path));
    if (!isAuthorized) {
      return { success: false, error: 'Path not authorized' };
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : null;
    if (!mime) {
      return { success: false, error: 'Not an image file' };
    }
    const buf = await fs.promises.readFile(filePath);
    const base64 = buf.toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;
    return { success: true, dataUrl };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('fs:list-dir', async (_, dirPath: string) => {
  try {
    const resolvedPath = toAbsoluteFolderPath(dirPath);
    const folders = configStore.getAll().authorizedFolders || [];
    const isAuthorized = folders.some((f: { path: string }) => {
      const resolvedFolder = toAbsoluteFolderPath(f.path);
      return resolvedPath === resolvedFolder || resolvedPath.startsWith(resolvedFolder + path.sep);
    });
    if (!isAuthorized) {
      return { success: false, error: 'Path not authorized' };
    }
    const items = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
    const result = items.map(item => ({
      name: item.name,
      isDirectory: item.isDirectory(),
      path: path.join(resolvedPath, item.name)
    }));
    return { success: true, items: result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('fs:create-dir', async (_, dirPath: string) => {
  try {
    // 权限检查
    const folders = configStore.getAll().authorizedFolders || [];
    const isAuthorized = folders.some(f => dirPath.startsWith(f.path));
    if (!isAuthorized) {
      return { success: false, error: 'Path not authorized' };
    }
    await fs.promises.mkdir(dirPath, { recursive: true });
    // 通知所有窗口目录已创建，用于刷新资源管理器
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('fs:file-changed', dirPath);
    }
    if (floatingBallWin && !floatingBallWin.isDestroyed()) {
      floatingBallWin.webContents.send('fs:file-changed', dirPath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
  try {
    // 权限检查
    const folders = configStore.getAll().authorizedFolders || [];
    const isAuthorized = folders.some(f => oldPath.startsWith(f.path) && newPath.startsWith(f.path));
    if (!isAuthorized) {
      return { success: false, error: 'Path not authorized' };
    }
    await fs.promises.rename(oldPath, newPath);
    // 通知所有窗口文件已重命名，用于刷新资源管理器
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('fs:file-changed', oldPath);
      mainWin.webContents.send('fs:file-changed', newPath);
    }
    if (floatingBallWin && !floatingBallWin.isDestroyed()) {
      floatingBallWin.webContents.send('fs:file-changed', oldPath);
      floatingBallWin.webContents.send('fs:file-changed', newPath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('fs:delete', async (_, filePath: string) => {
  try {
    // 权限检查
    const folders = configStore.getAll().authorizedFolders || [];
    const isAuthorized = folders.some(f => filePath.startsWith(f.path));
    if (!isAuthorized) {
      return { success: false, error: 'Path not authorized' };
    }
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      await fs.promises.rm(filePath, { recursive: true });
    } else {
      await fs.promises.unlink(filePath);
    }
    // 通知所有窗口文件已删除，用于刷新资源管理器
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('fs:file-changed', filePath);
    }
    if (floatingBallWin && !floatingBallWin.isDestroyed()) {
      floatingBallWin.webContents.send('fs:file-changed', filePath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Terminal Handlers: 支持 node-pty（PTY）或 child_process（pipe）两种后端
type TerminalSession = {
  cwd: string;
  webContents: Electron.WebContents;
  process?: import('child_process').ChildProcess;
  pty?: { write: (data: string) => void; resize: (cols: number, rows: number) => void; kill: (signal?: string) => void };
  windowId?: string;
  processGroupId?: number; // 进程组 ID（用于发送信号到整个进程组）
};
const terminalSessions = new Map<string, TerminalSession>();

// ========== 终端诊断日志 ==========
console.log('[Terminal:Diag] ==================== 终端模块诊断开始 ====================');
console.log('[Terminal:Diag] process.platform:', process.platform);
console.log('[Terminal:Diag] process.arch:', process.arch);
console.log('[Terminal:Diag] process.resourcesPath:', process.resourcesPath);
console.log('[Terminal:Diag] app.isPackaged:', app.isPackaged);
console.log('[Terminal:Diag] app.getAppPath():', app.getAppPath());
console.log('[Terminal:Diag] __dirname:', __dirname);
console.log('[Terminal:Diag] import.meta.url:', import.meta.url);

// 检查 node-pty 是否可加载
try {
  const _require = createRequire(import.meta.url);
  const nodePtyPath = _require.resolve('node-pty');
  console.log('[Terminal:Diag] node-pty 模块路径:', nodePtyPath);
  const ptyMod = _require('node-pty');
  console.log('[Terminal:Diag] node-pty 加载成功, spawn 函数:', typeof ptyMod?.spawn);
  console.log('[Terminal:Diag] node-pty 导出的键:', Object.keys(ptyMod || {}));
} catch (e) {
  const err = e instanceof Error ? e : new Error(String(e));
  console.error('[Terminal:Diag] node-pty 加载失败!', err.message);
  console.error('[Terminal:Diag] node-pty 错误堆栈:', err.stack);

  // 尝试列出可能的 node-pty 位置
  const possiblePaths = [
    path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty'),
    path.join(process.resourcesPath, 'app', 'node_modules', 'node-pty'),
    path.join(__dirname, '..', 'node_modules', 'node-pty'),
    path.join(app.getAppPath(), 'node_modules', 'node-pty'),
  ];
  for (const p of possiblePaths) {
    console.log(`[Terminal:Diag] 检查路径 ${p}: 存在=${fs.existsSync(p)}`);
    if (fs.existsSync(p)) {
      try {
        const files = fs.readdirSync(p);
        console.log(`[Terminal:Diag]   内容: ${files.join(', ')}`);
        // 检查 build/Release 目录
        const buildRelease = path.join(p, 'build', 'Release');
        if (fs.existsSync(buildRelease)) {
          console.log(`[Terminal:Diag]   build/Release: ${fs.readdirSync(buildRelease).join(', ')}`);
        }
        const prebuilds = path.join(p, 'prebuilds');
        if (fs.existsSync(prebuilds)) {
          console.log(`[Terminal:Diag]   prebuilds: ${fs.readdirSync(prebuilds).join(', ')}`);
        }
      } catch (readErr) {
        console.log(`[Terminal:Diag]   读取目录失败: ${readErr}`);
      }
    }
  }
}

// 检查 shell 路径
const diagShellPath = process.env.SHELL || '/bin/zsh';
console.log(`[Terminal:Diag] SHELL 环境变量: ${process.env.SHELL}`);
console.log(`[Terminal:Diag] shell 路径 (${diagShellPath}): 存在=${fs.existsSync(diagShellPath)}`);
console.log('[Terminal:Diag] ==================== 终端模块诊断结束 ====================');

// resolveShellPath / validateShellPath / getShellCandidates 已提取到 ./utils/ShellResolver.ts

// 构建 PTY 环境变量
function buildPtyEnv(minimal: boolean): Record<string, string> {
  // 对于 PTY 模式，使用最简化的环境变量来避免 posix_spawnp 失败
  // 只包含绝对必需的环境变量
  const base: Record<string, string> = {
    TERM: 'xterm-256color',
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME || os.homedir(),
    USER: process.env.USER || process.env.LOGNAME || 'user',
    LANG: process.env.LANG || 'en_US.UTF-8',
    SHELL: resolveShellPath(),
  };
  
  // 只在最小模式下使用基础环境变量
  if (minimal) {
    if (process.env.TMPDIR) base.TMPDIR = process.env.TMPDIR;
    if (process.env.LOGNAME) base.LOGNAME = process.env.LOGNAME;
    return base;
  }
  
  // 完整模式：添加一些安全的环境变量
  // 但仍然过滤掉可能有问题的变量
  const skipPrefixes = [
    'npm_config_',
    'npm_package_',
    'npm_lifecycle_',
    'npm_node_execpath',
    'npm_execpath',
    'npm_command',
    'VSCODE_',
    'CURSOR_',
    '__CF',
    'XPC_',
  ];
  
  if (process.env) {
    for (const [k, v] of Object.entries(process.env)) {
      // 跳过可能有问题的键
      if (skipPrefixes.some(prefix => k.startsWith(prefix))) {
        continue;
      }
      // 只包含字符串值，且值不为空
      if (v !== undefined && typeof v === 'string' && v.length > 0) {
        // 对于 PATH 等关键变量，允许包含非 ASCII 字符
        // 对于其他变量，检查是否包含控制字符
        if (k === 'PATH' || !/[\x00-\x1F\x7F]/.test(v)) {
          base[k] = v;
        }
      }
    }
  }
  
  // 确保关键环境变量存在
  base.TERM = base.TERM || 'xterm-256color';
  if (!base.SHELL) base.SHELL = resolveShellPath();
  if (!base.HOME) base.HOME = os.homedir();
  if (!base.USER) base.USER = process.env.USER || process.env.LOGNAME || 'user';
  
  return base;
}



// 创建 PTY 终端
function createPtyTerminal(
  id: string,
  normalizedCwd: string,
  event: Electron.IpcMainInvokeEvent,
  windowId?: string
): { success: boolean; error?: string; mode?: 'pty' | 'pipe' } {
  console.log(`[Terminal:PTY] createPtyTerminal 开始, id=${id}, cwd=${normalizedCwd}, windowId=${windowId}`);
  console.log(`[Terminal:PTY] 运行环境: platform=${process.platform}, arch=${process.arch}, isPackaged=${app.isPackaged}`);

  if (process.platform === 'win32') {
    console.log('[Terminal:PTY] Windows 平台不支持 PTY 模式');
    return { success: false, error: 'PTY mode is not supported on Windows' };
  }

  const require = createRequire(import.meta.url);
  let ptyModule: any;
  try {
    const resolvedPath = require.resolve('node-pty');
    console.log(`[Terminal:PTY] node-pty 解析路径: ${resolvedPath}`);
    ptyModule = require('node-pty');
    // 验证 node-pty 模块是否可用
    if (!ptyModule || typeof ptyModule.spawn !== 'function') {
      console.error('[Terminal:PTY] node-pty 模块已加载但 spawn 函数不存在', {
        hasModule: !!ptyModule,
        keys: Object.keys(ptyModule || {}),
        spawnType: typeof ptyModule?.spawn,
      });
      return { success: false, error: 'node-pty module is not properly loaded (spawn function not found)' };
    }
    console.log('[Terminal:PTY] node-pty 模块加载成功');
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    const errorStack = e instanceof Error ? e.stack : '';
    console.error('[Terminal:PTY] node-pty 加载失败:', errorMsg);
    console.error('[Terminal:PTY] node-pty 错误堆栈:', errorStack);
    
    // 诊断: 列出 require 路径
    try {
      console.log('[Terminal:PTY] require 搜索路径 (import.meta.url):', import.meta.url);
      const possibleNodeModules = [
        path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty'),
        path.join(process.resourcesPath, 'app', 'node_modules', 'node-pty'),
        path.join(__dirname, '..', 'node_modules', 'node-pty'),
      ];
      for (const p of possibleNodeModules) {
        console.log(`[Terminal:PTY] 检查 ${p}: ${fs.existsSync(p) ? '存在' : '不存在'}`);
      }
    } catch (diagErr) {
      console.error('[Terminal:PTY] 诊断检查失败:', diagErr);
    }
    
    return { success: false, error: `node-pty module not available: ${errorMsg}` };
  }

  const ptyShellArgs: string[] = []; // 不使用 -l，避免 .zprofile 中的 exit 导致 shell 立即退出
  
  // 尝试多种 shell 和环境变量组合
  // 优先使用最小环境变量，因为完整环境变量可能导致 posix_spawnp 失败
  const shellCandidates = getShellCandidates();
  const envCandidates = [true, false]; // 先尝试最小环境变量（更稳定），再尝试完整环境变量
  
  let lastError: Error | null = null;
  const lastErrorDetails: string[] = [];

  for (const shellPath of shellCandidates) {
    const validation = validateShellPath(shellPath);
    if (!validation.valid) {
      lastErrorDetails.push(`Shell validation failed for ${shellPath}: ${validation.error}`);
      continue;
    }

    for (const useFullEnv of envCandidates) {
      try {
        const ptyEnv = buildPtyEnv(!useFullEnv);
        
        // 验证工作目录是否存在且可访问
        if (!fs.existsSync(normalizedCwd)) {
          throw new Error(`Working directory does not exist: ${normalizedCwd}`);
        }
        
        const stats = fs.statSync(normalizedCwd);
        if (!stats.isDirectory()) {
          throw new Error(`Path is not a directory: ${normalizedCwd}`);
        }
        
        // 尝试创建 PTY
        // 使用最简化的选项来避免 posix_spawnp 失败
        const ptyOptions: any = {
          cwd: normalizedCwd,
          env: ptyEnv,
          cols: 80,
          rows: 24,
          name: 'xterm-256color',
          // 不设置 encoding，让 node-pty 使用默认值
        };
        
        // 尝试使用 spawn，如果失败则尝试 fork
        let ptyProcess: any;
        try {
          ptyProcess = ptyModule.spawn(shellPath, ptyShellArgs, ptyOptions);
        } catch (spawnError) {
          // 如果 spawn 失败，尝试使用 fork（某些情况下更稳定）
          if (typeof ptyModule.fork === 'function') {
            console.log(`[Terminal] spawn failed, trying fork for ${shellPath}`);
            try {
              ptyProcess = ptyModule.fork(shellPath, ptyShellArgs, ptyOptions);
            } catch (forkError) {
              throw spawnError; // 抛出原始 spawn 错误
            }
          } else {
            throw spawnError;
          }
        }

        // 验证 PTY 进程是否成功创建
        if (!ptyProcess) {
          throw new Error('PTY process is null');
        }

        ptyProcess.on('data', (data?: string) => {
          event.sender.send('terminal:output', id, data ?? '');
        });

        ptyProcess.on('exit', () => {
          if (terminalSessions.has(id)) {
            event.sender.send('terminal:exit', id);
            terminalSessions.delete(id);
          }
        });

        terminalSessions.set(id, {
          cwd: normalizedCwd,
          webContents: event.sender,
          pty: ptyProcess,
          windowId
        });

        console.log(`[Terminal] PTY mode succeeded with shell: ${shellPath}, env: ${useFullEnv ? 'full' : 'minimal'}`);
        return { success: true, mode: 'pty' };
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        lastError = error;
        const errorMsg = error.message || String(e);
        lastErrorDetails.push(`Shell: ${shellPath}, Env: ${useFullEnv ? 'full' : 'minimal'}, Error: ${errorMsg}`);
        
        // 如果是 posix_spawnp 错误，提供更详细的诊断
        if (errorMsg.includes('posix_spawnp')) {
          lastErrorDetails.push(`  - Shell path: ${shellPath}`);
          lastErrorDetails.push(`  - Shell exists: ${fs.existsSync(shellPath)}`);
          lastErrorDetails.push(`  - CWD: ${normalizedCwd}`);
          lastErrorDetails.push(`  - CWD exists: ${fs.existsSync(normalizedCwd)}`);
          lastErrorDetails.push(`  - CWD is directory: ${fs.existsSync(normalizedCwd) && fs.statSync(normalizedCwd).isDirectory()}`);
          const envKeys = Object.keys(buildPtyEnv(!useFullEnv));
          lastErrorDetails.push(`  - Env keys count: ${envKeys.length}`);
          lastErrorDetails.push(`  - Env keys: ${envKeys.slice(0, 20).join(', ')}${envKeys.length > 20 ? '...' : ''}`);
        }
      }
    }
  }

  // 所有尝试都失败了
  const errorMessage = lastError?.message || 'Unknown error';
  const diagnosticInfo = lastErrorDetails.join('\n');
  console.error(`[Terminal] PTY mode failed after trying all combinations:\n${diagnosticInfo}`);
  
  return {
    success: false,
    error: `PTY mode failed: ${errorMessage}. Tried shells: ${shellCandidates.join(', ')}. See console for details.`,
    mode: undefined
  };
}

// 创建 Pipe 终端（使用 script 命令创建伪终端）
async function createPipeTerminal(
  id: string,
  normalizedCwd: string,
  event: Electron.IpcMainInvokeEvent,
  windowId?: string
): Promise<{ success: boolean; error?: string; mode?: 'pty' | 'pipe' }> {
  const { spawn } = await import('child_process');
  
  // 确定 shell 命令（统一使用 ShellResolver 的候选回退逻辑）
  let shellCommand: string;
  if (process.platform === 'win32') {
    shellCommand = process.env.COMSPEC || 'cmd.exe';
  } else {
    shellCommand = resolveShellForCommand() || resolveShellPath();
  }
  
  // 设置环境变量
  const terminalEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    ...(process.platform !== 'win32' ? { 
      FORCE_COLOR: '1',
      PS1: '$ ',
      PS2: '> ',
    } : {})
  };
  
  let processGroupId: number | undefined;
  let terminalProcess: import('child_process').ChildProcess;
  
  if (process.platform !== 'win32') {
    // 直接使用 bash -i，但确保 stdin 保持打开
    // 通过设置环境变量和确保 stdin 不关闭来让 shell 保持运行
    console.log(`[Terminal] Using direct spawn with interactive shell: ${shellCommand}`);
    
    terminalProcess = spawn(shellCommand, ['-i'], {
      cwd: normalizedCwd,
      env: {
        ...terminalEnv,
        // 确保 shell 认为是交互式的
        PS1: '$ ',
        PS2: '> ',
        // 防止 shell 因为非 TTY 而退出
        INTERACTIVE: '1',
        // 清空可能干扰的环境变量
        BASH_ENV: '',
        ENV: '',
        // 确保有正确的 TERM
        TERM: 'xterm-256color',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });
    
    if (terminalProcess.pid) {
      processGroupId = terminalProcess.pid;
    }
    
    // 确保 stdin 不会因为父进程关闭而关闭
    if (terminalProcess.stdin) {
      // 保持 stdin 打开
      terminalProcess.stdin.setDefaultEncoding('utf8');
      // 监听 stdin 错误但不关闭
      terminalProcess.stdin.on('error', (err) => {
        console.warn(`[Terminal] stdin error (non-fatal): ${err.message}`);
      });
    }
  } else {
    // Windows: 直接 spawn
    terminalProcess = spawn(shellCommand, [], {
      cwd: normalizedCwd,
      env: terminalEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });
  }
  
  console.log(`[Terminal] Spawning shell (pipe mode with script): ${shellCommand} in ${normalizedCwd}`);
  
  const safeDeleteSession = (onlyIfOurs: boolean) => {
    const cur = terminalSessions.get(id);
    if (!onlyIfOurs || cur?.process === terminalProcess) {
      terminalSessions.delete(id);
    }
  };

  terminalProcess.on('error', (error: Error) => {
    console.error(`[Terminal] Process error for ${id}:`, error);
    if (terminalSessions.get(id)?.process === terminalProcess) {
      event.sender.send('terminal:exit', id);
      terminalSessions.delete(id);
    }
  });

  const exitHandler = (_code: number | null, _signal: string | null) => {
    if (terminalSessions.get(id)?.process === terminalProcess) {
      event.sender.send('terminal:exit', id);
      terminalSessions.delete(id);
    }
  };
  terminalProcess.on('exit', exitHandler);
  
  const webContents = event.sender;
  terminalSessions.set(id, { 
    process: terminalProcess, 
    cwd: normalizedCwd, 
    webContents, 
    windowId,
    processGroupId
  } as TerminalSession);
  setupTerminalListeners(id, terminalProcess, webContents);
  
  if (!terminalProcess.stdin || terminalProcess.stdin.destroyed) {
    console.error(`[Terminal] stdin is not available for ${id}`);
    safeDeleteSession(true);
    return {
      success: false,
      error: 'Terminal stdin is not available. This may indicate a shell spawn issue.'
    };
  }
  terminalProcess.stdin.setDefaultEncoding('utf8');

  // 等待进程稳定
  return new Promise<{ success: boolean; error?: string; mode?: 'pty' | 'pipe' }>((resolve) => {
    // 增加等待时间，让 script 和 shell 有时间初始化
    setTimeout(() => {
      if (terminalProcess.killed || terminalProcess.exitCode !== null) {
        const exitCode = terminalProcess.exitCode;
        console.error(`[Terminal] Process ${id} exited immediately with code=${exitCode}`);
        safeDeleteSession(true);
        resolve({
          success: false,
          error: `Terminal process exited immediately (code: ${exitCode}). This may indicate a shell configuration issue.`
        });
      } else {
        console.log(`[Terminal] Terminal ${id} started successfully (PID: ${terminalProcess.pid})`);
        resolve({ success: true, mode: 'pipe' });
      }
    }, 800); // 增加等待时间到 800ms
  });
}

function setupTerminalListeners(id: string, process: import('child_process').ChildProcess, webContents: Electron.WebContents) {
  // 监听 stdout
  if (process.stdout) {
    process.stdout.on('data', (data: Buffer) => {
      webContents.send('terminal:output', id, data.toString());
    });
    
    // 监听 stdout 关闭
    process.stdout.on('close', () => {
      console.log(`[Terminal] stdout closed for ${id}`);
    });
    
    // 监听 stdout 错误
    process.stdout.on('error', (error: Error) => {
      console.error(`[Terminal] stdout error for ${id}:`, error);
    });
  }
  
  // 监听 stderr
  if (process.stderr) {
    process.stderr.on('data', (data: Buffer) => {
      webContents.send('terminal:output', id, data.toString());
    });
    
    // 监听 stderr 关闭
    process.stderr.on('close', () => {
      console.log(`[Terminal] stderr closed for ${id}`);
    });
    
    // 监听 stderr 错误
    process.stderr.on('error', (error: Error) => {
      console.error(`[Terminal] stderr error for ${id}:`, error);
    });
  }
  
  // 监听 stdin 错误
  if (process.stdin) {
    process.stdin.on('error', (error: Error) => {
      console.error(`[Terminal] stdin error for ${id}:`, error);
    });
    
    // 监听 stdin 关闭
    process.stdin.on('close', () => {
      console.log(`[Terminal] stdin closed for ${id}`);
    });
  }
  
  // 注意：exit 事件已经在 terminal:create 中处理，这里不再重复处理
  // 避免重复删除会话和发送事件
}

ipcMain.handle('terminal:create', async (event, { id, cwd, windowId }: { id: string, cwd: string, windowId?: string }) => {
  console.log(`[Terminal:Create] ===== terminal:create 开始 =====`);
  console.log(`[Terminal:Create] id=${id}, cwd=${cwd}, windowId=${windowId}`);
  console.log(`[Terminal:Create] isPackaged=${app.isPackaged}, resourcesPath=${process.resourcesPath}`);
  try {
    // 验证 cwd 是否存在且为目录
    if (!cwd || cwd.trim() === '') {
      console.error('[Terminal:Create] cwd 为空');
      return { success: false, error: 'Working directory is required' };
    }
    
    const normalizedCwd = path.resolve(cwd.trim());
    console.log(`[Terminal:Create] normalizedCwd=${normalizedCwd}`);
    
    // 检查目录是否存在
    if (!fs.existsSync(normalizedCwd)) {
      console.error(`[Terminal:Create] 目录不存在: ${normalizedCwd}`);
      return { success: false, error: `Directory does not exist: ${normalizedCwd}` };
    }
    
    const stats = fs.statSync(normalizedCwd);
    if (!stats.isDirectory()) {
      console.error(`[Terminal:Create] 路径不是目录: ${normalizedCwd}`);
      return { success: false, error: `Path is not a directory: ${normalizedCwd}` };
    }
    
    // 权限检查
    const folders = configStore.getAll().authorizedFolders || [];
    const isAuthorized = folders.some(f => normalizedCwd.startsWith(path.resolve(f.path)));
    if (!isAuthorized) {
      // 如果路径未授权，尝试自动授权项目目录
      const projectPath = normalizedCwd;
      if (!folders.some(f => f.path === projectPath)) {
        folders.push({ path: projectPath, trustLevel: 'strict' as TrustLevel, addedAt: Date.now() });
        configStore.set('authorizedFolders', folders);
        console.log(`[Terminal] Auto-authorized project directory: ${projectPath}`);
      }
    }
    
    // 若已存在同 id 的会话，直接返回成功，避免重复创建导致历史丢失
    const existing = terminalSessions.get(id);
    if (existing) {
      console.log(`[Terminal] Session ${id} already exists, skipping creation`);
      // 更新 webContents（可能切换了窗口）
      existing.webContents = event.sender;
      return { success: true, mode: existing.pty ? 'pty' : 'pipe' };
    }
    
    // 获取配置的终端模式
    const terminalMode = configStore.get('terminalMode') || 'auto';
    
    // 根据配置选择模式
    if (terminalMode === 'pipe' || process.platform === 'win32') {
      // 强制使用 Pipe 模式（Windows 必须使用 Pipe）
      console.log(`[Terminal] Using pipe mode (configured: ${terminalMode === 'pipe' ? 'pipe' : 'Windows'})`);
      return await createPipeTerminal(id, normalizedCwd, event, windowId);
    } else if (terminalMode === 'pty') {
      // 强制使用 PTY 模式
      console.log('[Terminal] Using PTY mode (configured: pty)');
      const result = createPtyTerminal(id, normalizedCwd, event, windowId);
      if (!result.success) {
        return { success: false, error: `PTY mode failed: ${result.error}` };
      }
      return result;
    } else {
      // auto 模式：优先 PTY，失败则回退 Pipe
      console.log('[Terminal:Create] auto 模式：优先尝试 PTY...');
      const ptyResult = createPtyTerminal(id, normalizedCwd, event, windowId);
      if (ptyResult.success) {
        console.log('[Terminal:Create] PTY 模式创建成功');
        return ptyResult;
      }
      console.warn(`[Terminal:Create] PTY 模式失败: ${ptyResult.error}, 回退到 Pipe 模式...`);
      const pipeResult = await createPipeTerminal(id, normalizedCwd, event, windowId);
      console.log(`[Terminal:Create] Pipe 模式结果: success=${pipeResult.success}, error=${pipeResult.error || 'none'}`);
      return pipeResult;
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : '';
    console.error('[Terminal:Create] terminal:create 异常:', errMsg);
    console.error('[Terminal:Create] 错误堆栈:', errStack);
    return { success: false, error: errMsg };
  }
});

ipcMain.handle('terminal:write', (_, id: string, data: string) => {
  const session = terminalSessions.get(id);
  if (!session) {
    return { success: false, error: 'Terminal session not found' };
  }
  if (session.pty) {
    try {
      session.pty.write(data);
      return { success: true };
    } catch (error) {
      console.error(`[Terminal] Error writing to PTY for ${id}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const proc = session.process;
  if (!proc || proc.killed || proc.exitCode !== null) {
    return { success: false, error: 'Terminal process has exited' };
  }
  if (!proc.stdin || proc.stdin.destroyed) {
    return { success: false, error: 'Terminal stdin is not available' };
  }
  try {
    proc.stdin.write(data);
    return { success: true };
  } catch (error) {
    console.error(`[Terminal] Error writing to stdin for ${id}:`, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('terminal:signal', async (_, id: string, signal: string) => {
  const session = terminalSessions.get(id);
  if (!session) {
    return { success: false, error: 'Terminal session not found' };
  }
  if (session.pty) {
    try {
      // node-pty 不支持直接发送信号，需要 kill
      if (signal === 'SIGINT') {
        session.pty.kill('SIGINT');
      } else {
        session.pty.kill(signal as NodeJS.Signals);
      }
      return { success: true };
    } catch (error) {
      console.error(`[Terminal] Error sending signal to PTY for ${id}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const proc = session.process;
  if (!proc || proc.killed || proc.exitCode !== null) {
    return { success: false, error: 'Terminal process has exited' };
  }
  try {
    if (signal === 'SIGINT') {
      // 在 pipe 模式下，最好的方法是发送 Ctrl+C 字符到 stdin
      // 这样 shell 会正确处理并转发信号给前台进程组
      // 这是最可靠的方法，因为 shell 知道如何将信号传递给子进程
      if (proc.stdin && !proc.stdin.destroyed) {
        try {
          // 先发送 Ctrl+C 字符到 stdin，让 shell 处理
          proc.stdin.write('\x03');
        } catch (e) {
          console.warn(`[Terminal] Failed to write Ctrl+C to stdin for ${id}:`, e);
        }
      }
      
      // 在非 Windows 系统上，尝试发送信号到进程组
      if (process.platform !== 'win32' && proc.pid) {
        // 优先使用保存的进程组 ID（如果使用了 setsid）
        if (session.processGroupId) {
          try {
            // 发送信号到进程组（负数 PID 表示进程组）
            process.kill(-session.processGroupId, 'SIGINT');
            console.log(`[Terminal] Sent SIGINT to process group ${session.processGroupId} for ${id}`);
          } catch (e) {
            console.warn(`[Terminal] Failed to send SIGINT to process group ${session.processGroupId}:`, e);
          }
        }
        
        // 也尝试发送到进程本身的进程组
        try {
          process.kill(-proc.pid, 'SIGINT');
          console.log(`[Terminal] Sent SIGINT to process group ${-proc.pid} for ${id}`);
        } catch (e) {
          // 如果进程组发送失败，发送到进程本身
          try {
            proc.kill('SIGINT');
            console.log(`[Terminal] Sent SIGINT to process ${proc.pid} for ${id}`);
          } catch (e2) {
            console.warn(`[Terminal] Failed to send SIGINT to process ${proc.pid}:`, e2);
          }
        }
      } else {
        // Windows 系统：直接发送信号到进程
        proc.kill('SIGINT');
      }
    } else {
      proc.kill(signal as NodeJS.Signals);
    }
    return { success: true };
  } catch (error) {
    console.error(`[Terminal] Error sending signal to process for ${id}:`, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('terminal:resize', (_, id: string, cols: number, rows: number) => {
  const session = terminalSessions.get(id);
  if (!session) {
    return { success: false, error: 'Terminal session not found' };
  }
  if (session.pty) {
    try {
      session.pty.resize(cols, rows);
    } catch (e) {
      // ignore
    }
    return { success: true };
  }
  return { success: true };
});

ipcMain.handle('terminal:open-window', async (_, { cwd, instanceId }: { cwd?: string; instanceId?: string }) => {
  const windowId = `terminal-window-${Date.now()}`;
  const win = createTerminalWindow(cwd || process.cwd(), windowId, instanceId);
  terminalWindows.set(windowId, win);
  return { success: true, windowId };
});

ipcMain.handle('terminal:close-window', (_, windowId: string) => {
  const win = terminalWindows.get(windowId);
  if (win && !win.isDestroyed()) {
    win.close();
  }
  return { success: true };
});

ipcMain.handle('terminal:destroy', (_, id: string) => {
  const session = terminalSessions.get(id);
  if (session) {
    if (session.pty) {
      try {
        session.pty.kill();
      } catch (e) {
        // ignore
      }
    } else if (session.process) {
      session.process.kill();
    }
    terminalSessions.delete(id);
  }
  return { success: true };
});

/** 发送初始化进度到渲染进程 */
function sendInitProgress(stage: string, progress: number, detail?: string) {
  mainWin?.webContents.send('app:init-progress', { stage, progress, detail })
}

/**
 * 延迟初始化：窗口渲染后先尽快展示 UI（含资源管理器），再在后台初始化 Agent
 * 避免因 Agent 初始化耗时（Skills、MCP 等）导致用户长时间卡在启动页
 */
async function deferredInitialization() {
  console.log('[Main] Starting deferred initialization...')
  const startTime = Date.now()

  try {
    // Stage 1: 配置加载 (极快，已完成)
    sendInitProgress('加载配置', 10)
    await new Promise(resolve => setTimeout(resolve, 50))

    // Stage 2: 提前设置项目工作目录，使资源管理器在 UI 展示后即可加载文件列表（fs:list-dir 依赖 authorizedFolders）
    const currentProject = projectStore.getCurrentProject()
    if (currentProject) {
      applyProjectWorkingDirs(currentProject)
      console.log('[Main] Project working dir applied for:', currentProject.name)
    }

    // 无论当前处于何种模式，确保 cowork workspace 目录始终在授权列表中
    // 避免安装新版本后首次启动时，因前端 IPC 时序问题导致协作模式工作目录未生效
    const coworkWorkspaceDir = directoryManager.getCoworkWorkspaceDir()
    const currentFolders = configStore.getAll().authorizedFolders || []
    const normalizedCowork = toAbsoluteFolderPath(coworkWorkspaceDir)
    const coworkAlreadyExists = currentFolders.some(
      (f: { path: string }) => toAbsoluteFolderPath(f.path) === normalizedCowork
    )
    if (!coworkAlreadyExists) {
      configStore.setAll({
        ...configStore.getAll(),
        authorizedFolders: [
          ...currentFolders,
          { path: coworkWorkspaceDir, trustLevel: 'strict' as TrustLevel, addedAt: Date.now() }
        ]
      })
      console.log('[Main] Cowork workspace dir added to authorized folders:', coworkWorkspaceDir)
    }

    // Stage 3: 立即通知前端初始化完成，并附带当前项目，使首帧即可渲染资源管理器
    sendInitProgress('启动完成', 100)
    mainWin?.webContents.send('app:init-complete', currentProject ?? null)
    const toFirstPaint = Date.now() - startTime
    console.log(`[Main] App UI ready in ${toFirstPaint}ms (agent will init in background)`)

    // Stage 4: 后台初始化 Agent（不阻塞 UI）
    initializeAgentAsync()
      .then((result) => {
        const total = Date.now() - startTime
        if (result?.skipped) {
          console.warn(`[Main] Agent initialization skipped: ${result.reason}`)
          mainWin?.webContents.send('agent:init-failed', { reason: result.reason })
        } else {
          console.log(`[Main] Agent initialization completed in ${total}ms`)
          mainWin?.webContents.send('agent:ready')
          // 首次打开时渲染端可能尚未注册 agent:ready 监听，主进程主动加载最近会话并下发历史，确保聊天区能显示
          if (currentActiveView === 'cowork') {
            autoLoadLatestSession()
          }
        }
      })
      .catch((err) => {
        console.error('[Main] Agent initialization failed:', err)
        mainWin?.webContents.send('agent:init-failed', { reason: err?.message || 'Unknown error' })
      })
  } catch (error) {
    console.error('[Main] Deferred initialization failed:', error)
    mainWin?.webContents.send('app:init-complete')
  }
}

/** 自动加载最近一次会话 */
function autoLoadLatestSession() {
  try {
    if (!mainAgent) {
      console.log('[Main] Agent not ready, skip auto-load session')
      return
    }

    const coworkWorkspaceDir = directoryManager.getCoworkWorkspaceDir()
    // 使用 SessionStore 的过滤逻辑，与历史任务面板「历史任务」列表一致
    const coworkSessions = sessionStore.getSessions('cowork', coworkWorkspaceDir)
    const sortedSessions = [...coworkSessions].sort((a, b) => b.updatedAt - a.updatedAt)
    const latestSession = sortedSessions[0]

    if (latestSession) {
      console.log(`[Main] Auto-loading latest session: ${latestSession.id} (${latestSession.title})`)
      sessionStore.setSessionId(latestSession.id, false)
      const fullSession = sessionStore.getSession(latestSession.id)
      if (fullSession && fullSession.messages.length > 0) {
        mainAgent.loadHistory(fullSession.messages)
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('agent:history-update', fullSession.messages)
        }
        mainWin?.webContents.send('session:auto-loaded', latestSession.id)
        console.log(`[Main] Successfully auto-loaded session: ${latestSession.title}`)
        return
      }
    }

    // 无 cowork 会话，或最近会话为空：初始化干净的新会话状态
    console.log('[Main] No cowork sessions found or latest is empty, initializing new session')
    sessionStore.setSessionId(null, false)
    mainAgent.clearHistory()
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('agent:history-update', [])
    }
  } catch (error) {
    console.error('[Main] Error auto-loading latest session:', error)
  }
}

/** 异步初始化 Agent，发送中间进度 */
async function initializeAgentAsync() {
  // #region agent log - API key source (H3,H4)
  const fromConfig = configStore.getApiKey();
  const fromEnv = process.env.ANTHROPIC_API_KEY || '';
  const apiKey = fromConfig || fromEnv;
  try {
    const payload = {
      location: 'main.ts:initializeAgentAsync',
      message: 'API key source',
      data: {
        hasConfigKey: !!fromConfig,
        configKeyLen: fromConfig ? fromConfig.length : 0,
        hasEnvKey: !!fromEnv,
        envKeyLen: fromEnv ? fromEnv.length : 0,
        hasApiKey: !!apiKey,
        activeProviderId: configStore.get('activeProviderId')
      },
      timestamp: Date.now(),
      hypothesisId: 'H3,H4'
    };
    fs.appendFileSync(path.join(app.getPath('userData'), 'debug-launch.log'), JSON.stringify(payload) + '\n');
    fetch('http://127.0.0.1:7242/ingest/c9da8242-409a-4cac-8926-c6d816aecb2e', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  } catch (_e) {}
  // #endregion

  const model = configStore.getModel()
  const apiUrl = configStore.getApiUrl()

  if (apiKey && mainWin) {
    // Dispose previous agents if they exist
    if (mainAgent) {
      console.log('Disposing previous main agent instance...');
      mainAgent.dispose();
    }

    // Create agent instance (fast, no IO)
    const maxTokens = configStore.getMaxTokens();
    mainAgent = new AgentRuntime(apiKey, mainWin, model, apiUrl, maxTokens);
    mainAgent.onShrinkWindow = () => shrinkMainWindowToBottomRight();
    mainAgent.onMaximizeBrowserWindow = () => maximizeChromeForTesting();

    // Initialize Skills + MCP in parallel (the slow part)
    sendInitProgress('加载 Skills', 30)
    await mainAgent.initialize()
    sendInitProgress('AI 引擎就绪', 70)
    console.log('Main agent initialized with model:', model);

    // Set global references for backward compatibility
    (global as Record<string, unknown>).agent = mainAgent;
    (global as Record<string, unknown>).mainAgent = mainAgent;

    console.log('API URL:', apiUrl)
    
    // 主 agent 就绪后，立即初始化浮窗 agent（如果窗口已创建）
    if (floatingBallWin && !floatingBallAgent) {
      initializeFloatingBallAgent()
    }
    return { skipped: false }
  } else {
    console.warn('[Main] No API Key found. Agent initialization skipped. Please configure API Key in Settings.')
    return { skipped: true, reason: 'no_api_key' }
  }
}

/** 同步版本 - 仅供 IPC 重新初始化时使用 */
function initializeAgent() {
  initializeAgentAsync().catch(err => {
    console.error('Agent initialization failed:', err)
  })
}

/** 初始化浮窗 agent - 主 agent 就绪后调用，避免重复加载 skills */
function initializeFloatingBallAgent() {
  if (floatingBallAgent || !mainAgent) {
    // 如果已创建或主 agent 未就绪，直接返回（不再循环等待）
    return
  }
  
  const apiKey = configStore.getApiKey() || process.env.ANTHROPIC_API_KEY
  if (!apiKey || !floatingBallWin) return

  console.log('[Main] Creating floating ball agent (main agent is ready)...')
  floatingBallAgent = new AgentRuntime(apiKey, floatingBallWin, configStore.getModel(), configStore.getApiUrl(), configStore.getMaxTokens());
  floatingBallAgent.onShrinkWindow = () => shrinkMainWindowToBottomRight();
  floatingBallAgent.onMaximizeBrowserWindow = () => maximizeChromeForTesting();

  // Skills 和 MCP 已被主 agent 加载过，这里的 initialize 会命中 SkillManager 的 cooldown 缓存
  floatingBallAgent.initialize().then(() => {
    console.log('Floating ball agent created independently');
  }).catch(err => {
    console.error('Floating ball agent initialization failed:', err);
  });

  (global as Record<string, unknown>).floatingBallAgent = floatingBallAgent
}

function createTray() {
  try {
    console.log('Creating system tray...')

    // Use file path instead of base64 buffer to avoid "Failed to create tray icon from buffer" error
    const iconPath = getIconPath();
    console.log('Using tray icon path:', iconPath);
    tray = new Tray(iconPath);
    console.log('✅ System tray created successfully');

    tray.setToolTip('OpenCowork')

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          mainWin?.show()
          mainWin?.focus()
        }
      },
      {
        label: '显示悬浮球',
        click: () => {
          floatingBallWin?.isVisible() ? floatingBallWin?.hide() : floatingBallWin?.show()
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.isQuitting = true
          app.quit()
        }
      }
    ])

    tray.setContextMenu(contextMenu)

    tray.on('click', () => {
      if (mainWin) {
        if (mainWin.isVisible()) {
          mainWin.hide()
        } else {
          mainWin.show()
          mainWin.focus()
        }
      }
    })

    console.log('✅ Tray menu and click handlers configured')

  } catch (e) {
    console.error('❌ Failed to create system tray:', e)
  }
}

function createMainWindow() {
  const iconPath = getIconPath()
  console.log('Main window icon path:', iconPath)
  console.log('Icon exists:', fs.existsSync(iconPath))

  // Load icon as nativeImage for better Windows taskbar support
  let iconImage = undefined
  try {
    iconImage = nativeImage.createFromPath(iconPath)
    if (iconImage.isEmpty()) {
      console.warn('Icon image is empty, falling back to default')
      iconImage = undefined
    }
  } catch (e) {
    console.error('Failed to load icon:', e)
  }

  // Mac-specific configuration
  const isMac = process.platform === 'darwin'

  // 默认窗口宽度设置为 1090
  const DEFAULT_WINDOW_WIDTH = 560;
  const DEFAULT_WINDOW_HEIGHT = 720;

  // ========== 浏览器预览诊断日志 ==========
  const preloadPath = path.join(__dirname, 'preload.mjs');
  console.log('[Browser:Diag] ==================== 浏览器预览诊断 ====================');
  console.log('[Browser:Diag] preload 路径:', preloadPath);
  console.log('[Browser:Diag] preload 存在:', fs.existsSync(preloadPath));
  console.log('[Browser:Diag] __dirname:', __dirname);
  console.log('[Browser:Diag] VITE_DEV_SERVER_URL:', VITE_DEV_SERVER_URL);
  console.log('[Browser:Diag] RENDERER_DIST:', RENDERER_DIST);
  console.log('[Browser:Diag] RENDERER_DIST 存在:', fs.existsSync(RENDERER_DIST));
  console.log('[Browser:Diag] app.isPackaged:', app.isPackaged);
  console.log('[Browser:Diag] process.resourcesPath:', process.resourcesPath);
  
  // 检查 dist 目录内容
  if (fs.existsSync(RENDERER_DIST)) {
    try {
      const distFiles = fs.readdirSync(RENDERER_DIST);
      console.log('[Browser:Diag] RENDERER_DIST 内容:', distFiles.join(', '));
      // 检查 index.html 是否存在
      const indexPath = path.join(RENDERER_DIST, 'index.html');
      console.log('[Browser:Diag] index.html 存在:', fs.existsSync(indexPath));
    } catch (e) {
      console.error('[Browser:Diag] 读取 RENDERER_DIST 失败:', e);
    }
  }
  console.log('[Browser:Diag] ==================== 浏览器预览诊断结束 ====================');

  mainWin = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: 450,
    minHeight: 600,
    icon: iconImage || iconPath,
    frame: false, // Custom frame for consistent look
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden', // Mac: inset buttons, others: hidden
    backgroundColor: '#18181b', // 与 index.html 极简 loading 一致，无白屏/黑屏闪变
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      webviewTag: true,
    },
    show: false,
  })

  // Platform-specific menu configuration
  if (isMac) {
    // Mac: Create native application menu
    const template: any[] = [
      {
        label: app.getName(),
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'File',
        submenu: [
          { role: 'close' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Terminal',
        submenu: [
          {
            label: 'New Terminal Window',
            accelerator: 'CmdOrCtrl+Shift+T',
            click: () => {
              const cwd = mainWin ? (mainWin.webContents as any).cwd || process.cwd() : process.cwd();
              createTerminalWindow(cwd, `terminal-window-${Date.now()}`);
            }
          }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' }
        ]
      }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)

    // Mac-specific: Ensure app doesn't dock when all windows are closed
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      } else {
        mainWin?.show()
        mainWin?.focus()
      }
    })

    console.log('[Mac] Application menu configured')
  } else {
    // Windows/Linux: No menu bar
    mainWin.setMenu(null)
    console.log('[Windows/Linux] Menu bar removed')
  }

  mainWin.once('ready-to-show', () => {
    console.log('Main window ready (staying hidden until did-finish-load).')
    // 不在首帧显示，等 did-finish-load 后再显示，避免白屏；期间仅 dock/任务栏跳动
  })

  // Handle external links：localhost 和部署域名用内置浏览器打开，其他用系统浏览器
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    // localhost / 127.0.0.1 - 使用内置浏览器，不缩小窗口
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1') ||
        url.startsWith('https://localhost') || url.startsWith('https://127.0.0.1')) {
      mainWin?.webContents.send('agent:open-browser-preview', url)
      return { action: 'deny' }
    }
    // 部署相关域名 - 使用内置浏览器，不缩小窗口
    if (url.includes('.autocode.test.sankuai.com') || url.includes('aie.sankuai.com/rdc_host')) {
      mainWin?.webContents.send('agent:open-browser-preview', url)
      return { action: 'deny' }
    }
    // 美团内网 - 使用内置浏览器打开，避免用系统默认浏览器导致「扫码用户登录」报错
    if (url.includes('.sankuai.com') || url.includes('.meituan.com')) {
      mainWin?.webContents.send('agent:open-browser-preview', url)
      return { action: 'deny' }
    }
    // 其他外部链接 - 使用系统默认浏览器，缩小窗口至右下角
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
      shrinkMainWindowToBottomRight()
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  mainWin.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWin?.hide()
    }
  })

  // 监听主窗口加载状态，排查客户端打包后页面无法加载的问题（仅主 frame，iframe 失败不误报）
  mainWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      // 内置预览 iframe 加载失败（如 ERR_CONNECTION_REFUSED），通知渲染进程立即显示错误，无需等待超时
      console.warn('[Browser:Diag] 内置预览 iframe 加载失败:', { errorCode, errorDescription, validatedURL });
      if (errorCode === -102) {
        mainWin?.webContents.send('agent:iframe-load-failed', validatedURL);
      }
      return;
    }
    console.error('[Browser:Diag] 主窗口加载失败!', { errorCode, errorDescription, validatedURL });
  });
  mainWin.webContents.on('did-start-loading', () => {
    console.log('[Browser:Diag] 主窗口开始加载...');
  });
  mainWin.webContents.on('did-stop-loading', () => {
    console.log('[Browser:Diag] 主窗口停止加载');
  });
  mainWin.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Browser:Diag] 渲染进程已退出!', details);
  });
  mainWin.webContents.on('unresponsive', () => {
    console.error('[Browser:Diag] 渲染进程无响应!');
  });

  mainWin.webContents.on('did-finish-load', () => {
    console.log('[Browser:Diag] 主窗口加载完成 (did-finish-load)');
    // loading 页已就绪，此时再显示窗口，用户看到即为 loading 效果，无白屏
    if (!mainWin?.isVisible()) {
      mainWin?.show();
      mainWin?.focus();
    }
    mainWin?.webContents.send('main-process-message', (new Date).toLocaleString())
    
    // === 延迟初始化：窗口已显示后再执行重操作，避免白屏 ===
    deferredInitialization()
  })

  if (VITE_DEV_SERVER_URL) {
    console.log('[Browser:Diag] 开发模式: 加载 URL:', VITE_DEV_SERVER_URL);
    mainWin.loadURL(VITE_DEV_SERVER_URL)
  } else {
    const distPath = getRendererDistPath()
    const indexPath = path.join(distPath, 'index.html');
    const rendererToken = getRendererLoadVersionToken();
    console.log('[Browser:Diag] 生产模式: 加载文件:', indexPath);
    console.log('[Browser:Diag] distPath:', distPath);
    console.log('[Browser:Diag] index.html 存在:', fs.existsSync(indexPath));
    console.log('[Browser:Diag] renderer cache token:', rendererToken);
    if (!fs.existsSync(indexPath)) {
      console.error('[Browser:Diag] ❌ index.html 不存在! 这是页面无法加载的原因!');
      // 列出 distPath 下的文件
      if (fs.existsSync(distPath)) {
        console.log('[Browser:Diag] distPath 内容:', fs.readdirSync(distPath).join(', '));
      } else {
        console.error('[Browser:Diag] distPath 也不存在:', distPath);
        // 列出 resourcesPath 下的文件
        console.log('[Browser:Diag] resourcesPath 内容:', fs.readdirSync(process.resourcesPath).join(', '));
      }
    }
    mainWin.loadFile(indexPath, {
      query: { v: rendererToken }
    })
  }
}

function createFloatingBallWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  floatingBallWin = new BrowserWindow({
    width: BALL_SIZE,
    height: BALL_SIZE,
    x: screenWidth - BALL_SIZE - 20,
    y: screenHeight - BALL_SIZE - 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    icon: getIconPath(),
  })

  if (VITE_DEV_SERVER_URL) {
    floatingBallWin.loadURL(`${VITE_DEV_SERVER_URL}#/floating-ball`)
  } else {
    const distPath = getRendererDistPath()
    floatingBallWin.loadFile(path.join(distPath, 'index.html'), {
      hash: 'floating-ball',
      query: { v: getRendererLoadVersionToken() }
    })
  }

  floatingBallWin.on('closed', () => {
    // Clean up floating ball agent when window is closed
    if (floatingBallAgent) {
      floatingBallAgent.dispose();
      floatingBallAgent = null;
    }
    floatingBallWin = null
  })

  // Create independent agent for floating ball after window is created
  // Note: Initialization is deferred until main agent is ready to avoid duplicate skill loading
  floatingBallWin.webContents.on('did-finish-load', () => {
    // 只有在主 agent 已就绪时才创建浮窗 agent
    // 否则等待主 agent 初始化完成后主动调用
    if (mainAgent) {
      initializeFloatingBallAgent()
    }
  })
}

function toggleFloatingBallExpanded() {
  if (!floatingBallWin) return

  // Get current bounds BEFORE any state changes
  const bounds = floatingBallWin.getBounds()
  const currentX = bounds.x
  const currentY = bounds.y
  const currentWidth = bounds.width

  // Use workArea to respect taskbars/docks
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  if (isBallExpanded) {
    // Collapse to ball size
    // Ball should be at the right edge of the expanded window
    const newWidth = BALL_SIZE
    const newX = currentX + currentWidth - newWidth
    const newY = currentY

    // Clamp to screen bounds
    const clampedX = Math.max(0, Math.min(newX, screenWidth - BALL_SIZE))
    const clampedY = Math.max(0, Math.min(newY, screenHeight - BALL_SIZE))

    // Use setBounds to set position and size atomically (prevents flicker)
    floatingBallWin.setBounds({
      x: Math.round(clampedX),
      y: Math.round(clampedY),
      width: BALL_SIZE,
      height: BALL_SIZE
    })
    isBallExpanded = false
  } else {
    // Expand to conversation view
    // Window expands to the LEFT, keeping Y position the same
    const newWidth = EXPANDED_WIDTH
    const newX = currentX + currentWidth - newWidth
    const newY = currentY

    // Clamp to screen bounds
    const clampedX = Math.max(0, newX)
    const clampedY = Math.max(0, newY)

    // Use setBounds to set position and size atomically (prevents flicker)
    floatingBallWin.setBounds({
      x: Math.round(clampedX),
      y: Math.round(clampedY),
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT
    })
    isBallExpanded = true
  }

  // Notify renderer of state change AFTER window bounds are updated
  floatingBallWin.webContents.send('floating-ball:state-changed', isBallExpanded)
}

// Ensure the ball stays on top
setInterval(() => {
  if (floatingBallWin && !floatingBallWin.isDestroyed()) {
    floatingBallWin.setAlwaysOnTop(true, 'screen-saver')
  }
}, 2000)

function createTerminalWindow(cwd: string, windowId: string, instanceId?: string): BrowserWindow {
  const iconPath = getIconPath()
  let iconImage = undefined
  try {
    iconImage = nativeImage.createFromPath(iconPath)
    if (iconImage.isEmpty()) {
      iconImage = undefined
    }
  } catch (e) {
    console.error('Failed to load icon:', e)
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    icon: iconImage || iconPath,
    frame: true,
    title: `Terminal - ${path.basename(cwd)}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Center window on screen
  const x = Math.floor((screenWidth - 800) / 2)
  const y = Math.floor((screenHeight - 600) / 2)
  win.setPosition(x, y)

  const instanceIdParam = instanceId ? `&instanceId=${encodeURIComponent(instanceId)}` : '';
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}#/terminal-window?cwd=${encodeURIComponent(cwd)}&windowId=${encodeURIComponent(windowId)}${instanceIdParam}`)
  } else {
    const distPath = getRendererDistPath()
    win.loadFile(path.join(distPath, 'index.html'), {
      hash: `terminal-window?cwd=${encodeURIComponent(cwd)}&windowId=${encodeURIComponent(windowId)}${instanceIdParam}`,
      query: { v: getRendererLoadVersionToken() }
    })
  }

  win.on('closed', () => {
    // Clean up all terminal sessions created in this window
    terminalSessions.forEach((session, id) => {
      if (session.windowId === windowId) {
        if (session.pty) {
          try {
            session.pty.kill()
          } catch (_) {
            /* ignore */
          }
        } else if (session.process) {
          session.process.kill()
        }
        terminalSessions.delete(id)
      }
    })
    terminalWindows.delete(windowId)
  })

  return win
}
