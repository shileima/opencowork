import { app, BrowserWindow, shell, ipcMain, screen, dialog, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawn as cpSpawn } from 'node:child_process'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'
import { AgentRuntime } from './agent/AgentRuntime'
import { configStore, TrustLevel } from './config/ConfigStore'
import { sessionStore } from './config/SessionStore'
import { scriptStore } from './config/ScriptStore'
import { projectStore } from './config/ProjectStore'
import { directoryManager } from './config/DirectoryManager'
import { permissionService } from './config/PermissionService'
import { getBuiltinNodePath } from './utils/NodePath'
import { ResourceUpdater } from './updater/ResourceUpdater'
import { PlaywrightManager } from './utils/PlaywrightManager'
import { registerContextSwitchHandler } from './contextSwitchCoordinator'
import Anthropic from '@anthropic-ai/sdk'

// Extend App type to include isQuitting property
declare global {
  namespace Electron {
    interface App {
      isQuitting?: boolean
    }
  }
}

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

/**
 * 获取前端资源目录路径
 * 生产环境下优先使用热更新目录，否则使用内置资源
 */
function getRendererDistPath(): string {
  if (VITE_DEV_SERVER_URL) {
    // 开发模式直接返回默认路径
    return RENDERER_DIST
  }

  // 生产模式：检查热更新目录
  const hotUpdateDistDir = directoryManager.getHotUpdateDistDir()
  const hotUpdateIndexPath = path.join(hotUpdateDistDir, 'index.html')
  
  if (fs.existsSync(hotUpdateIndexPath)) {
    console.log('[Main] Using hot-update dist directory')
    return hotUpdateDistDir
  }

  // 回退到内置资源
  console.log('[Main] Using built-in dist directory')
  return RENDERER_DIST
}

// Helper to get icon path for both dev and prod
function getIconPath(): string {
  // Try PNG first as it's always available
  const pngName = 'icon.png'

  if (app.isPackaged) {
    // In production, icon is in extraResources
    const pngPath = path.join(process.resourcesPath, pngName)
    if (fs.existsSync(pngPath)) return pngPath
    // Fallback to app directory
    return path.join(process.resourcesPath, 'app.asar.unpacked', pngName)
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
  const hotUpdateVersion = resourceUpdater ? directoryManager.getHotUpdateVersion() : null
  const effectiveVersion = resourceUpdater?.getCurrentVersion() || appVersion
  console.log(`[Main] App started - appVersion: ${appVersion}, hotUpdateVersion: ${hotUpdateVersion}, effectiveVersion: ${effectiveVersion}`)

  // 1. Setup IPC handlers FIRST
  // 1. Setup IPC handlers FIRST
  // setupIPCHandlers() - handlers are defined at top level now

  // 2. Create windows
  createMainWindow()
  createFloatingBallWindow()

  // 3. Ensure built-in MCP config exists (synchronous, fast)
  ensureBuiltinMcpConfig()

  // 4. Sync official scripts to user directory (non-blocking)
  scriptStore.syncOfficialScripts()

  // 4.5. Initialize permission service and check preset admin
  // 这会自动检查当前用户是否为预设管理员，如果是则自动设置为管理员
  permissionService.getUserRole()

  // 5. Built-in skills are now loaded async by SkillManager (inside initializeAgent)
  // ensureBuiltinSkills() - Removed

  // 6. Initialize agent AFTER windows are created
  initializeAgent()

  // 6.5 Clean up empty sessions on startup
  sessionStore.cleanupEmptySessions()

  // 7. Initialize resource updater and start auto-check
  resourceUpdater = new ResourceUpdater()
  
  // 开发环境也启用自动更新检查 (用于测试)
  const notifyUpdateFound = (updateInfo: any) => {
    console.log('[Main] Resource update found, notifying renderer...')
    // 通知所有窗口有新版本
    mainWin?.webContents.send('resource:update-available', updateInfo)
    floatingBallWin?.webContents.send('resource:update-available', updateInfo)
  }
  
  if (app.isPackaged) {
    resourceUpdater.startAutoUpdateCheck(1 / 60, notifyUpdateFound) // 每1分钟检查一次 (测试用)
  } else {
    // 开发环境: 每1分钟检查一次
    resourceUpdater.startAutoUpdateCheck(1 / 60, notifyUpdateFound)
  }

  // 7.5 Initialize Playwright manager and check status
  playwrightManager = new PlaywrightManager()
  checkPlaywrightStatus()

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

ipcMain.handle('agent:send-message', async (event, message: string | { content: string, images: string[] }) => {
  // Determine which agent to use based on sender window
  const isFloatingBall = event.sender === floatingBallWin?.webContents
  const targetAgent = isFloatingBall ? floatingBallAgent : mainAgent
  if (!targetAgent) throw new Error('Agent not initialized')
  // 项目视图下传入当前任务 ID 与项目 ID，以便 agent:done 时能可靠更新任务状态
  const currentProject = isFloatingBall ? null : projectStore.getCurrentProject()
  const taskId = isFloatingBall ? undefined : (currentProject && currentTaskIdForSession ? currentTaskIdForSession : undefined)
  const projectId = currentProject?.id
  return await targetAgent.processUserMessage(message, taskId, projectId, isFloatingBall)
})

ipcMain.handle('agent:abort', (event) => {
  // Determine which agent to abort based on sender window
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  targetAgent?.abort()
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

// Session Management
ipcMain.handle('session:list', () => {
  return sessionStore.getSessions()
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

  console.log(`[Session] Saving session for ${isFloatingBall ? 'floating ball' : 'main window'}: ${messages.length} messages`)

  try {
    // Use the smart save method that only saves if there's meaningful content
    const sessionId = sessionStore.saveSession(currentId, messages)

    // Update the appropriate current session ID
    if (sessionId) {
      sessionStore.setSessionId(sessionId, isFloatingBall)
      
      // 如果是项目视图，尝试更新当前任务的 sessionId
      const currentProject = projectStore.getCurrentProject()
      if (currentProject && currentTaskIdForSession) {
        const task = projectStore.getTasks(currentProject.id).find(t => t.id === currentTaskIdForSession)
        if (task && (!task.sessionId || task.sessionId === '')) {
          // 关联 session 到当前任务
          projectStore.updateTask(currentProject.id, currentTaskIdForSession, { sessionId })
          console.log(`[Project] Associated session ${sessionId} with task ${currentTaskIdForSession} (${task.title})`)
        }
      } else if (currentProject) {
        // 如果没有当前任务ID，尝试找到最新的没有 sessionId 的任务
        const tasks = projectStore.getTasks(currentProject.id)
        const tasksWithoutSession = tasks.filter(t => !t.sessionId || t.sessionId === '').sort((a, b) => b.updatedAt - a.updatedAt)
        if (tasksWithoutSession.length > 0) {
          const taskToUpdate = tasksWithoutSession[0]
          projectStore.updateTask(currentProject.id, taskToUpdate.id, { sessionId })
          console.log(`[Project] Associated session ${sessionId} with latest task without session ${taskToUpdate.id} (${taskToUpdate.title})`)
        }
      }
    }

    return { success: true, sessionId: sessionId || undefined }
  } catch (error) {
    console.error('[Session] Error saving session:', error)
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

ipcMain.handle('script:mark-official', (_, id: string) => {
  const script = scriptStore.getScript(id)
  if (!script) {
    return { success: false, error: 'Script not found' }
  }

  // 权限检查：只有管理员可以标记脚本为官方
  if (!permissionService.canMarkScriptOfficial(id)) {
    return { success: false, error: 'Permission denied: Only administrators can mark scripts as official' }
  }

  // 如果已经是官方脚本，直接返回成功
  if (script.isOfficial) {
    return { success: true }
  }

  const success = scriptStore.markAsOfficial(id)
  return { success, error: success ? undefined : 'Failed to mark script as official' }
})

ipcMain.handle('script:unmark-official', (_, id: string) => {
  const script = scriptStore.getScript(id)
  if (!script) {
    return { success: false, error: 'Script not found' }
  }

  // 权限检查：只有管理员可以将官方脚本标记为非官方
  if (!permissionService.canUnmarkScriptOfficial(id)) {
    return { success: false, error: 'Permission denied: Only administrators can unmark official scripts' }
  }

  // 如果不是官方脚本，直接返回成功
  if (!script.isOfficial) {
    return { success: true }
  }

  const success = scriptStore.unmarkAsOfficial(id)
  return { success, error: success ? undefined : 'Failed to unmark script as official' }
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
    let executeMessage = `请执行以下 chrome-agent 脚本：\n\n\`\`\`bash\n${command}\n\`\`\`\n\n脚本路径：${script.filePath}`;
    
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

// 打开外部链接（在系统默认浏览器中打开）
ipcMain.handle('app:open-external-url', async (_event, url: string) => {
  try {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url)
      return { success: true }
    }
    return { success: false, error: 'Invalid URL' }
  } catch (error) {
    console.error('[Main] Error opening external URL:', error)
    return { success: false, error: (error as Error).message }
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

// Get chrome-agent scripts directory path
ipcMain.handle('agent:get-scripts-dir', () => {
  return directoryManager.getScriptsDir()
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
  // 获取有效版本（优先热更新版本）
  const appVersion = app.getVersion()
  const hotUpdateVersion = directoryManager.getHotUpdateVersion()
  const effectiveVersion = resourceUpdater?.getCurrentVersion() || appVersion
  
  console.log(`[Main] app:info - appVersion: ${appVersion}, hotUpdateVersion: ${hotUpdateVersion}, effectiveVersion: ${effectiveVersion}`)
  
  return {
    name: 'QACowork',
    version: effectiveVersion,
    appVersion: appVersion, // 原始应用版本
    hotUpdateVersion: hotUpdateVersion, // 热更新版本（如果有）
    author: 'shileima', 
    homepage: 'https://github.com/shileima/opencowork'
  };
})

ipcMain.handle('app:get-version', () => {
  // 返回有效版本（优先热更新版本）
  return resourceUpdater?.getCurrentVersion() || app.getVersion()
})

ipcMain.handle('app:check-update', async () => {
  try {
    const currentVersion = app.getVersion();
    // Use user agent to comply with GitHub API reqs
    const response = await fetch('https://api.github.com/repos/Safphere/opencowork/releases/latest', {
      headers: { 'User-Agent': 'OpenCowork-App' }
    });

    if (!response.ok) throw new Error('Failed to fetch release info');

    const data = await response.json();
    const latestTag = data.tag_name || ''; // e.g. "v1.0.4"
    const latestVersion = latestTag.replace(/^v/, '');

    // Simple semver compare (assuming strict X.Y.Z)
    // Returns true if latest > current
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    return {
      success: true,
      hasUpdate,
      currentVersion,
      latestVersion,
      latestTag,
      releaseUrl: data.html_url
    };
  } catch (error: any) {
    console.error('Update check failed:', error);
    return { success: false, error: error.message };
  }
})

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

    // 发送更新进度
    const success = await resourceUpdater.performUpdate((progress) => {
      mainWin?.webContents.send('resource:update-progress', progress)
      floatingBallWin?.webContents.send('resource:update-progress', progress)
    })

    if (success) {
      // 更新完成后获取新版本号
      const newVersion = resourceUpdater.getCurrentVersion()
      console.log(`[Main] Resource update completed. New version: ${newVersion}`)
      
      return { 
        success: true, 
        message: `资源更新完成！新版本: v${newVersion}`,
        version: newVersion
      }
    }

    return { success: false, error: '更新失败：未知错误' }
  } catch (error: any) {
    console.error('[Main] Resource update failed:', error)
    const errorMessage = error?.message || '未知错误'
    console.error('[Main] Error details:', error)
    return { success: false, error: `更新失败: ${errorMessage}` }
  }
})

// 应用更新后重启
ipcMain.handle('resource:restart-app', () => {
  app.relaunch()
  app.quit()
})

// ========== Playwright 管理 ==========

// 检查 Playwright 安装状态
async function checkPlaywrightStatus() {
  if (!playwrightManager) return

  try {
    const status = await playwrightManager.getInstallStatus()
    
    if (status.needsInstall && mainWin) {
      // 通知前端需要安装
      mainWin.webContents.send('playwright:status', {
        installed: false,
        ...status
      })
    }
  } catch (error) {
    console.error('检查 Playwright 状态失败:', error)
  }
}

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

// Helper for version comparison
function compareVersions(v1: string, v2: string) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

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


// MCP Configuration Handlers

/**
 * 获取内置MCP配置文件路径
 * 优先使用热更新目录，否则使用内置资源
 */
function getBuiltinMcpConfigPath(): string | null {
  // 优先检查热更新目录
  const hotUpdateMcpDir = directoryManager.getHotUpdateMcpDir()
  const hotUpdateMcpConfig = path.join(hotUpdateMcpDir, 'builtin-mcp.json')
  if (fs.existsSync(hotUpdateMcpConfig)) {
    console.log('[MCP] Using hot-update MCP config')
    return hotUpdateMcpConfig
  }

  // 回退到内置资源
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
  // 优先检查热更新目录
  const hotUpdateSkillsDir = directoryManager.getHotUpdateSkillsDir()
  if (fs.existsSync(hotUpdateSkillsDir)) {
    console.log('[Skills] Using hot-update skills directory')
    return hotUpdateSkillsDir
  }

  // 回退到内置资源
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
    // 通知前端项目已创建
    const targetWindow = event.sender === floatingBallWin?.webContents ? floatingBallWin : mainWin;
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('project:created', project);
    }
    return { success: true, project };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('project:list', () => {
  return projectStore.getProjects();
});

// Project 模式：主工作目录优先使用当前已选项目的目录，其次 ~/.qa-cowork
const applyProjectWorkingDirs = (project: { path: string }) => {
  const folders = configStore.getAll().authorizedFolders || [];
  const baseDir = directoryManager.getBaseDir();
  const normalizedBase = path.normalize(baseDir).replace(/\/$/, '');
  const normalizedProject = path.normalize(project.path).replace(/\/$/, '');
  const ensureFolder = (p: string, trust: TrustLevel = 'standard') => {
    const np = path.normalize(p).replace(/\/$/, '');
    const existing = folders.find((f: { path: string }) => path.normalize(f.path).replace(/\/$/, '') === np);
    return existing || { path: np, trustLevel: trust, addedAt: Date.now() };
  };
  const baseFolder = ensureFolder(baseDir, 'strict');
  const projectFolder = ensureFolder(project.path, 'standard');
  const otherFolders = folders.filter((f: { path: string }) => {
    const np = path.normalize(f.path).replace(/\/$/, '');
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

  // 模板路径：开发用 app 目录，生产用 extraResources
  const templateDir = app.isPackaged
    ? path.join(process.resourcesPath, 'templates', 'react-vite')
    : path.join(app.getAppPath(), 'resources', 'templates', 'react-vite');

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

// Project 模式：切换到项目视图时，确保主工作目录为 ~/.qa-cowork（不发送 project:switched 事件）
ipcMain.handle('project:ensure-working-dir', () => {
  const project = projectStore.getCurrentProject();
  if (project) applyProjectWorkingDirs(project);
});

ipcMain.handle('project:delete', async (_, id: string, projectPath?: string) => {
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

registerContextSwitchHandler((taskId) => {
    currentTaskIdForSession = taskId;
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
        // Session 不存在，清空历史
        targetAgent.clearHistory();
        sessionStore.setSessionId(null, isFloatingBall);
        // clearHistory 会触发 notifyUpdate，但为了确保前端收到更新，我们再次发送
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('agent:history-update', []);
        }
      }
    } else {
      // 任务没有 sessionId，清空历史（新任务）
      targetAgent.clearHistory();
      sessionStore.setSessionId(null, isFloatingBall);
      // clearHistory 会触发 notifyUpdate，但为了确保前端收到更新，我们再次发送
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('agent:history-update', []);
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
// Deploy Handler: generate deploy.sh, execute, stream logs
// ═══════════════════════════════════════
ipcMain.handle('deploy:start', async (event, projectPath: string) => {
  try {
    const sender = event.sender;

    // Step 1: Read package.json to get name and version
    const pkgPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
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

    // Step 2: Generate script/deploy.sh
    const scriptDir = path.join(projectPath, 'script');
    if (!fs.existsSync(scriptDir)) {
      fs.mkdirSync(scriptDir, { recursive: true });
    }

    const deployScript = `#!/bin/bash
set -e

PROJECT_NAME="${projectName}"
VERSION="${version}"
BUILD_DIR="dist"

# ── Step 1: Check webstatic ──
if ! command -v webstatic &> /dev/null; then
  echo "✗ webstatic not installed"
  echo "  Run: pnpm add -g @bfe/webstatic --registry=http://r.npm.sankuai.com/"
  exit 1
fi
echo "✓ webstatic ready"

# ── Step 2: Build & Publish ──
echo ""
echo "── CDN Deploy: \${PROJECT_NAME} v\${VERSION} ──"
echo ""

webstatic publish \\
  --appkey=com.sankuai.waimaiqafc.aie \\
  --env=prod \\
  --artifact=dist \\
  --build-command='pnpm run build' \\
  --token=269883ad-b7b0-4431-b5e7-5886cd1d590f

# ── Step 3: Verify build output ──
EXPECTED_BUILD_PATH="\${BUILD_DIR}/code/\${PROJECT_NAME}/vite/\${VERSION}"

if [ ! -d "\$EXPECTED_BUILD_PATH" ]; then
  echo "✗ Build output missing: \${EXPECTED_BUILD_PATH}"
  exit 1
fi

if [ ! -f "\${EXPECTED_BUILD_PATH}/index.html" ]; then
  echo "✗ index.html missing"
  exit 1
fi

FILE_COUNT=\$(find "\${EXPECTED_BUILD_PATH}" -type f | wc -l | tr -d ' ')
TOTAL_SIZE=\$(du -sh "\${EXPECTED_BUILD_PATH}" | cut -f1)
echo "✓ Build verified: \${FILE_COUNT} files, \${TOTAL_SIZE}"

# ── Step 4: Register proxy ──
DEPLOY_BASE_URL="https://aie.sankuai.com/rdc_host/code/\${PROJECT_NAME}/vite/\${VERSION}"
EXPECTED_DEPLOY_URL="https://\${PROJECT_NAME}.autocode.test.sankuai.com/"

HTTP_RESPONSE=\$(curl -s -o /dev/null -w "%{http_code}" \\
  --location --request POST \\
  "https://digitalgateway.waimai.test.sankuai.com/testgenius/open/agent/claudeProject/updateProjectProxyTarget?projectId=\${PROJECT_NAME}&proxyType=publish&targetUrl=\${DEPLOY_BASE_URL}" \\
  --header 'Content-Type: application/json' \\
  --data-raw '{}')

if [ "\$HTTP_RESPONSE" -eq 200 ]; then
  echo "✓ Proxy registered"
else
  echo "✗ Proxy registration failed (HTTP \${HTTP_RESPONSE})"
  exit 1
fi

# ── Done ──
echo ""
echo "✓ Deploy successful!"
echo "  URL: \${EXPECTED_DEPLOY_URL}"
`;

    const deployScriptPath = path.join(scriptDir, 'deploy.sh');
    fs.writeFileSync(deployScriptPath, deployScript, { mode: 0o755 });

    sender.send('deploy:log', `Generated deploy.sh for ${projectName} v${version}\n`);

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

        // Extract plugins section if exists
        const pluginsMatch = existingConfig.match(/(plugins\s*:\s*\[[\s\S]*?\])/);
        const pluginsSection = pluginsMatch ? pluginsMatch[0] : 'plugins: []';

        // Build complete config according to SKILL.md
        const completeConfig = `${beforeConfig}
  // ========================================
  // CDN Deployment Configuration (SKILL.md)
  // ========================================
  base: '${cdnBase}',
  
  ${pluginsSection},

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
        cssCodeSplit: true,
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
        // Fallback: generate minimal config
        viteConfigContent = `${importLines.join('\n')}

export default defineConfig({
  base: '${cdnBase}',
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
        cssCodeSplit: true,
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
      sender.send('deploy:log', `  Backup: ${path.basename(viteConfigPath)}.deploy-backup\n\n`);
    } else {
      sender.send('deploy:error', 'No vite.config found, cannot proceed with deployment');
      return { success: false, error: 'No vite.config found' };
    }

    // Step 3: Execute the script
    const expectedDeployUrl = `https://${projectName}.autocode.test.sankuai.com/`;
    let allOutput = '';

    // Helper: restore vite config backup after deploy
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

    const child = cpSpawn('bash', ['script/deploy.sh'], {
      cwd: projectPath,
      env: { ...process.env, FORCE_COLOR: '0' },
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

    child.on('close', (code: number | null) => {
      // Always restore vite config after deploy
      restoreViteConfig();

      if (code === 0) {
        // Send deploy:done with the expected URL
        sender.send('deploy:done', expectedDeployUrl);
        // Also open in built-in browser
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('agent:open-browser-preview', expectedDeployUrl);
        }
      } else {
        sender.send('deploy:error', `Deploy script exited with code ${code}\n\n${allOutput.slice(-500)}`);
      }
    });

    child.on('error', (err: Error) => {
      restoreViteConfig();
      sender.send('deploy:error', `Failed to execute deploy script: ${err.message}`);
    });

    return { success: true };
  } catch (error) {
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

ipcMain.handle('fs:write-file', async (_, filePath: string, content: string) => {
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
    // 通知所有窗口文件已更改，用于刷新资源管理器
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

ipcMain.handle('fs:list-dir', async (_, dirPath: string) => {
  try {
    // 权限检查
    const folders = configStore.getAll().authorizedFolders || [];
    const isAuthorized = folders.some(f => dirPath.startsWith(f.path));
    if (!isAuthorized) {
      return { success: false, error: 'Path not authorized' };
    }
    const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const result = items.map(item => ({
      name: item.name,
      isDirectory: item.isDirectory(),
      path: path.join(dirPath, item.name)
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

// 解析 shell 路径，确保是绝对路径且存在
function resolveShellPath(): string {
  const shellRaw = process.env.SHELL || '/bin/zsh';
  let s = path.isAbsolute(shellRaw) ? shellRaw : path.join(process.env.HOME || '/', shellRaw.replace(/^~/, ''));
  if (!fs.existsSync(s)) {
    s = '/bin/zsh';
    if (!fs.existsSync(s)) s = '/bin/bash';
    if (!fs.existsSync(s)) s = '/bin/sh';
  }
  return s;
}

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

// 验证 shell 文件是否存在且可执行
function validateShellPath(shellPath: string): { valid: boolean; error?: string } {
  if (!fs.existsSync(shellPath)) {
    return { valid: false, error: `Shell file does not exist: ${shellPath}` };
  }
  try {
    const stats = fs.statSync(shellPath);
    if (!stats.isFile()) {
      return { valid: false, error: `Shell path is not a file: ${shellPath}` };
    }
    // 检查是否可执行（Unix 权限）
    if (process.platform !== 'win32') {
      const mode = stats.mode;
      const isExecutable = (mode & parseInt('111', 8)) !== 0;
      if (!isExecutable) {
        return { valid: false, error: `Shell file is not executable: ${shellPath}` };
      }
    }
  } catch (e) {
    return { valid: false, error: `Cannot access shell file: ${shellPath}, ${e instanceof Error ? e.message : String(e)}` };
  }
  return { valid: true };
}

// 尝试多种 shell 路径
function getShellCandidates(): string[] {
  const candidates: string[] = [];
  const shellRaw = process.env.SHELL;
  if (shellRaw && path.isAbsolute(shellRaw) && fs.existsSync(shellRaw)) {
    candidates.push(shellRaw);
  }
  candidates.push('/bin/zsh', '/bin/bash', '/bin/sh');
  // 去重并过滤不存在的路径
  return [...new Set(candidates)].filter(p => fs.existsSync(p));
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
  
  // 确定 shell 命令
  let shellCommand: string;
  if (process.platform === 'win32') {
    shellCommand = process.env.COMSPEC || 'cmd.exe';
  } else {
    // 优先使用 bash
    if (fs.existsSync('/bin/bash')) {
      shellCommand = '/bin/bash';
    } else {
      shellCommand = resolveShellPath();
    }
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

function initializeAgent() {
  const apiKey = configStore.getApiKey() || process.env.ANTHROPIC_API_KEY
  const model = configStore.getModel()
  const apiUrl = configStore.getApiUrl()

  if (apiKey && mainWin) {
    // Dispose previous agents if they exist
    if (mainAgent) {
      console.log('Disposing previous main agent instance...');
      mainAgent.dispose();
    }
    // Note: Don't dispose floatingBallAgent here as it will be created independently in createFloatingBallWindow

    // Create separate agent for main window only
    const maxTokens = configStore.getMaxTokens();
    mainAgent = new AgentRuntime(apiKey, mainWin, model, apiUrl, maxTokens);

    // Initialize the agent asynchronously
    mainAgent.initialize().then(() => {
      console.log('Main agent initialized with model:', model);
    }).catch(err => {
      console.error('Main agent initialization failed:', err);
    });

    // Set global references for backward compatibility
    (global as Record<string, unknown>).agent = mainAgent;
    (global as Record<string, unknown>).mainAgent = mainAgent;

    console.log('API URL:', apiUrl)
  } else {
    console.warn('No API Key found. Please configure in Settings.')
  }
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
    minWidth: 400,
    minHeight: 600,
    icon: iconImage || iconPath,
    frame: false, // Custom frame for consistent look
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden', // Mac: inset buttons, others: hidden
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      webviewTag: true, // 用于浏览器预览中注入 CSS（如缩小 Vite 报错 overlay 字号）
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
    console.log('Main window ready.')
    // 确保窗口显示在最前面
    mainWin?.show()
    mainWin?.focus()
  })

  // Handle external links：localhost 和部署域名用内置浏览器打开，其他用系统浏览器
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    // localhost / 127.0.0.1 - 使用内置浏览器
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1') ||
        url.startsWith('https://localhost') || url.startsWith('https://127.0.0.1')) {
      mainWin?.webContents.send('agent:open-browser-preview', url)
      return { action: 'deny' }
    }
    // 部署相关域名 - 使用内置浏览器
    if (url.includes('.autocode.test.sankuai.com') || url.includes('aie.sankuai.com/rdc_host')) {
      mainWin?.webContents.send('agent:open-browser-preview', url)
      return { action: 'deny' }
    }
    // 其他外部链接 - 使用系统默认浏览器
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
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

  // 监听主窗口加载状态，排查客户端打包后页面无法加载的问题
  mainWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
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

  // 监听 webview 相关事件（webview 创建时）
  mainWin.webContents.on('will-attach-webview', (_event, webPreferences, _params) => {
    console.log('[Browser:Diag] will-attach-webview 触发, webPreferences:', JSON.stringify({
      preload: webPreferences.preload,
      nodeIntegration: webPreferences.nodeIntegration,
      contextIsolation: webPreferences.contextIsolation,
    }));
  });
  mainWin.webContents.on('did-attach-webview', (_event, webContents) => {
    console.log('[Browser:Diag] did-attach-webview 触发, webContents ID:', webContents.id);
    
    // 监听 webview 内部的加载事件
    webContents.on('did-start-loading', () => {
      console.log('[Browser:Diag] webview did-start-loading, URL:', webContents.getURL());
    });
    webContents.on('did-finish-load', () => {
      console.log('[Browser:Diag] webview did-finish-load (成功), URL:', webContents.getURL());
    });
    webContents.on('did-fail-load', (_ev: any, errorCode: number, errorDescription: string, validatedURL: string) => {
      console.error('[Browser:Diag] webview did-fail-load (失败)!', { errorCode, errorDescription, validatedURL });
    });
    webContents.on('render-process-gone', (_ev: any, details: any) => {
      console.error('[Browser:Diag] webview 渲染进程退出!', details);
    });
    webContents.on('crashed' as any, () => {
      console.error('[Browser:Diag] webview crashed!');
    });
  });

  mainWin.webContents.on('did-finish-load', () => {
    console.log('[Browser:Diag] 主窗口加载完成 (did-finish-load)');
    mainWin?.webContents.send('main-process-message', (new Date).toLocaleString())
    
    // 自动加载最近一次会话
    const tryLoadLatestSession = () => {
      try {
        // 确保 agent 已初始化
        if (!mainAgent) {
          console.log('[Main] Agent not ready yet, retrying in 500ms...')
          setTimeout(tryLoadLatestSession, 500)
          return
        }
        
        const sessions = sessionStore.getSessions()
        if (sessions && sessions.length > 0) {
          // 按更新时间排序，获取最近一次会话
          const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
          const latestSession = sortedSessions[0]
          
          if (latestSession) {
            console.log(`[Main] Auto-loading latest session: ${latestSession.id} (${latestSession.title})`)
            // 设置当前会话ID
            sessionStore.setSessionId(latestSession.id, false)
            // 加载会话历史
            const fullSession = sessionStore.getSession(latestSession.id)
            if (fullSession && fullSession.messages.length > 0) {
              mainAgent.loadHistory(fullSession.messages)
              // 通知渲染进程会话已加载
              mainWin?.webContents.send('session:auto-loaded', latestSession.id)
              console.log(`[Main] Successfully auto-loaded session: ${latestSession.title}`)
            }
          }
        } else {
          console.log('[Main] No sessions found, skipping auto-load')
        }
      } catch (error) {
        console.error('[Main] Error auto-loading latest session:', error)
      }
    }
    
    // 延迟一下确保 agent 已初始化
    setTimeout(tryLoadLatestSession, 500)
  })

  if (VITE_DEV_SERVER_URL) {
    console.log('[Browser:Diag] 开发模式: 加载 URL:', VITE_DEV_SERVER_URL);
    mainWin.loadURL(VITE_DEV_SERVER_URL)
  } else {
    const distPath = getRendererDistPath()
    const indexPath = path.join(distPath, 'index.html');
    console.log('[Browser:Diag] 生产模式: 加载文件:', indexPath);
    console.log('[Browser:Diag] distPath:', distPath);
    console.log('[Browser:Diag] index.html 存在:', fs.existsSync(indexPath));
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
    mainWin.loadFile(indexPath)
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    icon: getIconPath(),
  })

  if (VITE_DEV_SERVER_URL) {
    floatingBallWin.loadURL(`${VITE_DEV_SERVER_URL}#/floating-ball`)
  } else {
    const distPath = getRendererDistPath()
    floatingBallWin.loadFile(path.join(distPath, 'index.html'), { hash: 'floating-ball' })
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
  floatingBallWin.webContents.on('did-finish-load', () => {
    if (!floatingBallAgent) {
      // Create floating ball agent with same config as main agent
      const apiKey = configStore.getApiKey() || process.env.ANTHROPIC_API_KEY
      if (apiKey && floatingBallWin) {
        floatingBallAgent = new AgentRuntime(apiKey, floatingBallWin, configStore.getModel(), configStore.getApiUrl(), configStore.getMaxTokens());

        // Initialize the agent asynchronously
        floatingBallAgent.initialize().then(() => {
          console.log('Floating ball agent created independently');
        }).catch(err => {
          console.error('Floating ball agent initialization failed:', err);
        });

        (global as Record<string, unknown>).floatingBallAgent = floatingBallAgent
      }
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
