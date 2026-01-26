# v0.0.16 发布说明

## 问题诊断

### 根本原因
打包后的应用提示"内置 Node.js 不存在"，路径为：
```
/Applications/测试助手.app/Contents/Resources/resources/node/darwin-arm64/node
```

**诊断结果**：
1. ✅ 本地 `resources/node/` 目录存在，包含完整的 Node.js 运行时
2. ❌ Git 仓库中只有 `node` 二进制文件，但缺少 `lib/node_modules/npm` 等关键目录
3. ❌ GitHub Actions 构建时，由于 Git 中缺少完整的 Node.js 环境，导致打包后的应用无法正常运行

### 为什么本地有而 Git 没有？
- `resources/node/` 目录包含约 140-170 MB 的文件
- npm 模块目录（`lib/node_modules/npm`）约 50-80 MB
- 这些大文件不应该提交到 Git（会极大增加仓库大小）

## 解决方案

### 核心思路：动态下载策略

**不再将 Node.js 运行时提交到 Git**，而是在构建时动态下载：

1. **CI/CD 构建时**：GitHub Actions 自动下载
2. **本地开发时**：开发者手动运行脚本准备

### 实现步骤

#### 1. 创建下载脚本
创建 `scripts/download-node.mjs`：
- 从 Node.js 官方源下载指定版本（v20.18.0）
- 支持多平台：macOS (arm64/x64)、Windows (x64)
- 显示下载进度，支持断点续传
- 自动解压并提取 `node` / `node.exe` 二进制文件

#### 2. 修改 GitHub Actions
在 `.github/workflows/release.yml` 中添加：
```yaml
- name: Download and prepare Node.js runtimes
  run: node scripts/download-node.mjs

- name: Prepare npm for Node.js runtimes
  run: node scripts/prepare-node-npm.mjs
```

#### 3. 更新 .gitignore
排除 Node.js 运行时文件：
```gitignore
resources/node/*/node
resources/node/*/node.exe
resources/node/*/npm
resources/node/*/npm-cli.js
resources/node/*/lib
resources/node/*/node_modules
```

#### 4. 清理 Git 历史
移除已提交的 Node.js 二进制文件：
```bash
git rm --cached resources/node/*/node*
```

#### 5. 保留目录结构
添加 `.gitkeep` 文件保留空目录。

## 版本变更

### v0.0.16 新特性

✨ **Node.js 运行时动态下载**
- CI 构建时自动下载 Node.js
- 支持 macOS (arm64/x64) 和 Windows (x64)
- 减小 Git 仓库大小（移除 ~200MB 文件）

📝 **新增文档**
- `docs/NODE_RUNTIME.md`：Node.js 运行时管理指南

🔧 **技术改进**
- 优化构建流程
- 提高构建可靠性
- 更好的平台兼容性

## 测试计划

### 1. 等待 GitHub Actions 构建完成
预计时间：10-15 分钟

### 2. 验证构建产物
检查 Release 页面的文件：
- ✅ `测试助手-Mac-0.0.16-Installer.dmg`
- ✅ `测试助手-Windows-0.0.16-Setup.exe`
- ✅ `resources-v0.0.16.zip`
- ✅ `resource-manifest.json`（版本应为 `0.0.16`）

### 3. 下载并安装
在 macOS 上安装 `v0.0.16`：
```bash
# 1. 下载 DMG 文件
# 2. 打开并拖拽到 Applications
# 3. 清除隔离属性
xattr -cr /Applications/测试助手.app
# 4. 启动应用
```

### 4. 测试 Playwright 功能
1. 打开应用后，应显示"需要安装 Playwright 浏览器"提示
2. 点击"立即安装"按钮
3. **关键验证点**：安装过程应该成功启动，不应再提示"内置 Node.js 不存在"
4. 等待 Playwright 和 Chromium 下载完成
5. 切换到"自动化"标签，测试浏览器功能

### 5. 测试自动更新
如果您有 `v0.0.14` 或 `v0.0.15` 客户端：
1. 启动旧版本客户端
2. 等待 1 分钟（自动更新检查间隔）
3. 应显示"发现新版本 v0.0.16"提示
4. 点击"立即更新"
5. 验证更新过程

## 预期结果

### ✅ 成功标志
1. 应用能够正常启动
2. Playwright 安装过程能够正常执行（不再提示 Node.js 不存在）
3. 自动更新功能正常工作
4. 所有功能正常运行

### ❌ 如果仍然失败
可能的原因：
1. **下载脚本执行失败**：检查 GitHub Actions 日志中的 "Download and prepare Node.js runtimes" 步骤
2. **打包配置问题**：确认 `electron-builder.json5` 的 `extraResources` 包含 `resources/node`
3. **文件权限问题**：Node.js 二进制文件可能缺少执行权限

## 后续步骤

### 如果测试成功
1. ✅ 确认 Node.js 运行时问题已解决
2. 🔄 将自动更新检查频率改回 24 小时：
   ```typescript
   // electron/main.ts
   resourceUpdater.startAutoUpdateCheck(24)
   ```
3. 📝 更新用户文档
4. 🎉 发布正式版本

### 如果测试失败
1. 查看 GitHub Actions 构建日志
2. 下载构建产物，手动检查 `resources/node/` 目录
3. 根据错误信息调整下载脚本或构建配置
4. 发布修复版本 `v0.0.17`

## 技术细节

### Node.js 版本
- **版本**：20.18.0 (LTS)
- **来源**：https://nodejs.org/dist/v20.18.0/
- **平台**：
  - darwin-arm64: `node-v20.18.0-darwin-arm64.tar.gz`
  - darwin-x64: `node-v20.18.0-darwin-x64.tar.gz`
  - win32-x64: `node-v20.18.0-win32-x64.zip`

### 文件大小
- **Node.js 二进制**：~90 MB (darwin-arm64)
- **npm 模块**：~50-80 MB
- **总应用包大小**：预计增加 ~140-170 MB

### CI/CD 流程
```
1. Checkout 代码
2. 安装依赖 (npm ci)
3. 下载 Node.js 运行时 ← 新增
4. 准备 npm ← 新增
5. TypeScript 编译检查
6. 构建应用
7. 生成资源清单
8. 打包资源
9. 上传到 Release
```

## 参考文档

- 📖 [Node.js 运行时管理](docs/NODE_RUNTIME.md)
- 📖 [自动更新故障排查](docs/AUTO_UPDATE_TROUBLESHOOTING.md)
- 📖 [macOS 安装指南](docs/MACOS_INSTALL.md)
- 📖 [Playwright 下载配置](docs/PLAYWRIGHT_DOWNLOAD.md)

## 发布时间
2026-01-26

## 发布人
AI Assistant (Claude)

---

## 监控构建状态

🔗 GitHub Actions: https://github.com/shileima/opencowork/actions
🔗 Release 页面: https://github.com/shileima/opencowork/releases

**下一步：等待构建完成，然后按照测试计划进行验证。**
