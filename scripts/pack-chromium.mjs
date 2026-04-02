#!/usr/bin/env node
/**
 * 将 resources/playwright/browsers/ 下的所有浏览器资源压缩为 resources/playwright/chromium.tar.gz
 *
 * 打包内容（按实际存在情况收集）：
 *   - chromium-XXXX          — 完整 Chrome for Testing 浏览器
 *   - chromium_headless_shell-XXXX — Headless Shell（agent-browser 需要）
 *   - ffmpeg-XXXX            — 视频/音频解码器
 *
 * 作用：
 *  1. 避免将大量 Chromium 小文件交给 electron-builder 逐一签名（会导致 codesign 失败）
 *  2. 减小安装包体积（330M → ~160M）
 *  3. 应用首次启动时自动解压到 userData，后续直接使用
 *
 * 注意：
 *  chromium.tar.gz 超过 GitHub 100MB 限制，已加入 .gitignore，不纳入版本控制。
 *  该文件由本脚本在本地或 CI 构建阶段按需生成，无需手动提交。
 *
 * 使用方法：
 *   node scripts/pack-chromium.mjs
 *   pnpm pack:chromium
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const browsersDir = path.join(projectRoot, 'resources', 'playwright', 'browsers');
const outputFile = path.join(projectRoot, 'resources', 'playwright', 'chromium.tar.gz');

// ── 浏览器目录检查 ───────────────────────────────────────────────────────────
if (!fs.existsSync(browsersDir)) {
  console.error(`❌ 浏览器目录不存在: ${browsersDir}`);
  console.error('   请先运行: pnpm prepare:playwright');
  process.exit(1);
}

// 收集所有需要打包的浏览器相关目录
const allEntries = fs.readdirSync(browsersDir);
const chromiumDirs = allEntries.filter(f => /^chromium-\d+$/.test(f));
const headlessShellDirs = allEntries.filter(f => /^chromium_headless_shell-\d+$/.test(f));
const ffmpegDirs = allEntries.filter(f => /^ffmpeg-\d+$/.test(f));
const dirsToPackage = [...chromiumDirs, ...headlessShellDirs, ...ffmpegDirs];

if (chromiumDirs.length === 0) {
  console.error('❌ browsers/ 下没有找到 chromium-* 目录');
  console.error('   请先运行: pnpm prepare:playwright');
  process.exit(1);
}

console.log('📦 打包浏览器资源为 chromium.tar.gz ...');
console.log(`  目录列表: ${dirsToPackage.join(', ')}`);
console.log(`  源目录:   ${browsersDir}`);
console.log(`  输出:     ${outputFile}`);

if (headlessShellDirs.length === 0) {
  console.warn('⚠️  未找到 chromium_headless_shell-* 目录，headless 模式可能受影响');
}
if (ffmpegDirs.length === 0) {
  console.warn('⚠️  未找到 ffmpeg-* 目录，视频播放可能受影响');
}

// ── 跳过检测（tar.gz 比所有源目录都新时不重复压缩）──────────────────────────
if (fs.existsSync(outputFile)) {
  const tarMtime = fs.statSync(outputFile).mtimeMs;
  const latestDirMtime = Math.max(
    ...dirsToPackage.map(d => {
      try { return fs.statSync(path.join(browsersDir, d)).mtimeMs; }
      catch { return 0; }
    })
  );
  if (tarMtime > latestDirMtime) {
    const sizeMB = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(1);
    console.log(`✅ chromium.tar.gz 已是最新 (${sizeMB} MB)，跳过压缩`);
    process.exit(0);
  }
}

// ── 打包 ─────────────────────────────────────────────────────────────────────
const start = Date.now();

// 将所有目录作为参数一次性打包
const dirArgs = dirsToPackage.map(d => `"${d}"`).join(' ');
execSync(
  `tar -czf "${outputFile}" -C "${browsersDir}" ${dirArgs}`,
  { stdio: 'inherit' }
);

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const sizeMB = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(1);
console.log(`✅ 打包完成: ${sizeMB} MB，耗时 ${elapsed}s`);
console.log(`   包含: ${dirsToPackage.length} 个目录 (${dirsToPackage.join(', ')})`);
console.log('\n💡 提示：chromium.tar.gz 已加入 .gitignore，无需提交到 git。');
console.log('   构建时由 CI 脚本自动生成，或本地运行 pnpm pack:chromium 手动生成。');
