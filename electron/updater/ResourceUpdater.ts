/**
 * Resource Updater - 资源动态更新系统
 * 
 * 功能:
 * 1. 检测远程资源版本（包括前端、技能、MCP等所有内置资源）
 * 2. 增量下载更新的资源文件
 * 3. 热更新到用户目录，不修改应用安装包
 * 4. 应用启动时优先从热更新目录加载资源
 */

import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import AdmZip from 'adm-zip'
import { directoryManager } from '../config/DirectoryManager'

/** 单个 zip 或分卷 zip 的资产信息 */
type ResourceAssetsInfo =
  | { type: 'single'; asset: { name: string; browser_download_url: string; size: number }; totalSize: number }
  | { type: 'split'; assets: Array<{ name: string; browser_download_url: string; size: number }>; totalSize: number }

interface ResourceManifest {
  version: string
  buildTime: number
  files: Record<string, FileInfo>
}

interface FileInfo {
  hash: string
  size: number
  path: string
}

interface UpdateProgress {
  stage: 'checking' | 'downloading' | 'extracting' | 'applying' | 'completed'
  total: number
  downloaded: number
  current: string
  percentage: number
}

interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  updateSize?: number
  changelog?: string
  filesToUpdate?: number
}

export class ResourceUpdater {
  private tempDir: string
  private hotUpdateDir: string
  private manifestPath: string
  private githubRepo = 'shileima/opencowork'
  private updateCheckInterval: NodeJS.Timeout | null = null
  private githubToken: string | null = null
  private isUpdating: boolean = false // 防止并发更新
  private isChecking: boolean = false // 防止并发检查

  constructor() {
    // 尝试从环境变量读取 GitHub Token（可选）
    this.githubToken = process.env.GITHUB_TOKEN || null
    // 临时下载目录
    this.tempDir = path.join(app.getPath('userData'), 'update-temp')
    // 热更新目录（资源实际存放位置）
    this.hotUpdateDir = directoryManager.getHotUpdateDir()
    // 清单文件路径
    this.manifestPath = directoryManager.getHotUpdateManifestPath()
    this.ensureDirs()
  }

  private ensureDirs() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }
    if (!fs.existsSync(this.hotUpdateDir)) {
      fs.mkdirSync(this.hotUpdateDir, { recursive: true })
    }
  }

  /**
   * 获取当前有效版本
   * 优先返回热更新版本，否则返回应用版本
   */
  public getCurrentVersion(): string {
    const hotUpdateVersion = directoryManager.getHotUpdateVersion()
    const appVersion = app.getVersion()
    const effectiveVersion = hotUpdateVersion || appVersion
    console.log(`[ResourceUpdater] getCurrentVersion: hotUpdate=${hotUpdateVersion}, app=${appVersion}, effective=${effectiveVersion}`)
    return effectiveVersion
  }

  /**
   * 检查资源更新
   */
  async checkForUpdates(): Promise<UpdateCheckResult> {
    // 防止并发检查
    if (this.isChecking) {
      console.log('[ResourceUpdater] Check already in progress, skipping...')
      // 返回一个标记，表示正在检查中
      return {
        hasUpdate: false,
        currentVersion: this.getCurrentVersion(),
        latestVersion: this.getCurrentVersion(),
        filesToUpdate: 0
      }
    }

    this.isChecking = true
    
    try {
      console.log('[ResourceUpdater] Checking for resource updates...')

      const currentVersion = this.getCurrentVersion()
      const localManifest = this.loadLocalManifest()
      
      console.log(`[ResourceUpdater] Current version: ${currentVersion}`)
      console.log(`[ResourceUpdater] Local manifest: ${localManifest ? `found (version ${localManifest.version}, ${Object.keys(localManifest.files).length} files)` : 'not found (using built-in resources)'}`)

      // 从 GitHub Releases 获取最新版本的资源清单
      const latestRelease = await this.fetchLatestRelease()
      
      if (!latestRelease) {
        console.warn('[ResourceUpdater] Failed to fetch latest release (may be rate limited or network issue)')
        return {
          hasUpdate: false,
          currentVersion,
          latestVersion: currentVersion
        }
      }

      const latestVersion = latestRelease.tag_name.replace(/^v/, '')
      console.log(`[ResourceUpdater] Latest release version: ${latestVersion}`)
      
      // 版本对比：如果远程版本更旧，直接返回无更新
      const versionCompare = this.compareVersions(latestVersion, currentVersion)
      if (versionCompare < 0) {
        console.log(`[ResourceUpdater] Remote version (${latestVersion}) is older than current (${currentVersion})`)
        return {
          hasUpdate: false,
          currentVersion,
          latestVersion
        }
      }

      // 下载远程清单（即使版本相同，也要检查文件是否有变化）
      const remoteManifest = await this.fetchRemoteManifest(latestRelease)
      
      if (!remoteManifest) {
        console.warn('[ResourceUpdater] Failed to fetch remote manifest')
        return {
          hasUpdate: false,
          currentVersion,
          latestVersion
        }
      }

      console.log(`[ResourceUpdater] Remote manifest: version ${remoteManifest.version}, ${Object.keys(remoteManifest.files).length} files`)

      // 如果远程版本更新，肯定有更新
      if (versionCompare > 0) {
        const filesToUpdate = this.calculateUpdateFiles(localManifest, remoteManifest)
        const updateSize = filesToUpdate.reduce((sum, file) => sum + file.size, 0)
        
        console.log(`[ResourceUpdater] Found newer version: ${latestVersion} > ${currentVersion}`)
        console.log(`[ResourceUpdater] Found ${filesToUpdate.length} files to update (${this.formatBytes(updateSize)})`)
        
        if (filesToUpdate.length === 0) {
          console.warn(`[ResourceUpdater] WARNING: Newer version detected but no files to update. This may indicate a manifest issue.`)
        }

        const hasUpdate = filesToUpdate.length > 0
        console.log(`[ResourceUpdater] Check result: hasUpdate=${hasUpdate}, current=${currentVersion}, latest=${latestVersion}, files=${filesToUpdate.length}`)

        return {
          hasUpdate,
          currentVersion,
          latestVersion,
          updateSize,
          changelog: latestRelease.body,
          filesToUpdate: filesToUpdate.length
        }
      }

      // 版本相同，检查文件是否有变化
      const filesToUpdate = this.calculateUpdateFiles(localManifest, remoteManifest)
      const updateSize = filesToUpdate.reduce((sum, file) => sum + file.size, 0)

      if (filesToUpdate.length > 0) {
        console.log(`[ResourceUpdater] Same version (${currentVersion}) but files changed: ${filesToUpdate.length} files need update`)
        console.log(`[ResourceUpdater] Update size: ${this.formatBytes(updateSize)}`)
      } else {
        console.log(`[ResourceUpdater] Already on latest version (${currentVersion}) with no file changes`)
        console.log(`[ResourceUpdater] Local manifest has ${localManifest ? Object.keys(localManifest.files).length : 0} files, remote has ${Object.keys(remoteManifest.files).length} files`)
        console.log(`[ResourceUpdater] All file hashes match - no update needed`)
      }

      const hasUpdate = filesToUpdate.length > 0
      console.log(`[ResourceUpdater] Check result: hasUpdate=${hasUpdate}, current=${currentVersion}, latest=${latestVersion}, files=${filesToUpdate.length}`)
      
      return {
        hasUpdate,
        currentVersion,
        latestVersion,
        updateSize: hasUpdate ? updateSize : undefined,
        changelog: latestRelease.body,
        filesToUpdate: filesToUpdate.length
      }
    } catch (error) {
      console.error('[ResourceUpdater] Check for updates failed:', error)
      throw error
    } finally {
      this.isChecking = false
    }
  }

  /**
   * 执行资源更新
   */
  async performUpdate(
    onProgress?: (progress: UpdateProgress) => void
  ): Promise<boolean> {
    // 防止并发更新
    if (this.isUpdating) {
      console.warn('[ResourceUpdater] Update already in progress, skipping...')
      throw new Error('Update already in progress')
    }

    this.isUpdating = true
    
    try {
      console.log('[ResourceUpdater] Starting resource update...')

      // 阶段1: 检查
      onProgress?.({
        stage: 'checking',
        total: 100,
        downloaded: 0,
        current: 'Fetching release info...',
        percentage: 0
      })

      const latestRelease = await this.fetchLatestRelease()
      if (!latestRelease) {
        throw new Error('Failed to fetch latest release')
      }

      const remoteManifest = await this.fetchRemoteManifest(latestRelease)
      if (!remoteManifest) {
        throw new Error('Failed to fetch remote manifest')
      }

      const localManifest = this.loadLocalManifest()
      const filesToUpdate = this.calculateUpdateFiles(localManifest, remoteManifest)

      if (filesToUpdate.length === 0) {
        console.log('[ResourceUpdater] No files to update')
        onProgress?.({
          stage: 'completed',
          total: 100,
          downloaded: 100,
          current: 'Already up to date',
          percentage: 100
        })
        return true
      }

      // 阶段2: 下载
      onProgress?.({
        stage: 'downloading',
        total: 100,
        downloaded: 0,
        current: 'Downloading resource package...',
        percentage: 10
      })

      // 下载资源包
      const downloadDir = path.join(this.tempDir, 'download', remoteManifest.version)
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true })
      }

      // 下载并解压资源包
      await this.downloadAndExtractResources(
        latestRelease,
        filesToUpdate,
        downloadDir,
        (downloadProgress) => {
          // 下载阶段：10% - 70%
          if (downloadProgress.current.includes('Downloading:')) {
            onProgress?.({
              stage: 'downloading',
              total: downloadProgress.total,
              downloaded: downloadProgress.downloaded,
              current: downloadProgress.current,
              percentage: 10 + (downloadProgress.downloaded / downloadProgress.total) * 60
            })
          } else {
            // 解压阶段：70% - 90%
            onProgress?.({
              stage: 'extracting',
              total: downloadProgress.total,
              downloaded: downloadProgress.downloaded,
              current: downloadProgress.current,
              percentage: 70 + (downloadProgress.downloaded / downloadProgress.total) * 20
            })
          }
        }
      )

      // 阶段3: 应用更新到热更新目录
      onProgress?.({
        stage: 'applying',
        total: filesToUpdate.length,
        downloaded: 0,
        current: 'Applying updates...',
        percentage: 70
      })

      await this.applyUpdate(downloadDir, remoteManifest, (applyProgress) => {
        onProgress?.({
          stage: 'applying',
          total: applyProgress.total,
          downloaded: applyProgress.downloaded,
          current: applyProgress.current,
          percentage: 70 + (applyProgress.downloaded / applyProgress.total) * 25
        })
      })

      // 保存新的清单
      this.saveManifest(remoteManifest)

      // 阶段4: 完成
      onProgress?.({
        stage: 'completed',
        total: 100,
        downloaded: 100,
        current: 'Update completed!',
        percentage: 100
      })

      console.log('[ResourceUpdater] Resource update completed successfully')
      console.log(`[ResourceUpdater] New version: ${remoteManifest.version}`)
      return true
    } catch (error) {
      console.error('[ResourceUpdater] Update failed:', error)
      throw error
    } finally {
      this.isUpdating = false
    }
  }

  /**
   * 自动检查更新(定时)
   * 如果遇到速率限制，会自动延长检查间隔
   */
  startAutoUpdateCheck(intervalHours: number = 24, onUpdateFound?: (updateInfo: UpdateCheckResult) => void) {
    // 清除旧的定时器
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval)
    }

    let consecutiveFailures = 0
    const maxFailures = 3

    const checkAndNotify = async () => {
      try {
        console.log('[ResourceUpdater] Auto check triggered')
        const result = await this.checkForUpdates()
        
        console.log(`[ResourceUpdater] Auto check result: hasUpdate=${result.hasUpdate}, onUpdateFound=${!!onUpdateFound}`)
        
        // 如果检查成功，重置失败计数
        if (result.currentVersion && result.latestVersion) {
          consecutiveFailures = 0
        }
        
        if (result.hasUpdate) {
          if (onUpdateFound) {
            console.log('[ResourceUpdater] New version found, notifying...')
            onUpdateFound(result)
          } else {
            console.warn('[ResourceUpdater] Update found but no callback provided')
          }
        } else {
          console.log('[ResourceUpdater] No update available')
        }
      } catch (err: any) {
        consecutiveFailures++
        console.error(`[ResourceUpdater] Auto update check failed (${consecutiveFailures}/${maxFailures}):`, err.message)
        
        // 如果连续失败多次，延长检查间隔（可能是速率限制）
        if (consecutiveFailures >= maxFailures) {
          console.warn('[ResourceUpdater] Too many consecutive failures, extending check interval to avoid rate limiting')
          // 清除当前定时器
          if (this.updateCheckInterval) {
            clearInterval(this.updateCheckInterval)
          }
          // 延长到 6 小时检查一次
          const extendedInterval = 6 * 60 * 60 * 1000
          this.updateCheckInterval = setInterval(checkAndNotify, extendedInterval)
          consecutiveFailures = 0 // 重置计数
        }
      }
    }

    // 延迟5秒后检查一次（避免启动时阻塞）
    setTimeout(checkAndNotify, 5000)

    // 设置定时检查
    const interval = intervalHours * 60 * 60 * 1000
    this.updateCheckInterval = setInterval(checkAndNotify, interval)
  }

  stopAutoUpdateCheck() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval)
      this.updateCheckInterval = null
    }
  }

  /**
   * 清理热更新目录（回退到内置版本）
   */
  async clearHotUpdate(): Promise<void> {
    try {
      if (fs.existsSync(this.hotUpdateDir)) {
        fs.rmSync(this.hotUpdateDir, { recursive: true, force: true })
        console.log('[ResourceUpdater] Hot update directory cleared')
      }
    } catch (error) {
      console.error('[ResourceUpdater] Failed to clear hot update:', error)
      throw error
    }
  }

  /**
   * 从 GitHub Releases 获取最新版本信息
   * 支持重试机制和 GitHub Token 认证
   */
  private async fetchLatestRelease(retries: number = 3): Promise<any> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'User-Agent': 'QACowork-App',
          'Accept': 'application/vnd.github.v3+json'
        }

        // 如果配置了 GitHub Token，添加到请求头
        if (this.githubToken) {
          headers['Authorization'] = `token ${this.githubToken}`
        }

        // 取最近 10 个 release，找第一个有 resource-manifest.json 的
        // 避免最新 release 是 CI 还在构建中的空 release 导致 manifest 不存在
        const response = await fetch(
          `https://api.github.com/repos/${this.githubRepo}/releases?per_page=10`,
          { headers }
        )

        if (!response.ok) {
          const errorText = await response.text()
          let errorData: any = {}
          try {
            errorData = JSON.parse(errorText)
          } catch {
            errorData = { message: errorText }
          }

          // 处理速率限制错误
          if (response.status === 403 && errorData.message?.includes('rate limit')) {
            const resetTime = response.headers.get('x-ratelimit-reset')
            const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000) : null
            const waitMinutes = resetDate ? Math.ceil((resetDate.getTime() - Date.now()) / 60000) : 60
            
            console.warn(`[ResourceUpdater] GitHub API rate limit exceeded. Reset in ~${waitMinutes} minutes`)
            
            // 如果是最后一次尝试，返回 null 而不是抛出错误
            if (attempt === retries - 1) {
              console.warn('[ResourceUpdater] Rate limit exceeded, skipping update check')
              return null
            }
            
            // 等待后重试（指数退避）
            const waitTime = Math.min(60000 * Math.pow(2, attempt), 300000) // 最多等待 5 分钟
            console.log(`[ResourceUpdater] Waiting ${waitTime / 1000}s before retry...`)
            await new Promise(resolve => setTimeout(resolve, waitTime))
            continue
          }

          // 其他错误
          console.error(`[ResourceUpdater] GitHub API error: ${response.status} - ${errorData.message || errorText}`)
          
          // 如果是最后一次尝试，返回 null
          if (attempt === retries - 1) {
            return null
          }
          
          // 等待后重试
          const waitTime = 1000 * Math.pow(2, attempt) // 指数退避：1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, waitTime))
          continue
        }

        const releases = await response.json()
        // 找第一个包含 resource-manifest.json 的 release（跳过 CI 还未完成的空 release）
        const validRelease = releases.find((r: any) =>
          r.assets?.some((a: any) => a.name === 'resource-manifest.json')
        )
        if (!validRelease) {
          console.warn('[ResourceUpdater] No release with resource-manifest.json found in recent releases')
          return null
        }
        console.log(`[ResourceUpdater] Found valid release: ${validRelease.tag_name} (skipped ${releases.indexOf(validRelease)} newer incomplete releases)`)
        return validRelease
      } catch (error: any) {
        console.error(`[ResourceUpdater] Failed to fetch latest release (attempt ${attempt + 1}/${retries}):`, error.message)
        
        // 如果是最后一次尝试，返回 null
        if (attempt === retries - 1) {
          return null
        }
        
        // 等待后重试
        const waitTime = 1000 * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }
    
    return null
  }

  /**
   * 按 tag 拉取单个 release（用于 Invalid LOC 时获取最新 assets，如分卷 .z01）
   */
  private async fetchReleaseByTag(tagName: string): Promise<any | null> {
    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
      if (this.githubToken) headers['Authorization'] = `token ${this.githubToken}`
      const res = await fetch(
        `https://api.github.com/repos/${this.githubRepo}/releases/tags/${encodeURIComponent(tagName)}`,
        { headers }
      )
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  /**
   * 获取远程资源清单
   * 支持重试机制和超时控制
   */
  private async fetchRemoteManifest(release: any, retries: number = 3): Promise<ResourceManifest | null> {
    try {
      console.log(`[ResourceUpdater] Release assets: ${release.assets?.map((a: any) => a.name).join(', ') || 'none'}`)
      
      // 查找清单文件资源
      const manifestAsset = release.assets.find(
        (asset: any) => asset.name === 'resource-manifest.json'
      )

      if (!manifestAsset) {
        console.warn(`[ResourceUpdater] No manifest found in release ${release.tag_name}`)
        console.warn(`[ResourceUpdater] Available assets: ${release.assets?.map((a: any) => a.name).join(', ') || 'none'}`)
        return null
      }
      
      console.log(`[ResourceUpdater] Found manifest: ${manifestAsset.name} (${manifestAsset.size} bytes)`)

      const headers: Record<string, string> = {}
      if (this.githubToken) {
        headers['Authorization'] = `token ${this.githubToken}`
      }

      // 重试机制
      for (let attempt = 0; attempt < retries; attempt++) {
        let timeoutId: NodeJS.Timeout | null = null
        try {
          // 创建超时控制器（manifest 文件较小，30 秒超时足够）
          const timeoutMs = 30000
          const abortController = new AbortController()
          timeoutId = setTimeout(() => {
            abortController.abort()
          }, timeoutMs)

          console.log(`[ResourceUpdater] Fetching manifest (attempt ${attempt + 1}/${retries})...`)

          const response = await fetch(manifestAsset.browser_download_url, {
            headers,
            signal: abortController.signal
          })

          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }

          if (!response.ok) {
            // 处理速率限制
            if (response.status === 403) {
              const errorText = await response.text()
              if (errorText.includes('rate limit')) {
                const resetTime = response.headers.get('x-ratelimit-reset')
                const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000) : null
                const waitMinutes = resetDate ? Math.ceil((resetDate.getTime() - Date.now()) / 60000) : 60
                
                console.warn(`[ResourceUpdater] Rate limit exceeded while fetching manifest. Reset in ~${waitMinutes} minutes`)
                
                if (attempt < retries - 1) {
                  const waitTime = Math.min(60000 * Math.pow(2, attempt), 300000)
                  console.log(`[ResourceUpdater] Waiting ${waitTime / 1000}s before retry...`)
                  await new Promise(resolve => setTimeout(resolve, waitTime))
                  continue
                }
              }
            }
            
            if (attempt === retries - 1) {
              throw new Error(`Failed to download manifest: ${response.status}`)
            }
            
            // 其他错误，等待后重试
            const waitTime = 1000 * Math.pow(2, attempt)
            await new Promise(resolve => setTimeout(resolve, waitTime))
            continue
          }

          const manifest = await response.json()
          console.log(`[ResourceUpdater] Successfully fetched manifest: version ${manifest.version}`)
          return manifest

        } catch (error: any) {
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }

          // 检查是否是超时错误
          if (error.name === 'AbortError' || error.code === 'UND_ERR_CONNECT_TIMEOUT') {
            console.error(`[ResourceUpdater] Manifest fetch timeout (attempt ${attempt + 1}/${retries})`)
            if (attempt === retries - 1) {
              console.error('[ResourceUpdater] Failed to fetch manifest after all retries')
              return null
            }
            // 等待后重试
            const waitTime = 2000 * Math.pow(2, attempt)
            console.log(`[ResourceUpdater] Waiting ${waitTime / 1000}s before retry...`)
            await new Promise(resolve => setTimeout(resolve, waitTime))
            continue
          }

          if (attempt === retries - 1) {
            console.error('[ResourceUpdater] Failed to fetch remote manifest:', error)
            return null
          }

          // 其他错误，等待后重试
          const waitTime = 1000 * Math.pow(2, attempt)
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }

      return null
    } catch (error) {
      console.error('[ResourceUpdater] Failed to fetch remote manifest:', error)
      return null
    }
  }

  /**
   * 加载本地清单（从热更新目录）
   */
  private loadLocalManifest(): ResourceManifest | null {
    try {
      if (!fs.existsSync(this.manifestPath)) {
        return null
      }

      const content = fs.readFileSync(this.manifestPath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      console.error('[ResourceUpdater] Failed to load local manifest:', error)
      return null
    }
  }

  /**
   * 保存清单文件到热更新目录
   */
  private saveManifest(manifest: ResourceManifest) {
    try {
      const dir = path.dirname(this.manifestPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const manifestContent = JSON.stringify(manifest, null, 2)
      fs.writeFileSync(this.manifestPath, manifestContent, 'utf-8')
      console.log(`[ResourceUpdater] Saved manifest: version ${manifest.version} to ${this.manifestPath}`)
      
      // 验证保存是否成功
      if (fs.existsSync(this.manifestPath)) {
        const savedManifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'))
        console.log(`[ResourceUpdater] Verified manifest saved: version ${savedManifest.version}`)
      } else {
        console.error(`[ResourceUpdater] ERROR: Manifest file not found after save: ${this.manifestPath}`)
      }
    } catch (error) {
      console.error(`[ResourceUpdater] ERROR: Failed to save manifest:`, error)
      throw error
    }
  }

  /**
   * 计算需要更新的文件
   */
  private calculateUpdateFiles(
    localManifest: ResourceManifest | null,
    remoteManifest: ResourceManifest
  ): FileInfo[] {
    if (!localManifest) {
      // 如果没有本地清单，返回所有文件
      console.log(`[ResourceUpdater] No local manifest found, all ${Object.keys(remoteManifest.files).length} files need update`)
      return Object.values(remoteManifest.files)
    }

    const filesToUpdate: FileInfo[] = []
    let matchedCount = 0
    let missingCount = 0
    let hashMismatchCount = 0

    for (const [filePath, remoteFile] of Object.entries(remoteManifest.files)) {
      const localFile = localManifest.files[filePath]

      // 文件不存在或 hash 不匹配
      if (!localFile) {
        filesToUpdate.push(remoteFile)
        missingCount++
      } else if (localFile.hash !== remoteFile.hash) {
        filesToUpdate.push(remoteFile)
        hashMismatchCount++
      } else {
        matchedCount++
      }
    }

    console.log(`[ResourceUpdater] File comparison: ${matchedCount} matched, ${missingCount} missing, ${hashMismatchCount} hash mismatched, ${filesToUpdate.length} total to update`)

    return filesToUpdate
  }

  /**
   * 从 release 中解析资源包：单个 zip 或分卷 zip（.z01, .z02, ..., .zip）
   * 支持资源名 resources-1.1.20.* 与 resources-v1.1.20.*（与 CI 产物一致）
   */
  private getResourceAssets(release: any, version: string): ResourceAssetsInfo | null {
    const base = `resources-${version}`
    const baseV = `resources-v${version}`
    const all = (release.assets || []).filter((a: any) => {
      const n = a.name
      if (!(n.startsWith(base + '.') || n.startsWith(baseV + '.'))) return false
      return n === `${base}.zip` || n === `${baseV}.zip` || /\.z\d+$/.test(n)
    })
    if (all.length === 0) return null
    const singleZip = all.find((a: any) => a.name.endsWith('.zip'))
    const parts = all.filter((a: any) => !a.name.endsWith('.zip'))
    // 若存在 .z01 等分卷，则按分卷处理；否则按单文件
    if (parts.length > 0) {
      const sorted = parts.slice().sort((a: any, b: any) => {
        const nA = parseInt(a.name.replace(/.*\.z(\d+)$/, '$1'), 10)
        const nB = parseInt(b.name.replace(/.*\.z(\d+)$/, '$1'), 10)
        return nA - nB
      })
      const assets = singleZip ? [...sorted, singleZip] : sorted
      const totalSize = assets.reduce((sum: number, a: any) => sum + (a.size || 0), 0)
      return { type: 'split', assets, totalSize }
    }
    if (singleZip) {
      return { type: 'single', asset: singleZip, totalSize: singleZip.size || 0 }
    }
    return null
  }

  /**
   * 检查是否有缓存的 zip 包（单文件或分卷）
   */
  private hasCachedZip(info: ResourceAssetsInfo): boolean {
    if (info.type === 'single') {
      const p = path.join(this.tempDir, info.asset.name)
      return fs.existsSync(p) && fs.statSync(p).size === info.totalSize
    }
    for (const a of info.assets) {
      const p = path.join(this.tempDir, a.name)
      if (!fs.existsSync(p) || fs.statSync(p).size !== (a.size || 0)) {
        return false
      }
    }
    return true
  }

  /**
   * 下载并解压资源包
   * 
   * 注意：当前实现会下载完整的资源包，然后只解压需要更新的文件。
   * 这是因为 GitHub Releases 不支持单文件下载，资源包是预编译的产物。
   * 
   * 优化措施：
   * 1. 缓存已下载的 zip 包，相同版本不重复下载
   * 2. 只解压需要更新的文件
   */
  private async downloadAndExtractResources(
    release: any,
    filesToUpdate: FileInfo[],
    downloadDir: string,
    onProgress?: (progress: { total: number; downloaded: number; current: string }) => void
  ): Promise<void> {
    try {
      const version = release.tag_name.replace(/^v/, '')
      const info = this.getResourceAssets(release, version)
      if (!info) {
        throw new Error('Resource package not found in release')
      }

      const totalSize = info.totalSize
      const updateSize = filesToUpdate.reduce((sum, file) => sum + file.size, 0)
      const packageLabel = info.type === 'split' ? `${info.assets.length} parts` : info.type === 'single' ? info.asset.name : ''

      console.log(`[ResourceUpdater] Resource package: ${packageLabel} (${this.formatBytes(totalSize)})`)
      console.log(`[ResourceUpdater] Files to update: ${filesToUpdate.length} (${this.formatBytes(updateSize)})`)

      if (this.hasCachedZip(info)) {
        console.log(`[ResourceUpdater] Using cached zip package for version ${version}`)
        onProgress?.({
          total: 100,
          downloaded: 100,
          current: `使用缓存的资源包 v${version}`
        })
      } else {
        this.cleanupOldCaches(version)
        if (info.type === 'single') {
          await this.downloadSingleZip(info.asset, totalSize, onProgress)
        } else {
          await this.downloadSplitZip(info.assets, totalSize, onProgress)
        }
      }

      const isSplit = info.type === 'split'
      const zipPath = isSplit
        ? path.join(this.tempDir, (info.assets as Array<{ name: string }>).find(a => a.name.endsWith('.zip'))!.name)
        : path.join(this.tempDir, info.asset.name)

      console.log(`[ResourceUpdater] Extracting ${filesToUpdate.length} files (${this.formatBytes(updateSize)})...`)

      if (isSplit) {
        this.extractSplitZip(zipPath, downloadDir, filesToUpdate, updateSize, onProgress)
      } else {
        try {
          this.extractSingleZipWithAdm(zipPath, downloadDir, filesToUpdate, updateSize, onProgress)
        } catch (admError: unknown) {
          const msg = admError instanceof Error ? admError.message : String(admError)
          const isInvalidLoc = /Invalid LOC|bad signature|invalid.*header/i.test(msg)
          const isBufferBounds = /buffer bounds|outside buffer|out of bounds/i.test(msg)
          if (isInvalidLoc) {
            let splitInfo = this.getResourceAssets(release, version)
            if (splitInfo?.type !== 'split') {
              const freshRelease = await this.fetchReleaseByTag(release.tag_name)
              if (freshRelease) splitInfo = this.getResourceAssets(freshRelease, version)
            }
            if (splitInfo?.type === 'split') {
              console.warn('[ResourceUpdater] Single zip invalid (likely split segment), retrying as split...')
              await this.downloadSplitZip(splitInfo.assets, splitInfo.totalSize, onProgress)
              const splitZipPath = path.join(this.tempDir, splitInfo.assets.find(a => a.name.endsWith('.zip'))!.name)
              this.extractSplitZip(splitZipPath, downloadDir, filesToUpdate, updateSize, onProgress)
              return
            }
          }
          if (isBufferBounds || isInvalidLoc) {
            console.warn('[ResourceUpdater] AdmZip failed, falling back to system unzip:', msg)
            this.extractSingleZipWithUnzip(zipPath, downloadDir, filesToUpdate, updateSize, onProgress)
            return
          }
          throw admError
        }
      }
    } catch (error) {
      console.error('[ResourceUpdater] Failed to download and extract resources:', error)
      throw error
    }
  }

  private extractSingleZipWithAdm(
    zipPath: string,
    downloadDir: string,
    filesToUpdate: FileInfo[],
    updateSize: number,
    onProgress?: (progress: { total: number; downloaded: number; current: string }) => void
  ): void {
    const zip = new AdmZip(zipPath)
    let extractedSize = 0
    for (const file of filesToUpdate) {
      onProgress?.({ total: updateSize, downloaded: extractedSize, current: `解压文件: ${file.path}` })
      const zipEntry = zip.getEntry(file.path)
      if (zipEntry) {
        const targetPath = path.join(downloadDir, file.path)
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        const content = zip.readFile(zipEntry)
        if (content) fs.writeFileSync(targetPath, content)
      } else {
        console.warn(`[ResourceUpdater] File not found in zip: ${file.path}`)
      }
      extractedSize += file.size
    }
    onProgress?.({ total: updateSize, downloaded: updateSize, current: `解压完成: ${filesToUpdate.length} 个文件` })
    console.log(`[ResourceUpdater] Extraction completed: ${filesToUpdate.length} files (${this.formatBytes(extractedSize)})`)
  }

  /** 使用系统 unzip 解压单文件 zip（AdmZip 报 buffer bounds 等时的回退） */
  private extractSingleZipWithUnzip(
    zipPath: string,
    downloadDir: string,
    filesToUpdate: FileInfo[],
    updateSize: number,
    onProgress?: (progress: { total: number; downloaded: number; current: string }) => void
  ): void {
    const extractDir = path.join(this.tempDir, 'extract-single-' + path.basename(zipPath, '.zip'))
    fs.mkdirSync(extractDir, { recursive: true })
    const zipDir = path.dirname(zipPath)
    const zipName = path.basename(zipPath)
    try {
      if (process.platform === 'win32') {
        try {
          execSync(`7z x -o"${extractDir.replace(/"/g, '""')}" "${zipPath}"`, { stdio: 'pipe', maxBuffer: 100 * 1024 * 1024 })
        } catch {
          execSync(`unzip -o "${zipName}" -d "${extractDir}"`, { stdio: 'pipe', cwd: zipDir, maxBuffer: 100 * 1024 * 1024 })
        }
      } else {
        execSync(`unzip -o "${zipName}" -d "${extractDir}"`, { stdio: 'pipe', cwd: zipDir, maxBuffer: 100 * 1024 * 1024 })
      }
    } catch (e) {
      fs.rmSync(extractDir, { recursive: true, force: true })
      console.error('[ResourceUpdater] System unzip failed:', e)
      throw e
    }
    let extractedSize = 0
    for (const file of filesToUpdate) {
      onProgress?.({ total: updateSize, downloaded: extractedSize, current: `解压: ${file.path}` })
      const src = path.join(extractDir, file.path)
      const dest = path.join(downloadDir, file.path)
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
      } else {
        console.warn(`[ResourceUpdater] File not found in extracted archive: ${file.path}`)
      }
      extractedSize += file.size
    }
    fs.rmSync(extractDir, { recursive: true, force: true })
    onProgress?.({ total: updateSize, downloaded: updateSize, current: `解压完成: ${filesToUpdate.length} 个文件` })
    console.log(`[ResourceUpdater] Extraction completed (unzip): ${filesToUpdate.length} files (${this.formatBytes(extractedSize)})`)
  }

  private async downloadSingleZip(
    asset: { name: string; browser_download_url: string; size: number },
    totalSize: number,
    onProgress?: (progress: { total: number; downloaded: number; current: string }) => void
  ): Promise<void> {
    const zipPath = path.join(this.tempDir, asset.name)
    console.log(`[ResourceUpdater] Downloading resource package: ${asset.name} (stream to file)`)
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      let timeoutId: NodeJS.Timeout | null = null
      try {
        const headers: Record<string, string> = {}
        if (this.githubToken) headers['Authorization'] = `token ${this.githubToken}`
        const timeoutMs = Math.min(Math.max(totalSize / 1024 / 1024 * 10000, 60000), 30 * 60 * 1000)
        const abort = new AbortController()
        timeoutId = setTimeout(() => abort.abort(), timeoutMs)
        const response = await fetch(asset.browser_download_url, { headers, signal: abort.signal })
        clearTimeout(timeoutId!)
        if (!response.ok) {
          if (response.status === 403 && (await response.text()).includes('rate limit') && attempt < 2) {
            await new Promise(r => setTimeout(r, 60000 * Math.pow(2, attempt)))
            continue
          }
          throw new Error(`Download failed: ${response.status}`)
        }
        const reader = response.body?.getReader()
        if (!reader) throw new Error('Response body is not readable')
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
        const writeStream = fs.createWriteStream(zipPath)
        let downloaded = 0
        try {
          for (;;) {
            const { done: readDone, value } = await reader.read()
            if (readDone) break
            writeStream.write(Buffer.from(value))
            downloaded += value.length
            if (onProgress && contentLength > 0) {
              onProgress({
                total: contentLength,
                downloaded,
                current: `下载资源包: ${this.formatBytes(downloaded)} / ${this.formatBytes(contentLength)} (${Math.round((downloaded / contentLength) * 100)}%)`
              })
            }
          }
        } finally {
          writeStream.end()
          await new Promise<void>((resolve, reject) => writeStream.close(err => (err ? reject(err) : resolve())))
        }
        const writtenSize = fs.statSync(zipPath).size
        if (contentLength > 0 && writtenSize !== contentLength) {
          throw new Error(`Download incomplete: ${writtenSize} !== ${contentLength}`)
        }
        console.log(`[ResourceUpdater] Download completed: ${this.formatBytes(downloaded)}`)
        return
      } catch (e: unknown) {
        if (timeoutId) clearTimeout(timeoutId as NodeJS.Timeout)
        lastError = e instanceof Error ? e : new Error(String(e))
        if ((e as Error)?.name === 'AbortError' && attempt < 2) {
          await new Promise(r => setTimeout(r, 5000 * Math.pow(2, attempt)))
          continue
        }
        if (attempt === 2) throw lastError
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)))
      }
    }
    throw lastError || new Error('Download failed')
  }

  private async downloadSplitZip(
    assets: Array<{ name: string; browser_download_url: string; size: number }>,
    totalSize: number,
    onProgress?: (progress: { total: number; downloaded: number; current: string }) => void
  ): Promise<void> {
    console.log(`[ResourceUpdater] Downloading split resource package: ${assets.length} parts`)
    let downloadedTotal = 0
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i]
      const destPath = path.join(this.tempDir, a.name)
      if (fs.existsSync(destPath) && fs.statSync(destPath).size === (a.size || 0)) {
        downloadedTotal += a.size || 0
        onProgress?.({ total: totalSize, downloaded: downloadedTotal, current: `已缓存: ${a.name}` })
        continue
      }
      const headers: Record<string, string> = {}
      if (this.githubToken) headers['Authorization'] = `token ${this.githubToken}`
      const response = await fetch(a.browser_download_url, { headers })
      if (!response.ok) throw new Error(`Failed to download ${a.name}: ${response.status}`)
      const buf = Buffer.from(await response.arrayBuffer())
      fs.writeFileSync(destPath, buf)
      downloadedTotal += buf.length
      onProgress?.({
        total: totalSize,
        downloaded: downloadedTotal,
        current: `下载分卷 ${i + 1}/${assets.length}: ${a.name}`
      })
    }
    console.log(`[ResourceUpdater] Split download completed: ${this.formatBytes(downloadedTotal)}`)
  }

  private extractSplitZip(
    zipPath: string,
    downloadDir: string,
    filesToUpdate: FileInfo[],
    updateSize: number,
    onProgress?: (progress: { total: number; downloaded: number; current: string }) => void
  ): void {
    if (!fs.existsSync(zipPath)) {
      throw new Error(`Split zip not found: ${zipPath}. Ensure all .z01, .z02, ... parts are present.`)
    }
    const extractDir = path.join(this.tempDir, 'extract-' + path.basename(zipPath, '.zip'))
    fs.mkdirSync(extractDir, { recursive: true })
    const zipName = path.basename(zipPath)
    try {
      if (process.platform === 'win32') {
        try {
          execSync(`7z x -o"${extractDir.replace(/"/g, '""')}" "${zipPath}"`, { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 })
        } catch {
          execSync(`unzip -o "${zipName}" -d "${extractDir}"`, { stdio: 'pipe', cwd: this.tempDir, maxBuffer: 50 * 1024 * 1024 })
        }
      } else {
        execSync(`unzip -o "${zipName}" -d "${extractDir}"`, { stdio: 'pipe', cwd: this.tempDir, maxBuffer: 50 * 1024 * 1024 })
      }
    } catch (e) {
      console.error('[ResourceUpdater] Split unzip failed. On Windows, 7-Zip may be required for split archives.', e)
      throw e
    }
    let extractedSize = 0
    for (const file of filesToUpdate) {
      onProgress?.({ total: updateSize, downloaded: extractedSize, current: `解压: ${file.path}` })
      const src = path.join(extractDir, file.path)
      const dest = path.join(downloadDir, file.path)
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
      } else {
        console.warn(`[ResourceUpdater] File not found in extracted archive: ${file.path}`)
      }
      extractedSize += file.size
    }
    fs.rmSync(extractDir, { recursive: true, force: true })
    onProgress?.({ total: updateSize, downloaded: updateSize, current: `解压完成: ${filesToUpdate.length} 个文件` })
    console.log(`[ResourceUpdater] Extraction completed: ${filesToUpdate.length} files (${this.formatBytes(extractedSize)})`)
  }

  /**
   * 应用更新到热更新目录
   * 
   * 重要：不再修改应用安装包，而是写入热更新目录
   * 应用启动时会优先从热更新目录加载资源
   */
  private async applyUpdate(
    downloadDir: string,
    manifest: ResourceManifest,
    onProgress?: (progress: { total: number; downloaded: number; current: string }) => void
  ): Promise<void> {
    try {
      console.log('[ResourceUpdater] Applying updates to hot-update directory...')

      const files = Object.values(manifest.files)
      let processed = 0
      const total = files.length

      // 复制新文件到热更新目录
      for (const file of files) {
        const sourcePath = path.join(downloadDir, file.path)
        const targetPath = path.join(this.hotUpdateDir, file.path)

        onProgress?.({
          total,
          downloaded: processed,
          current: file.path
        })

        if (!fs.existsSync(sourcePath)) {
          console.warn(`[ResourceUpdater] Source file not found: ${sourcePath}`)
          processed++
          continue
        }

        // 确保目标目录存在
        const targetParent = path.dirname(targetPath)
        if (!fs.existsSync(targetParent)) {
          fs.mkdirSync(targetParent, { recursive: true })
        }

        // 复制文件到热更新目录
        fs.copyFileSync(sourcePath, targetPath)
        processed++
      }

      onProgress?.({
        total,
        downloaded: total,
        current: 'All files applied'
      })

      // 清理下载目录
      fs.rmSync(downloadDir, { recursive: true, force: true })

      // 清理临时目录中的旧下载
      this.cleanupTempDir()

      console.log(`[ResourceUpdater] Applied ${processed} files to hot-update directory`)
    } catch (error) {
      console.error('[ResourceUpdater] Failed to apply update:', error)
      throw error
    }
  }

  /**
   * 清理旧版本的缓存 zip 包（含分卷 .z01, .z02 等）
   */
  private cleanupOldCaches(currentVersion: string) {
    try {
      if (!fs.existsSync(this.tempDir)) return
      const files = fs.readdirSync(this.tempDir)
      const keepPrefix = (n: string) =>
        n === `resources-${currentVersion}.zip` ||
        n === `resources-v${currentVersion}.zip` ||
        n.startsWith(`resources-${currentVersion}.z`) ||
        n.startsWith(`resources-v${currentVersion}.z`)
      for (const file of files) {
        if (!file.startsWith('resources-')) continue
        if (file.endsWith('.zip') || /\.z\d+$/.test(file)) {
          if (keepPrefix(file)) continue
          const filePath = path.join(this.tempDir, file)
          try {
            fs.unlinkSync(filePath)
            console.log(`[ResourceUpdater] Cleaned up old cache: ${file}`)
          } catch (e) {
            console.warn(`[ResourceUpdater] Failed to delete old cache ${file}:`, e)
          }
        }
      }
    } catch (error) {
      console.error('[ResourceUpdater] Failed to cleanup old caches:', error)
    }
  }

  /**
   * 清理临时下载目录
   */
  private cleanupTempDir() {
    try {
      const downloadRoot = path.join(this.tempDir, 'download')
      if (fs.existsSync(downloadRoot)) {
        fs.rmSync(downloadRoot, { recursive: true, force: true })
      }
    } catch (error) {
      console.error('[ResourceUpdater] Failed to cleanup temp dir:', error)
    }
  }

  /**
   * 版本比较
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number)
    const parts2 = v2.split('.').map(Number)

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0
      const p2 = parts2[i] || 0
      if (p1 > p2) return 1
      if (p1 < p2) return -1
    }
    return 0
  }

  /**
   * 格式化字节大小
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }
}
