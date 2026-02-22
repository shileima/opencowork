#!/usr/bin/env node

/**
 * 下载完整 pnpm 包（bin + dist）到 resources/node 各平台目录下的 pnpm/
 * bin/pnpm.cjs 会 require('../dist/pnpm.cjs')，故必须保留整包结构
 * 与内置 Node 20 配合使用，直接运行 .app 或 DMG 安装后均可找到内置 pnpm
 *
 * 使用：node scripts/prepare-pnpm.mjs
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import https from 'https';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const PNPM_VERSION = process.env.PNPM_VERSION || '9.15.0';

const nodeDirs = [
  path.join(projectRoot, 'resources', 'node', 'darwin-arm64'),
  path.join(projectRoot, 'resources', 'node', 'darwin-x64'),
  path.join(projectRoot, 'resources', 'node', 'win32-x64'),
  path.join(projectRoot, 'resources', 'node', 'linux-x64'),
].filter((dir) => fs.existsSync(dir));

if (nodeDirs.length === 0) {
  console.log('⚠️  resources/node 下无平台目录，请先执行 scripts/download-node.mjs');
  process.exit(0);
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('📦 准备内置 pnpm (standalone)...');
  console.log(`   pnpm 版本: ${PNPM_VERSION}`);

  const tarballUrl = `https://registry.npmmirror.com/pnpm/-/pnpm-${PNPM_VERSION}.tgz`;
  const tmpDir = path.join(os.tmpdir(), `pnpm-prepare-${Date.now()}`);
  const tgzPath = path.join(tmpDir, 'pnpm.tgz');

  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    console.log('   下载 tarball...');
    const buf = await get(tarballUrl);
    if (!buf || buf.length < 1000) {
      throw new Error('下载失败或内容过小');
    }
    fs.writeFileSync(tgzPath, buf);
    console.log('   解压...');

    const extractDir = path.join(tmpDir, 'extract');
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf "${tgzPath}" -C "${extractDir}"`, { stdio: 'pipe' });

    const packageDir = path.join(extractDir, 'package');
    const pnpmBin = path.join(packageDir, 'bin', 'pnpm.cjs');
    const pnpmDist = path.join(packageDir, 'dist');
    if (!fs.existsSync(pnpmBin)) {
      throw new Error(`未找到 package/bin/pnpm.cjs，解压目录: ${extractDir}`);
    }
    if (!fs.existsSync(pnpmDist)) {
      throw new Error(`未找到 package/dist/（pnpm.cjs 依赖 ../dist），解压目录: ${extractDir}`);
    }

    for (const dir of nodeDirs) {
      const destPnpmDir = path.join(dir, 'pnpm');
      if (fs.existsSync(destPnpmDir)) {
        fs.rmSync(destPnpmDir, { recursive: true, force: true });
      }
      fs.cpSync(packageDir, destPnpmDir, { recursive: true });
      const binPath = path.join(destPnpmDir, 'bin', 'pnpm.cjs');
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(binPath, 0o644);
        } catch (_) {}
      }
      console.log(`   ✅ ${path.relative(projectRoot, destPnpmDir)} (bin + dist)`);
    }

    console.log('\n✅ 内置 pnpm 准备完成');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
