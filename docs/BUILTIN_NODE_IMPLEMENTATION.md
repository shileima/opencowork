# 内置 Node.js 实现文档

## 概述

为了确保应用在任何环境下都使用统一的 Node.js 版本，我们实现了内置 Node.js 功能。无论是开发环境还是生产环境，应用都会使用 `resources/node/` 目录下的 Node.js 和 npm。

## 架构设计

### 目录结构

```
resources/
└── node/
    ├── darwin-arm64/          # macOS ARM64 (Apple Silicon)
    │   ├── node               # Node.js 可执行文件 (84MB)
    │   ├── npm                # npm 脚本
    │   ├── npm-cli.js         # npm CLI 入口
    │   ├── lib/
    │   │   └── node_modules/
    │   │       └── npm/       # npm 完整模块 (~10MB)
    │   └── node_modules/
    │       └── npm -> ../lib/node_modules/npm  # 符号链接
    ├── darwin-x64/            # macOS Intel
    └── win32-x64/             # Windows
```

### 核心文件

1. **`electron/utils/NodePath.ts`**
   - 获取内置 Node.js 和 npm 的路径
   - 配置必要的环境变量
   - 开发环境和生产环境统一使用内置版本

2. **`electron/utils/PlaywrightManager.ts`**
   - 使用内置 Node.js 和 npm 安装 Playwright
   - 管理 Playwright 和浏览器的安装

3. **`scripts/prepare-node-npm.mjs`**
   - 从系统复制 Node.js 和 npm 到 `resources/node/`
   - 在构建前运行，准备内置资源

## 实现细节

### 1. NodePath.ts 修改

**关键变更**：开发环境和生产环境都使用内置 Node.js

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

**环境变量配置**：

```typescript
export function getNpmEnvVars(): Record<string, string> {
  // 设置 PATH，确保能找到 node 和 npm
  env.PATH = `${nodeBinDir}${pathSeparator}${npmBinDir}${pathSeparator}${existingPath}`;
  
  // 设置 NODE_PATH，让 npm 能找到自己的模块
  env.NODE_PATH = npmModuleDir;
  
  // 设置 npm 配置前缀
  env.NPM_CONFIG_PREFIX = npmPrefix;
  
  return env;
}
```

### 2. PlaywrightManager.ts 修改

**安装策略**：

1. 创建 `package.json`（如果不存在）
2. 使用内置 npm 安装 Playwright
3. 使用 `--no-save --no-package-lock` 避免修改项目依赖

```typescript
// 创建 package.json
const packageJsonPath = path.join(this.playwrightPath, 'package.json')
if (!fs.existsSync(packageJsonPath)) {
  fs.writeFileSync(packageJsonPath, JSON.stringify({
    name: 'playwright-runtime',
    version: '1.0.0',
    description: 'Playwright runtime for automation',
    private: true
  }, null, 2))
}

// 使用内置 npm 安装
const npmCommand = `"${npmPath}" install playwright --no-save --no-package-lock`
await execAsync(npmCommand, {
  cwd: this.playwrightPath,
  env: {
    ...process.env,
    ...npmEnv,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'
  }
})
```

### 3. prepare-node-npm.mjs 脚本

**功能**：

1. 从系统 Node.js 安装中复制 Node.js 可执行文件
2. 复制 npm 脚本和 npm-cli.js
3. 复制完整的 npm 模块目录（包含所有依赖）
4. 创建符号链接：`node_modules/npm -> lib/node_modules/npm`

**使用方法**：

```bash
npm run prepare:node-npm
```

## 使用流程

### 开发环境

1. **首次设置**：
   ```bash
   npm run prepare:node-npm
   ```
   这会从系统复制 Node.js 和 npm 到 `resources/node/darwin-arm64/`

2. **启动开发**：
   ```bash
   npm run dev
   ```
   应用会自动使用 `resources/node/` 下的 Node.js

3. **安装 Playwright**：
   - 在应用中点击"立即安装"按钮
   - 使用内置 Node.js 和 npm 安装到 `resources/playwright/`

### 生产环境

1. **构建应用**：
   ```bash
   npm run build
   ```
   `resources/node/` 会被打包到应用中

2. **用户使用**：
   - 用户启动应用
   - 点击"立即安装" Playwright
   - 使用内置 Node.js 和 npm 安装

## 优势

1. **版本统一**：所有用户使用相同的 Node.js 版本（v18.19.1）
2. **环境隔离**：不依赖系统 Node.js，避免版本冲突
3. **离线友好**：内置 Node.js 和 npm，减少网络依赖
4. **一致体验**：开发环境和生产环境行为一致

## 注意事项

### 1. Node.js 版本

当前使用 Node.js v18.19.1，如果需要升级：

1. 更新系统 Node.js 版本
2. 运行 `npm run prepare:node-npm`
3. 重新构建应用

### 2. 平台支持

- ✅ macOS ARM64 (Apple Silicon)
- ✅ macOS x64 (Intel)
- ⚠️  Windows（待实现）
- ❌ Linux（不需要，使用系统 Node.js）

### 3. 文件大小

- Node.js 可执行文件：~84MB
- npm 模块：~10MB
- 总计：~94MB per platform

### 4. 构建流程

确保在构建前运行准备脚本：

```json
{
  "scripts": {
    "prebuild": "npm run prepare:node-npm",
    "build": "tsc && vite build && electron-builder"
  }
}
```

## 故障排查

### 问题 1：找不到 Node.js

**症状**：
```
[NodePath] Built-in Node.js not found, falling back to system node
```

**解决方案**：
```bash
npm run prepare:node-npm
```

### 问题 2：npm 安装失败

**症状**：
```
Cannot find module '/path/to/npm'
```

**解决方案**：
1. 检查 `resources/node/darwin-arm64/npm` 是否存在
2. 检查 `resources/node/darwin-arm64/lib/node_modules/npm/` 是否存在
3. 重新运行 `npm run prepare:node-npm`

### 问题 3：Playwright 安装到错误位置

**症状**：
```
npm ERR! ENOTEMPTY: directory not empty
```

**解决方案**：
- 确保 `PlaywrightManager.ts` 中的 `cwd` 设置正确
- 安装应该在 `resources/playwright/` 目录，而不是项目根目录

## 测试验证

### 1. 验证内置 Node.js

```bash
# 检查文件是否存在
ls -lh resources/node/darwin-arm64/node

# 测试 Node.js
resources/node/darwin-arm64/node --version
# 输出：v18.19.1
```

### 2. 验证内置 npm

```bash
# 设置环境变量
export PATH="$(pwd)/resources/node/darwin-arm64:$PATH"
export NODE_PATH="$(pwd)/resources/node/darwin-arm64/lib/node_modules"

# 测试 npm
npm --version
# 输出：10.2.4
```

### 3. 验证 Playwright 安装

1. 启动应用（开发模式）
2. 点击"立即安装"按钮
3. 观察控制台输出：
   ```
   [NodePath] Using built-in Node.js: /path/to/resources/node/darwin-arm64/node
   正在安装 Playwright 包...
   Playwright 包安装完成 ✓
   正在下载 Chromium...
   Chromium 安装完成 ✓
   安装完成! 🎉
   ```

## 未来改进

1. **自动下载 Node.js**：不依赖系统 Node.js，从官方源下载
2. **多版本支持**：支持切换不同的 Node.js 版本
3. **Windows 支持**：实现 Windows 平台的内置 Node.js
4. **增量更新**：只更新变化的文件，减少下载大小

## 参考资料

- [Node.js 官方文档](https://nodejs.org/docs/)
- [npm CLI 文档](https://docs.npmjs.com/cli/)
- [Electron 打包文档](https://www.electron.build/)
- [Playwright 安装指南](https://playwright.dev/docs/intro)
