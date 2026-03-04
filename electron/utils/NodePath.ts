import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';

/**
 * 获取内置 Node.js 目录路径（供 deploy 等子进程使用）
 */
export function getBuiltinNodeDir(): string | null {
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  
  let nodeDir: string;

  if (platform === 'darwin') {
    // 开发环境和生产环境都使用内置 Node.js
    nodeDir = app.isPackaged
      ? path.join(process.resourcesPath, 'node', `darwin-${arch}`)
      : path.join(app.getAppPath(), 'resources', 'node', `darwin-${arch}`);
  } else if (platform === 'win32') {
    nodeDir = app.isPackaged
      ? path.join(process.resourcesPath, 'node', 'win32-x64')
      : path.join(app.getAppPath(), 'resources', 'node', 'win32-x64');
  } else if (platform === 'linux') {
    nodeDir = app.isPackaged
      ? path.join(process.resourcesPath, 'node', `linux-${arch}`)
      : path.join(app.getAppPath(), 'resources', 'node', `linux-${arch}`);
  } else {
    return null;
  }

  return fs.existsSync(nodeDir) ? nodeDir : null;
}

/**
 * 获取内置 Node.js 可执行文件路径
 * 
 * 开发环境和生产环境都使用内置 Node.js
 * 
 * @returns Node.js 可执行文件路径，如果不存在则回退到 'node'
 */
export function getBuiltinNodePath(): string {
  const nodeDir = getBuiltinNodeDir();
  if (!nodeDir) {
    console.warn(`[NodePath] Built-in Node.js directory not found, falling back to system node`);
    return 'node';
  }

  const platform = process.platform;
  const nodeExecutable = platform === 'win32' ? 'node.exe' : 'node';
  const nodePath = path.join(nodeDir, nodeExecutable);
  
  if (fs.existsSync(nodePath)) {
    // 确保文件有执行权限（macOS/Linux）
    if (platform !== 'win32') {
      try {
        fs.chmodSync(nodePath, 0o755);
      } catch (error) {
        console.warn(`[NodePath] Failed to set executable permission: ${error}`);
      }
    }
    console.log(`[NodePath] Using built-in Node.js: ${nodePath}`);
    return nodePath;
  }

  // 如果内置 node 不存在，回退到系统 node
  console.warn(`[NodePath] Built-in Node.js not found at ${nodePath}, falling back to system node`);
  return 'node';
}

/**
 * 获取内置 npm 可执行文件路径
 * 
 * 注意：npm 脚本会在 process.execPath 的目录下查找 node_modules/npm/bin/npm-cli.js
 * 但我们的 npm 模块在 lib/node_modules/npm，所以需要特殊处理
 * 
 * 开发环境和生产环境都使用内置 npm
 * 
 * @returns npm 可执行文件路径，如果不存在则回退到 'npm'
 */
export function getBuiltinNpmPath(): string {
  const nodeDir = getBuiltinNodeDir();
  if (!nodeDir) {
    console.warn(`[NodePath] Built-in Node.js directory not found, falling back to system npm`);
    return 'npm';
  }

  const platform = process.platform;
  
  // 尝试多个可能的 npm 路径
  const possibleNpmPaths = [
    // 方式1: npm 与 node 在同一目录（我们复制的方式）
    path.join(nodeDir, platform === 'win32' ? 'npm.cmd' : 'npm'),
    // 方式2: npm 在 lib/node_modules/npm/bin/ 目录（标准安装）
    path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', platform === 'win32' ? 'npm.cmd' : 'npm'),
    // 方式3: npm 在父目录的 lib/node_modules/npm/bin/ 目录
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', platform === 'win32' ? 'npm.cmd' : 'npm'),
    // 方式4: npm 在 node_modules/npm/bin/ 目录（npm 脚本期望的位置）
    path.join(nodeDir, 'node_modules', 'npm', 'bin', platform === 'win32' ? 'npm.cmd' : 'npm'),
  ];

  for (const npmPath of possibleNpmPaths) {
    if (fs.existsSync(npmPath)) {
      // 确保文件有执行权限（macOS/Linux）
      if (platform !== 'win32') {
        try {
          fs.chmodSync(npmPath, 0o755);
        } catch (error) {
          console.warn(`[NodePath] Failed to set executable permission for npm: ${error}`);
        }
      }
      return npmPath;
    }
  }

  // 如果内置 npm 不存在，回退到系统 npm
  console.warn(`[NodePath] Built-in npm not found, falling back to system npm`);
  return 'npm';
}

/**
 * 获取 npm-cli.js 路径（用于直接使用 node 执行）
 * 
 * 当 npm 脚本无法正常工作时，可以直接使用 node 执行 npm-cli.js
 * 
 * @returns npm-cli.js 路径，如果不存在则返回 null
 */
export function getBuiltinNpmCliJsPath(): string | null {
  const nodeDir = getBuiltinNodeDir();
  if (!nodeDir) {
    return null;
  }

  // npm-cli.js 在 lib/node_modules/npm/bin/npm-cli.js
  const npmCliJsPath = path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  
  if (fs.existsSync(npmCliJsPath)) {
    return npmCliJsPath;
  }

  return null;
}

/**
 * 获取 npx-cli.js 路径（用于直接使用 node 执行，绕过 npx 脚本）
 * 避免 "Class extends value undefined is not a constructor or null" 等 npm 内部错误
 */
export function getBuiltinNpxCliJsPath(): string | null {
  const nodeDir = getBuiltinNodeDir();
  if (!nodeDir) {
    return null;
  }
  const npxCliPath = path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');
  return fs.existsSync(npxCliPath) ? npxCliPath : null;
}

/**
 * 根据 node 路径获取同目录下的 npx-cli.js（用于 NodeVersionManager 缓存的 Node）
 */
export function getNpxCliPathForNode(nodePath: string): string | null {
  if (!nodePath || nodePath === 'node') return null;
  const nodeDir = path.dirname(nodePath);
  const npxCliPath = path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');
  return fs.existsSync(npxCliPath) ? npxCliPath : null;
}

/**
 * 获取 npm 环境变量配置
 * 
 * npm 需要特定的环境变量才能正常工作：
 * - PATH: 包含 node 和 npm 的目录
 * - NODE_PATH: Node.js 模块搜索路径
 * 
 * @returns 环境变量对象
 */
export function getNpmEnvVars(): Record<string, string> {
  const env: Record<string, string> = {};
  
  const nodeDir = getBuiltinNodeDir();
  if (!nodeDir) {
    return env;
  }

  const platform = process.platform;
  const nodePath = getBuiltinNodePath();
  const npmPath = getBuiltinNpmPath();
  
  // 设置 PATH，确保能找到 node 和 npm
  const nodeBinDir = path.dirname(nodePath);
  const npmBinDir = path.dirname(npmPath);
  
  // 合并 PATH，优先使用内置的 node 和 npm
  // 注意：npm 脚本会查找 node，所以 node 的目录必须在 PATH 中
  const existingPath = process.env.PATH || '';
  const pathSeparator = platform === 'win32' ? ';' : ':';
  
  // 重要：node 目录必须在最前面，这样 npm 脚本能找到它
  env.PATH = `${nodeBinDir}${pathSeparator}${npmBinDir}${pathSeparator}${existingPath}`;
  
  // 设置 NODE_PATH，让 npm 能找到自己的模块
  const npmModuleDir = path.join(nodeDir, 'lib', 'node_modules');
  if (fs.existsSync(npmModuleDir)) {
    const existingNodePath = process.env.NODE_PATH || '';
    env.NODE_PATH = existingNodePath 
      ? `${npmModuleDir}${path.delimiter}${existingNodePath}`
      : npmModuleDir;
  }
  
  // npm 脚本会通过 node 来查找自己的位置
  // 它使用 process.execPath 来找到 Node.js 安装目录
  // 然后在该目录下查找 node_modules/npm/bin/npm-cli.js
  
  // 设置 npm 配置前缀（npm 的安装位置）
  // 这应该指向包含 lib/node_modules/npm 的目录
  const npmPrefix = nodeDir;
  env.NPM_CONFIG_PREFIX = npmPrefix;
  
  // 重要：npm 脚本会查找 node_modules/npm/bin/npm-cli.js
  // 相对于 Node.js 安装目录（process.execPath 的目录）
  // 由于我们的 node 在 nodeDir 中，npm 模块在 nodeDir/lib/node_modules/npm
  // npm 脚本应该能找到它，因为它是相对于 node 的位置查找的
  
  return env;
}

/** 内置 pnpm 入口：nodeDir/pnpm/bin/pnpm.cjs（依赖同级的 ../dist，需整包复制） */
const BUILTIN_PNPM_BIN = path.join('pnpm', 'bin', 'pnpm.cjs');

/**
 * 获取内置 pnpm 入口路径（需先执行 scripts/prepare-pnpm.mjs 放入各 platform 的 pnpm/ 目录）
 * 直接运行 .app 或 DMG 安装后均通过 getBuiltinNodeDir() 解析到正确 resources 路径
 * 使用方式：spawn(getBuiltinNodePath(), [getBuiltinPnpmPath(), 'exec', '@bfe/webstatic', ...])
 */
export function getBuiltinPnpmPath(): string | null {
  const nodeDir = getBuiltinNodeDir();
  if (!nodeDir) {
    console.warn('[NodePath] getBuiltinPnpmPath: nodeDir 为空');
    return null;
  }
  const pnpmBinPath = path.join(nodeDir, BUILTIN_PNPM_BIN);
  if (!fs.existsSync(pnpmBinPath)) {
    console.warn('[NodePath] getBuiltinPnpmPath: 未找到 pnpm.cjs:', pnpmBinPath);
    return null;
  }
  const pnpmDistDir = path.join(nodeDir, 'pnpm', 'dist');
  if (!fs.existsSync(pnpmDistDir)) {
    console.warn('[NodePath] getBuiltinPnpmPath: pnpm/dist 缺失（pnpm 依赖此目录，执行可能失败）:', pnpmDistDir);
  }
  return pnpmBinPath;
}

const NPX_NAME = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/**
 * 解析系统 npx 的完整路径（用于 DMG 安装后部署上传：GUI 启动时 PATH 常不包含 Node）
 * 依次检查：当前 PATH、/usr/local/bin、/opt/homebrew/bin、nvm、fnm、volta
 */
export function getSystemNpxPath(): string | null {
  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const home = process.env.HOME || process.env.USERPROFILE || '';

  const check = (dir: string): string | null => {
    if (!dir) return null;
    const full = path.join(dir, NPX_NAME);
    try {
      if (fs.existsSync(full)) return full;
    } catch {
      // ignore
    }
    return null;
  };

  // 1. 当前进程 PATH
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(pathSeparator)) {
    const found = check(dir.trim());
    if (found) return found;
  }

  // 2. 常见安装位置（macOS/Linux）
  const commonDirs = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'bin'),
  ].filter(Boolean);
  for (const dir of commonDirs) {
    const found = check(dir);
    if (found) return found;
  }

  // 3. nvm
  const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
  if (fs.existsSync(nvmDir)) {
    const defaultVer = path.join(nvmDir, 'alias', 'default');
    let nodeVer: string | null = null;
    try {
      if (fs.existsSync(defaultVer)) {
        nodeVer = fs.readFileSync(defaultVer, 'utf-8').trim();
      }
    } catch {
      // ignore
    }
    const versionsDir = path.join(nvmDir, 'versions', 'node');
    if (fs.existsSync(versionsDir)) {
      const versions = fs.readdirSync(versionsDir);
      const toTry = nodeVer ? [nodeVer, ...versions.filter((v) => v !== nodeVer)] : versions;
      for (const v of toTry) {
        const npxPath = check(path.join(versionsDir, v, 'bin'));
        if (npxPath) return npxPath;
      }
    }
  }

  // 4. fnm
  const fnmDir = process.env.FNM_DIR || path.join(home, '.fnm');
  if (fs.existsSync(fnmDir)) {
    const multiversions = path.join(fnmDir, 'node-versions');
    const aliasDir = path.join(fnmDir, 'aliases', 'default');
    try {
      if (fs.existsSync(aliasDir)) {
        const alias = fs.readFileSync(aliasDir, 'utf-8').trim();
        const npxPath = check(path.join(multiversions, alias, 'installation', 'bin'));
        if (npxPath) return npxPath;
      }
      if (fs.existsSync(multiversions)) {
        const entries = fs.readdirSync(multiversions, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            const npxPath = check(path.join(multiversions, e.name, 'installation', 'bin'));
            if (npxPath) return npxPath;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 5. volta
  const voltaBin = path.join(home, '.volta', 'bin');
  const found = check(voltaBin);
  if (found) return found;

  return null;
}
