/**
 * 微博热搜自动化脚本 (Playwright版本)
 * 功能：打开微博网站，获取热搜内容，并保存为PDF
 * 
 * 使用方法：
 * 1. 安装依赖：npm install playwright
 * 2. 运行脚本：node weibo-playwright.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 配置项
const CONFIG = {
  weiboUrl: 'https://s.weibo.com/top/summary',
  outputDir: './output',
  pdfFileName: `weibo-hotsearch-${new Date().toISOString().split('T')[0]}.pdf`,
  jsonFileName: `weibo-hotsearch-${new Date().toISOString().split('T')[0]}.json`,
  timeout: 30000,
  headless: false,
};

/**
 * 确保输出目录存在
 */
function ensureOutputDir() {
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    console.log(`✓ 创建输出目录: ${CONFIG.outputDir}`);
  }
}

/**
 * 获取微博热搜数据
 */
async function getWeiboHotSearch() {
  console.log('🚀 启动浏览器...');
  
  const browser = await chromium.launch({
    headless: CONFIG.headless,
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    
    console.log(`📱 正在访问微博热搜: ${CONFIG.weiboUrl}`);
    await page.goto(CONFIG.weiboUrl, {
      waitUntil: 'networkidle',
      timeout: CONFIG.timeout
    });

    // 等待热搜列表加载
    console.log('⏳ 等待页面加载...');
    await page.waitForSelector('tbody tr', { timeout: CONFIG.timeout });
    
    // 等待额外时间确保所有内容加载完成
    await page.waitForTimeout(2000);

    // 提取热搜数据
    console.log('📊 正在提取热搜数据...');
    const hotSearchData = await page.evaluate(() => {
      const items = [];
      const rows = document.querySelectorAll('tbody tr');
      
      rows.forEach((row, index) => {
        const rankEl = row.querySelector('td.td-01');
        const contentEl = row.querySelector('td.td-02 a');
        const hotValueEl = row.querySelector('td.td-02 span');
        const categoryEl = row.querySelector('td.td-03');
        
        if (contentEl) {
          items.push({
            rank: index + 1,
            title: contentEl.textContent.trim(),
            link: contentEl.href || '',
            hotValue: hotValueEl ? hotValueEl.textContent.trim() : '',
            category: categoryEl ? categoryEl.textContent.trim() : '',
          });
        }
      });
      
      return items;
    });

    console.log(`✓ 成功获取 ${hotSearchData.length} 条热搜数据`);

    // 保存为 JSON
    const jsonPath = path.join(CONFIG.outputDir, CONFIG.jsonFileName);
    fs.writeFileSync(jsonPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      count: hotSearchData.length,
      data: hotSearchData
    }, null, 2), 'utf-8');
    console.log(`✓ 热搜数据已保存为 JSON: ${jsonPath}`);

    // 生成美化的 HTML 内容用于 PDF
    const htmlContent = generateHTML(hotSearchData);
    
    // 设置页面内容
    await page.setContent(htmlContent, { waitUntil: 'networkidle' });
    
    // 生成 PDF
    const pdfPath = path.join(CONFIG.outputDir, CONFIG.pdfFileName);
    console.log('📄 正在生成PDF...');
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      }
    });

    console.log(`✓ PDF 已保存: ${pdfPath}`);
    
    return {
      success: true,
      data: hotSearchData,
      pdfPath,
      jsonPath
    };

  } catch (error) {
    console.error('❌ 发生错误:', error.message);
    throw error;
  } finally {
    await browser.close();
    console.log('🔒 浏览器已关闭');
  }
}

/**
 * 生成美化的 HTML 内容
 */
function generateHTML(hotSearchData) {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  const rows = hotSearchData.map((item, index) => `
    <tr class="${index < 3 ? 'top-rank' : ''}">
      <td class="rank">${item.rank}</td>
      <td class="title">${item.title}</td>
      <td class="hot-value">${item.hotValue}</td>
      <td class="category">${item.category || '-'}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <title>微博热搜榜 - ${timestamp}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 30px;
        }
        
        .container {
          background: white;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          overflow: hidden;
        }
        
        .header {
          background: linear-gradient(135deg, #ff6b6b 0%, #ff8e53 100%);
          color: white;
          padding: 30px;
          text-align: center;
        }
        
        .header h1 {
          font-size: 32px;
          margin-bottom: 10px;
          font-weight: 700;
        }
        
        .header .timestamp {
          font-size: 14px;
          opacity: 0.9;
        }
        
        .content {
          padding: 20px;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
        }
        
        thead {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }
        
        th {
          padding: 15px;
          text-align: left;
          font-weight: 600;
          font-size: 14px;
        }
        
        th.rank { width: 60px; text-align: center; }
        th.title { width: auto; }
        th.hot-value { width: 120px; text-align: center; }
        th.category { width: 100px; text-align: center; }
        
        tbody tr {
          border-bottom: 1px solid #e0e0e0;
          transition: background-color 0.2s;
        }
        
        tbody tr:hover {
          background-color: #f5f5f5;
        }
        
        tbody tr.top-rank {
          background-color: #fff8e1;
        }
        
        td {
          padding: 12px 15px;
          font-size: 13px;
        }
        
        td.rank {
          text-align: center;
          font-weight: 700;
          font-size: 16px;
          color: #667eea;
        }
        
        tr.top-rank td.rank {
          color: #ff6b6b;
        }
        
        td.title {
          font-weight: 500;
          color: #333;
        }
        
        td.hot-value {
          text-align: center;
          color: #ff6b6b;
          font-weight: 600;
        }
        
        td.category {
          text-align: center;
          color: #666;
          font-size: 12px;
        }
        
        .footer {
          text-align: center;
          padding: 20px;
          color: #999;
          font-size: 12px;
          border-top: 1px solid #e0e0e0;
        }
        
        @media print {
          body {
            background: white;
            padding: 0;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔥 微博热搜榜</h1>
          <div class="timestamp">数据采集时间: ${timestamp}</div>
        </div>
        
        <div class="content">
          <table>
            <thead>
              <tr>
                <th class="rank">排名</th>
                <th class="title">热搜标题</th>
                <th class="hot-value">热度值</th>
                <th class="category">分类</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
        
        <div class="footer">
          生成时间: ${timestamp} | 数据来源: 微博热搜榜
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * 主函数
 */
async function main() {
  console.log('='.repeat(60));
  console.log('📱 微博热搜自动化采集脚本 (Playwright版)');
  console.log('='.repeat(60));
  
  try {
    // 确保输出目录存在
    ensureOutputDir();
    
    // 执行热搜采集
    const result = await getWeiboHotSearch();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ 任务完成！');
    console.log('='.repeat(60));
    console.log(`📊 采集数据: ${result.data.length} 条`);
    console.log(`📄 PDF文件: ${result.pdfPath}`);
    console.log(`📋 JSON文件: ${result.jsonPath}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ 任务失败！');
    console.error('='.repeat(60));
    console.error('错误信息:', error.message);
    console.error('='.repeat(60));
    process.exit(1);
  }
}

// 执行主函数
if (require.main === module) {
  main();
}

module.exports = { getWeiboHotSearch, generateHTML };
