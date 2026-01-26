/**
 * 生成资源清单文件
 * 在构建时运行,生成 resource-manifest.json
 * 
 * 用法: node scripts/generate-resource-manifest.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

/**
 * 需要监控更新的目录
 */
const WATCH_DIRS = [
  'dist',           // 前端构建产物
  'resources/skills',  // 技能
  'resources/mcp',     // MCP 配置
  'resources/node',    // 内置 Node.js
  'resources/playwright' // Playwright 浏览器
]

/**
 * 排除的文件模式
 */
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /\.DS_Store/,
  /Thumbs\.db/,
  /\.map$/  // source maps
]

/**
 * 计算文件 hash
 */
function calculateFileHash(filePath) {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * 递归扫描目录
 */
function scanDirectory(dir, baseDir, files = {}) {
  if (!fs.existsSync(dir)) {
    console.warn(`⚠️  Directory not found: ${dir}`)
    return files
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(baseDir, fullPath)

    // 检查是否应该排除
    if (EXCLUDE_PATTERNS.some(pattern => pattern.test(relativePath))) {
      continue
    }

    if (entry.isDirectory()) {
      scanDirectory(fullPath, baseDir, files)
    } else if (entry.isFile()) {
      const stats = fs.statSync(fullPath)
      const hash = calculateFileHash(fullPath)

      files[relativePath] = {
        hash,
        size: stats.size,
        path: relativePath
      }
    }
  }

  return files
}

/**
 * 生成清单文件
 */
function generateManifest() {
  console.log('🔍 Scanning resource directories...')

  const files = {}

  // 扫描所有监控目录
  for (const dir of WATCH_DIRS) {
    const fullPath = path.join(rootDir, dir)
    console.log(`  📁 Scanning ${dir}...`)
    
    const dirFiles = scanDirectory(fullPath, rootDir)
    Object.assign(files, dirFiles)
  }

  // 读取版本号
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')
  )

  const manifest = {
    version: packageJson.version,
    buildTime: Date.now(),
    files
  }

  // 写入清单文件
  const manifestPath = path.join(rootDir, 'resource-manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  console.log('\n✅ Resource manifest generated successfully!')
  console.log(`📦 Total files: ${Object.keys(files).length}`)
  console.log(`📊 Total size: ${formatBytes(
    Object.values(files).reduce((sum, file) => sum + file.size, 0)
  )}`)
  console.log(`📄 Manifest: ${manifestPath}`)
}

/**
 * 格式化字节大小
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

// 运行生成
try {
  generateManifest()
} catch (error) {
  console.error('❌ Failed to generate manifest:', error)
  process.exit(1)
}
