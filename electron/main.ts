import { app, BrowserWindow, shell, ipcMain, screen, dialog, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import dotenv from 'dotenv'
import { agentManager } from './agent/AgentManager'
import type { AgentRuntime } from './agent/AgentRuntime'
import { configStore, TrustLevel } from './config/ConfigStore'
import { sessionStoreV2 as sessionStore } from './config/SessionStoreV2'
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

// Internal MCP Server Runner
// MiniMax startup removed
// --- Normal App Initialization ---

let mainWin: BrowserWindow | null = null
let floatingBallWin: BrowserWindow | null = null
let tray: Tray | null = null

// 移除了 mainAgent 和 floatingBallAgent
// 现在使用统一的 agentManager 管理所有会话的 Agent

// Memory Assistant 相关常量
const MEMORY_ASSISTANT_SESSION_ID = 'memory-assistant-session';
let previousSessionId: string | null = null; // 用于从记忆助手切换回普通会话

// Ball state
let isBallExpanded = false
const BALL_SIZE = 64
const EXPANDED_WIDTH = 340    // Match w-80 (320px) + padding
const EXPANDED_HEIGHT = 320   // Compact height for less dramatic expansion

app.on('before-quit', async () => {
  app.isQuitting = true

  // ⚠️ 关键修复: 在关闭应用前保存所有运行中的会话
  logger.debug('[Main] App quitting, saving all active sessions...')
  const stats = agentManager.getStats()
  let savedCount = 0

  for (const sessionId of stats.sessions) {
    try {
      const agent = agentManager.getAgent(sessionId)
      // 访问 AgentRuntime 的私有 history 属性
      const history = (agent as any).history

      if (history && history.length > 0) {
        // 检查是否有实际内容
        const hasRealContent = history.some((msg: any) => {
          const content = msg.content
          if (typeof content === 'string') {
            return content.trim().length > 0
          } else if (Array.isArray(content)) {
            return content.some((block: any) =>
              block.type === 'text' ? (block.text || '').trim().length > 0 : true
            )
          }
          return false
        })

        if (hasRealContent) {
          sessionStore.updateSession(sessionId, history)
          savedCount++
          logger.debug(`✅ Saved session ${sessionId} on quit: ${history.length} messages`)
        }
      }
    } catch (err) {
      logger.error(`❌ Error saving session ${sessionId} on quit:`, err)
    }
  }

  logger.debug(`Saved ${savedCount}/${stats.sessions.length} sessions before quit`)

  // 清理所有 Agent
  logger.debug('[Main] Cleaning up all agents via AgentManager...')
  agentManager.disposeAll();
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// [Fix] Prevent crash on EPIPE (broken pipe) when child processes die unexpectedly during reload
process.on('uncaughtException', (err: any) => {
  if (err.code === 'EPIPE' || err.message?.includes('EPIPE')) {
    logger.warn('Detected EPIPE error (likely from MCP child process). Ignoring to prevent crash.');
    return;
  }
  logger.error('Uncaught Exception:', err);
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
    logger.debug('Skipping protocol registration in Dev mode.')
  }

  // 1. Setup IPC handlers FIRST
  // 1. Setup IPC handlers FIRST
  // setupIPCHandlers() - handlers are defined at top level now

  // 2. Create windows
  createMainWindow()
  createFloatingBallWindow()

  // 3. Built-in skills are now loaded async by SkillManager (inside initializeAgent)
  // ensureBuiltinSkills() - Removed


  // 4. Initialize agent AFTER windows are created
  initializeAgent()

  // 4.5 Clean up empty sessions on startup
  sessionStore.cleanupEmptySessions()

  // 4.55 Start periodic cleanup of idle agents
  // Clean up agents that haven't been used for 60 minutes every 30 minutes
  setInterval(() => {
    const disposed = agentManager.cleanupIdleAgents(60 * 60 * 1000); // 60 minutes
    if (disposed > 0) {
      logger.debug(`Periodic cleanup: disposed ${disposed} idle agents`);
    }
  }, 30 * 60 * 1000); // Every 30 minutes

  // 4.6 Ensure built-in MCP config
  ensureBuiltinMcpConfig()

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

  // Show main window in dev mode
  if (VITE_DEV_SERVER_URL) {
    mainWin?.show()
  }

  logger.info('OpenCowork started. Press Alt+Space to toggle floating ball.')
})


//Functions defined outside the block to ensure proper hoisiting and scope access (vars are global to file)

/**
 * Clean up window references from all agents when a window is closed
 * This prevents memory leaks and ensures agents don't try to send to destroyed windows
 */
function cleanupWindowFromAgents(closedWin: BrowserWindow) {
  logger.debug(`Cleaning up window references from all agents`);

  const stats = agentManager.getStats();
  let cleanedCount = 0;

  for (const sessionId of stats.sessions) {
    try {
      const agent = agentManager.getAgent(sessionId);
      agent.removeWindow(closedWin);
      cleanedCount++;
    } catch (err) {
      logger.error(`Error cleaning up window from agent ${sessionId}:`, err);
    }
  }

  logger.debug(`Cleaned up window from ${cleanedCount} agents`);
}

// IPC Handlers

ipcMain.handle('agent:send-message', async (event, message: string | { content: string, images: string[] }) => {
  // 不再区分 mainAgent 和 floatingBallAgent
  // 所有会话统一通过 AgentManager 管理

  // 获取当前会话ID
  const isFloatingBall = event.sender === floatingBallWin?.webContents;
  let sessionId = sessionStore.getSessionId(isFloatingBall);

  // 特殊处理：记忆助手会话不保存到 SessionStore
  const isMemoryAssistant = sessionId === MEMORY_ASSISTANT_SESSION_ID;

  // ⚠️ 关键优化：检查消息是否有实际内容，只有有内容时才创建新会话
  const messageContent = typeof message === 'string' ? message : message.content;
  const hasRealContent = messageContent && messageContent.trim().length > 0;

  if (!sessionId && hasRealContent) {
    // 只有在有实际内容时才创建新会话
    const newSession = sessionStore.createSession();
    sessionId = newSession.id;
    // 设置当前窗口的会话ID
    sessionStore.setSessionId(sessionId, isFloatingBall);

    // 只通知发送请求的窗口
    const eventData = { sessionId };
    const targetWin = isFloatingBall ? floatingBallWin : mainWin;
    targetWin?.webContents.send('session:current-changed', eventData);

    logger.debug(`Created new session with content: ${sessionId}, notified ${isFloatingBall ? 'floating ball' : 'main window'}`);
  } else if (!sessionId) {
    // 没有会话且没有内容，直接返回
    logger.debug(`No session and no content, skipping`);
    return { content: '' };
  }

  // ⚠️ 关键修复：保存用户消息（记忆助手使用专用存储）
  // 将用户消息转换为 Anthropic.MessageParam 格式
  const userMessage: Anthropic.MessageParam = typeof message === 'string'
    ? { role: 'user', content: message }
    : {
        role: 'user',
        content: [
          { type: 'text' as const, text: message.content },
          ...(message.images || []).map(img => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: img.split(',')[1] }
          }))
        ]
      };

  // 获取当前会话的历史，添加用户消息
  if (isMemoryAssistant) {
    // 记忆助手使用专用存储
    const memoryHistory = sessionStore.getMemoryAssistantHistory();
    const updatedMemoryHistory = [...memoryHistory, userMessage];
    sessionStore.saveMemoryAssistantHistory(updatedMemoryHistory);
    logger.debug(`Saved memory assistant message, total messages: ${updatedMemoryHistory.length}`);
  } else {
    // 普通会话保存到 SessionStore
    const session = sessionStore.getSession(sessionId);
    const updatedMessages = session ? [...session.messages, userMessage] : [userMessage];
    sessionStore.updateSessionImmediate(sessionId, updatedMessages);
    logger.debug(`Saved user message to session ${sessionId}, total messages: ${updatedMessages.length}`);
  }

  // 标记会话为运行中
  sessionStore.setSessionRunning(sessionId, true);

  // 广播运行状态变化
  mainWin?.webContents.send('session:running-changed', {
    sessionId,
    isRunning: true,
    count: sessionStore.getRunningSessionsCount()
  });
  floatingBallWin?.webContents.send('session:running-changed', {
    sessionId,
    isRunning: true,
    count: sessionStore.getRunningSessionsCount()
  });

  try {
    // 从 AgentManager 获取或创建 Agent
    // 获取所有可用的窗口
    const windows = [];
    if (mainWin && !mainWin.isDestroyed()) {
      windows.push(mainWin);
    }
    if (floatingBallWin && !floatingBallWin.isDestroyed()) {
      windows.push(floatingBallWin);
    }

    const agent = agentManager.getOrCreateAgent(sessionId, windows);

    // 处理消息
    return await agent.processUserMessage(message);
  } finally {
    // 清除运行状态
    if (sessionId) {
      logger.debug(`Task for session ${sessionId} completed (in finally block)`);

      // ⚠️ 保存记忆助手的完整历史（包括助手响应）
      if (sessionId === MEMORY_ASSISTANT_SESSION_ID) {
        try {
          const agent = agentManager.getAgent(sessionId);
          if (agent) {
            const history = (agent as any).history as Anthropic.MessageParam[];
            if (history && history.length > 0) {
              sessionStore.saveMemoryAssistantHistory(history);
              logger.debug(`💾 Saved memory assistant complete history, messages: ${history.length}`);
            }
          }
        } catch (error) {
          logger.error('[Main] Failed to save memory assistant history:', error);
        }
      }

      sessionStore.setSessionRunning(sessionId, false);

      // 广播运行状态变化
      mainWin?.webContents.send('session:running-changed', {
        sessionId,
        isRunning: false,
        count: sessionStore.getRunningSessionsCount()
      });
      floatingBallWin?.webContents.send('session:running-changed', {
        sessionId,
        isRunning: false,
        count: sessionStore.getRunningSessionsCount()
      });
    }
  }
})

ipcMain.handle('agent:abort', (event) => {
  // 获取当前会话ID
  const isFloatingBall = event.sender === floatingBallWin?.webContents;
  const sessionId = sessionStore.getSessionId(isFloatingBall);

  if (sessionId && agentManager.hasAgent(sessionId)) {
    logger.debug(`Aborting task for session: ${sessionId}`);
    const agent = agentManager.getAgent(sessionId);
    agent.abort();
  } else {
    logger.warn('[Main] No session or agent to abort');
  }
})

ipcMain.handle('agent:confirm-response', (_, { id, approved, remember, tool, path }: { id: string, approved: boolean, remember?: boolean, tool?: string, path?: string }) => {
  if (approved && remember && tool) {
    configStore.addPermission(tool, path)
    logger.debug(`Saved: ${tool} for path: ${path || '*'}`)
  }

  // 广播确认响应到所有 Agent 实例
  const stats = agentManager.getStats();
  for (const sessionId of stats.sessions) {
    try {
      const agent = agentManager.getAgent(sessionId);
      agent.handleConfirmResponse(id, approved);
    } catch (err) {
      logger.error(`Error confirming for session ${sessionId}:`, err);
    }
  }
})

// ⚠️ 新增：处理用户问题回答
ipcMain.handle('agent:user-question-answer', (_, { requestId, answers }: { requestId: string, answers: string[] }) => {
  logger.debug(`Received user question answer for request: ${requestId}`);

  // 广播问题回答到所有 Agent 实例
  const stats = agentManager.getStats();
  for (const sessionId of stats.sessions) {
    try {
      const agent = agentManager.getAgent(sessionId);
      agent.handleUserQuestionAnswer(requestId, answers);
    } catch (err) {
      logger.error(`Error handling question answer for session ${sessionId}:`, err);
    }
  }
})

ipcMain.handle('agent:new-session', (event) => {
  // 清除当前窗口的会话引用
  const isFloatingBall = event.sender === floatingBallWin?.webContents;
  sessionStore.setSessionId(null, isFloatingBall);

  // 只通知发送请求的窗口清空当前会话显示
  const eventData = {
    sessionId: null,  // null 表示新会话
    data: []  // 空历史
  };

  const targetWin = isFloatingBall ? floatingBallWin : mainWin;

  // 先清空历史，再通知会话切换
  targetWin?.webContents.send('agent:history-update', eventData);

  // 然后发送会话切换事件（需要放在 history-update 之后，并包含 isRunning 状态）
  targetWin?.webContents.send('session:current-changed', { sessionId: null, isRunning: false });

  logger.debug(`New session requested, cleared ${isFloatingBall ? 'floating ball' : 'main window'} session state`);
  return { success: true, sessionId: null };
})

// ⚠️ 新增：立即创建新会话（用于发送消息前确保有 sessionId）
ipcMain.handle('session:create-new', (event) => {
  const isFloatingBall = event.sender === floatingBallWin?.webContents;
  const newSession = sessionStore.createSession();

  // 设置为当前会话
  sessionStore.setSessionId(newSession.id, isFloatingBall);

  // 获取所有可用的窗口
  const windows = [];
  if (mainWin && !mainWin.isDestroyed()) {
    windows.push(mainWin);
  }
  if (floatingBallWin && !floatingBallWin.isDestroyed()) {
    windows.push(floatingBallWin);
  }

  // 确保 Agent 存在
  agentManager.getOrCreateAgent(newSession.id, windows);

  // 通知前端会话已创建
  const targetWin = isFloatingBall ? floatingBallWin : mainWin;
  targetWin?.webContents.send('session:current-changed', {
    sessionId: newSession.id,
    isRunning: false
  });

  logger.debug(`✅ Created new session: ${newSession.id} for ${isFloatingBall ? 'floating ball' : 'main window'}`);
  return { success: true, sessionId: newSession.id };
})

// Session Management
ipcMain.handle('session:list', () => {
  return sessionStore.getSessions()
})

ipcMain.handle('session:get', (_, id: string) => {
  return sessionStore.getSession(id)
})

ipcMain.handle('session:load', (event, id: string) => {
  const session = sessionStore.getSession(id);
  if (!session) {
    logger.error(`Session not found: ${id}`);
    return { error: 'Session not found' };
  }

  const isFloatingBall = event.sender === floatingBallWin?.webContents;

  // 获取所有可用的窗口
  const windows = [];
  if (mainWin && !mainWin.isDestroyed()) {
    windows.push(mainWin);
  }
  if (floatingBallWin && !floatingBallWin.isDestroyed()) {
    windows.push(floatingBallWin);
  }

  // 确保该会话的 Agent 存在
  const agent = agentManager.getOrCreateAgent(id, windows);

  // 检查会话是否正在运行
  const isRunning = agent.isProcessingMessage();

  // ⚠️ 关键修复：先发送会话切换事件，让前端更新 sessionId ref
  const eventData = { sessionId: id, isRunning };
  const targetWin = isFloatingBall ? floatingBallWin : mainWin;

  // 使用 sendSync 确保事件立即处理
  targetWin?.webContents.send('session:current-changed', eventData);

  logger.debug(`Step 1: Sent session:current-changed for ${id}`);

  // 然后加载历史（这会触发 agent:history-update）
  // 因为前端已经更新了 ref，所以这次事件不会被过滤
  agent.loadHistory(session.messages, id);

  logger.debug(`Step 2: Loaded history for session ${id}, triggered agent:history-update`);

  // ⚠️ 关键修复：如果会话正在运行，需要恢复流式文本
  if (isRunning && session.messages.length > 0) {
    const lastMessage = session.messages[session.messages.length - 1];
    if (lastMessage.role === 'assistant') {
      // 提取最后一条 assistant 消息的文本内容
      let streamingText = '';
      if (typeof lastMessage.content === 'string') {
        streamingText = lastMessage.content;
      } else if (Array.isArray(lastMessage.content)) {
        // 提取所有 text block 的内容
        streamingText = lastMessage.content
          .filter(block => block.type === 'text')
          .map(block => (block as any).text || '')
          .join('\n');
      }

      if (streamingText.length > 0) {
        // 发送恢复流式文本的事件
        targetWin?.webContents.send('agent:restore-streaming', {
          sessionId: id,
          data: streamingText
        });
        logger.debug(`Step 2.5: Restored streaming text for session ${id}: ${streamingText.length} chars`);
      }
    }
  }

  // 最后更新 SessionStore
  sessionStore.setSessionId(id, isFloatingBall);

  logger.debug(`Step 3: Updated SessionStore for ${id}`);
  logger.debug(`✅ Session load complete: ${id} for ${isFloatingBall ? 'floating ball' : 'main window'} (running: ${isRunning})`);

  return { success: true, isRunning };
})

ipcMain.handle('session:save', (event, messages: Anthropic.MessageParam[]) => {
  // Determine which window is making the request
  const isFloatingBall = event.sender === floatingBallWin?.webContents

  // Get the appropriate current session ID based on window
  const currentId = sessionStore.getSessionId(isFloatingBall)

  logger.debug(`[Session] Saving session for ${isFloatingBall ? 'floating ball' : 'main window'}: ${messages.length} messages`)

  try {
    // Use the smart save method that only saves if there's meaningful content
    const sessionId = sessionStore.saveSession(currentId, messages)

    // Update the appropriate current session ID
    if (sessionId) {
      sessionStore.setSessionId(sessionId, isFloatingBall)
    }

    return { success: true, sessionId: sessionId || undefined }
  } catch (error) {
    logger.error('[Session] Error saving session:', error)
    return { success: false, error: (error as Error).message }
  }
})

ipcMain.handle('session:delete', (_, id: string) => {
  logger.debug(`Deleting session: ${id}`);

  // 释放对应的 Agent 以防止内存泄漏
  if (agentManager.hasAgent(id)) {
    logger.debug(`Disposing Agent for deleted session: ${id}`);
    agentManager.disposeAgent(id);
  }

  sessionStore.deleteSession(id)

  logger.debug(`Session deleted successfully: ${id}`);
  return { success: true }
})

ipcMain.handle('session:current', () => {
  const id = sessionStore.getCurrentSessionId()
  return id ? sessionStore.getSession(id) : null
})

// Session running status
ipcMain.handle('session:get-running-count', () => {
  return sessionStore.getRunningSessionsCount()
})

ipcMain.handle('session:get-running-ids', () => {
  return sessionStore.getRunningSessionIds()
})

ipcMain.handle('session:is-running', (_, sessionId: string) => {
  if (!sessionId || !agentManager.hasAgent(sessionId)) {
    return false;
  }
  return agentManager.getAgent(sessionId).isProcessingMessage();
})

ipcMain.handle('agent:authorize-folder', (_, folderPath: string) => {
  const folders = configStore.getAll().authorizedFolders || []

  // ⚠️ 优化：检查是否已经有父目录授权
  // 如果父目录已经授权，就不需要添加子目录
  const alreadyAuthorized = folders.some(f => {
    // 检查 folderPath 是否已经在某个授权路径下
    return folderPath.startsWith(f.path) || f.path.startsWith(folderPath)
  })

  if (!alreadyAuthorized) {
    folders.push({ path: folderPath, trustLevel: 'strict' as TrustLevel, addedAt: Date.now() })
    configStore.set('authorizedFolders', folders)
    logger.debug(`✅ Authorized new folder: ${folderPath}`)
  } else {
    logger.debug(`ℹ️  Folder already covered by existing authorization: ${folderPath}`)
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

// 打开主页并在文件画布中显示文件
ipcMain.handle('open-main-with-file', async (event, { filePath }: { filePath: string }) => {
  logger.debug('[Main] Opening main window with file:', filePath)

  // 从 event 获取发送消息的窗口（悬浮球窗口）
  const floatingBallWindow = BrowserWindow.fromWebContents(event.sender)
  if (!floatingBallWindow) {
    logger.error('[Main] Could not identify floating ball window')
    return { success: false, error: 'Could not identify floating ball window' }
  }

  // 获取所有窗口
  const windows = BrowserWindow.getAllWindows()
  logger.debug(`Total windows: ${windows.length}`)

  // 找到主页窗口（不是悬浮球窗口的其他窗口）
  const mainWindow = windows.find(win => win.id !== floatingBallWindow.id)

  if (!mainWindow) {
    logger.error('[Main] Main window not found')
    return { success: false, error: 'Main window not found' }
  }

  logger.debug('[Main] Found main window, focusing...')
  // 聚焦到主页窗口
  mainWindow.focus()
  // 最小化然后恢复窗口以确保它被激活
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  // 发送打开文件画布的事件到主页窗口
  mainWindow.webContents.send('open-file-canvas', { filePath })
  logger.debug('[Main] Sent open-file-canvas event to main window')

  return { success: true }
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

ipcMain.handle('agent:set-working-dir', async (_, folderPath: string) => {
  // Set as first (primary) in the list
  const folders = configStore.getAll().authorizedFolders || []
  const existing = folders.find(f => f.path === folderPath)
  const otherFolders = folders.filter(f => f.path !== folderPath)
  const newFolders = existing ? [existing, ...otherFolders] : [{ path: folderPath, trustLevel: 'strict' as TrustLevel, addedAt: Date.now() }, ...otherFolders]
  configStore.set('authorizedFolders', newFolders)

  // ⚠️ 确保当前会话的文件监听器已启动
  try {
    // 获取当前活动的会话
    const agentManager = (global as any).agentManager
    if (agentManager) {
      const stats = agentManager.getStats()
      const currentSessionId = stats.currentSession

      if (currentSessionId) {
        // 为当前会话启动文件监听
        const tracker = await getFileTracker(currentSessionId, folderPath)
        let watcher = fileWatcherInstances.get(currentSessionId)

        if (!watcher) {
          const { FileWatcher } = await import('./services/FileWatcher')
          watcher = new FileWatcher(tracker)

          // 设置变更事件监听
          watcher.on('change', (change: any) => {
            logger.debug(`[FileWatcher] File changed for session ${currentSessionId}:`, change.path)
            BrowserWindow.getAllWindows().forEach(win => {
              win.webContents.send('file:changed', {
                sessionId: currentSessionId,
                change
              })
            })
          })

          fileWatcherInstances.set(currentSessionId, watcher)
        }

        // 启动监听
        watcher.watch({
          basePath: folderPath,
          sessionId: currentSessionId
        })

        logger.debug(`Started file watching for session ${currentSessionId} at ${folderPath}`)
      }
    }
  } catch (error) {
    logger.error('[Main] Failed to start file watching:', error)
  }

  // ⚠️ 通知所有窗口 workingDir 已变化
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('agent:working-dir-changed', folderPath)
  })

  return true
})

ipcMain.handle('config:get-all', () => configStore.getAll())
ipcMain.handle('config:set-all', (_, cfg) => {
  configStore.setAll(cfg)

  // Hot-Swap capability: Update all active agents via AgentManager
  const stats = agentManager.getStats();
  for (const sessionId of stats.sessions) {
    try {
      const agent = agentManager.getAgent(sessionId);
      agent.updateConfig(
        configStore.getModel(),
        configStore.getApiUrl(),
        configStore.getApiKey(),
        configStore.getMaxTokens()
      );
    } catch (err) {
      logger.error(`Error updating agent for session ${sessionId}:`, err);
    }
  }

  // [Fix] Broadcast config update to all windows so UI can refresh immediately
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('config:updated', cfg);
  });
})

ipcMain.handle('config:test-connection', async (_, { apiKey, apiUrl, model }) => {
  try {
    logger.debug(`[Config] Testing connection to ${apiUrl} with model ${model}`);
    const tempClient = new Anthropic({
      apiKey,
      baseURL: apiUrl || 'https://api.anthropic.com'
    });

    const response = await tempClient.messages.create({
      model: model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hello' }]
    });

    logger.debug('[Config] Test successful:', response.id);
    return { success: true, message: 'Connection successful!' };
  } catch (error: any) {
    logger.error('[Config] Test failed:', error);
    return { success: false, message: error.message || 'Connection failed' };
  }
})

ipcMain.handle('app:info', () => {
  return {
    name: 'OpenCowork', // app.getName() might be lowercase 'opencowork'
    version: app.getVersion(),
    author: 'Safphere', // Hardcoded from package.json
    homepage: 'https://github.com/Safphere/opencowork'
  };
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
    logger.error('Update check failed:', error);
    return { success: false, error: error.message };
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


// MCP Configuration Handlers
const mcpConfigPath = path.join(os.homedir(), '.opencowork', 'mcp.json');

// Ensure built-in MCP config exists
function ensureBuiltinMcpConfig() {
  try {
    // If config already exists, do nothing
    if (fs.existsSync(mcpConfigPath)) return;

    logger.debug('[MCP] Initializing default configuration...');

    // Determine source path based on environment
    let sourcePath = '';

    if (app.isPackaged) {
      // Production: resources/mcp/builtin-mcp.json
      // Try electron-builder standard resources path
      sourcePath = path.join(process.resourcesPath, 'mcp', 'builtin-mcp.json');

      // Fallback: Check inside resources folder (some setups)
      if (!fs.existsSync(sourcePath)) {
        sourcePath = path.join(process.resourcesPath, 'resources', 'mcp', 'builtin-mcp.json');
      }
    } else {
      // Development: resources/mcp/builtin-mcp.json (relative to root)
      sourcePath = path.join(process.env.APP_ROOT!, 'resources', 'mcp', 'builtin-mcp.json');
    }

    if (fs.existsSync(sourcePath)) {
      const configContent = fs.readFileSync(sourcePath, 'utf-8');

      // Ensure directory exists
      const configDir = path.dirname(mcpConfigPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(mcpConfigPath, configContent, 'utf-8');
      logger.debug(`[MCP] Created default config at ${mcpConfigPath}`);
    } else {
      logger.warn(`[MCP] Could not find builtin-mcp.json at ${sourcePath}`);
    }
  } catch (err) {
    logger.error('[MCP] Failed to ensure builtin config:', err);
  }
}

ipcMain.handle('mcp:get-config', async () => {
  try {
    if (!fs.existsSync(mcpConfigPath)) return '{}';
    return fs.readFileSync(mcpConfigPath, 'utf-8');
  } catch (e) {
    logger.error('Failed to read MCP config:', e);
    return '{}';
  }
});

ipcMain.handle('mcp:save-config', async (_, content: string) => {
  try {
    const dir = path.dirname(mcpConfigPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(mcpConfigPath, content, 'utf-8');

    // Note: Agents will pick up the new config on their next initialization
    // For hot-reload, users can restart the app or we can add a reload capability later
    logger.debug('[MCP] Config saved. Agents will use new config on next task.');

    return { success: true };
  } catch (e) {
    logger.error('Failed to save MCP config:', e);
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('mcp:open-config-folder', async () => {
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
const skillsDir = path.join(os.homedir(), '.opencowork', 'skills');

// Helper to get built-in skill names
const getBuiltinSkillNames = () => {
  try {
    let sourceDir = path.join(process.cwd(), 'resources', 'skills');
    if (app.isPackaged) {
      const possiblePath = path.join(process.resourcesPath, 'resources', 'skills');
      if (fs.existsSync(possiblePath)) sourceDir = possiblePath;
      else sourceDir = path.join(process.resourcesPath, 'skills');
    }
    if (fs.existsSync(sourceDir)) {
      return fs.readdirSync(sourceDir).filter(f => fs.statSync(path.join(sourceDir, f)).isDirectory());
    }
  } catch (e) { logger.error(e) }
  return [];
};

// ensureBuiltinSkills logic moved to SkillManager (async) to prevent startup blocking
// See SkillManager.initializeDefaults()

ipcMain.handle('skills:list', async () => {
  try {
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
    logger.error('Failed to list skills:', e);
    return [];
  }
});

ipcMain.handle('skills:get', async (_, skillId: string) => {
  try {
    const skillPath = path.join(skillsDir, skillId);
    if (!fs.existsSync(skillPath)) return '';

    // Look for MD file inside
    const files = fs.readdirSync(skillPath);
    const mdFile = files.find(f => f.toLowerCase().endsWith('.md'));

    if (!mdFile) return '';
    return fs.readFileSync(path.join(skillPath, mdFile), 'utf-8');
  } catch (e) {
    logger.error('Failed to read skill:', e);
    return '';
  }
});

ipcMain.handle('skills:save', async (_, { filename, content }: { filename: string, content: string }) => {
  try {
    const skillId = filename.replace('.md', ''); // normalized id

    // Check if built-in
    const builtinSkills = getBuiltinSkillNames();
    if (builtinSkills.includes(skillId)) {
      return { success: false, error: 'Cannot modify built-in skills' };
    }

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
    logger.error('Failed to save skill:', e);
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('skills:delete', async (_, skillId: string) => {
  try {
    // Check if built-in
    const builtinSkills = getBuiltinSkillNames();
    if (builtinSkills.includes(skillId)) {
      return { success: false, error: 'Cannot delete built-in skills' };
    }

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

ipcMain.handle('skills:open-folder', () => {
  if (fs.existsSync(skillsDir)) {
    shell.openPath(skillsDir);
  } else {
    fs.mkdirSync(skillsDir, { recursive: true });
    shell.openPath(skillsDir);
  }
});

// Background Task Management
import { backgroundTaskManager } from './agent/BackgroundTaskManager';
import logger from './services/Logger';

// Get all background tasks
ipcMain.handle('background-task:list', () => {
  return backgroundTaskManager.getAllTasks();
});

// Get a specific background task
ipcMain.handle('background-task:get', (_, taskId: string) => {
  return backgroundTaskManager.getTask(taskId);
});

// Get tasks for a specific session
ipcMain.handle('background-task:by-session', (_, sessionId: string) => {
  return backgroundTaskManager.getTasksBySession(sessionId);
});

// Get running tasks
ipcMain.handle('background-task:running', () => {
  return backgroundTaskManager.getRunningTasks();
});

// Get task statistics
ipcMain.handle('background-task:stats', () => {
  return backgroundTaskManager.getStats();
});

// Delete a task
ipcMain.handle('background-task:delete', (_, taskId: string) => {
  backgroundTaskManager.deleteTask(taskId);
  return { success: true };
});

// Abort a running task
ipcMain.handle('background-task:abort', (_, taskId: string) => {
  const task = backgroundTaskManager.getTask(taskId);
  if (task && task.status === 'running') {
    backgroundTaskManager.abortTask(taskId);
    return { success: true };
  }
  return { success: false, error: 'Task not found or not running' };
});

// Cleanup old tasks
ipcMain.handle('background-task:cleanup', (_, keepCount: number = 50) => {
  backgroundTaskManager.cleanupOldTasks(keepCount);
  return { success: true };
});

// Agent Management
ipcMain.handle('agent:stats', () => {
  return agentManager.getStats();
});

ipcMain.handle('agent:cleanup', () => {
  const disposed = agentManager.cleanupIdleAgents();
  logger.debug(`Cleaned up ${disposed} idle agents`);
  return { success: true, disposed };
});

ipcMain.handle('agent:dispose', (_, sessionId: string) => {
  if (agentManager.hasAgent(sessionId)) {
    agentManager.disposeAgent(sessionId);
    logger.debug(`Manually disposed agent for session: ${sessionId}`);
    return { success: true };
  }
  return { success: false, error: 'Agent not found' };
});

// Start a background task
ipcMain.handle('background-task:start', async (_event, { sessionId, taskTitle, messages }: { sessionId: string, taskTitle: string, messages: any[] }) => {
  // 使用 AgentManager 而不是分离的 Agent
  if (!agentManager.hasAgent(sessionId)) {
    return { success: false, error: 'Agent not found for session' };
  }

  try {
    const agent = agentManager.getAgent(sessionId);

    // Get config values
    const config = configStore.getAll();
    const activeProvider = config.providers[config.activeProviderId];

    if (!activeProvider?.apiKey) {
      return { success: false, error: 'No API Key configured' };
    }

    const taskId = await agent.processInBackground(
      sessionId,
      taskTitle,
      messages,
      activeProvider.apiKey,
      activeProvider.model,
      activeProvider.apiUrl,
      activeProvider.maxTokens || 131072
    );

    return { success: true, taskId };
  } catch (error: any) {
    logger.error('[Main] Error starting background task:', error);
    return { success: false, error: error.message };
  }
});

// Listen to background task events and forward to renderer
backgroundTaskManager.addEventListener({
  onTaskUpdate: (task) => {
    mainWin?.webContents.send('background-task:update', task);
    floatingBallWin?.webContents.send('background-task:update', task);
  },
  onTaskComplete: (task) => {
    mainWin?.webContents.send('background-task:complete', task);
    floatingBallWin?.webContents.send('background-task:complete', task);
  },
  onTaskFailed: (task) => {
    mainWin?.webContents.send('background-task:failed', task);
    floatingBallWin?.webContents.send('background-task:failed', task);
  }
});


function initializeAgent() {
  logger.debug('[Main] Initializing agents...');

  const apiKey = configStore.getApiKey() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('[Main] No API key found - Please configure in settings');
    return;
  }

  // 获取所有可用的窗口
  const windows = [];
  if (mainWin && !mainWin.isDestroyed()) {
    windows.push(mainWin);
  }
  if (floatingBallWin && !floatingBallWin.isDestroyed()) {
    windows.push(floatingBallWin);
  }

  if (windows.length === 0) {
    logger.error('[Main] No windows available for agent initialization');
    return;
  }

  // ⚠️ 恢复默认行为：主窗口使用普通会话
  // 尝试恢复上次的会话，或保持无会话状态
  let sessionId = sessionStore.getSessionId(false); // 主窗口的会话

  if (sessionId) {
    // 如果有上次的会话，恢复它
    logger.debug(`Restored session: ${sessionId}`);

    // 设置为主窗口的当前会话
    sessionStore.setSessionId(sessionId, false);

    // 获取或创建 Agent
    const agent = agentManager.getOrCreateAgent(sessionId, windows);

    // 如果会话有历史消息，加载到 Agent
    const session = sessionStore.getSession(sessionId);
    if (session && session.messages && session.messages.length > 0) {
      logger.debug(`Loading history for session ${sessionId}: ${session.messages.length} messages`);
      agent.loadHistory(session.messages, sessionId);

      // 通知前端加载历史
      mainWin?.webContents.send('session:current-changed', {
        sessionId,
        isRunning: false
      });
    } else {
      // 空会话，通知前端（但不阻止用户发送消息）
      mainWin?.webContents.send('session:current-changed', {
        sessionId,
        isRunning: false
      });
    }
  } else {
    // 没有上次会话，不创建新会话，等待用户发送第一条消息
    logger.debug(`No previous session, waiting for first message`);
    // 通知前端当前无会话
    mainWin?.webContents.send('session:current-changed', {
      sessionId: null,
      isRunning: false
    });
  }

  logger.info('[Main] Agent initialization complete (Cowork mode)');
}

function createTray() {
  try {
    logger.debug('Creating system tray...')

    // Use file path instead of base64 buffer to avoid "Failed to create tray icon from buffer" error
    const iconPath = getIconPath();
    logger.debug('Using tray icon path:', iconPath);
    tray = new Tray(iconPath);
    logger.debug('System tray created successfully');

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
          if (floatingBallWin?.isVisible()) {
            floatingBallWin?.hide();
          } else {
            floatingBallWin?.show();
          }
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

    logger.debug('Tray menu and click handlers configured')

  } catch (e) {
    logger.error('Failed to create system tray:', e)
  }
}

function createMainWindow() {
  const iconPath = getIconPath()
  logger.debug('Main window icon path:', iconPath)
  logger.debug('Icon exists:', fs.existsSync(iconPath))

  // Load icon as nativeImage for better Windows taskbar support
  let iconImage = undefined
  try {
    iconImage = nativeImage.createFromPath(iconPath)
    if (iconImage.isEmpty()) {
      logger.warn('Icon image is empty, falling back to default')
      iconImage = undefined
    }
  } catch (e) {
    logger.error('Failed to load icon:', e)
  }

  // Mac-specific configuration
  const isMac = process.platform === 'darwin'

  mainWin = new BrowserWindow({
    width: 480,
    height: 720,
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
      }
    })

    logger.debug('[Mac] Application menu configured')
  } else {
    // Windows/Linux: No menu bar
    mainWin.setMenu(null)
    logger.debug('[Windows/Linux] Menu bar removed')
  }

  mainWin.once('ready-to-show', () => {
    logger.info('Main window ready.')
  })

  // Handle external links
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
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

  // Clean up window references when window is actually closed (not just hidden)
  mainWin.once('closed', () => {
    logger.debug('[Main] Main window closed, cleaning up references');
    if (mainWin) {
      cleanupWindowFromAgents(mainWin);
      mainWin = null;
    }
  })

  mainWin.webContents.on('did-finish-load', () => {
    mainWin?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    mainWin.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWin.loadFile(path.join(RENDERER_DIST, 'index.html'))
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
    floatingBallWin.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: 'floating-ball' })
  }

  floatingBallWin.on('closed', () => {
    logger.debug('[Main] Floating ball window closed, cleaning up references');
    if (floatingBallWin) {
      cleanupWindowFromAgents(floatingBallWin);
      floatingBallWin = null
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

// ============================================================
// Memory IPC Handlers
// ============================================================

ipcMain.handle('memory:list-files', async () => {
  const { AutoMemoryManager } = await import('./memory/AutoMemoryManager')
  const memoryManager = new AutoMemoryManager()
  return await memoryManager.listMemoryFiles('all')
})

ipcMain.handle('memory:read', async (_event, memoryPath: string) => {
  const { AutoMemoryManager } = await import('./memory/AutoMemoryManager')
  const memoryManager = new AutoMemoryManager()
  return await memoryManager.readMemory(memoryPath)
})

ipcMain.handle('memory:write', async (_event, { path, content }: { path: string, content: string }) => {
  const { AutoMemoryManager } = await import('./memory/AutoMemoryManager')
  const memoryManager = new AutoMemoryManager()
  await memoryManager.writeMemory(path, content)
  return { success: true }
})

ipcMain.handle('memory:delete', async (_event, memoryPath: string) => {
  const { AutoMemoryManager } = await import('./memory/AutoMemoryManager')
  const memoryManager = new AutoMemoryManager()
  await memoryManager.deleteMemory(memoryPath)
  return { success: true }
})

// ============================================================
// Memory Assistant Mode Switching
// ============================================================

// Switch to Memory Assistant mode
ipcMain.handle('session:switch-to-memory-assistant', async () => {
  try {
    logger.debug('[Main] Switching to Memory Assistant mode...');

    const apiKey = configStore.getApiKey() || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('No API key configured');
    }

    // Get available windows
    const windows: Electron.BrowserWindow[] = [];
    if (mainWin && !mainWin.isDestroyed()) {
      windows.push(mainWin);
    }

    if (windows.length === 0) {
      throw new Error('No windows available');
    }

    // Save current session ID
    const currentSessionId = sessionStore.getSessionId(false);
    if (currentSessionId && currentSessionId !== MEMORY_ASSISTANT_SESSION_ID) {
      previousSessionId = currentSessionId;
      logger.debug(`Saved previous session: ${previousSessionId}`);
    }

    // Switch to memory assistant session
    sessionStore.setSessionId(MEMORY_ASSISTANT_SESSION_ID, false);

    // ⚠️ 关键修复：使用 getMemoryAssistantAgent 确保正确初始化
    // 这会确保 Agent 已初始化（Skills、MCP）、设置系统提示、授权路径
    const agent = await getMemoryAssistantAgent();

    // Notify frontend of mode switch
    mainWin?.webContents.send('session:current-changed', {
      sessionId: MEMORY_ASSISTANT_SESSION_ID,
      isRunning: agent.isProcessingMessage(),
      mode: 'memory-assistant'
    });

    logger.info('[Main] Switched to Memory Assistant mode');
    return { success: true, sessionId: MEMORY_ASSISTANT_SESSION_ID };
  } catch (error: any) {
    logger.error('[Main] Failed to switch to Memory Assistant mode:', error);
    return { success: false, error: error.message };
  }
});

// Switch back to Cowork mode
ipcMain.handle('session:switch-to-cowork', async () => {
  try {
    logger.debug('[Main] Switching back to Cowork mode...');

    // Get available windows
    const windows: Electron.BrowserWindow[] = [];
    if (mainWin && !mainWin.isDestroyed()) {
      windows.push(mainWin);
    }

    if (windows.length === 0) {
      throw new Error('No windows available');
    }

    // Determine which session to restore
    let targetSessionId = previousSessionId;

    if (!targetSessionId) {
      // No previous session, check if there are any sessions
      const sessions = sessionStore.getSessions();
      if (sessions.length > 0) {
        // Use the most recent session
        targetSessionId = sessions[0].id;
      }
    }

    if (targetSessionId) {
      // Restore the previous or most recent session
      sessionStore.setSessionId(targetSessionId, false);

      const agent = agentManager.getOrCreateAgent(targetSessionId, windows);

      // Load history if exists
      const session = sessionStore.getSession(targetSessionId);
      if (session && session.messages && session.messages.length > 0) {
        logger.debug(`Loading history for session ${targetSessionId}: ${session.messages.length} messages`);
        agent.loadHistory(session.messages, targetSessionId);
      }

      mainWin?.webContents.send('session:current-changed', {
        sessionId: targetSessionId,
        isRunning: agent.isProcessingMessage(),
        mode: 'cowork'
      });

      logger.debug(`✅ Restored session: ${targetSessionId}`);
    } else {
      // No sessions exist, clear current session
      sessionStore.setSessionId('', false);
      previousSessionId = null;

      mainWin?.webContents.send('session:current-changed', {
        sessionId: null,
        isRunning: false,
        mode: 'cowork'
      });

      logger.info('[Main] Cleared session (Cowork mode)');
    }

    return { success: true };
  } catch (error: any) {
    logger.error('[Main] Failed to switch to Cowork mode:', error);
    return { success: false, error: error.message };
  }
});

// List all sessions for analysis
ipcMain.handle('memory:list-sessions', async () => {
  try {
    const sessions = sessionStore.getSessions();
    return sessions.map(session => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messageCount,
      preview: session.preview
    }));
  } catch (error) {
    logger.error('Failed to list sessions:', error);
    return [];
  }
});

// Get session messages for analysis
ipcMain.handle('memory:get-session-messages', async (_event, sessionId: string) => {
  try {
    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return { error: 'Session not found' };
    }

    return {
      sessionId: session.id,
      title: session.title,
      messages: session.messages,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    };
  } catch (error) {
    logger.error('Failed to get session messages:', error);
    return { error: (error as Error).message };
  }
});

// Analyze sessions and extract memories
ipcMain.handle('memory:analyze-sessions', async (_event, options: { sessionIds?: string[], autoSave?: boolean }) => {
  try {
    const { sessionIds, autoSave = false } = options;

    // Get sessions to analyze
    const sessionsToAnalyze = sessionIds || sessionStore.getSessions().map(s => s.id);

    const analysis: {
      totalSessions: number;
      totalMessages: number;
      memories: Array<{
        type: 'decision' | 'knowledge' | 'preference' | 'progress';
        sessionId: string;
        sessionTitle: string;
        content: string;
        timestamp: number;
      }>;
    } = {
      totalSessions: 0,
      totalMessages: 0,
      memories: []
    };

    const { AutoMemoryManager } = await import('./memory/AutoMemoryManager');
    const memoryManager = new AutoMemoryManager();

    for (const sessionId of sessionsToAnalyze) {
      const session = sessionStore.getSession(sessionId);
      if (!session || !session.messages || session.messages.length === 0) continue;

      analysis.totalSessions++;
      analysis.totalMessages += session.messages.length;

      // Analyze messages for important information
      for (const msg of session.messages) {
        if (msg.role !== 'user') continue;

        const content = typeof msg.content === 'string' ? msg.content :
          msg.content.filter(b => b.type === 'text').map(b => (b as any).text).join('\n');

        // Detect decisions
        if (/(?:决定|选择|decided|choose|使用|use|采用|adopt)/i.test(content)) {
          const memory = {
            type: 'decision' as const,
            sessionId,
            sessionTitle: session.title,
            content: content.substring(0, 200),
            timestamp: session.updatedAt
          };
          analysis.memories.push(memory);

          // Auto-save if enabled
          if (autoSave) {
            await memoryManager.writeMemory(
              `/memories/decisions/${sessionId}_${Date.now()}.md`,
              `## Decision from: ${session.title}\n\n${content}\n\n**Session**: ${sessionId}\n**Date**: ${new Date(memory.timestamp).toLocaleString()}\n`
            );
          }
        }

        // Detect knowledge
        if (/(?:学到了|learned|发现|found|理解|understand)/i.test(content)) {
          const memory = {
            type: 'knowledge' as const,
            sessionId,
            sessionTitle: session.title,
            content: content.substring(0, 200),
            timestamp: session.updatedAt
          };
          analysis.memories.push(memory);

          if (autoSave) {
            await memoryManager.writeMemory(
              `/memories/knowledge/${sessionId}_${Date.now()}.md`,
              `## Knowledge from: ${session.title}\n\n${content}\n\n**Session**: ${sessionId}\n**Date**: ${new Date(memory.timestamp).toLocaleString()}\n`
            );
          }
        }

        // Detect preferences
        if (/(?:我喜欢|我偏好|i prefer|i like|习惯|habit|风格|style)/i.test(content)) {
          const memory = {
            type: 'preference' as const,
            sessionId,
            sessionTitle: session.title,
            content: content.substring(0, 200),
            timestamp: session.updatedAt
          };
          analysis.memories.push(memory);

          if (autoSave) {
            await memoryManager.writeMemory(
              `/memories/preferences/${sessionId}_${Date.now()}.md`,
              `## User Preference\n\n${content}\n\n**Session**: ${sessionId}\n**Date**: ${new Date(memory.timestamp).toLocaleString()}\n`
            );
          }
        }
      }
    }

    logger.debug(`[Memory] Analyzed ${analysis.totalSessions} sessions with ${analysis.totalMessages} messages, found ${analysis.memories.length} potential memories`);

    return analysis;
  } catch (error) {
    logger.error('Failed to analyze sessions:', error);
    return { error: (error as Error).message };
  }
});

// List all memories with content
ipcMain.handle('memory:list-all-with-content', async () => {
  try {
    const { AutoMemoryManager } = await import('./memory/AutoMemoryManager')
    const memoryManager = new AutoMemoryManager()
    const fs = await import('fs/promises')

    const files = await memoryManager.listMemoryFiles('all')
    const memoriesWithContent = await Promise.all(
      files.map(async (file: any) => {
        try {
          const content = await fs.readFile(file.path, 'utf-8')
          return { ...file, content }
        } catch (err) {
          logger.error(`Failed to read memory ${file.path}:`, err)
          return { ...file, content: '' }
        }
      })
    )
    return memoriesWithContent
  } catch (error) {
    logger.error('Failed to list memories with content:', error)
    return []
  }
})

// 获取或创建记忆助手的 AgentRuntime 实例
async function getMemoryAssistantAgent() {
  // ⚠️ 关键修复：使用 hasAgent() 检查，而不是 getAgent()
  // getAgent() 在 agent 不存在时会抛出异常
  let agent: AgentRuntime | null = agentManager.hasAgent(MEMORY_ASSISTANT_SESSION_ID)
    ? agentManager.getAgent(MEMORY_ASSISTANT_SESSION_ID)
    : null;

  // 设置记忆助手专用的系统提示（在函数顶层，确保 if 和 else 都能访问）
  // ========== 动态生成实际路径（跨平台） ==========
  const sessionsDir = path.join(app.getPath('userData'), 'sessions')
  const opencoworkDir = path.join(os.homedir(), '.opencowork')
  const globalMemoryDir = path.join(opencoworkDir, 'memories')
  const projectMemoryDir = path.join(opencoworkDir, 'projects')
  const skillsDir = path.join(opencoworkDir, 'skills')

  const memorySystemPrompt = `# 智能记忆助手

你是 OpenCowork 的智能记忆管理助手，专注于帮助用户管理和提取有价值的记忆信息。

## 核心能力

### 1. 记忆查看与管理
- **查看所有记忆**：列出 ${globalMemoryDir} 和 ${projectMemoryDir} 下的所有记忆文件
- **搜索记忆**：根据关键词查找相关记忆（使用 list_dir 和 read_file）
- **分析记忆内容**：理解并总结记忆中的信息
- **创建记忆**：将有价值的信息保存到合适的记忆目录
- **更新记忆**：修改现有记忆文件的内容
- **删除记忆**：移除不再需要的记忆文件

### 2. 会话数据读取与分析
- **查看会话列表**：从 ${sessionsDir} 读取所有会话索引
- **分析会话内容**：读取会话消息文件（${sessionsDir}/messages/{session-id}.json），理解完整对话过程
- **提取有价值内容**：识别决策、知识、偏好、进度、技术方案等
- **生成洞察报告**：总结会话中的关键信息和上下文

### 3. 技能生成
- **创建 Skill**：将常见任务流程转化为可重用的 Skill
- **总结项目**：生成项目上下文和技术栈文档
- **最佳实践提取**：从会话中提取可复用的解决方案

## 完整路径访问说明（所有路径已预授权）

### 记忆存储目录（已授权）
- **${opencoworkDir}/** - 完全访问权限
  - memories/ - 全局记忆目录
  - projects/{project-id}/memories/ - 项目记忆目录
  - skills/ - 技能定义目录

### 会话数据目录（已授权，只读）
- **${sessionsDir}/** - 完全访问权限（只读，用于分析）
  - opencowork-sessions-index.json - 会话索引文件（包含所有会话的元数据）
  - messages/{session-id}.json - 单个会话的完整消息记录
  - meta/ - 会话元数据目录

### 工作目录
- **用户授权的项目文件夹** - 访问用户已授权的所有工作目录

## 实用工具操作

### 读取会话列表
\`\`\`javascript
// 读取会话目录
list_dir('${sessionsDir}')
// 或者直接读取索引文件
read_file('${sessionsDir}/opencowork-sessions-index.json')
\`\`\`

### 读取特定会话的消息
\`\`\`javascript
// 从索引中选择 session-id 后
read_file('${sessionsDir}/messages/{session-id}.json')
\`\`\`

### 读取现有记忆
\`\`\`javascript
// 列出全局记忆
list_dir('${globalMemoryDir}')
read_file('${globalMemoryDir}/decisions.md')

// 列出项目记忆
list_dir('${projectMemoryDir}')
read_file('${projectMemoryDir}/{project-id}/memories/xxx.md')
\`\`\`

### 创建记忆
\`\`\`javascript
write_file('${globalMemoryDir}/{category}/{name}.md', content)
// 或者项目记忆
write_file('${projectMemoryDir}/{project-id}/memories/{category}/{name}.md', content)
\`\`\`

### 更新记忆
\`\`\`javascript
// 1. 先读取现有内容
const existing = read_file('${globalMemoryDir}/xxx.md')
// 2. 修改内容
// 3. 写回文件
write_file('${globalMemoryDir}/xxx.md', newContent)
\`\`\`

### 删除记忆
\`\`\`javascript
delete_file('${globalMemoryDir}/xxx.md')
\`\`\`

### 创建 Skill
\`\`\`javascript
write_file('${skillsDir}/{skill-name}/README.md', skillContent)
\`\`\`

## 工作流程

当用户与你对话时：

1. **理解意图**：用户想查看、创建、分析、更新或删除什么？
2. **查看信息**：使用 read_file, list_dir 等工具读取数据
3. **分析内容**：理解信息价值，识别模式
4. **执行操作**：
   - **创建记忆**：保存到 ${globalMemoryDir} 或项目记忆目录
   - **更新记忆**：修改现有记忆文件
   - **删除记忆**：移除不需要的记忆文件
   - **生成 Skill**：保存到 ${skillsDir}/{skill-name}/README.md
5. **确认反馈**：向用户清晰说明你做了什么

## 重要提示

- **所有路径都已预授权**：上述所有路径都已在系统启动时授权，无需再请求用户授权
- **绝对路径**：始终使用上面显示的绝对路径
- **结构化**：使用清晰的 Markdown 格式
- **简洁**：只保留关键信息，便于快速检索
- **分类**：合理组织目录结构（decisions/, knowledge/, preferences/, technical/ 等）
- **命名**：使用描述性的文件名，避免特殊字符
- **避免冗余**：不要重复保存相同信息
- **会话数据只读**：只能读取会话数据进行分析，不能修改或删除会话
- **记忆可修改**：创建的记忆可以随时更新或删除

---

你是智能记忆助手，要主动发现和保存有价值的信息，帮助用户构建知识库。通过分析历史会话，理解用户的工作方式和偏好，自动生成有价值的记忆和技能。`

  if (!agent) {
    // 获取当前配置
    const config = configStore.getAll()
    const provider = config.providers[config.activeProviderId]

    if (!provider) {
      throw new Error('No API provider configured')
    }

    // 创建记忆助手专用的 Agent（通过 agentManager）
    const windows = mainWin ? [mainWin] : []

    // 使用 agentManager 创建并注册 agent
    agent = agentManager.getOrCreateAgent(MEMORY_ASSISTANT_SESSION_ID, windows)

    // ⚠️ 关键修复：初始化 Agent（加载 Skills 和 MCP）
    await agent.initialize()

    // ========== 自动授权所有必要的路径 ==========
    // 注意：路径变量已在函数顶部声明（line 2016-2020），此处直接使用

    // 使用全局 permissionManager 授权所有路径
    const { permissionManager: pm } = await import('./agent/security/PermissionManager')

    // 授权核心目录
    pm.authorizeFolder(opencoworkDir)
    pm.authorizeFolder(globalMemoryDir)
    pm.authorizeFolder(projectMemoryDir)
    pm.authorizeFolder(sessionsDir)
    pm.authorizeFolder(skillsDir)

    // 授权用户已经授权的所有工作目录（让记忆助手能访问项目文件）
    const authorizedFolders = configStore.getAll().authorizedFolders || []
    for (const folder of authorizedFolders) {
      pm.authorizeFolder(folder.path)
    }

    logger.debug('[MemoryAssistant] Authorized paths:', {
      opencoworkDir,
      globalMemoryDir,
      projectMemoryDir,
      sessionsDir,
      skillsDir,
      workingDirs: authorizedFolders.map(f => f.path)
    })

    // 设置记忆助手专用的系统提示
    // 使用上面已声明的路径变量生成系统提示
    const memorySystemPrompt = `# 智能记忆助手

你是 OpenCowork 的智能记忆管理助手，专注于帮助用户管理和提取有价值的记忆信息。

## 核心能力

### 1. 记忆查看与管理
- **查看所有记忆**：列出 ${globalMemoryDir} 和 ${projectMemoryDir} 下的所有记忆文件
- **搜索记忆**：根据关键词查找相关记忆（使用 list_dir 和 read_file）
- **分析记忆内容**：理解并总结记忆中的信息
- **创建记忆**：将有价值的信息保存到合适的记忆目录
- **更新记忆**：修改现有记忆文件的内容
- **删除记忆**：移除不再需要的记忆文件

### 2. 会话数据读取与分析
- **查看会话列表**：从 ${sessionsDir} 读取所有会话索引
- **分析会话内容**：读取会话消息文件（${sessionsDir}/messages/{session-id}.json），理解完整对话过程
- **提取有价值内容**：识别决策、知识、偏好、进度、技术方案等
- **生成洞察报告**：总结会话中的关键信息和上下文

### 3. 技能生成
- **创建 Skill**：将常见任务流程转化为可重用的 Skill
- **总结项目**：生成项目上下文和技术栈文档
- **最佳实践提取**：从会话中提取可复用的解决方案

## 完整路径访问说明（所有路径已预授权）

### 记忆存储目录（已授权）
- **${opencoworkDir}/** - 完全访问权限
  - memories/ - 全局记忆目录
  - projects/{project-id}/memories/ - 项目记忆目录
  - skills/ - 技能定义目录

### 会话数据目录（已授权，只读）
- **${sessionsDir}/** - 完全访问权限（只读，用于分析）
  - opencowork-sessions-index.json - 会话索引文件（包含所有会话的元数据）
  - messages/{session-id}.json - 单个会话的完整消息记录
  - meta/ - 会话元数据目录

### 工作目录
- **用户授权的项目文件夹** - 访问用户已授权的所有工作目录

## 实用工具操作

### 读取会话列表
\`\`\`javascript
// 读取会话目录
list_dir('${sessionsDir}')
// 或者直接读取索引文件
read_file('${sessionsDir}/opencowork-sessions-index.json')
\`\`\`

### 读取特定会话的消息
\`\`\`javascript
// 从索引中选择 session-id 后
read_file('${sessionsDir}/messages/{session-id}.json')
\`\`\`

### 读取现有记忆
\`\`\`javascript
// 列出全局记忆
list_dir('${globalMemoryDir}')
read_file('${globalMemoryDir}/decisions.md')

// 列出项目记忆
list_dir('${projectMemoryDir}')
read_file('${projectMemoryDir}/{project-id}/memories/xxx.md')
\`\`\`

### 创建记忆
\`\`\`javascript
write_file('${globalMemoryDir}/{category}/{name}.md', content)
// 或者项目记忆
write_file('${projectMemoryDir}/{project-id}/memories/{category}/{name}.md', content)
\`\`\`

### 更新记忆
\`\`\`javascript
// 1. 先读取现有内容
const existing = read_file('${globalMemoryDir}/xxx.md')
// 2. 修改内容
// 3. 写回文件
write_file('${globalMemoryDir}/xxx.md', newContent)
\`\`\`

### 删除记忆
\`\`\`javascript
delete_file('${globalMemoryDir}/xxx.md')
\`\`\`

### 创建 Skill
\`\`\`javascript
write_file('${skillsDir}/{skill-name}/README.md', skillContent)
\`\`\`

## 工作流程

当用户与你对话时：

1. **理解意图**：用户想查看、创建、分析、更新或删除什么？
2. **查看信息**：使用 read_file, list_dir 等工具读取数据
3. **分析内容**：理解信息价值，识别模式
4. **执行操作**：
   - **创建记忆**：保存到 ${globalMemoryDir} 或项目记忆目录
   - **更新记忆**：修改现有记忆文件
   - **删除记忆**：移除不需要的记忆文件
   - **生成 Skill**：保存到 ${skillsDir}/{skill-name}/README.md
5. **确认反馈**：向用户清晰说明你做了什么

## 重要提示

- **所有路径都已预授权**：上述所有路径都已在系统启动时授权，无需再请求用户授权
- **绝对路径**：始终使用上面显示的绝对路径
- **结构化**：使用清晰的 Markdown 格式
- **简洁**：只保留关键信息，便于快速检索
- **分类**：合理组织目录结构（decisions/, knowledge/, preferences/, technical/ 等）
- **命名**：使用描述性的文件名，避免特殊字符
- **避免冗余**：不要重复保存相同信息
- **会话数据只读**：只能读取会话数据进行分析，不能修改或删除会话
- **记忆可修改**：创建的记忆可以随时更新或删除

---

你是智能记忆助手，要主动发现和保存有价值的信息，帮助用户构建知识库。通过分析历史会话，理解用户的工作方式和偏好，自动生成有价值的记忆和技能。`

    // ⚠️ 关键修复：设置自定义系统提示（不要作为历史消息）
    agent.setSystemPrompt(memorySystemPrompt)

    // ⚠️ 加载记忆助手的历史记录（纯对话历史，不包含系统提示）
    const memoryHistory = sessionStore.getMemoryAssistantHistory()
    if (memoryHistory.length > 0) {
      agent.loadHistory(memoryHistory, MEMORY_ASSISTANT_SESSION_ID)
      logger.debug('[MemoryAssistant] Loaded history with custom system prompt, total messages:', memoryHistory.length)
      // loadHistory 会自动调用 notifyUpdate 发送事件
    } else {
      // 无历史记录，清空历史（系统提示已通过 setSystemPrompt 设置）
      agent.loadHistory([], MEMORY_ASSISTANT_SESSION_ID)
      logger.debug('[MemoryAssistant] Set custom system prompt for memory assistant (no history)')
    }

    logger.debug('[MemoryAssistant] Created new agent with custom system prompt and full access to sessions, memories, and skills')
  } else {
    // Agent 已存在，确保系统提示和历史记录正确
    // ⚠️ 确保系统提示已设置
    agent.setSystemPrompt(memorySystemPrompt)

    const existingHistory = (agent as any).history || []
    if (existingHistory.length === 0) {
      // 历史为空，加载保存的历史
      const memoryHistory = sessionStore.getMemoryAssistantHistory()
      if (memoryHistory.length > 0) {
        agent.loadHistory(memoryHistory, MEMORY_ASSISTANT_SESSION_ID)
        logger.debug('[MemoryAssistant] Loaded history for existing agent with custom system prompt, total messages:', memoryHistory.length)
        // loadHistory 会自动调用 notifyUpdate 发送事件
      }
    } else {
      logger.debug('[MemoryAssistant] Existing agent already has history and custom system prompt')
    }
  }

  return agent
}

// Process user input with memory assistant (using AI Agent)
ipcMain.handle('memory:assistant-process', async (_event, userInput: string) => {
  try {
    const agent = await getMemoryAssistantAgent()

    // 使用 Agent 处理用户消息
    await agent.processUserMessage(userInput)

    // 获取最新的历史记录
    const history = (agent as any).history as Anthropic.MessageParam[]
    const lastMessage = history[history.length - 1]

    let response = {
      message: '',
      memoryCreated: false,
      memoryContent: '',
      memoryPath: '',
      memoryName: '',
      memoryType: 'global' as 'global' | 'project',
      memorySize: 0
    }

    if (lastMessage && lastMessage.role === 'assistant') {
      // 提取文本内容
      const content = lastMessage.content
      if (typeof content === 'string') {
        response.message = content
      } else if (Array.isArray(content)) {
        // 过滤掉 thinking 和 tool_use，只保留 text
        const textBlocks = content.filter((block: any) => block.type === 'text')
        response.message = textBlocks.map((block: any) => block.text).join('\n')
      }
    }

    // 检查是否创建了新记忆（通过检查工具调用）
    const toolUses = Array.isArray(lastMessage?.content)
      ? lastMessage.content.filter((b: any) => b.type === 'tool_use' && b.name === 'write_file')
      : []

    if (toolUses.length > 0) {
      response.memoryCreated = true
    }

    return response
  } catch (error: any) {
    logger.error('Memory assistant error:', error)
    return {
      message: `❌ 处理失败：${error.message || '未知错误'}`,
      memoryCreated: false
    }
  }
})

// ============================================================
// File Canvas / File Tracker IPC Handlers
// ============================================================

// 全局文件追踪器实例
const fileTrackerInstances = new Map<string, any>()
// 全局文件监听器实例
const fileWatcherInstances = new Map<string, any>()

// 获取或创建文件追踪器
async function getFileTracker(sessionId: string, basePath: string) {
  if (!fileTrackerInstances.has(sessionId)) {
    const { FileChangeTracker } = await import('./services/FileChangeTracker')
    const tracker = new FileChangeTracker(basePath)
    fileTrackerInstances.set(sessionId, tracker)
    logger.debug(`[FileCanvas] Created tracker for session: ${sessionId}`)
  }
  return fileTrackerInstances.get(sessionId)
}

ipcMain.on('file:record-change', async (_event, data: { filePath: string; sessionId: string; toolUseId?: string }) => {
  const { filePath, sessionId, toolUseId } = data
  try {
    // ⚠️ 修复：使用工作目录作为 basePath，而不是文件目录
    const agentManager = (global as any).agentManager
    let basePath = path.dirname(filePath)

    // 尝试从 agentManager 获取工作目录
    if (agentManager) {
      const session = agentManager.getSession(sessionId)
      if (session && session.workingDir) {
        basePath = session.workingDir
      }
    }

    // 获取或创建 tracker 实例
    let tracker = fileTrackerInstances.get(sessionId)
    if (!tracker) {
      const { FileChangeTracker } = await import('./services/FileChangeTracker')
      tracker = new FileChangeTracker(basePath)
      fileTrackerInstances.set(sessionId, tracker)
      logger.debug(`Created FileTracker for session ${sessionId} with basePath: ${basePath}`)
    }

    // 获取或创建 watcher 实例
    let watcher = fileWatcherInstances.get(sessionId)
    if (!watcher) {
      const { FileWatcher } = await import('./services/FileWatcher')
      watcher = new FileWatcher(tracker)

      // ⚠️ 关键修复：在保存 watcher 实例之前，先设置事件监听器
      watcher.on('change', (change: any) => {
        logger.debug(`[FileWatcher] Emitted change event for session ${sessionId}:`, change.path, change.type)
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('file:changed', {
            sessionId,
            change
          })
        })
      })

      // 保存 watcher 实例
      fileWatcherInstances.set(sessionId, watcher)
      logger.debug(`Created new FileWatcher for session: ${sessionId}`)
    }

    // 确保会话已启动
    tracker.startSession(sessionId, basePath)

    // 记录文件变更
    await watcher.recordManualWrite(filePath, sessionId, undefined, toolUseId)
    logger.debug(`✅ Recorded file change: ${filePath} for session ${sessionId}`)
  } catch (error) {
    logger.error(`❌ Failed to record file change:`, error)
  }
})

// 开始文件追踪
ipcMain.handle('file:watch', async (_event, sessionId: string, basePath: string) => {
  try {
    const tracker = await getFileTracker(sessionId, basePath)
    const { FileWatcher } = await import('./services/FileWatcher')
    const watcher = new FileWatcher(tracker)

    // 监听文件变更事件，发送到渲染进程
    watcher.on('change', (change: any) => {
      // 发送到所有窗口
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('file:changed', {
          sessionId,
          change
        })
      })
    })

    watcher.watch({ basePath, sessionId })

    // 保存 watcher 实例
    fileWatcherInstances.set(sessionId, watcher)

    return { success: true }
  } catch (error: any) {
    logger.error('Failed to start file watching:', error)
    return { success: false, error: error.message }
  }
})

// 停止文件追踪
ipcMain.handle('file:unwatch', async (_event, sessionId: string) => {
  try {
    // 清理 watcher 实例
    const watcher = fileWatcherInstances.get(sessionId)
    if (watcher) {
      watcher.unwatchAll()
      watcher.removeAllListeners()
      fileWatcherInstances.delete(sessionId)
    }

    // 清理 tracker 实例
    const tracker = fileTrackerInstances.get(sessionId)
    if (tracker) {
      tracker.endSession(sessionId)
    }

    return { success: true }
  } catch (error: any) {
    logger.error('Failed to stop file watching:', error)
    return { success: false, error: error.message }
  }
})

// 获取文件变更列表
ipcMain.handle('file:getChanges', async (_event, sessionId: string) => {
  try {
    const tracker = fileTrackerInstances.get(sessionId)
    if (!tracker) {
      return []
    }
    return tracker.getSessionChanges(sessionId)
  } catch (error: any) {
    logger.error('Failed to get file changes:', error)
    return []
  }
})

// 获取文件统计
ipcMain.handle('file:getStats', async (_event, sessionId: string) => {
  try {
    const tracker = fileTrackerInstances.get(sessionId)
    if (!tracker) {
      return {
        totalFiles: 0,
        createdFiles: 0,
        modifiedFiles: 0,
        deletedFiles: 0,
        totalSize: 0
      }
    }
    return tracker.getStatistics(sessionId)
  } catch (error: any) {
    logger.error('Failed to get file statistics:', error)
    return null
  }
})

// 获取文件差异
ipcMain.handle('file:getDiff', async (_event, filePath: string, fromId?: string, toId?: string) => {
  try {
    // 找到对应的追踪器
    let tracker = null
    for (const [_sessionId, instance] of fileTrackerInstances) {
      const changes = instance.getChanges(filePath)
      if (changes.length > 0) {
        tracker = instance
        break
      }
    }

    if (!tracker) {
      return null
    }

    return await tracker.generateDiff(filePath, fromId, toId)
  } catch (error: any) {
    logger.error('Failed to get file diff:', error)
    return null
  }
})

// 读取文件内容（支持文本和二进制）
ipcMain.handle('file:read', async (_event, filePath: string) => {
  try {
    const fs = await import('fs/promises')

    // 检查文件是否为图片或 PDF
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp'].includes(ext)
    const isPDF = ext === 'pdf'
    const isBinary = isImage || isPDF

    if (isBinary) {
      // 对于二进制文件，返回 base64
      const buffer = await fs.readFile(filePath)
      const base64 = buffer.toString('base64')
      return { success: true, content: base64, isBinary: true }
    } else {
      // 对于文本文件，直接返回字符串
      const content = await fs.readFile(filePath, 'utf-8')
      return { success: true, content, isBinary: false }
    }
  } catch (error: any) {
    logger.error('Failed to read file:', error)
    return { success: false, error: error.message }
  }
})

// 获取文件 URL（用于 iframe 显示 PDF 等）
ipcMain.handle('file:getUrl', async (_event, filePath: string) => {
  try {
    // 将文件路径转换为 file:// 协议的 URL
    const fileUrl = `file://${filePath.replace(/\\/g, '/')}`
    return { success: true, url: fileUrl }
  } catch (error: any) {
    logger.error('Failed to get file URL:', error)
    return { success: false, error: error.message }
  }
})

// 获取路径类型（文件或目录）
ipcMain.handle('file:get-type', async (_event, filePath: string) => {
  try {
    const fs = await import('fs/promises')
    const stats = await fs.stat(filePath)
    return {
      success: true,
      type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : null
    }
  } catch (error: any) {
    logger.error('Failed to get path type:', error)
    return { success: false, type: null, error: error.message }
  }
})

// 获取目录树（懒加载：只读取第一层）
ipcMain.handle('file:getTree', async (_event, dirPath: string) => {
  try {
    const fs = await import('fs/promises')
    const path = await import('path')

    const stats = await fs.stat(dirPath)

    if (!stats.isDirectory()) {
      return { success: false, error: 'Not a directory' }
    }

    const name = path.basename(dirPath)
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const children = []

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const childPath = path.join(dirPath, entry.name)

      try {
        const childStats = await fs.stat(childPath)

        if (childStats.isDirectory()) {
          // 目录：只添加基本信息，children 为 null 表示未加载
          children.push({
            id: childPath,
            name: entry.name,
            path: childPath,
            type: 'directory',
            children: null  // ⚠️ null 表示未加载，[] 表示空目录
          })
        } else {
          // 文件：添加完整信息
          children.push({
            id: childPath,
            name: entry.name,
            path: childPath,
            type: 'file',
            extension: path.extname(childPath).slice(1),
            size: childStats.size,
            modified: childStats.mtime
          })
        }
      } catch (error) {
        // 跳过无权访问的文件
      }
    }

    const tree = {
      id: dirPath,
      name,
      path: dirPath,
      type: 'directory' as const,
      children: children.sort((a, b) => {
        // 目录排在前面
        if (a.type === 'directory' && b.type === 'file') return -1
        if (a.type === 'file' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })
    }

    return { success: true, tree }
  } catch (error: any) {
    logger.error('Failed to get directory tree:', error)
    return { success: false, error: error.message }
  }
})

// 懒加载：获取目录的子节点
ipcMain.handle('file:getDirectoryChildren', async (_event, dirPath: string) => {
  try {
    const fs = await import('fs/promises')
    const path = await import('path')

    const stats = await fs.stat(dirPath)

    if (!stats.isDirectory()) {
      return { success: false, error: 'Not a directory' }
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const children = []

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const childPath = path.join(dirPath, entry.name)

      try {
        const childStats = await fs.stat(childPath)

        if (childStats.isDirectory()) {
          children.push({
            id: childPath,
            name: entry.name,
            path: childPath,
            type: 'directory',
            children: null
          })
        } else {
          children.push({
            id: childPath,
            name: entry.name,
            path: childPath,
            type: 'file',
            extension: path.extname(childPath).slice(1),
            size: childStats.size,
            modified: childStats.mtime
          })
        }
      } catch (error) {
        // 跳过无权访问的文件
      }
    }

    return {
      success: true,
      children: children.sort((a, b) => {
        if (a.type === 'directory' && b.type === 'file') return -1
        if (a.type === 'file' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })
    }
  } catch (error: any) {
    logger.error('Failed to get directory children:', error)
    return { success: false, error: error.message }
  }
})

// 手动记录文件变更（用于 Agent 工具操作）
ipcMain.handle('file:recordChange', async (_event, filePath: string, sessionId: string, messageId?: string) => {
  try {
    const tracker = await getFileTracker(sessionId, path.dirname(filePath))
    const { FileWatcher } = await import('./services/FileWatcher')

    // 获取或创建 watcher 实例
    let watcher = fileWatcherInstances.get(sessionId)
    if (!watcher) {
      watcher = new FileWatcher(tracker)
      fileWatcherInstances.set(sessionId, watcher)

      // 监听文件变更事件
      watcher.on('change', (change: any) => {
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('file:changed', {
            sessionId,
            change
          })
        })
      })
    }

    await watcher.recordManualWrite(filePath, sessionId, messageId)
    return { success: true }
  } catch (error: any) {
    logger.error('Failed to record file change:', error)
    return { success: false, error: error.message }
  }
})

// 搜索文件
ipcMain.handle('file:search', async (_event, options: { query: string; type: 'name' | 'content'; basePath: string }) => {
  const { query, type, basePath } = options
  try {
    if (!query.trim()) {
      return []
    }

    const fs = await import('fs/promises')
    const path = await import('path')

    const results: any[] = []
    const lowerQuery = query.toLowerCase()

    // 递归搜索目录
    async function searchDirectory(dirPath: string, maxDepth = 10, currentDepth = 0) {
      if (currentDepth > maxDepth) return

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true })

        for (const entry of entries) {
          // 跳过隐藏文件和特殊目录
          if (entry.name.startsWith('.') || ['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
            continue
          }

          const fullPath = path.join(dirPath, entry.name)

          if (entry.isDirectory()) {
            // 搜索目录名
            if (type === 'name' && entry.name.toLowerCase().includes(lowerQuery)) {
              results.push({
                path: fullPath,
                name: entry.name,
                type: 'directory',
                matches: []
              })
            }

            // 递归搜索子目录
            await searchDirectory(fullPath, maxDepth, currentDepth + 1)
          } else if (entry.isFile()) {
            // 搜索文件名
            if (type === 'name' && entry.name.toLowerCase().includes(lowerQuery)) {
              results.push({
                path: fullPath,
                name: entry.name,
                type: 'file',
                matches: []
              })
            }

            // 搜索文件内容
            if (type === 'content') {
              try {
                const content = await fs.readFile(fullPath, 'utf-8')
                const lines = content.split('\n')
                const matches: any[] = []

                // 在每一行中搜索
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i]
                  if (line.toLowerCase().includes(lowerQuery)) {
                    // 生成预览（匹配点前后各30个字符）
                    const matchIndex = line.toLowerCase().indexOf(lowerQuery)
                    const start = Math.max(0, matchIndex - 30)
                    const end = Math.min(line.length, matchIndex + query.length + 30)
                    const preview = (start > 0 ? '...' : '') + line.slice(start, end) + (end < line.length ? '...' : '')

                    matches.push({
                      type: 'content',
                      line: i + 1,
                      context: line,
                      preview
                    })

                    // 限制每个文件的匹配结果数
                    if (matches.length >= 10) break
                  }
                }

                if (matches.length > 0) {
                  results.push({
                    path: fullPath,
                    name: entry.name,
                    type: 'file',
                    matches
                  })
                }
              } catch (error) {
                // 忽略无法读取的文件
              }
            }
          }
        }
      } catch (error) {
        // 忽略无法访问的目录
      }
    }

    await searchDirectory(basePath)

    // 限制结果数量
    return results.slice(0, 100)
  } catch (error: any) {
    logger.error('Failed to search files:', error)
    return []
  }
})

// 清理会话数据
ipcMain.handle('file:cleanup', async (_event, sessionId: string) => {
  try {
    // 清理 watcher 实例
    const watcher = fileWatcherInstances.get(sessionId)
    if (watcher) {
      watcher.unwatchAll()
      watcher.removeAllListeners()
      fileWatcherInstances.delete(sessionId)
    }

    // 清理 tracker 实例
    const tracker = fileTrackerInstances.get(sessionId)
    if (tracker) {
      tracker.cleanupSession(sessionId)
    }
    fileTrackerInstances.delete(sessionId)

    return { success: true }
  } catch (error: any) {
    logger.error('Failed to cleanup session:', error)
    return { success: false, error: error.message }
  }
})
