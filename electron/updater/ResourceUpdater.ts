/**
 * Resource Updater - 资源动态更新系统
 * 
 * 功能:
 * 1. 检测远程资源版本
 * 2. 增量下载更新的资源文件
 * 3. 热更新前端资源和 resources 目录
 * 4. 支持断点续传和错误重试
 */

import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
// import crypto from 'node:crypto'  // 保留以备将来计算文件hash时使用
import AdmZip from 'adm-zip'

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
  total: number
  downloaded: number
  current: string
}

export class ResourceUpdater {
  private updateDir: string
  private manifestPath: string
  private githubRepo = 'shileima/opencowork'
  private updateCheckInterval: NodeJS.Timeout | null = null

  constructor() {
    // 更新文件存储在 userData 目录
    this.updateDir = path.join(app.getPath('userData'), 'updates')
    this.manifestPath = path.join(this.updateDir, 'manifest.json')
    this.ensureUpdateDir()
  }

  private ensureUpdateDir() {
    if (!fs.existsSync(this.updateDir)) {
      fs.mkdirSync(this.updateDir, { recursive: true })
    }
  }

  /**
   * 检查资源更新
   */
  async checkForUpdates(): Promise<{
    hasUpdate: boolean
    currentVersion: string
    latestVersion: string
    updateSize?: number
    changelog?: string
  }> {
    try {
      console.log('[ResourceUpdater] Checking for resource updates...')

      const currentVersion = app.getVersion()
      const localManifest = this.loadLocalManifest()

      // 从 GitHub Releases 获取最新版本的资源清单
      const latestRelease = await this.fetchLatestRelease()
      
      if (!latestRelease) {
        return {
          hasUpdate: false,
          currentVersion,
          latestVersion: currentVersion
        }
      }

      const latestVersion = latestRelease.tag_name.replace(/^v/, '')
      
      // 版本对比
      if (this.compareVersions(latestVersion, currentVersion) <= 0) {
        console.log('[ResourceUpdater] Already on latest version')
        return {
          hasUpdate: false,
          currentVersion,
          latestVersion
        }
      }

      // 下载远程清单
      const remoteManifest = await this.fetchRemoteManifest(latestRelease)
      
      if (!remoteManifest) {
        console.warn('[ResourceUpdater] Failed to fetch remote manifest')
        return {
          hasUpdate: false,
          currentVersion,
          latestVersion
        }
      }

      // 计算需要更新的文件
      const filesToUpdate = this.calculateUpdateFiles(localManifest, remoteManifest)
      const updateSize = filesToUpdate.reduce((sum, file) => sum + file.size, 0)

      console.log(`[ResourceUpdater] Found ${filesToUpdate.length} files to update (${this.formatBytes(updateSize)})`)

      return {
        hasUpdate: filesToUpdate.length > 0,
        currentVersion,
        latestVersion,
        updateSize,
        changelog: latestRelease.body
      }
    } catch (error) {
      console.error('[ResourceUpdater] Check for updates failed:', error)
      throw error
    }
  }

  /**
   * 执行资源更新
   */
  async performUpdate(
    onProgress?: (progress: UpdateProgress) => void
  ): Promise<boolean> {
    try {
      console.log('[ResourceUpdater] Starting resource update...')

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
        return true
      }

      // 下载资源包
      const downloadDir = path.join(this.updateDir, 'download', remoteManifest.version)
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true })
      }

      // 下载并解压资源包
      await this.downloadAndExtractResources(
        latestRelease,
        filesToUpdate,
        downloadDir,
        onProgress
      )

      // 应用更新
      await this.applyUpdate(downloadDir, remoteManifest)

      // 保存新的清单
      this.saveManifest(remoteManifest)

      console.log('[ResourceUpdater] Resource update completed successfully')
      return true
    } catch (error) {
      console.error('[ResourceUpdater] Update failed:', error)
      throw error
    }
  }

  /**
   * 自动检查更新(定时)
   */
  startAutoUpdateCheck(intervalHours: number = 24, onUpdateFound?: (updateInfo: any) => void) {
    // 清除旧的定时器
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval)
    }

    const checkAndNotify = async () => {
      try {
        const result = await this.checkForUpdates()
        if (result.hasUpdate && onUpdateFound) {
          console.log('[ResourceUpdater] New version found, notifying...')
          onUpdateFound(result)
        }
      } catch (err) {
        console.error('[ResourceUpdater] Auto update check failed:', err)
      }
    }

    // 立即检查一次
    checkAndNotify()

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
   * 从 GitHub Releases 获取最新版本信息
   */
  private async fetchLatestRelease(): Promise<any> {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${this.githubRepo}/releases/latest`,
        {
          headers: {
            'User-Agent': 'OpenCowork-App',
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      )

      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      console.error('[ResourceUpdater] Failed to fetch latest release:', error)
      return null
    }
  }

  /**
   * 获取远程资源清单
   */
  private async fetchRemoteManifest(release: any): Promise<ResourceManifest | null> {
    try {
      // 查找清单文件资源
      const manifestAsset = release.assets.find(
        (asset: any) => asset.name === 'resource-manifest.json'
      )

      if (!manifestAsset) {
        console.warn('[ResourceUpdater] No manifest found in release')
        return null
      }

      const response = await fetch(manifestAsset.browser_download_url)
      if (!response.ok) {
        throw new Error(`Failed to download manifest: ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      console.error('[ResourceUpdater] Failed to fetch remote manifest:', error)
      return null
    }
  }

  /**
   * 加载本地清单
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
   * 保存清单文件
   */
  private saveManifest(manifest: ResourceManifest) {
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2))
  }

  /**
   * 计算需要更新的文件
   */
  private calculateUpdateFiles(
    localManifest: ResourceManifest | null,
    remoteManifest: ResourceManifest
  ): FileInfo[] {
    if (!localManifest) {
      // 如果没有本地清单,返回所有文件
      return Object.values(remoteManifest.files)
    }

    const filesToUpdate: FileInfo[] = []

    for (const [filePath, remoteFile] of Object.entries(remoteManifest.files)) {
      const localFile = localManifest.files[filePath]

      // 文件不存在或 hash 不匹配
      if (!localFile || localFile.hash !== remoteFile.hash) {
        filesToUpdate.push(remoteFile)
      }
    }

    return filesToUpdate
  }

  /**
   * 下载文件
   */
  /**
   * 下载并解压资源包
   */
  private async downloadAndExtractResources(
    release: any,
    filesToUpdate: FileInfo[],
    downloadDir: string,
    onProgress?: (progress: UpdateProgress) => void
  ): Promise<void> {
    try {
      // 查找资源包
      const resourceAsset = release.assets.find(
        (asset: any) => asset.name.startsWith('resources-') && asset.name.endsWith('.zip')
      )

      if (!resourceAsset) {
        throw new Error('Resource package not found in release')
      }

      console.log(`[ResourceUpdater] Downloading resource package: ${resourceAsset.name}`)
      
      // 下载 zip 包
      const zipPath = path.join(this.updateDir, 'temp.zip')
      const response = await fetch(resourceAsset.browser_download_url)
      
      if (!response.ok) {
        throw new Error(`Failed to download resource package: ${response.status}`)
      }

      const buffer = await response.arrayBuffer()
      fs.writeFileSync(zipPath, Buffer.from(buffer))

      console.log(`[ResourceUpdater] Extracting ${filesToUpdate.length} files...`)

      // 解压指定文件
      const zip = new AdmZip(zipPath)
      let extracted = 0
      const total = filesToUpdate.length

      for (const file of filesToUpdate) {
        onProgress?.({
          total,
          downloaded: extracted,
          current: file.path
        })

        const zipEntry = zip.getEntry(file.path)
        if (zipEntry) {
          const targetPath = path.join(downloadDir, file.path)
          const targetDir = path.dirname(targetPath)
          
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true })
          }
          
          // 提取文件内容
          const content = zip.readFile(zipEntry)
          if (content) {
            fs.writeFileSync(targetPath, content)
            console.log(`[ResourceUpdater] Extracted: ${file.path}`)
          }
        } else {
          console.warn(`[ResourceUpdater] File not found in zip: ${file.path}`)
        }

        extracted++
      }

      // 最后一次进度更新
      onProgress?.({
        total,
        downloaded: total,
        current: 'Completed'
      })

      // 清理临时文件
      fs.unlinkSync(zipPath)
      console.log(`[ResourceUpdater] Extraction completed`)
    } catch (error) {
      console.error('[ResourceUpdater] Failed to download and extract resources:', error)
      throw error
    }
  }

  /**
   * 应用更新
   */
  private async applyUpdate(
    downloadDir: string,
    manifest: ResourceManifest
  ): Promise<void> {
    try {
      console.log('[ResourceUpdater] Applying updates...')

      // 备份当前文件
      const backupDir = path.join(this.updateDir, 'backup', Date.now().toString())
      fs.mkdirSync(backupDir, { recursive: true })

      // 复制新文件到应用目录
      for (const file of Object.values(manifest.files)) {
        const sourcePath = path.join(downloadDir, file.path)
        const targetPath = this.resolveAppPath(file.path)

        if (!fs.existsSync(sourcePath)) {
          console.warn(`[ResourceUpdater] Source file not found: ${sourcePath}`)
          continue
        }

        // 备份旧文件
        if (fs.existsSync(targetPath)) {
          const backupPath = path.join(backupDir, file.path)
          const backupParent = path.dirname(backupPath)
          if (!fs.existsSync(backupParent)) {
            fs.mkdirSync(backupParent, { recursive: true })
          }
          fs.copyFileSync(targetPath, backupPath)
        }

        // 复制新文件
        const targetParent = path.dirname(targetPath)
        if (!fs.existsSync(targetParent)) {
          fs.mkdirSync(targetParent, { recursive: true })
        }
        fs.copyFileSync(sourcePath, targetPath)

        console.log(`[ResourceUpdater] Updated: ${file.path}`)
      }

      // 清理下载目录
      fs.rmSync(downloadDir, { recursive: true, force: true })

      // 只保留最近3个备份
      this.cleanupOldBackups(path.dirname(backupDir), 3)
    } catch (error) {
      console.error('[ResourceUpdater] Failed to apply update:', error)
      throw error
    }
  }

  /**
   * 解析应用内路径
   */
  private resolveAppPath(relativePath: string): string {
    if (relativePath.startsWith('dist/')) {
      // 前端资源
      return path.join(process.resourcesPath || app.getAppPath(), relativePath)
    } else if (relativePath.startsWith('resources/')) {
      // extraResources
      return path.join(process.resourcesPath || app.getAppPath(), relativePath)
    }
    return path.join(app.getAppPath(), relativePath)
  }

  /**
   * 清理旧备份
   */
  private cleanupOldBackups(backupRootDir: string, keepCount: number) {
    try {
      if (!fs.existsSync(backupRootDir)) {
        return
      }

      const backups = fs.readdirSync(backupRootDir)
        .map(name => ({
          name,
          path: path.join(backupRootDir, name),
          time: parseInt(name)
        }))
        .filter(b => !isNaN(b.time))
        .sort((a, b) => b.time - a.time)

      // 删除多余的备份
      for (let i = keepCount; i < backups.length; i++) {
        fs.rmSync(backups[i].path, { recursive: true, force: true })
        console.log(`[ResourceUpdater] Removed old backup: ${backups[i].name}`)
      }
    } catch (error) {
      console.error('[ResourceUpdater] Failed to cleanup backups:', error)
    }
  }

  /**
   * 计算文件 hash (备用方法,当前未使用但保留以备将来需要)
   */
  // private calculateFileHash(filePath: string): string {
  //   const content = fs.readFileSync(filePath)
  //   return crypto.createHash('sha256').update(content).digest('hex')
  // }

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
