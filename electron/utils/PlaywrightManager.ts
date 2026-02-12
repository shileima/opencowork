/**
 * Playwright 安装管理器
 * 检查、安装和管理 Playwright 及浏览器
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getBuiltinNodePath, getBuiltinNpmPath, getBuiltinNpmCliJsPath, getNpmEnvVars } from './NodePath'

const execAsync = promisify(exec)

export class PlaywrightManager {
  private playwrightPath: string
  private browsersPath: string

  constructor() {
    // 打包后：playwright 包在 Resources，浏览器在 userData（未签名的 Chromium 不能打入 app bundle）
    this.playwrightPath = app.isPackaged
      ? path.join(process.resourcesPath, 'playwright')
      : path.join(app.getAppPath(), 'resources', 'playwright')

    this.browsersPath = app.isPackaged
      ? path.join(app.getPath('userData'), 'playwright', 'browsers')
      : path.join(this.playwrightPath, 'browsers')
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

      const nodePath = getBuiltinNodePath()
      const npmEnv = getNpmEnvVars()
      const npmCliJsPath = getBuiltinNpmCliJsPath()

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

      // 使用 node + npm-cli.js 执行安装，避免直接调 npm 脚本时 “Could not determine Node.js install directory”
      const env: Record<string, string> = {
        ...process.env,
        ...npmEnv,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'
      }
      if (npmCliJsPath && nodePath && nodePath !== 'node') {
        const npmCommand = `"${nodePath}" "${npmCliJsPath}" install playwright --no-save --no-package-lock`
        await execAsync(npmCommand, { cwd: this.playwrightPath, env })
      } else {
        const npmPath = getBuiltinNpmPath()
        const npmCommand = `"${npmPath}" install playwright --no-save --no-package-lock`
        await execAsync(npmCommand, { cwd: this.playwrightPath, env })
      }

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

      // 确保 userData 下的 playwright 目录存在（打包后浏览器安装到此目录）
      const browsersDir = path.dirname(this.browsersPath)
      if (!fs.existsSync(browsersDir)) {
        fs.mkdirSync(browsersDir, { recursive: true })
      }

      const nodePath = getBuiltinNodePath()
      
      // 尝试多个可能的 Playwright CLI 路径
      const possibleCliPaths = [
        path.join(this.playwrightPath, 'node_modules', '@playwright', 'browser-chromium', 'cli.js'),
        path.join(this.playwrightPath, 'node_modules', 'playwright', 'cli.js'),
        path.join(this.playwrightPath, 'node_modules', 'playwright-core', 'cli.js'),
      ]
      
      let playwrightCli: string | null = null
      for (const cliPath of possibleCliPaths) {
        if (fs.existsSync(cliPath)) {
          playwrightCli = cliPath
          break
        }
      }

      if (!playwrightCli) {
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
