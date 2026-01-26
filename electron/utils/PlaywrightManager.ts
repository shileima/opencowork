/**
 * Playwright 安装管理器
 * 检查、安装和管理 Playwright 及浏览器
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const execAsync = promisify(exec)

export class PlaywrightManager {
  private resourcesPath: string
  private playwrightPath: string
  private browsersPath: string

  constructor() {
    this.resourcesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(app.getAppPath(), 'resources')
    
    this.playwrightPath = path.join(this.resourcesPath, 'playwright')
    this.browsersPath = path.join(this.playwrightPath, 'browsers')
  }

  /**
   * 检查 Playwright 是否已安装
   */
  async isPlaywrightInstalled(): Promise<boolean> {
    try {
      const packagePath = path.join(this.playwrightPath, 'package', 'package.json')
      return fs.existsSync(packagePath)
    } catch (error) {
      return false
    }
  }

  /**
   * 检查浏览器是否已安装
   */
  async isBrowserInstalled(): Promise<boolean> {
    try {
      // 检查 Chromium 是否存在
      if (!fs.existsSync(this.browsersPath)) {
        return false
      }

      const files = fs.readdirSync(this.browsersPath)
      const hasChromium = files.some(file => file.startsWith('chromium-'))
      return hasChromium
    } catch (error) {
      return false
    }
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

      // 使用内置的 npm 安装 playwright
      const nodePath = this.getNodePath()
      const npmPath = this.getNpmPath()

      onProgress?.('正在安装 Playwright 包...')
      
      // 安装 playwright
      await execAsync(
        `"${nodePath}" "${npmPath}" install playwright`,
        {
          cwd: this.playwrightPath,
          env: {
            ...process.env,
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' // 先不下载浏览器
          }
        }
      )

      onProgress?.('Playwright 包安装完成 ✓')
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('安装 Playwright 失败:', errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * 安装浏览器
   * @param onProgress 进度回调
   */
  async installBrowser(
    onProgress?: (message: string) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      onProgress?.('开始安装 Chromium 浏览器...')

      const nodePath = this.getNodePath()
      const playwrightCli = path.join(
        this.playwrightPath,
        'node_modules',
        '@playwright',
        'browser-chromium',
        'cli.js'
      )

      if (!fs.existsSync(playwrightCli)) {
        throw new Error('Playwright CLI 不存在,请先安装 Playwright')
      }

      onProgress?.('正在下载 Chromium...(可能需要几分钟)')

      // 安装 Chromium
      await execAsync(
        `"${nodePath}" "${playwrightCli}" install chromium`,
        {
          cwd: this.playwrightPath,
          env: {
            ...process.env,
            PLAYWRIGHT_BROWSERS_PATH: this.browsersPath
          }
        }
      )

      onProgress?.('Chromium 安装完成 ✓')
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
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
   * 获取内置 Node.js 路径
   */
  private getNodePath(): string {
    const platform = process.platform
    const arch = process.arch

    let nodePath: string
    
    if (platform === 'win32') {
      nodePath = path.join(this.resourcesPath, 'node', `${platform}-${arch}`, 'node.exe')
    } else {
      nodePath = path.join(this.resourcesPath, 'node', `${platform}-${arch}`, 'node')
    }

    if (!fs.existsSync(nodePath)) {
      throw new Error(`内置 Node.js 不存在: ${nodePath}`)
    }

    return nodePath
  }

  /**
   * 获取内置 npm 路径
   */
  private getNpmPath(): string {
    const platform = process.platform
    const arch = process.arch

    let npmPath: string
    
    if (platform === 'win32') {
      npmPath = path.join(this.resourcesPath, 'node', `${platform}-${arch}`, 'npm.cmd')
    } else {
      npmPath = path.join(this.resourcesPath, 'node', `${platform}-${arch}`, 'npm')
    }

    if (!fs.existsSync(npmPath)) {
      throw new Error(`内置 npm 不存在: ${npmPath}`)
    }

    return npmPath
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
