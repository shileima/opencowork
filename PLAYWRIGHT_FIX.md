# Playwright 安装问题修复（完整版）

## 问题描述

### 问题 1：错误的命令构造

用户在点击"立即安装"按钮安装 Playwright 时遇到错误：

```
Command failed: "node" "npm" install playwright
Error: Cannot find module '/Users/shilei/ai/opencowork/resources/playwright/npm'
```

### 问题 2：使用系统 Node.js

即使修复了命令问题，应用仍在使用系统的 Node.js v18.19.1，而不是内置的 Node.js：

```
npm WARN EBADENGINE Unsupported engine
npm ERR! ENOTEMPTY: directory not empty
```

并且安装位置错误，安装到了项目根目录的 `node_modules/` 而不是 `resources/playwright/`。

## 根本原因

### 原因 1：命令构造错误

在 `electron/utils/PlaywrightManager.ts` 中，安装 Playwright 的命令构造有误：

```typescript
// 错误的代码
npmCommand = `"${nodePath}" "${npmPath}" install playwright`
```

这里 `npmPath` 是 npm 脚本的路径（例如 `/path/to/npm`），但代码错误地将其作为参数传递给 `node`，导致 node 试图将 npm 脚本当作 JavaScript 文件执行。

### 原因 2：开发环境使用系统 Node.js

在 `electron/utils/NodePath.ts` 中，开发环境默认使用系统 Node.js：

```typescript
// 错误的代码
export function getBuiltinNodePath(): string {
  if (!app.isPackaged) {
    return 'node';  // 使用系统 node
  }
  // ...
}
```

### 原因 3：缺少 Node.js 可执行文件

`resources/node/darwin-arm64/` 目录只有 npm 模块，没有 Node.js 可执行文件。

## 解决方案

### 修复 1：正确的命令构造

直接执行 npm 脚本，而不是将其作为参数传递给 node：

```typescript
// 修复后的代码
const npmCommand = `"${npmPath}" install playwright --no-save --no-package-lock`
```

### 修复 2：开发环境也使用内置 Node.js

修改 `NodePath.ts`，让开发环境和生产环境都使用内置 Node.js：

```typescript
function getBuiltinNodeDir(): string | null {
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  
  let nodeDir: string;

  if (platform === 'darwin') {
    // 开发环境和生产环境都使用内置 Node.js
    nodeDir = app.isPackaged
      ? path.join(process.resourcesPath, 'node', `darwin-${arch}`)
      : path.join(app.getAppPath(), 'resources', 'node', `darwin-${arch}`);
  }
  // ...
}
```

### 修复 3：准备 Node.js 可执行文件

更新 `scripts/prepare-node-npm.mjs`，复制 Node.js 可执行文件：

```javascript
// 复制 Node.js 可执行文件
const sourceNodePath = path.join(systemNodeDir, nodeExecutable);
const targetNodePath = path.join(targetDir, nodeExecutable);

fs.copyFileSync(sourceNodePath, targetNodePath);
fs.chmodSync(targetNodePath, 0o755);
```

### 修复 4：创建 package.json

在安装 Playwright 前创建 `package.json`，避免安装到错误位置：

```typescript
// 创建 package.json（如果不存在）
const packageJsonPath = path.join(this.playwrightPath, 'package.json')
if (!fs.existsSync(packageJsonPath)) {
  fs.writeFileSync(packageJsonPath, JSON.stringify({
    name: 'playwright-runtime',
    version: '1.0.0',
    description: 'Playwright runtime for automation',
    private: true
  }, null, 2))
}
```

## 测试步骤

### 准备工作

1. **准备内置 Node.js**：
   ```bash
   npm run prepare:node-npm
   ```
   这会从系统复制 Node.js 和 npm 到 `resources/node/darwin-arm64/`

2. **验证文件**：
   ```bash
   ls -lh resources/node/darwin-arm64/
   # 应该看到：
   # - node (84MB)
   # - npm
   # - npm-cli.js
   # - lib/node_modules/npm/
   ```

### 开发环境测试

1. **启动应用**：
   ```bash
   npm run dev
   ```

2. **检查日志**：
   打开开发者工具，应该看到：
   ```
   [NodePath] Using built-in Node.js: /path/to/resources/node/darwin-arm64/node
   ```

3. **安装 Playwright**：
   - 点击"立即安装"按钮
   - 观察进度和日志

### 生产环境测试

1. **构建应用**：
   ```bash
   npm run build:dir
   ```

2. **启动打包后的应用**：
   ```bash
   open release/0.0.33/mac-arm64/QACowork.app
   ```

3. **安装 Playwright**：
   - 点击"立即安装"按钮
   - 观察安装进度

## 预期结果

- Playwright 包应该成功安装到 `resources/playwright/node_modules/playwright/`
- Chromium 浏览器应该成功下载到 `resources/playwright/browsers/chromium-*/`
- 安装完成后显示"安装完成! 🎉"

## 技术细节

### npm 脚本 vs npm-cli.js

- **npm 脚本**（`/usr/local/bin/npm`）：这是一个 shell 脚本，包装了 node 和 npm-cli.js
- **npm-cli.js**：这是 npm 的实际 JavaScript 入口点

在 Electron 打包环境中：
- 如果我们打包了完整的 Node.js + npm，应该有 `lib/node_modules/npm/bin/npm-cli.js`
- 如果只有 npm 脚本，应该直接执行它（它会自己找到 node）

### 环境变量

代码还设置了必要的环境变量：
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'`：先安装 Playwright 包，不下载浏览器
- `PLAYWRIGHT_BROWSERS_PATH`：指定浏览器下载位置
- `PATH`、`NODE_PATH`：确保能找到 node 和 npm

## 相关文件

### 核心文件

- `electron/utils/PlaywrightManager.ts`：Playwright 安装管理器
- `electron/utils/NodePath.ts`：Node.js 和 npm 路径管理
- `src/components/PlaywrightPrompt.tsx`：安装提示 UI 组件
- `scripts/prepare-node-npm.mjs`：准备内置 Node.js 和 npm 的脚本

### 文档

- `docs/BUILTIN_NODE_IMPLEMENTATION.md`：内置 Node.js 实现的完整文档
- `PLAYWRIGHT_FIX.md`：本文档

## 修改摘要

### 修改的文件

1. **electron/utils/NodePath.ts**
   - ✅ 开发环境也使用内置 Node.js
   - ✅ 移除 `if (!app.isPackaged)` 的特殊处理
   - ✅ 添加日志输出

2. **electron/utils/PlaywrightManager.ts**
   - ✅ 修复命令构造逻辑
   - ✅ 创建 package.json
   - ✅ 使用 `--no-save --no-package-lock` 参数
   - ✅ 移除未使用的导入

3. **scripts/prepare-node-npm.mjs**
   - ✅ 添加复制 Node.js 可执行文件的逻辑
   - ✅ 验证 Node.js 版本
   - ✅ 改进错误处理

### 新增的文件

- `docs/BUILTIN_NODE_IMPLEMENTATION.md`：详细的实现文档

## 验证清单

- [x] Node.js 可执行文件已复制到 `resources/node/darwin-arm64/`
- [x] npm 模块已复制到 `resources/node/darwin-arm64/lib/node_modules/npm/`
- [x] 符号链接已创建：`node_modules/npm -> lib/node_modules/npm`
- [x] 开发环境使用内置 Node.js
- [x] 生产环境使用内置 Node.js
- [x] Playwright 安装到正确位置（`resources/playwright/`）
- [x] TypeScript 编译无错误
- [x] 应用构建成功
