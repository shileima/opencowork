#!/usr/bin/env node
/**
 * 使用系统代理下载 NotoSansCJK 字体
 * 支持 macOS 系统代理设置
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FONT_URL = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Subset/TTF/SC/NotoSansCJKsc-Regular.ttf';
const OUTPUT_DIR = __dirname;
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'NotoSansCJK-SC-Regular.ttf');

// 获取系统代理设置
function getSystemProxy() {
  try {
    // macOS 系统代理
    const httpProxy = execSync('scutil --proxy | grep "HTTPProxy" | awk \'{print $3}\'').toString().trim();
    const httpsProxy = execSync('scutil --proxy | grep "HTTPSProxy" | awk \'{print $3}\'').toString().trim();
    const proxyPort = execSync('scutil --proxy | grep "HTTPPort" | awk \'{print $3}\'').toString().trim();
    
    if (httpProxy && proxyPort) {
      return `http://${httpProxy}:${proxyPort}`;
    }
  } catch (e) {
    // 忽略错误
  }
  
  // 检查环境变量
  return process.env.https_proxy || process.env.HTTPS_PROXY || 
         process.env.http_proxy || process.env.HTTP_PROXY || null;
}

function downloadWithProxy(url, outputFile, proxy) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputFile);
    let downloadedSize = 0;
    let totalSize = 0;

    const options = {
      hostname: 'raw.githubusercontent.com',
      path: '/notofonts/noto-cjk/main/Sans/Subset/TTF/SC/NotoSansCJKsc-Regular.ttf',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    };

    // 如果有代理，使用代理
    if (proxy) {
      const proxyUrl = new URL(proxy);
      options.hostname = proxyUrl.hostname;
      options.port = proxyUrl.port;
      options.path = url;
      options.headers['Host'] = 'raw.githubusercontent.com';
    }

    const req = https.request(options, (response) => {
      if (response.statusCode === 200) {
        totalSize = parseInt(response.headers['content-length'], 10) || 0;
        
        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize > 0) {
            const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
            process.stdout.write(`\r   进度: ${percent}% (${(downloadedSize / 1024 / 1024).toFixed(2)} MB)`);
          } else {
            process.stdout.write(`\r   已下载: ${(downloadedSize / 1024 / 1024).toFixed(2)} MB`);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log('\n✅ 下载完成！');
          const stats = fs.statSync(outputFile);
          console.log(`   文件: ${outputFile}`);
          console.log(`   大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          resolve(outputFile);
        });
      } else if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        console.log(`   重定向到: ${redirectUrl}`);
        file.close();
        fs.unlinkSync(outputFile);
        downloadWithProxy(redirectUrl, outputFile, proxy).then(resolve).catch(reject);
      } else {
        file.close();
        fs.unlinkSync(outputFile);
        reject(new Error(`HTTP ${response.statusCode}`));
      }
    });

    req.on('error', (err) => {
      file.close();
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
      reject(err);
    });

    req.end();
  });
}

console.log('📥 开始下载 NotoSansCJK 字体...');
console.log(`   来源: ${FONT_URL}`);
console.log(`   目标: ${OUTPUT_FILE}`);

// 检查系统代理
const proxy = getSystemProxy();
if (proxy) {
  console.log(`   使用代理: ${proxy}`);
} else {
  console.log(`   未检测到代理，直接连接`);
}

downloadWithProxy(FONT_URL, OUTPUT_FILE, proxy)
  .then(() => {
    console.log('\n📝 现在可以运行测试脚本验证字体：');
    console.log('   cd ~/.qa-cowork/skills/chrome-agent');
    console.log('   node test-pdf-chinese.js');
  })
  .catch((err) => {
    console.error(`\n❌ 下载失败: ${err.message}`);
    console.error('\n📝 请尝试以下方法：');
    console.error('   1. 确保 VPN 已连接');
    console.error('   2. 手动下载: https://github.com/notofonts/noto-cjk/releases');
    console.error(`   3. 将文件放到: ${OUTPUT_DIR}/`);
    process.exit(1);
  });
