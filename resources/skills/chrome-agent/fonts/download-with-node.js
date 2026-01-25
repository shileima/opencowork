#!/usr/bin/env node
/**
 * 使用 Node.js 下载 NotoSansCJK 字体
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const FONT_URL = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Subset/TTF/SC/NotoSansCJKsc-Regular.ttf';
const OUTPUT_DIR = __dirname;
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'NotoSansCJK-SC-Regular.ttf');

console.log('📥 开始下载 NotoSansCJK 字体...');
console.log(`   来源: ${FONT_URL}`);
console.log(`   目标: ${OUTPUT_FILE}`);

const file = fs.createWriteStream(OUTPUT_FILE);

https.get(FONT_URL, (response) => {
  if (response.statusCode === 200) {
    const totalSize = parseInt(response.headers['content-length'], 10);
    let downloadedSize = 0;

    response.on('data', (chunk) => {
      downloadedSize += chunk.length;
      const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
      process.stdout.write(`\r   进度: ${percent}% (${(downloadedSize / 1024 / 1024).toFixed(2)} MB)`);
    });

    response.pipe(file);

    file.on('finish', () => {
      file.close();
      console.log('\n✅ 下载完成！');
      console.log(`   文件: ${OUTPUT_FILE}`);
      const stats = fs.statSync(OUTPUT_FILE);
      console.log(`   大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      console.log('\n📝 现在可以运行测试脚本验证字体：');
      console.log('   cd ~/.qa-cowork/skills/chrome-agent');
      console.log('   node test-pdf-chinese.js');
    });
  } else if (response.statusCode === 301 || response.statusCode === 302) {
    // 处理重定向
    const redirectUrl = response.headers.location;
    console.log(`   重定向到: ${redirectUrl}`);
    // 递归下载
    https.get(redirectUrl, (redirectResponse) => {
      redirectResponse.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log('\n✅ 下载完成！');
      });
    });
  } else {
    console.error(`\n❌ 下载失败: HTTP ${response.statusCode}`);
    fs.unlinkSync(OUTPUT_FILE);
    process.exit(1);
  }
}).on('error', (err) => {
  console.error(`\n❌ 下载出错: ${err.message}`);
  console.error('\n📝 请手动下载：');
  console.error('   1. 访问: https://github.com/notofonts/noto-cjk/releases');
  console.error('   2. 下载 NotoSansCJK-SC-Regular.ttf');
  console.error(`   3. 放到: ${OUTPUT_DIR}/`);
  fs.unlinkSync(OUTPUT_FILE);
  process.exit(1);
});
