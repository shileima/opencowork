#!/usr/bin/env node

/**
 * 准备 Node.js 和 npm 资源脚本
 * 
 * 从系统 Node.js 安装中复制 npm 到 resources/node/ 目录
 * 
 * 使用方法：
 *   node scripts/prepare-node-npm.mjs
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

console.log('📦 准备 Node.js 和 npm 资源...');

// 获取系统 Node.js 路径
let systemNodePath;
try {
  systemNodePath = execSync('which node', { encoding: 'utf-8' }).trim();
} catch (error) {
  console.error('❌ 无法找到系统 Node.js');
  process.exit(1);
}

const systemNodeDir = path.dirname(systemNodePath);
const systemNodeRoot = path.resolve(systemNodeDir, '..');

console.log(`系统 Node.js 路径: ${systemNodePath}`);
console.log(`系统 Node.js 根目录: ${systemNodeRoot}`);

// 检查 npm 是否存在
const npmPaths = [
  path.join(systemNodeDir, 'npm'),
  path.join(systemNodeRoot, 'lib', 'node_modules', 'npm', 'bin', 'npm'),
];

let npmPath = null;
for (const testPath of npmPaths) {
  if (fs.existsSync(testPath)) {
    npmPath = testPath;
    console.log(`✅ 找到 npm: ${npmPath}`);
    break;
  }
}

if (!npmPath) {
  console.error('❌ 无法找到 npm');
  process.exit(1);
}

// 确定目标平台和架构
const platform = process.platform;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

let targetDir;
if (platform === 'darwin') {
  targetDir = path.join(projectRoot, 'resources', 'node', `darwin-${arch}`);
} else if (platform === 'win32') {
  targetDir = path.join(projectRoot, 'resources', 'node', 'win32-x64');
} else {
  console.error(`❌ 不支持的平台: ${platform}`);
  process.exit(1);
}

// 确保目标目录存在
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log(`✅ 创建目标目录: ${targetDir}`);
}

// 检查 node 是否存在
const nodePath = path.join(targetDir, platform === 'win32' ? 'node.exe' : 'node');
if (!fs.existsSync(nodePath)) {
  console.warn(`⚠️  警告: Node.js 二进制文件不存在: ${nodePath}`);
  console.warn('   请先确保 Node.js 已复制到 resources/node/');
}

// 复制 npm 相关文件
console.log('\n正在复制 npm...');

// npm 可能是一个符号链接，需要解析真实路径
let npmRealPath = npmPath;
try {
  npmRealPath = fs.realpathSync(npmPath);
} catch (error) {
  console.warn(`⚠️  无法解析 npm 路径: ${error.message}`);
}

// 复制 npm 可执行文件
// npm 在 bin 目录下通常是一个包装脚本，我们需要从 lib/node_modules/npm/bin/ 复制
const npmBinPath = path.join(systemNodeRoot, 'lib', 'node_modules', 'npm', 'bin', platform === 'win32' ? 'npm.cmd' : 'npm');
const targetNpmPath = path.join(targetDir, platform === 'win32' ? 'npm.cmd' : 'npm');

// 优先使用 lib/node_modules/npm/bin/npm（这是实际的 npm 脚本）
const sourceNpmPath = fs.existsSync(npmBinPath) ? npmBinPath : npmRealPath;

try {
  fs.copyFileSync(sourceNpmPath, targetNpmPath);
  fs.chmodSync(targetNpmPath, 0o755);
  console.log(`✅ 复制 npm 到: ${targetNpmPath}`);
} catch (error) {
  console.error(`❌ 复制 npm 失败: ${error.message}`);
  process.exit(1);
}

// 复制 npm-cli.js（npm 的主脚本）
const npmCliJsPath = path.join(path.dirname(sourceNpmPath), 'npm-cli.js');
if (fs.existsSync(npmCliJsPath)) {
  const targetNpmCliJsPath = path.join(targetDir, 'npm-cli.js');
  try {
    fs.copyFileSync(npmCliJsPath, targetNpmCliJsPath);
    console.log(`✅ 复制 npm-cli.js 到: ${targetNpmCliJsPath}`);
  } catch (error) {
    console.warn(`⚠️  复制 npm-cli.js 失败: ${error.message}`);
  }
}

// 复制整个 npm 模块目录（包含所有依赖）
const npmModuleDir = path.join(systemNodeRoot, 'lib', 'node_modules', 'npm');
const targetNpmModuleDir = path.join(targetDir, 'lib', 'node_modules', 'npm');

if (fs.existsSync(npmModuleDir)) {
  console.log('\n正在复制 npm 模块目录（这可能需要一些时间）...');
  try {
    // 如果目标目录已存在，先删除
    if (fs.existsSync(targetNpmModuleDir)) {
      fs.rmSync(targetNpmModuleDir, { recursive: true, force: true });
    }
    
    // 创建目标目录
    fs.mkdirSync(path.dirname(targetNpmModuleDir), { recursive: true });
    
    // 复制整个目录
    fs.cpSync(npmModuleDir, targetNpmModuleDir, { recursive: true });
    
    const size = getDirSize(targetNpmModuleDir);
    console.log(`✅ 复制 npm 模块目录完成 (${(size / 1024 / 1024).toFixed(2)} MB)`);
    
    // 创建符号链接：npm 脚本期望在 node_modules/npm 找到 npm
    // 但我们实际在 lib/node_modules/npm，所以创建符号链接
    const targetNodeModulesDir = path.join(targetDir, 'node_modules');
    const targetNodeModulesNpm = path.join(targetNodeModulesDir, 'npm');
    
    if (!fs.existsSync(targetNodeModulesDir)) {
      fs.mkdirSync(targetNodeModulesDir, { recursive: true });
    }
    
    // 如果已存在符号链接或目录，先删除
    if (fs.existsSync(targetNodeModulesNpm)) {
      fs.rmSync(targetNodeModulesNpm, { recursive: true, force: true });
    }
    
    // 创建符号链接：node_modules/npm -> lib/node_modules/npm
    const relativePath = path.relative(targetNodeModulesDir, targetNpmModuleDir);
    fs.symlinkSync(relativePath, targetNodeModulesNpm, 'dir');
    console.log(`✅ 创建符号链接: node_modules/npm -> lib/node_modules/npm`);
  } catch (error) {
    console.error(`❌ 复制 npm 模块目录失败: ${error.message}`);
    console.warn('   应用可能仍能工作，但某些 npm 功能可能不可用');
  }
} else {
  console.warn('⚠️  警告: npm 模块目录不存在，某些 npm 功能可能不可用');
}

console.log('\n✅ Node.js 和 npm 准备完成！');

function getDirSize(dirPath) {
  let totalSize = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += getDirSize(entryPath);
      } else {
        totalSize += fs.statSync(entryPath).size;
      }
    }
  } catch (error) {
    // 忽略错误
  }
  return totalSize;
}
