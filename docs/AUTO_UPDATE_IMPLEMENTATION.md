# 资源自动更新实现方案

## 方案概述

实现一个基于 GitHub Releases 的资源热更新系统,允许客户端动态更新前端资源和 resources 目录,无需重新安装应用。

## 技术方案对比

### 方案一: 增量文件更新(推荐 - 已实现框架)

**优点:**
- 更新粒度小,只下载变更文件
- 实现相对简单
- 不依赖第三方服务

**缺点:**
- 需要实现文件清单管理
- 需要处理 zip 包解压

**实现状态:** ✅ 框架已搭建,需要完善 zip 解压逻辑

### 方案二: electron-updater

**优点:**
- 官方推荐,成熟稳定
- 支持自动下载和安装
- 支持差分更新

**缺点:**
- 需要配置代码签名(macOS 需要 Apple 开发者账号)
- 更新整个 asar 包,粒度较大
- 配置复杂

**实现状态:** ❌ 未实现

### 方案三: 自定义 CDN 分发

**优点:**
- 下载速度快
- 支持国内访问
- 灵活可控

**缺点:**
- 需要额外的服务器成本
- 需要维护 CDN 服务

**实现状态:** ❌ 未实现

## 推荐方案详细设计

### 架构图

```
┌──────────────────────────────────────────────────────────┐
│                     GitHub Release                        │
│  ┌────────────────┐  ┌──────────────────────────────┐   │
│  │ resource-      │  │ resources-v0.0.14.zip        │   │
│  │ manifest.json  │  │ (打包的资源文件)              │   │
│  └────────────────┘  └──────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
              │                         │
              │ 下载清单                 │ 下载资源包
              ↓                         ↓
┌──────────────────────────────────────────────────────────┐
│                   ResourceUpdater                         │
│  1. 检测版本 → 2. 对比清单 → 3. 下载 → 4. 应用更新       │
└──────────────────────────────────────────────────────────┘
              │
              ↓
┌──────────────────────────────────────────────────────────┐
│              本地应用资源                                  │
│  dist/  resources/skills/  resources/mcp/ ...            │
└──────────────────────────────────────────────────────────┘
```

### 核心流程

#### 1. 构建时生成清单

```javascript
// scripts/generate-resource-manifest.mjs
{
  "version": "0.0.14",
  "buildTime": 1704067200000,
  "files": {
    "dist/index.html": {
      "hash": "sha256_hash_value",
      "size": 1024,
      "path": "dist/index.html"
    },
    "resources/skills/skill1/README.md": {
      "hash": "sha256_hash_value",
      "size": 2048,
      "path": "resources/skills/skill1/README.md"
    }
  }
}
```

#### 2. 打包资源文件

在 GitHub Actions 中添加步骤:

```yaml
- name: Package Resources
  run: |
    # 创建资源压缩包
    cd release
    zip -r resources-${{ steps.extract_version.outputs.version }}.zip \
      dist/ \
      resources/skills/ \
      resources/mcp/ \
      resources/node/ \
      resources/playwright/

- name: Upload Resources
  with:
    files: |
      release/*/OpenCowork*.dmg
      release/*/OpenCowork*.exe
      resource-manifest.json
      release/resources-*.zip
```

#### 3. 客户端检测更新

```typescript
// electron/updater/ResourceUpdater.ts
async checkForUpdates() {
  // 1. 获取最新 Release
  const release = await fetchLatestRelease()
  
  // 2. 下载远程清单
  const remoteManifest = await fetchRemoteManifest(release)
  
  // 3. 对比本地清单
  const filesToUpdate = calculateUpdateFiles(localManifest, remoteManifest)
  
  // 4. 返回更新信息
  return {
    hasUpdate: filesToUpdate.length > 0,
    updateSize: calculateTotalSize(filesToUpdate)
  }
}
```

#### 4. 下载和应用更新

```typescript
async performUpdate() {
  // 1. 下载资源包
  const resourcePackage = await downloadResourcePackage(release)
  
  // 2. 解压到临时目录
  const tempDir = await extractZip(resourcePackage)
  
  // 3. 备份当前文件
  await backupCurrentFiles()
  
  // 4. 复制新文件到应用目录
  await applyUpdates(tempDir, filesToUpdate)
  
  // 5. 保存新清单
  saveManifest(remoteManifest)
  
  // 6. 清理临时文件
  cleanupTempFiles()
}
```

## 完整实现步骤

### Step 1: 完善 ResourceUpdater

需要添加 zip 处理功能。推荐使用 `adm-zip` 库:

```bash
npm install adm-zip
npm install --save-dev @types/adm-zip
```

```typescript
import AdmZip from 'adm-zip';

private async downloadAndExtractResources(
  release: any,
  filesToUpdate: FileInfo[],
  downloadDir: string
): Promise<void> {
  // 查找资源包
  const resourceAsset = release.assets.find(
    (asset: any) => asset.name.startsWith('resources-') && asset.name.endsWith('.zip')
  )

  if (!resourceAsset) {
    throw new Error('Resource package not found in release')
  }

  // 下载 zip 包
  const zipPath = path.join(this.updateDir, 'temp.zip')
  const response = await fetch(resourceAsset.browser_download_url)
  const buffer = await response.arrayBuffer()
  fs.writeFileSync(zipPath, Buffer.from(buffer))

  // 解压指定文件
  const zip = new AdmZip(zipPath)
  for (const file of filesToUpdate) {
    const zipEntry = zip.getEntry(file.path)
    if (zipEntry) {
      const targetPath = path.join(downloadDir, file.path)
      const targetDir = path.dirname(targetPath)
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true })
      }
      zip.extractEntryTo(zipEntry, targetDir, false, true)
    }
  }

  // 清理临时文件
  fs.unlinkSync(zipPath)
}
```

### Step 2: 更新 GitHub Actions

修改 `.github/workflows/release.yml`:

```yaml
- name: Package Resources
  if: success() && matrix.platform == 'linux'  # 只在一个平台执行一次
  run: |
    # 提取版本号
    VERSION=$(node -p "require('./package.json').version")
    
    # 创建临时目录
    mkdir -p temp-resources
    
    # 复制需要更新的资源
    cp -r dist temp-resources/
    cp -r resources/skills temp-resources/resources/skills
    cp -r resources/mcp temp-resources/resources/mcp
    cp -r resources/node temp-resources/resources/node
    cp -r resources/playwright temp-resources/resources/playwright
    
    # 打包
    cd temp-resources
    zip -r ../resources-v${VERSION}.zip .
    cd ..
    
    # 清理临时目录
    rm -rf temp-resources

- name: Upload Resources
  uses: softprops/action-gh-release@v2
  if: success()
  with:
    files: |
      release/*/OpenCowork*.dmg
      release/*/OpenCowork*.exe
      release/*/OpenCowork*.AppImage
      release/*/OpenCowork*.deb
      resource-manifest.json
      resources-*.zip
```

### Step 3: 添加依赖

```bash
npm install adm-zip
npm install --save-dev @types/adm-zip
```

### Step 4: 更新构建脚本

修改 `package.json`:

```json
{
  "scripts": {
    "build": "node scripts/verify-builtin-resources.cjs && tsc && vite build && npm run build:manifest && electron-builder",
  }
}
```

### Step 5: 测试流程

1. **本地测试清单生成**
   ```bash
   npm run build:manifest
   cat resource-manifest.json
   ```

2. **模拟发布测试**
   ```bash
   # 创建测试 tag
   git tag v0.0.14-test
   git push origin v0.0.14-test
   
   # 观察 GitHub Actions 执行
   # 检查 Release 中是否包含:
   # - resource-manifest.json
   # - resources-v0.0.14-test.zip
   ```

3. **测试更新检测**
   - 在应用中打开设置 → 关于
   - 点击"检查资源更新"
   - 验证能否正确检测到更新

4. **测试更新下载**
   - 点击"立即更新"
   - 观察下载进度
   - 验证文件是否正确更新

## 优化建议

### 性能优化

1. **并行下载**
   - 同时下载多个小文件
   - 限制并发数避免过载

2. **缓存策略**
   - 缓存已下载的文件
   - 避免重复下载相同内容

3. **压缩传输**
   - 使用 gzip 压缩传输
   - 减少网络流量

### 用户体验优化

1. **后台静默更新**
   - 检测到更新后自动下载
   - 下载完成后提示用户重启

2. **更新通知**
   - 使用系统通知提醒更新
   - 显示更新日志

3. **错误处理**
   - 网络失败自动重试
   - 下载失败显示友好提示

### 安全优化

1. **签名验证**
   - 对资源包进行签名
   - 下载后验证签名

2. **HTTPS 强制**
   - 确保所有下载使用 HTTPS
   - 防止中间人攻击

3. **完整性检查**
   - 下载完成后验证 hash
   - 不匹配则重新下载

## 常见问题

### Q: 为什么不用 electron-updater?

A: electron-updater 需要代码签名,对于个人开发者来说成本较高。而且它更新整个 asar 包,我们只需要更新部分资源文件。

### Q: 资源包太大怎么办?

A: 可以考虑:
1. 分离大文件(如 playwright 浏览器)单独更新
2. 使用 CDN 加速
3. 实现差分更新

### Q: 如何回滚更新?

A: 系统会自动保留最近3个版本的备份,可以手动从备份目录恢复:
```
~/Library/Application Support/qacowork/updates/backup/
```

### Q: 更新失败怎么办?

A: 更新失败会保留旧文件,应用仍可正常使用。可以:
1. 检查网络连接
2. 查看控制台日志
3. 手动重试更新
4. 重新安装应用

## 后续工作

- [ ] 实现 zip 文件下载和解压(Step 1)
- [ ] 更新 GitHub Actions 工作流(Step 2)
- [ ] 添加 adm-zip 依赖(Step 3)
- [ ] 完整端到端测试
- [ ] 编写用户文档
- [ ] 添加错误处理和重试机制
- [ ] 实现更新回滚功能
- [ ] 优化下载进度显示
- [ ] 添加更新日志展示

## 总结

当前实现已经搭建了资源更新的完整框架,包括:

✅ 资源清单生成
✅ 版本检测
✅ 清单对比
✅ 前端 UI
✅ IPC 通信
✅ 自动检查机制

还需要完善:

⏳ Zip 文件下载和解压
⏳ GitHub Actions 资源打包
⏳ 端到端测试

按照本文档的步骤完成剩余工作,即可实现完整的资源自动更新功能。
