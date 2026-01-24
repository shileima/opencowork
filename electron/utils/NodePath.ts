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
