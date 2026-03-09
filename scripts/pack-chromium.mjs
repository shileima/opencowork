#!/usr/bin/env node
/**
 * 将 resources/playwright/browsers/chromium-* 压缩为 resources/playwright/chromium.tar.gz
 *
 * 作用：
 *  1. 避免将大量 Chromium 小文件交给 electron-builder 逐一签名（会导致 codesign 失败）
 *  2. 减小安装包体积（330M → ~160M）
 *  3. 应用首次启动时自动解压到 userData，后续直接使用
 *
 * 使用方法：
 *   node scripts/pack-chromium.mjs
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const browsersDir = path.join(projectRoot, 'resources', 'playwright', 'browsers');
const outputFile = path.join(projectRoot, 'resources', 'playwright', 'chromium.tar.gz');

console.log('📦 打包 Chromium 浏览器为 chromium.tar.gz ...');

if (!fs.existsSync(browsersDir)) {
  console.error(`❌ 浏览器目录不存在: ${browsersDir}`);
  console.error('   请先运行: pnpm prepare:playwright');
  process.exit(1);
}

const chromiumDirs = fs.readdirSync(browsersDir).filter(f => f.startsWith('chromium-'));
if (chromiumDirs.length === 0) {
  console.error('❌ browsers/ 下没有找到 chromium-* 目录');
  console.error('   请先运行: pnpm prepare:playwright');
  process.exit(1);
}

// 取最新版本（版本号最大的）
chromiumDirs.sort().reverse();
const chromiumDir = chromiumDirs[0];
console.log(`  源目录: ${chromiumDir} (${browsersDir})`);
console.log(`  输出:   ${outputFile}`);

// 若 tar.gz 已存在且比 chromium 目录新，跳过重复压缩
if (fs.existsSync(outputFile)) {
  const tarMtime = fs.statSync(outputFile).mtimeMs;
  const dirMtime = fs.statSync(path.join(browsersDir, chromiumDir)).mtimeMs;
  if (tarMtime > dirMtime) {
    const sizeMB = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(1);
    console.log(`✅ chromium.tar.gz 已是最新 (${sizeMB} MB)，跳过压缩`);
    process.exit(0);
  }
}

const start = Date.now();
execSync(
  `tar -czf "${outputFile}" -C "${browsersDir}" "${chromiumDir}"`,
  { stdio: 'inherit' }
);

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const sizeMB = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(1);
console.log(`✅ 打包完成: ${sizeMB} MB，耗时 ${elapsed}s`);
