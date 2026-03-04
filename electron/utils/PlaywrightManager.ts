/**
 * Playwright 安装管理器
 * 检查、安装和管理 Playwright 及浏览器
 *
 * 安装目录固定为 ~/.qa-cowork/skills/agent-browser/
 * 首次安装完成后写入 .installed 标记文件，后续直接复用无需重复安装
 */

import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'
import { getBuiltinNodePath, getBuiltinNodeDir, getBuiltinNpmPath, getBuiltinNpmCliJsPath, getNpmEnvVars, getBuiltinPnpmPath } from './NodePath'

const execAsync = promisify(exec)

/** Chromium 安装超时时间（约 15 分钟，避免网络慢时一直卡住） */
const CHROMIUM_INSTALL_TIMEOUT_MS = 15 * 60 * 1000

/** 固定安装目录：~/.qa-cowork/skills/agent-browser/ */
const AGENT_BROWSER_SKILL_DIR = path.join(os.homedir(), '.qa-cowork', 'skills', 'agent-browser')

/** 已完成安装的标记文件（存在即表示 playwright + 浏览器均已安装完毕，跳过后续检测） */
const INSTALLED_MARKER = path.join(AGENT_BROWSER_SKILL_DIR, '.playwright-installed')

export class PlaywrightManager {
  private playwrightPath: string
  private browsersPath: string

  constructor() {
    // 统一使用 ~/.qa-cowork/skills/agent-browser/ 作为安装根目录
    this.playwrightPath = AGENT_BROWSER_SKILL_DIR
    this.browsersPath = path.join(AGENT_BROWSER_SKILL_DIR, 'browsers')
  }

  /**
   * 检查 Playwright 是否已安装
   * 支持多种可能的安装路径
   */
  async isPlaywrightInstalled(): Promise<boolean> {
    try {
      // 检查多个可能的 Playwright 安装位置
      const possiblePaths = [
        // 方式1：npm install playwright 后的标准路径
        path.join(this.playwrightPath, 'node_modules', 'playwright', 'package.json'),
        // 方式2：package 目录（旧版安装方式）
        path.join(this.playwrightPath, 'package', 'package.json'),
        // 方式3：playwright-core
        path.join(this.playwrightPath, 'node_modules', 'playwright-core', 'package.json'),
      ]
      
      return possiblePaths.some(p => fs.existsSync(p))
    } catch (error) {
      return false
    }
  }

  /**
   * 检查浏览器是否可用（优先系统 Chrome，其次 Playwright 内置 Chromium）
   */
  async isBrowserInstalled(): Promise<boolean> {
    try {
      // 优先：系统已安装 Chrome/Chromium，无需下载 Chromium
      const systemChrome = this.getSystemChromePath()
      if (systemChrome) return true

      // 兜底：检查 Playwright 管理的 Chromium
      if (!fs.existsSync(this.browsersPath)) {
        return false
      }
      const files = fs.readdirSync(this.browsersPath)
      return files.some(file => file.startsWith('chromium-'))
    } catch (error) {
      return false
    }
  }

  /**
   * 获取系统已安装的 Chrome 可执行路径
   */
  private getSystemChromePath(): string | null {
    if (process.platform === 'darwin') {
      const candidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
      for (const p of candidates) {
        if (fs.existsSync(p)) return p
      }
    } else if (process.platform === 'linux') {
      const candidates = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
      ]
      for (const p of candidates) {
        if (fs.existsSync(p)) return p
      }
    } else if (process.platform === 'win32') {
      const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ]
      for (const p of candidates) {
        if (fs.existsSync(p)) return p
      }
    }
    return null
  }

  /**
   * 获取安装状态
   */
  async getInstallStatus(): Promise<{
    playwrightInstalled: boolean
    browserInstalled: boolean
    needsInstall: boolean
  }> {
    const playwrightInstalled = await this.isPlaywrightInstalled()
    const browserInstalled = await this.isBrowserInstalled()
    
    return {
      playwrightInstalled,
      browserInstalled,
      needsInstall: !playwrightInstalled || !browserInstalled
    }
  }

  /**
   * 自动化执行前调用：若未安装则静默安装，不弹窗。安装失败时抛出。
   * 安装完成后写入 .playwright-installed 标记文件，后续直接跳过，无需重复检测。
   */
  async ensureInstalled(): Promise<void> {
    // 快速路径：标记文件存在，说明之前已安装完毕，直接复用
    if (fs.existsSync(INSTALLED_MARKER)) {
      console.log('[PlaywrightManager] Already installed (marker exists), skipping.')
      return
    }
    const status = await this.getInstallStatus()
    if (!status.needsInstall) {
      // 安装完整但还没有标记文件（老版本升级场景），补写标记
      this.writeInstalledMarker()
      return
    }
    const onProgress = (msg: string) => console.log('[PlaywrightManager]', msg)
    const result = await this.installAll(onProgress)
    if (!result.success) {
      throw new Error(result.error || 'Playwright/Chromium 安装失败')
    }
    // 安装成功，写入标记文件
    this.writeInstalledMarker()
  }

  /** 写入安装完成标记文件 */
  private writeInstalledMarker(): void {
    try {
      fs.mkdirSync(path.dirname(INSTALLED_MARKER), { recursive: true })
      fs.writeFileSync(INSTALLED_MARKER, JSON.stringify({
        installedAt: new Date().toISOString(),
        playwrightPath: this.playwrightPath,
        browsersPath: this.browsersPath,
      }, null, 2))
      console.log('[PlaywrightManager] Wrote installed marker:', INSTALLED_MARKER)
    } catch (err) {
      console.warn('[PlaywrightManager] Failed to write installed marker:', err)
    }
  }

  /**
   * 安装 Playwright
   * @param onProgress 进度回调
   */
  async installPlaywright(
    onProgress?: (message: string) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      onProgress?.('开始安装 Playwright...')

      // 确保目录存在
      if (!fs.existsSync(this.playwrightPath)) {
        fs.mkdirSync(this.playwrightPath, { recursive: true })
      }

      const nodePath = getBuiltinNodePath()
      const pnpmPath = getBuiltinPnpmPath()

      onProgress?.('正在安装 Playwright 包...')

      const packageJsonPath = path.join(this.playwrightPath, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        fs.writeFileSync(packageJsonPath, JSON.stringify({
          name: 'playwright-runtime',
          version: '1.0.0',
          description: 'Playwright runtime for automation',
          private: true
        }, null, 2))
      }

      const env: Record<string, string> = {
        ...process.env,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'
      }

      // 1) 优先使用内置 pnpm（与 CI 一致；打包后内置 npm 易出现 Class extends value undefined）
      if (pnpmPath && nodePath && nodePath !== 'node') {
        const nodeDir = getBuiltinNodeDir()
        if (nodeDir) {
          const pathSep = process.platform === 'win32' ? ';' : ':'
          env.PATH = `${nodeDir}${pathSep}${process.env.PATH || ''}`
        }
        const pnpmCommand = `"${nodePath}" "${pnpmPath}" add playwright`
        try {
          await execAsync(pnpmCommand, { cwd: this.playwrightPath, env: env as NodeJS.ProcessEnv })
        } catch (builtinErr) {
          if (app.isPackaged) {
            console.warn('[PlaywrightManager] 内置 pnpm 执行失败，改用系统 pnpm/npm:', builtinErr instanceof Error ? builtinErr.message : String(builtinErr))
            try {
              await execAsync('pnpm add playwright', { cwd: this.playwrightPath, env: env as NodeJS.ProcessEnv })
            } catch {
              await execAsync('npm install playwright --no-package-lock', { cwd: this.playwrightPath, env: env as NodeJS.ProcessEnv })
            }
          } else {
            throw builtinErr
          }
        }
      } else if (app.isPackaged) {
        // 2) 打包后若内置 pnpm 缺失（如增量更新未带全 resources），改用系统 PATH 的 pnpm/npm，避免用内置 npm 报错
        try {
          await execAsync('pnpm add playwright', { cwd: this.playwrightPath, env: env as NodeJS.ProcessEnv })
        } catch {
          await execAsync('npm install playwright --no-package-lock', { cwd: this.playwrightPath, env: env as NodeJS.ProcessEnv })
        }
      } else {
        // 3) 开发环境：内置 npm
        const npmEnv = getNpmEnvVars()
        const npmCliJsPath = getBuiltinNpmCliJsPath()
        Object.assign(env, npmEnv)
        if (npmCliJsPath && nodePath && nodePath !== 'node') {
          const npmCommand = `"${nodePath}" "${npmCliJsPath}" install playwright --no-save --no-package-lock`
          await execAsync(npmCommand, { cwd: this.playwrightPath, env: env as NodeJS.ProcessEnv })
        } else {
          const npmPath = getBuiltinNpmPath()
          const npmCommand = `"${npmPath}" install playwright --no-save --no-package-lock`
          await execAsync(npmCommand, { cwd: this.playwrightPath, env: env as NodeJS.ProcessEnv })
        }
      }

      onProgress?.('Playwright 包安装完成 ✓')
      return { success: true }
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : String(error)
      const execErr = error as { stderr?: string; stdout?: string }
      const stderr = execErr.stderr?.trim()
      const stdout = execErr.stdout?.trim()
      const errorMessage = [baseMessage, stderr, stdout].filter(Boolean).join('\n')
      console.error('安装 Playwright 失败:', errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * 执行 Chromium 安装子进程（spawn + 超时，避免 exec 的 maxBuffer 与无超时导致卡住）
   */
  private runChromiumInstall(
    nodePath: string,
    playwrightCli: string,
    env: NodeJS.ProcessEnv,
    _onProgress?: (message: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(nodePath, [playwrightCli, 'install', 'chromium'], {
        cwd: this.playwrightPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stderrChunks: string[] = []
      child.stdout?.on('data', (chunk: Buffer) => {
        const line = chunk.toString()
        if (line.trim()) console.log('[PlaywrightManager]', line.trim())
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        const line = chunk.toString()
        stderrChunks.push(line)
        if (line.trim()) console.warn('[PlaywrightManager]', line.trim())
      })

      const timeoutId = setTimeout(() => {
        if (child.kill('SIGKILL')) {
          const stderr = stderrChunks.join('').trim()
          reject(new Error(`Chromium 安装超时（${CHROMIUM_INSTALL_TIMEOUT_MS / 60000} 分钟）。请检查网络或代理后重试。${stderr ? '\n' + stderr : ''}`))
        }
      }, CHROMIUM_INSTALL_TIMEOUT_MS)

      child.on('error', (err) => {
        clearTimeout(timeoutId)
        reject(err)
      })
      child.on('close', (code, signal) => {
        clearTimeout(timeoutId)
        if (code === 0) {
          resolve()
          return
        }
        const stderr = stderrChunks.join('').trim()
        const msg = signal
          ? `安装进程被终止 (signal: ${signal})`
          : `安装进程退出码: ${code}`
        reject(new Error(`${msg}${stderr ? '\n' + stderr : ''}`))
      })
    })
  }

  /**
   * 安装浏览器
   * 如果系统已安装 Chrome/Chromium，直接跳过 Chromium 下载（优先使用系统浏览器）
   * @param onProgress 进度回调
   */
  async installBrowser(
    onProgress?: (message: string) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 优先：系统已有 Chrome，跳过 Chromium 下载
      const systemChrome = this.getSystemChromePath()
      if (systemChrome) {
        onProgress?.(`检测到系统 Chrome，跳过 Chromium 下载 ✓ (${systemChrome})`)
        return { success: true }
      }

      onProgress?.('未检测到系统 Chrome，开始下载 Chromium...')

      // 确保浏览器目录存在
      if (!fs.existsSync(this.browsersPath)) {
        fs.mkdirSync(this.browsersPath, { recursive: true })
      }

      const nodePath = getBuiltinNodePath()
      
      // 尝试多个可能的 Playwright CLI 路径
      const possibleCliPaths = [
        path.join(this.playwrightPath, 'node_modules', 'playwright', 'cli.js'),
        path.join(this.playwrightPath, 'node_modules', 'playwright-core', 'cli.js'),
        path.join(this.playwrightPath, 'node_modules', '@playwright', 'browser-chromium', 'cli.js'),
      ]
      
      let playwrightCli: string | null = null
      for (const cliPath of possibleCliPaths) {
        if (fs.existsSync(cliPath)) {
          playwrightCli = cliPath
          break
        }
      }

      if (!playwrightCli) {
        throw new Error('Playwright CLI 不存在，请先安装 Playwright')
      }

      onProgress?.('正在下载 Chromium...(可能需要几分钟)')

      // 使用 spawn 替代 exec，避免 stdout/stderr 过多导致 maxBuffer 报错或卡住
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: this.browsersPath
      }
      const nodeDir = getBuiltinNodeDir()
      if (nodeDir) {
        const pathSep = process.platform === 'win32' ? ';' : ':'
        env.PATH = `${nodeDir}${pathSep}${process.env.PATH || ''}`
      }

      await this.runChromiumInstall(nodePath, playwrightCli, env, onProgress)
      onProgress?.('Chromium 安装完成 ✓')
      return { success: true }
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : String(error)
      const execErr = error as { stderr?: string; stdout?: string }
      const stderr = execErr.stderr?.trim()
      const stdout = execErr.stdout?.trim()
      const errorMessage = [baseMessage, stderr, stdout].filter(Boolean).join('\n')
      console.error('安装浏览器失败:', errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * 一键安装 Playwright 和浏览器
   */
  async installAll(
    onProgress?: (message: string) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 检查当前状态
      const status = await this.getInstallStatus()

      if (!status.playwrightInstalled) {
        const result = await this.installPlaywright(onProgress)
        if (!result.success) {
          return result
        }
      } else {
        onProgress?.('Playwright 已安装 ✓')
      }

      if (!status.browserInstalled) {
        const result = await this.installBrowser(onProgress)
        if (!result.success) {
          return result
        }
      } else {
        onProgress?.('浏览器已安装 ✓')
      }

      onProgress?.('安装完成! 🎉')
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * 卸载 Playwright 和浏览器
   */
  async uninstall(): Promise<{ success: boolean; error?: string }> {
    try {
      if (fs.existsSync(this.playwrightPath)) {
        fs.rmSync(this.playwrightPath, { recursive: true, force: true })
      }
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  }
}
