#!/usr/bin/env node

/**
 * 测试内置 npm 功能
 */

import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

console.log('🧪 测试内置 npm 功能...\n');

// 测试 1: 检查 npm 文件是否存在
console.log('1. 检查 npm 文件是否存在');
const npmPath = path.join(projectRoot, 'resources', 'node', 'darwin-arm64', 'npm');
const npmCliJsPath = path.join(projectRoot, 'resources', 'node', 'darwin-arm64', 'npm-cli.js');
const npmModulePath = path.join(projectRoot, 'resources', 'node', 'darwin-arm64', 'lib', 'node_modules', 'npm');

console.log(`   npm 路径: ${npmPath}`);
console.log(`   存在: ${fs.existsSync(npmPath) ? '✅' : '❌'}`);

console.log(`   npm-cli.js 路径: ${npmCliJsPath}`);
console.log(`   存在: ${fs.existsSync(npmCliJsPath) ? '✅' : '❌'}`);

console.log(`   npm 模块目录: ${npmModulePath}`);
console.log(`   存在: ${fs.existsSync(npmModulePath) ? '✅' : '❌'}`);

if (fs.existsSync(npmModulePath)) {
  const size = getDirSize(npmModulePath);
  console.log(`   大小: ${(size / 1024 / 1024).toFixed(2)} MB`);
}

// 测试 2: 检查 npm 文件权限
console.log('\n2. 检查 npm 文件权限');
if (fs.existsSync(npmPath)) {
  const stats = fs.statSync(npmPath);
  const isExecutable = (stats.mode & parseInt('111', 8)) !== 0;
  console.log(`   可执行: ${isExecutable ? '✅' : '❌'}`);
  console.log(`   权限: ${stats.mode.toString(8)}`);
}

// 测试 3: 检查 npm 脚本内容
console.log('\n3. 检查 npm 脚本内容');
if (fs.existsSync(npmPath)) {
  const content = fs.readFileSync(npmPath, 'utf-8');
  console.log(`   前 3 行:`);
  content.split('\n').slice(0, 3).forEach((line, i) => {
    console.log(`     ${i + 1}. ${line}`);
  });
  
  // 检查是否能找到 lib/cli.js
  const libCliPath = path.join(projectRoot, 'resources', 'node', 'darwin-arm64', 'lib', 'cli.js');
  const npmLibCliPath = path.join(npmModulePath, 'lib', 'cli.js');
  console.log(`\n   检查 lib/cli.js:`);
  console.log(`   相对路径 (lib/cli.js): ${fs.existsSync(libCliPath) ? '✅' : '❌'}`);
  console.log(`   npm 模块路径 (lib/node_modules/npm/lib/cli.js): ${fs.existsSync(npmLibCliPath) ? '✅' : '❌'}`);
}

// 测试 4: 尝试执行 npm --version（如果 node 可用）
console.log('\n4. 测试执行 npm --version');
const nodePath = path.join(projectRoot, 'resources', 'node', 'darwin-arm64', 'node');
if (fs.existsSync(nodePath)) {
  try {
    // 设置环境变量，让 npm 能找到自己的模块
    const env = {
      ...process.env,
      PATH: `${path.dirname(npmPath)}:${process.env.PATH}`,
      NODE_PATH: path.join(projectRoot, 'resources', 'node', 'darwin-arm64', 'lib', 'node_modules'),
    };
    
    // 使用 node 执行 npm
    const npmCliJs = path.join(npmModulePath, 'bin', 'npm-cli.js');
    if (fs.existsSync(npmCliJs)) {
      const result = execSync(`"${nodePath}" "${npmCliJs}" --version`, {
        cwd: projectRoot,
        env: env,
        encoding: 'utf-8',
        timeout: 5000,
      });
      console.log(`   ✅ npm 版本: ${result.trim()}`);
    } else {
      console.log(`   ⚠️  npm-cli.js 不存在，无法测试执行`);
    }
  } catch (error) {
    console.log(`   ❌ 执行失败: ${error.message}`);
  }
} else {
  console.log(`   ⚠️  Node.js 不存在，跳过执行测试`);
}

// 测试 5: 检查路径解析逻辑
console.log('\n5. 检查路径解析逻辑');
const testPaths = [
  path.join(projectRoot, 'resources', 'node', 'darwin-arm64', 'npm'),
  path.join(projectRoot, 'resources', 'node', 'darwin-arm64', 'lib', 'node_modules', 'npm', 'bin', 'npm'),
];

testPaths.forEach((testPath, i) => {
  console.log(`   路径 ${i + 1}: ${testPath}`);
  console.log(`   存在: ${fs.existsSync(testPath) ? '✅' : '❌'}`);
});

console.log('\n✅ 测试完成！');

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
