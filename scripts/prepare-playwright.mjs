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
import * as os from 'os';
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

// 检查是否已有缓存的浏览器
const cachePath = path.join(os.homedir(), '.cache', 'ms-playwright');
let hasCache = false;
if (fs.existsSync(cachePath)) {
  const cacheSize = getDirSize(cachePath);
  if (cacheSize > 50 * 1024 * 1024) { // 至少 50MB
    console.log(`发现已缓存的浏览器 (${(cacheSize / 1024 / 1024).toFixed(2)} MB)`);
    console.log('正在从缓存复制到资源目录...');
    try {
      // 复制缓存到目标目录
      if (fs.existsSync(browsersPath)) {
        fs.rmSync(browsersPath, { recursive: true, force: true });
      }
      fs.cpSync(cachePath, browsersPath, { recursive: true });
      console.log('✅ 从缓存复制完成');
      hasCache = true;
    } catch (err) {
      console.warn('⚠️  从缓存复制失败，将尝试下载:', err.message);
    }
  }
}

if (!hasCache) {
  console.log('\n正在下载 Chromium 浏览器...');
  console.log('提示: 如果下载失败，可以稍后手动运行: npm run prepare:playwright');
  
  // 设置重试机制
  let retries = 3;
  let success = false;
  let lastError = null;
  
  while (retries > 0 && !success) {
    try {
      execSync('npx playwright install chromium', {
        cwd: projectRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: browsersPath
        },
        timeout: 600000 // 10 分钟超时
      });
      success = true;
    } catch (err) {
      lastError = err;
      retries--;
      if (retries > 0) {
        console.log(`\n⚠️  下载失败，剩余重试次数: ${retries}`);
        console.log('等待 5 秒后重试...\n');
        // 使用同步等待
        const start = Date.now();
        while (Date.now() - start < 5000) {
          // 等待 5 秒
        }
      }
    }
  }
  
  if (!success) {
    console.error('\n❌ 下载失败:', lastError?.message || '未知错误');
    console.log('\n提示:');
    console.log('1. 检查网络连接');
    console.log('2. 可以稍后手动运行: npm run prepare:playwright');
    console.log(`3. 或者手动下载: PLAYWRIGHT_BROWSERS_PATH=${browsersPath} npx playwright install chromium`);
    console.log('\n注意: 浏览器文件较大（约 100-200MB），下载可能需要一些时间');
    process.exit(1);
  }
  
  console.log('✅ Playwright 浏览器下载完成');
}

console.log(`浏览器位置: ${browsersPath}`);
// 显示下载的文件大小
if (fs.existsSync(browsersPath)) {
  const size = getDirSize(browsersPath);
  console.log(`总大小: ${(size / 1024 / 1024).toFixed(2)} MB`);
  
  // 验证关键文件是否存在
  const chromiumDirs = fs.readdirSync(browsersPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.includes('chromium'))
    .map(d => d.name);
  
  if (chromiumDirs.length > 0) {
    console.log(`✅ 找到 Chromium 浏览器: ${chromiumDirs.join(', ')}`);
  } else {
    console.warn('⚠️  警告: 未找到 Chromium 浏览器目录');
  }
} else {
  console.error('❌ 浏览器目录不存在');
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
