# Node.js 运行时管理

## 概述

应用程序内置了 Node.js 运行时，用于在打包后的应用中运行 Playwright 等需要 Node.js 环境的功能。

## 架构设计

### 1. 动态下载策略

为了减小 Git 仓库大小，Node.js 运行时**不会**提交到版本控制系统中，而是在以下时机动态准备：

- **CI/CD 构建时**：GitHub Actions 在构建应用前自动下载
- **本地开发时**：开发者可以手动运行脚本准备

### 2. 支持的平台

应用内置以下平台的 Node.js 运行时：

- **macOS ARM64** (`darwin-arm64`): 适用于 Apple Silicon (M1/M2/M3)
- **macOS x64** (`darwin-x64`): 适用于 Intel Mac
- **Windows x64** (`win32-x64`): 适用于 64 位 Windows

### 3. 目录结构

```
resources/node/
├── darwin-arm64/
│   ├── node              # Node.js 二进制文件
│   ├── npm               # npm 包装脚本
│   ├── npm-cli.js        # npm 主脚本
│   ├── lib/
│   │   └── node_modules/
│   │       └── npm/      # npm 完整模块
│   └── node_modules/
│       └── npm -> ../lib/node_modules/npm  # 符号链接
├── darwin-x64/
│   └── node
└── win32-x64/
    └── node.exe
```

## 使用方法

### 本地开发准备

如果您需要在本地测试 Playwright 功能，需要先准备 Node.js 运行时：

```bash
# 1. 下载 Node.js 运行时（所有平台）
node scripts/download-node.mjs

# 2. 准备 npm（仅当前平台）
node scripts/prepare-node-npm.mjs
```

### CI/CD 自动准备

GitHub Actions 会在构建时自动执行以下步骤：

```yaml
- name: Download and prepare Node.js runtimes
  run: node scripts/download-node.mjs

- name: Prepare npm for Node.js runtimes
  run: node scripts/prepare-node-npm.mjs
```

## 脚本说明

### 1. `download-node.mjs`

**功能**：下载所有支持平台的 Node.js 二进制文件

**特点**：
- 从 Node.js 官方源下载指定版本
- 自动解压并提取 `node` / `node.exe` 二进制文件
- 支持断点续传（如果文件已存在则跳过）
- 显示下载进度

**配置**：
```javascript
const NODE_VERSION = '20.18.0';  // Node.js 版本
```

### 2. `prepare-node-npm.mjs`

**功能**：从系统 Node.js 安装中复制 npm 及其依赖

**特点**：
- 检测系统 Node.js 和 npm 路径
- 复制 npm 可执行文件、主脚本和完整模块目录
- 创建必要的符号链接
- 仅准备当前运行平台的 npm

**注意事项**：
- 需要系统已安装 Node.js 和 npm
- npm 模块目录较大（约 50-80 MB）

## 版本管理

### 更新 Node.js 版本

1. 修改 `scripts/download-node.mjs` 中的 `NODE_VERSION`：
   ```javascript
   const NODE_VERSION = '20.18.0';  // 修改为新版本
   ```

2. 清除本地缓存：
   ```bash
   rm -rf resources/node/*/node*
   ```

3. 重新下载：
   ```bash
   node scripts/download-node.mjs
   node scripts/prepare-node-npm.mjs
   ```

### 版本选择建议

- **生产环境**：使用 LTS 版本（如 20.x）
- **开发环境**：可以使用最新稳定版
- **兼容性**：确保与 Playwright 版本兼容

## Git 忽略规则

以下文件和目录被 `.gitignore` 排除，不会提交到版本控制：

```gitignore
resources/node/*/node
resources/node/*/node.exe
resources/node/*/npm
resources/node/*/npm-cli.js
resources/node/*/lib
resources/node/*/node_modules
```

只有 `.gitkeep` 文件会被提交，用于保留目录结构。

## 故障排查

### 问题 1：应用提示"内置 Node.js 不存在"

**原因**：构建时未正确下载或打包 Node.js 运行时

**解决方案**：
1. 检查 GitHub Actions 日志，确认 `download-node.mjs` 步骤成功
2. 验证 `resources/node/` 目录是否包含在 `electron-builder.json5` 的 `extraResources` 中
3. 本地测试：
   ```bash
   node scripts/download-node.mjs
   npm run build
   ```

### 问题 2：npm 命令执行失败

**原因**：npm 模块目录不完整或符号链接损坏

**解决方案**：
```bash
# 重新准备 npm
rm -rf resources/node/*/lib resources/node/*/node_modules
node scripts/prepare-node-npm.mjs
```

### 问题 3：下载脚本超时或失败

**原因**：网络问题或 Node.js 官方源访问受限

**解决方案**：
1. 使用镜像源（修改 `download-node.mjs` 中的下载 URL）：
   ```javascript
   const downloadUrl = `https://npmmirror.com/mirrors/node/v${NODE_VERSION}/${nodeDistName}.${ext}`;
   ```
2. 手动下载并放置到 `temp-node-download/` 目录

### 问题 4：不同平台的兼容性问题

**症状**：在某些平台上 Node.js 无法执行

**检查清单**：
- [ ] 确认下载了正确架构的二进制文件
- [ ] Unix-like 系统：检查文件是否有执行权限 (`chmod +x`)
- [ ] Windows：确认文件名为 `node.exe` 而不是 `node`
- [ ] macOS：清除隔离属性 (`xattr -cr`)

## 性能优化

### 减小应用包大小

当前配置：
- **Node.js 二进制**：~90 MB (darwin-arm64)
- **npm 模块**：~50-80 MB
- **总计**：~140-170 MB

优化建议：
1. **仅打包必要的平台**：根据目标平台选择性打包
2. **按需下载**：类似 Playwright，将 Node.js 也改为按需下载
3. **使用更小的运行时**：考虑使用 Deno 或其他轻量级运行时

### 缓存策略

- **CI/CD**：可以配置 GitHub Actions cache 缓存下载的 Node.js
- **用户端**：Node.js 运行时随应用安装，无需额外下载

## 参考资料

- [Node.js 官方下载](https://nodejs.org/dist/)
- [Electron Builder - Extra Resources](https://www.electron.build/configuration/contents#extraresources)
- [npm 文档](https://docs.npmjs.com/)
