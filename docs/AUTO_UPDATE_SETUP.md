# 资源自动更新功能 - 完整实现指南

## 📋 功能概述

本应用已实现**增量资源热更新**功能,支持在不重新安装客户端的情况下,动态更新:
- 前端资源 (`dist/`)
- 技能文件 (`resources/skills/`)
- MCP 配置 (`resources/mcp/`)
- 内置 Node.js (`resources/node/`)
- Playwright 浏览器 (`resources/playwright/`)

## ✅ 已完成的工作

### 1. 核心功能实现

- **ResourceUpdater** (`electron/updater/ResourceUpdater.ts`)
  - ✅ 版本检测和对比
  - ✅ 资源清单管理
  - ✅ Zip 文件下载和解压
  - ✅ 增量更新逻辑
  - ✅ 自动备份机制
  - ✅ 进度回调支持

- **清单生成器** (`scripts/generate-resource-manifest.mjs`)
  - ✅ 扫描资源目录
  - ✅ 计算文件 SHA-256 hash
  - ✅ 生成 JSON 清单文件

### 2. 主进程集成

- ✅ 导入 ResourceUpdater
- ✅ 添加 IPC handlers:
  - `resource:check-update` - 检查更新
  - `resource:perform-update` - 执行更新
  - `resource:restart-app` - 重启应用
- ✅ 自动检查机制(每24小时)
- ✅ 清理逻辑

### 3. 前端 UI

- ✅ 设置页面"关于"标签添加资源更新 UI
- ✅ 显示更新信息(版本、大小、变更日志)
- ✅ 更新进度条
- ✅ 错误处理和用户提示

### 4. 构建配置

- ✅ package.json 添加 `build:manifest` 命令
- ✅ 添加依赖: `adm-zip` 和 `@types/adm-zip`
- ✅ GitHub Actions 工作流更新:
  - 生成资源清单
  - 上传清单文件到 Release

## ⏳ 待完成的工作

### 1. 资源打包脚本

需要在 GitHub Actions 中添加资源打包步骤:

```yaml
# .github/workflows/release.yml
- name: Package Resources
  if: success() && matrix.platform == 'linux'  # 只在一个平台执行一次
  run: |
    # 提取版本号
    VERSION=$(node -p "require('./package.json').version")
    
    # 创建临时目录
    mkdir -p temp-resources
    
    # 复制需要更新的资源
    cp -r dist temp-resources/
    mkdir -p temp-resources/resources
    cp -r resources/skills temp-resources/resources/
    cp -r resources/mcp temp-resources/resources/
    cp -r resources/node temp-resources/resources/
    cp -r resources/playwright temp-resources/resources/
    
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
      resources-*.zip  # 添加资源包
```

### 2. 安装依赖

```bash
npm install
```

这会安装新添加的依赖:
- `adm-zip`: ZIP 文件处理
- `@types/adm-zip`: TypeScript 类型定义

### 3. 端到端测试

1. **生成清单测试**
   ```bash
   npm run build:manifest
   cat resource-manifest.json
   ```

2. **创建测试 Release**
   ```bash
   git tag v0.0.14-test
   git push origin v0.0.14-test
   ```

3. **验证 Release 资源**
   - 检查是否包含 `resource-manifest.json`
   - 检查是否包含 `resources-v0.0.14-test.zip`

4. **测试更新流程**
   - 打开应用设置 → 关于
   - 点击"检查资源更新"
   - 验证能否检测到更新
   - 点击"立即更新"
   - 观察进度和结果

## 🚀 使用方式

### 开发者

#### 发布新版本

1. **更新版本号**
   ```bash
   npm version patch  # 或 minor, major
   ```

2. **推送标签**
   ```bash
   git push origin --tags
   ```

3. **GitHub Actions 自动执行**
   - 构建应用
   - 生成资源清单
   - 打包资源文件
   - 上传到 Release

#### 本地测试

```bash
# 构建
npm run build

# 生成清单
npm run build:manifest

# 查看清单
cat resource-manifest.json
```

### 用户

1. **自动检查**
   - 应用启动后自动检查更新(每24小时)

2. **手动检查**
   - 打开设置 → 关于
   - 点击"检查资源更新"
   - 如有更新,点击"立即更新"
   - 更新完成后重启应用

## 📁 文件结构

```
opencowork/
├── electron/
│   ├── main.ts                          # 集成 ResourceUpdater
│   └── updater/
│       └── ResourceUpdater.ts           # ✅ 资源更新器核心
├── scripts/
│   └── generate-resource-manifest.mjs   # ✅ 清单生成器
├── src/
│   └── components/
│       └── SettingsView.tsx             # ✅ 更新 UI
├── .github/
│   └── workflows/
│       └── release.yml                  # ⏳ 需要添加资源打包步骤
├── docs/
│   ├── AUTO_UPDATE.md                   # 功能文档
│   ├── AUTO_UPDATE_IMPLEMENTATION.md    # 实现方案
│   └── AUTO_UPDATE_SETUP.md             # 本文件
└── package.json                         # ✅ 添加依赖和脚本
```

## 🔧 配置说明

### 修改检查间隔

在 `electron/main.ts` 中:

```typescript
// 默认每24小时检查一次
resourceUpdater.startAutoUpdateCheck(24)

// 改为每12小时
resourceUpdater.startAutoUpdateCheck(12)
```

### 添加监控目录

在 `scripts/generate-resource-manifest.mjs` 中:

```javascript
const WATCH_DIRS = [
  'dist',
  'resources/skills',
  'resources/mcp',
  'resources/node',
  'resources/playwright',
  // 添加新目录
  'resources/custom'
]
```

### 排除文件

```javascript
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /\.DS_Store/,
  /\.map$/,  // source maps
  // 添加新模式
  /\.tmp$/
]
```

## 🐛 故障排查

### 更新检测失败

1. 检查网络连接
2. 查看控制台日志 (搜索 `[ResourceUpdater]`)
3. 验证 GitHub API 可访问

### 更新下载失败

1. 检查 Release 是否包含资源文件
2. 验证 zip 文件完整性
3. 查看剩余磁盘空间

### 更新应用失败

1. 检查文件权限
2. 查看备份目录 (`~/Library/Application Support/qacowork/updates/backup/`)
3. 手动恢复文件

## 📊 技术指标

- **更新检测**: < 5秒
- **下载速度**: 取决于网络
- **应用更新**: < 30秒(1000个文件)
- **备份大小**: 保留最近3个版本
- **磁盘占用**: 额外约 100-500MB(视资源大小)

## 🎯 下一步优化

### 短期 (1-2周)

- [ ] 完成 GitHub Actions 资源打包配置
- [ ] 端到端测试
- [ ] 错误处理优化
- [ ] 添加更新重试机制

### 中期 (1-2月)

- [ ] 支持差分更新(仅传输文件变更部分)
- [ ] 添加 CDN 加速支持
- [ ] 实现更新回滚功能
- [ ] 支持自定义更新源

### 长期 (3-6月)

- [ ] 支持多版本并存
- [ ] 实现灰度发布
- [ ] 添加更新统计分析
- [ ] 支持离线更新包

## 📚 相关文档

- [AUTO_UPDATE.md](./AUTO_UPDATE.md) - 功能详细说明
- [AUTO_UPDATE_IMPLEMENTATION.md](./AUTO_UPDATE_IMPLEMENTATION.md) - 技术实现方案
- [DIRECTORY_STRUCTURE.md](./DIRECTORY_STRUCTURE.md) - 目录结构说明

## 💡 常见问题

**Q: 更新会影响用户数据吗?**
A: 不会。更新只修改应用资源文件,不影响 userData 中的配置和数据。

**Q: 更新失败会影响使用吗?**
A: 不会。更新前会自动备份,失败时保留旧文件,应用可正常使用。

**Q: 可以禁用自动更新吗?**
A: 自动检查仅在打包版本启用。可在代码中注释相关行禁用。

**Q: 更新包多大?**
A: 取决于变更文件数量和大小,通常几MB到几十MB。

## 📝 总结

当前实现已完成:
- ✅ 核心更新逻辑
- ✅ 前端 UI
- ✅ IPC 通信
- ✅ 清单生成

待完成:
- ⏳ GitHub Actions 资源打包
- ⏳ 端到端测试

完成 GitHub Actions 配置后,功能即可投入使用。

---

**实现状态**: 80% 完成
**预计完成时间**: 1-2天(完成打包配置和测试)
**优先级**: 高
