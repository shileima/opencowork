#!/usr/bin/env node
/**
 * release.mjs - 一键发布脚本
 *
 * 用法：pnpm release [patch|minor|major|vX.Y.Z]
 *
 * 流程：
 *   1. 检查工作区是否干净（如有修改，自动提交）
 *   2. 从远端获取最新 tag，按语义化版本自动累加
 *   3. 更新 package.json 中的 version 字段
 *   4. 提交版本变更
 *   5. 创建并推送 tag 到 opencowork remote（shileima/opencowork）
 *   6. GitHub Actions 监听 v* tag，自动触发构建
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const REMOTE = 'opencowork'; // shileima/opencowork

// ─── Helpers ────────────────────────────────────────────────────────────────

const run = (cmd, opts = {}) => {
  try {
    const output = execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe', ...opts });
    const result = (output || '').trim();
    if (!opts.silent && result) console.log(result);
    return result;
  } catch (e) {
    if (opts.ignoreError) return '';
    console.error(`\n❌ 命令失败: ${cmd}`);
    // 打印 stderr/stdout（execSync 失败时输出在 e.stderr / e.stdout）
    const errMsg = (e.stderr || e.stdout || e.message || '').trim();
    if (errMsg) console.error(errMsg);
    process.exit(1);
  }
};

const runSilent = (cmd, opts = {}) => run(cmd, { ...opts, silent: true });

const log = (msg) => console.log(`\n${msg}`);
const info = (msg) => console.log(`  ℹ  ${msg}`);
const ok = (msg) => console.log(`  ✓  ${msg}`);
const warn = (msg) => console.log(`  ⚠  ${msg}`);

// ─── Version Helpers ─────────────────────────────────────────────────────────

/**
 * 解析版本号为 [major, minor, patch]
 */
const parseVersion = (v) => {
  const clean = v.replace(/^v/, '');
  const parts = clean.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return parts;
};

/**
 * 从 [major, minor, patch] 格式化为 "X.Y.Z"
 */
const formatVersion = ([major, minor, patch]) => `${major}.${minor}.${patch}`;

/**
 * 版本比较：返回 1 / -1 / 0
 */
const compareVersions = (a, b) => {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
};

/**
 * 直接查询远端 tag 列表（不依赖本地缓存），找到最大的 vX.Y.Z
 */
const getLatestRemoteTag = () => {
  // 直接列出远端 tag，避免本地缓存（来自上游 fork）的干扰
  const tagsRaw = runSilent(`git ls-remote --tags ${REMOTE} "refs/tags/v*"`, { ignoreError: true });
  if (!tagsRaw) return null;

  // 格式：<sha>\trefs/tags/vX.Y.Z 或 refs/tags/vX.Y.Z^{} (annotated tag)
  const versions = tagsRaw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('\t')[1]) // 取 ref 部分
    .filter((ref) => ref && !ref.endsWith('^{}')) // 排除 annotated tag 的解引用行
    .map((ref) => ref.replace('refs/tags/', ''))
    .map((tag) => ({ tag, parts: parseVersion(tag) }))
    .filter((t) => t.parts !== null)
    .sort((a, b) => compareVersions(b.parts, a.parts));

  return versions.length > 0 ? versions[0] : null;
};

/**
 * 根据 bump 类型计算下一个版本
 * bump: 'patch' | 'minor' | 'major'
 */
const bumpVersion = (parts, bump) => {
  const [major, minor, patch] = parts;
  if (bump === 'major') return [major + 1, 0, 0];
  if (bump === 'minor') return [major, minor + 1, 0];
  return [major, minor, patch + 1]; // default: patch
};

// ─── Main ────────────────────────────────────────────────────────────────────

const main = async () => {
  log('🚀 OpenCowork Release Script');
  log('══════════════════════════════════════');

  // 1. 解析参数
  const arg = process.argv[2] || 'patch'; // patch | minor | major | v1.2.3
  let targetVersion = null;
  let bumpType = 'patch';

  if (/^v?\d+\.\d+\.\d+$/.test(arg)) {
    // 明确指定了版本号
    targetVersion = arg.replace(/^v/, '');
  } else if (['patch', 'minor', 'major'].includes(arg)) {
    bumpType = arg;
  } else {
    console.error(`❌ 无效参数: "${arg}"\n   用法: pnpm release [patch|minor|major|vX.Y.Z]`);
    process.exit(1);
  }

  // 2. 获取当前 package.json 版本
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const currentPkgVersion = pkg.version;
  info(`package.json 当前版本: v${currentPkgVersion}`);

  // 3. 从远端获取最新 tag
  info(`正在从 ${REMOTE} 拉取最新 tags...`);
  const latestTag = getLatestRemoteTag();
  if (latestTag) {
    info(`远端最新 tag: ${latestTag.tag}`);
  } else {
    info('远端暂无 tag，将从 package.json 版本开始');
  }

  // 4. 确定新版本号
  let newVersion;
  if (targetVersion) {
    // 明确指定版本
    newVersion = targetVersion;
    // 检查远端是否已存在此 tag
    const existingTags = runSilent('git tag --list "v*"', { ignoreError: true });
    if (existingTags.split('\n').map((t) => t.trim()).includes(`v${newVersion}`)) {
      warn(`tag v${newVersion} 在远端已存在，将自动累加 patch 版本`);
      const parts = parseVersion(newVersion);
      newVersion = formatVersion(bumpVersion(parts, 'patch'));
    }
  } else {
    // 基于远端最新 tag 或 package.json 版本进行累加
    const baseParts = latestTag
      ? latestTag.parts
      : parseVersion(currentPkgVersion) || [1, 0, 0];
    newVersion = formatVersion(bumpVersion(baseParts, bumpType));
  }

  log(`📦 新版本: v${newVersion}`);

  // 5. 确认不重复
  const allTags = runSilent('git tag --list "v*"', { ignoreError: true });
  if (allTags.split('\n').map((t) => t.trim()).includes(`v${newVersion}`)) {
    console.error(`❌ tag v${newVersion} 已存在，无法重复创建。请手动指定更高版本号。`);
    process.exit(1);
  }

  // 6. 更新 package.json
  pkg.version = newVersion;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
  ok(`已更新 package.json → version: "${newVersion}"`);

  // 7. 提交所有本地修改（包含 package.json 和其他未提交文件）
  const statusOutput = runSilent('git status --porcelain', { ignoreError: true });
  if (statusOutput) {
    log('📝 提交本地修改...');
    run('git add -A');
    run(`git commit -m "chore: release ${newVersion}"`);
    ok('已提交所有修改');
  } else {
    info('工作区干净，无需提交');
  }

  // 8. 创建 tag
  run(`git tag v${newVersion}`);
  ok(`已创建 tag: v${newVersion}`);

  // 9. 推送 commits + tag 到 opencowork remote
  log(`🔼 推送到 ${REMOTE} (shileima/opencowork)...`);
  const currentBranch = runSilent('git branch --show-current');
  run(`git push ${REMOTE} ${currentBranch}`);
  run(`git push ${REMOTE} v${newVersion}`);
  ok(`已推送 branch: ${currentBranch} 和 tag: v${newVersion}`);

  // 10. 完成
  log('══════════════════════════════════════');
  log(`✅ 发布完成！`);
  console.log(`\n   Tag    : v${newVersion}`);
  console.log(`   Remote : https://github.com/shileima/opencowork`);
  console.log(`   Actions: https://github.com/shileima/opencowork/actions`);
  console.log(`\n   GitHub Actions 将自动构建并发布 v${newVersion} 的各平台安装包。\n`);
};

main().catch((e) => {
  console.error('❌ 发布脚本出错:', e.message);
  process.exit(1);
});
