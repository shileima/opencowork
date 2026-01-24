import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';

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

  // 生产环境：使用内置的 node
  const platform = process.platform; // 'darwin', 'win32', 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  
  let nodeDir: string;
  let nodeExecutable: string;

  if (platform === 'darwin') {
    nodeDir = path.join(process.resourcesPath, 'node', `darwin-${arch}`);
    nodeExecutable = 'node';
  } else if (platform === 'win32') {
    nodeDir = path.join(process.resourcesPath, 'node', 'win32-x64');
    nodeExecutable = 'node.exe';
  } else {
    // Linux 暂不支持，回退到系统 node
    console.warn(`[NodePath] Platform ${platform} not supported for built-in Node.js, falling back to system node`);
    return 'node';
  }

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
