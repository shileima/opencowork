import { app, BrowserWindow, shell, ipcMain, screen, dialog, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
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
  // Stop resource updater
  if (resourceUpdater) {
    resourceUpdater.stopAutoUpdateCheck()
  }
  // Clean up both agent resources
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
  const targetAgent = event.sender === floatingBallWin?.webContents ? floatingBallAgent : mainAgent
  if (!targetAgent) throw new Error('Agent not initialized')
  return await targetAgent.processUserMessage(message)
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
        await targetAgent.processUserMessage(executeMessage, currentSessionId)
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

// 新建项目：在 ~/.qa-cowork/projects 下创建目录，重名则加后缀 -1、-2…
ipcMain.handle('project:create-new', async (event, name: string) => {
  if (!name || typeof name !== 'string') return { success: false, error: 'Invalid project name' };
  const sanitized = name.trim().replace(/[/\\:*?"<>|]/g, '-').replace(/-+/g, '-') || 'project';
  const baseDir = directoryManager.getBaseDir();
  const projectsDir = path.join(baseDir, 'projects');
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
    fs.mkdirSync(dirPath, { recursive: true });
    const project = projectStore.createProject(dirName, dirPath);
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

ipcMain.handle('project:get-current', () => {
  return projectStore.getCurrentProject();
});

// Project 模式：切换到项目视图时，确保主工作目录为 ~/.qa-cowork（不发送 project:switched 事件）
ipcMain.handle('project:ensure-working-dir', () => {
  const project = projectStore.getCurrentProject();
  if (project) applyProjectWorkingDirs(project);
});

ipcMain.handle('project:delete', (_, id: string) => {
  return { success: projectStore.deleteProject(id) };
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
      await fs.promises.rmdir(filePath, { recursive: true });
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

// Terminal Handlers
const terminalSessions = new Map<string, { process: any, cwd: string, webContents: Electron.WebContents }>();

function setupTerminalListeners(id: string, process: any, webContents: Electron.WebContents) {
  process.stdout.on('data', (data: Buffer) => {
    webContents.send('terminal:output', id, data.toString());
  });
  process.stderr.on('data', (data: Buffer) => {
    webContents.send('terminal:output', id, data.toString());
  });
  process.on('exit', () => {
    webContents.send('terminal:exit', id);
    terminalSessions.delete(id);
  });
}

ipcMain.handle('terminal:create', async (event, { id, cwd }: { id: string, cwd: string }) => {
  try {
    // 权限检查
    const folders = configStore.getAll().authorizedFolders || [];
    const isAuthorized = folders.some(f => cwd.startsWith(f.path));
    if (!isAuthorized) {
      return { success: false, error: 'Path not authorized' };
    }
    const shell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/bash';
    const { spawn } = await import('child_process');
    const terminalProcess = spawn(shell, [], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' }
    });
    const webContents = event.sender;
    terminalSessions.set(id, { process: terminalProcess, cwd, webContents });
    setupTerminalListeners(id, terminalProcess, webContents);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('terminal:write', (_, id: string, data: string) => {
  const session = terminalSessions.get(id);
  if (!session) {
    return { success: false, error: 'Terminal session not found' };
  }
  session.process.stdin.write(data);
  return { success: true };
});

ipcMain.handle('terminal:resize', (_, id: string, _cols: number, _rows: number) => {
  const session = terminalSessions.get(id);
  if (!session) {
    return { success: false, error: 'Terminal session not found' };
  }
  // PTY resize (if using pty on Unix)
  if (process.platform !== 'win32' && session.process.stdout.setDefaultEncoding) {
    session.process.stdout.setDefaultEncoding('utf8');
  }
  return { success: true };
});

ipcMain.handle('terminal:destroy', (_, id: string) => {
  const session = terminalSessions.get(id);
  if (session) {
    session.process.kill();
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
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
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

  // Handle external links：localhost 用内置浏览器打开，不启动系统默认浏览器
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1') ||
        url.startsWith('https://localhost') || url.startsWith('https://127.0.0.1')) {
      mainWin?.webContents.send('agent:open-browser-preview', url)
      return { action: 'deny' }
    }
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

  mainWin.webContents.on('did-finish-load', () => {
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
    mainWin.loadURL(VITE_DEV_SERVER_URL)
  } else {
    const distPath = getRendererDistPath()
    mainWin.loadFile(path.join(distPath, 'index.html'))
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
