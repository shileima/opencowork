#!/usr/bin/env node

/**
 * 准备 Playwright 资源脚本
 * 
 * 下载 Playwright 浏览器二进制文件到 resources/playwright/browsers/
 * 
 * 使用方法：
 *   node scripts/prepare-playwright.mjs
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const browsersPath = path.join(projectRoot, 'resources', 'playwright', 'browsers');

console.log('📦 准备 Playwright 浏览器二进制文件...');
console.log(`目标目录: ${browsersPath}`);

// 确保目录存在
if (!fs.existsSync(browsersPath)) {
  fs.mkdirSync(browsersPath, { recursive: true });
}

// 设置环境变量，指定浏览器下载路径
process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

try {
  console.log('正在下载 Chromium 浏览器...');
  execSync('npx playwright install chromium', {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath
    }
  });
  
  console.log('✅ Playwright 浏览器下载完成');
  console.log(`浏览器位置: ${browsersPath}`);
  
  // 显示下载的文件大小
  const stats = fs.statSync(browsersPath);
  console.log(`总大小: ${(getDirSize(browsersPath) / 1024 / 1024).toFixed(2)} MB`);
} catch (error) {
  console.error('❌ 下载失败:', error.message);
  console.log('\n提示: 可以稍后手动运行: npx playwright install chromium');
  process.exit(1);
}

function getDirSize(dirPath) {
  let totalSize = 0;
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
      const filePath = path.join(dirPath, file.name);
      if (file.isDirectory()) {
        totalSize += getDirSize(filePath);
      } else {
        totalSize += fs.statSync(filePath).size;
      }
    }
  } catch (error) {
    // 忽略错误
  }
  return totalSize;
}
