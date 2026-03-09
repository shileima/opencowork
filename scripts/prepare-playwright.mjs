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
const playwrightRoot = path.join(projectRoot, 'resources', 'playwright');
const browsersPath = path.join(playwrightRoot, 'browsers');

console.log('📦 准备 Playwright（内置 Node 同目录，避免「找不到 playwright」）...');
console.log(`Playwright 根目录: ${playwrightRoot}`);
console.log(`浏览器目录: ${browsersPath}`);

// 1) 确保 resources/playwright 存在且已安装 playwright 包（供应用内 require('playwright')）
const pkgJson = path.join(playwrightRoot, 'package.json');
const nodeModulesPlaywright = path.join(playwrightRoot, 'node_modules', 'playwright', 'package.json');
if (!fs.existsSync(playwrightRoot)) {
  fs.mkdirSync(playwrightRoot, { recursive: true });
}
if (!fs.existsSync(pkgJson)) {
  console.error('❌ 缺少 resources/playwright/package.json');
  process.exit(1);
}
if (!fs.existsSync(nodeModulesPlaywright)) {
  console.log('正在 resources/playwright 下安装 playwright 包...');
  try {
    execSync('npm install --no-package-lock --no-save', {
      cwd: playwrightRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
        PLAYWRIGHT_BROWSERS_PATH: browsersPath
        // 不下载浏览器，下面会单独处理
      },
      timeout: 120000
    });
    console.log('✅ playwright 包安装完成');
  } catch (err) {
    console.warn('⚠️  npm install 失败，将仅准备浏览器:', err?.message || err);
  }
}

// 快速检测：浏览器已存在则直接跳过，避免每次 build/postinstall 都重复安装
if (fs.existsSync(browsersPath)) {
  const existing = fs.readdirSync(browsersPath).filter(f => f.startsWith('chromium-'));
  if (existing.length > 0) {
    console.log(`✅ 浏览器已存在 (${existing[0]})，跳过安装`);
    ensureSkillSymlink(browsersPath);
    packChromium();
    process.exit(0);
  }
}

// 确保浏览器目录存在
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
        cwd: playwrightRoot,
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

ensureSkillSymlink(browsersPath);
packChromium();

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

function packChromium() {
  try {
    execSync(`node "${path.join(projectRoot, 'scripts', 'pack-chromium.mjs')}"`, {
      stdio: 'inherit',
      cwd: projectRoot,
    });
  } catch (err) {
    console.warn('⚠️  打包 Chromium 为 tar.gz 失败（不影响开发调试）:', err.message);
  }
}

function ensureSkillSymlink(targetBrowsersPath) {
  const skillBrowsersLink = path.join(os.homedir(), '.qa-cowork', 'skills', 'agent-browser', 'browsers');
  try {
    const skillDir = path.dirname(skillBrowsersLink);
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }
    // 若已存在且是软链接，先删除再重建（保证指向正确）
    try {
      const stat = fs.lstatSync(skillBrowsersLink);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(skillBrowsersLink);
      }
    } catch (_) { /* 不存在，忽略 */ }
    if (!fs.existsSync(skillBrowsersLink)) {
      fs.symlinkSync(targetBrowsersPath, skillBrowsersLink);
      console.log(`✅ 已创建软链接: ${skillBrowsersLink} → ${targetBrowsersPath}`);
    } else {
      console.log(`⏭️  软链接已存在，跳过: ${skillBrowsersLink}`);
    }
  } catch (err) {
    console.warn('⚠️  创建软链接失败（不影响功能）:', err.message);
  }
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
