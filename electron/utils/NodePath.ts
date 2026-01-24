import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';

/**
 * 获取内置 Node.js 目录路径
 */
function getBuiltinNodeDir(): string | null {
  if (!app.isPackaged) {
    return null;
  }

  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  
  let nodeDir: string;

  if (platform === 'darwin') {
    nodeDir = path.join(process.resourcesPath, 'node', `darwin-${arch}`);
  } else if (platform === 'win32') {
    nodeDir = path.join(process.resourcesPath, 'node', 'win32-x64');
  } else {
    return null;
  }

  return fs.existsSync(nodeDir) ? nodeDir : null;
}

/**
 * 获取内置 Node.js 可执行文件路径
 * 
 * 开发环境：返回 'node'（使用系统安装的 Node.js）
 * 生产环境：返回内置 Node.js 的完整路径，如果不存在则回退到 'node'
 * 
 * @returns Node.js 可执行文件路径，如果不存在则返回 'node'
 */
export function getBuiltinNodePath(): string {
  if (!app.isPackaged) {
    // 开发环境：使用系统的 node
    return 'node';
  }

  const nodeDir = getBuiltinNodeDir();
  if (!nodeDir) {
    return 'node';
  }

  const platform = process.platform;
  const nodeExecutable = platform === 'win32' ? 'node.exe' : 'node';
  const nodePath = path.join(nodeDir, nodeExecutable);
  
  if (fs.existsSync(nodePath)) {
    // 确保文件有执行权限（macOS）
    if (platform === 'darwin') {
      try {
        fs.chmodSync(nodePath, 0o755);
      } catch (error) {
        console.warn(`[NodePath] Failed to set executable permission: ${error}`);
      }
    }
    return nodePath;
  }

  // 如果内置 node 不存在，回退到系统 node
  console.warn(`[NodePath] Built-in Node.js not found at ${nodePath}, falling back to system node`);
  return 'node';
}

/**
 * 获取内置 npm 可执行文件路径
 * 
 * npm 通常位于 Node.js 安装目录的 lib/node_modules/npm/bin/npm
 * 或者与 node 在同一目录下（某些发行版）
 * 
 * 开发环境：返回 'npm'（使用系统安装的 npm）
 * 生产环境：返回内置 npm 的完整路径，如果不存在则回退到 'npm'
 * 
 * @returns npm 可执行文件路径，如果不存在则返回 'npm'
 */
export function getBuiltinNpmPath(): string {
  if (!app.isPackaged) {
    // 开发环境：使用系统的 npm
    return 'npm';
  }

  const nodeDir = getBuiltinNodeDir();
  if (!nodeDir) {
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
    // 方式4: npm 在 node_modules/npm/bin/ 目录
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
  
  if (!app.isPackaged) {
    // 开发环境：不需要特殊设置
    return env;
  }

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
