#!/usr/bin/env node

/**
 * 下载并准备 Node.js 运行时
 * 支持 macOS (darwin-arm64, darwin-x64) 和 Windows (win32-x64)
 * 
 * 使用方法：
 *   node scripts/download-node.mjs
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import https from 'https';
import { pipeline } from 'stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Node.js 版本
const NODE_VERSION = '20.18.0';

console.log('📦 下载并准备 Node.js 运行时...');
console.log(`Node.js 版本: ${NODE_VERSION}`);

// 定义需要准备的平台
const platforms = [
  { platform: 'darwin', arch: 'arm64', ext: 'tar.gz' },
  { platform: 'darwin', arch: 'x64', ext: 'tar.gz' },
  { platform: 'win32', arch: 'x64', ext: 'zip' }
];

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // 处理重定向
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      let lastProgress = 0;

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const progress = Math.floor((downloadedSize / totalSize) * 100);
        if (progress - lastProgress >= 10) {
          process.stdout.write(`\r   下载进度: ${progress}%`);
          lastProgress = progress;
        }
      });

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        process.stdout.write('\r   下载完成!          \n');
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function extractTarGz(tarPath, destDir) {
  console.log(`   解压到: ${destDir}`);
  
  if (process.platform === 'win32') {
    // Windows 平台使用 7-zip 或 tar (Git Bash 自带)
    try {
      execSync(`tar -xzf "${tarPath}" -C "${destDir}"`, { stdio: 'inherit' });
    } catch (error) {
      console.error('   ⚠️  解压失败，尝试使用系统命令');
      throw error;
    }
  } else {
    // macOS/Linux 使用 tar
    execSync(`tar -xzf "${tarPath}" -C "${destDir}"`, { stdio: 'inherit' });
  }
}

async function extractZip(zipPath, destDir) {
  console.log(`   解压到: ${destDir}`);
  
  if (process.platform === 'win32') {
    // Windows 使用 PowerShell
    execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'inherit' });
  } else {
    // macOS/Linux 使用 unzip
    execSync(`unzip -q "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
  }
}

async function prepareNodeForPlatform(platform, arch, ext) {
  const platformKey = `${platform}-${arch}`;
  console.log(`\n📥 准备 ${platformKey}...`);

  // 目标目录
  const targetDir = path.join(projectRoot, 'resources', 'node', platformKey);
  
  // 如果已存在 node 二进制文件，跳过
  const nodeExe = platform === 'win32' ? 'node.exe' : 'node';
  const nodePath = path.join(targetDir, nodeExe);
  if (fs.existsSync(nodePath)) {
    console.log(`✅ ${platformKey} 已存在，跳过`);
    return;
  }

  // 创建目标目录
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 构建下载 URL
  const nodeDistName = `node-v${NODE_VERSION}-${platform}-${arch}`;
  const downloadUrl = `https://nodejs.org/dist/v${NODE_VERSION}/${nodeDistName}.${ext}`;
  
  console.log(`   下载地址: ${downloadUrl}`);

  // 下载文件
  const tempDir = path.join(projectRoot, 'temp-node-download');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const downloadPath = path.join(tempDir, `${nodeDistName}.${ext}`);
  
  try {
    await downloadFile(downloadUrl, downloadPath);

    // 解压
    const extractDir = path.join(tempDir, nodeDistName);
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(extractDir, { recursive: true });

    if (ext === 'tar.gz') {
      await extractTarGz(downloadPath, tempDir);
    } else if (ext === 'zip') {
      await extractZip(downloadPath, tempDir);
    }

    // 复制 node 二进制文件
    const extractedNodeDir = path.join(tempDir, nodeDistName);
    const extractedBinDir = path.join(extractedNodeDir, 'bin');
    const extractedNode = path.join(
      platform === 'win32' ? extractedNodeDir : extractedBinDir,
      nodeExe
    );

    if (!fs.existsSync(extractedNode)) {
      throw new Error(`无法找到解压后的 node 二进制文件: ${extractedNode}`);
    }

    fs.copyFileSync(extractedNode, nodePath);
    
    // 设置执行权限 (Unix-like 系统)
    if (platform !== 'win32') {
      fs.chmodSync(nodePath, 0o755);
    }

    console.log(`✅ ${platformKey} 准备完成`);

    // 验证文件大小
    const stats = fs.statSync(nodePath);
    console.log(`   文件大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  } catch (error) {
    console.error(`❌ ${platformKey} 准备失败:`, error.message);
    throw error;
  } finally {
    // 清理临时文件
    if (fs.existsSync(downloadPath)) {
      fs.unlinkSync(downloadPath);
    }
  }
}

async function main() {
  // 创建临时目录
  const tempDir = path.join(projectRoot, 'temp-node-download');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // 下载所有平台的 Node.js
    for (const { platform, arch, ext } of platforms) {
      await prepareNodeForPlatform(platform, arch, ext);
    }

    console.log('\n✅ 所有平台的 Node.js 准备完成！');
  } finally {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

main().catch(error => {
  console.error('❌ 准备失败:', error);
  process.exit(1);
});
