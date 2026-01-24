/**
 * 微博热搜采集脚本 - 简化版
 * 使用方法：node weibo-simple.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

async function main() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('正在访问微博热搜...');
  await page.goto('https://s.weibo.com/top/summary', { waitUntil: 'networkidle2' });
  
  console.log('等待页面加载...');
  await page.waitForSelector('tbody tr');
  await page.waitForTimeout(2000);
  
  console.log('提取热搜数据...');
  const hotSearch = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('tbody tr').forEach((row, index) => {
      const title = row.querySelector('td.td-02 a');
      const hot = row.querySelector('td.td-02 span');
      if (title) {
        items.push({
          rank: index + 1,
          title: title.textContent.trim(),
          hot: hot ? hot.textContent.trim() : ''
        });
      }
    });
    return items;
  });
  
  console.log(`获取到 ${hotSearch.length} 条热搜`);
  
  // 生成 HTML
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>微博热搜 - ${new Date().toLocaleDateString()}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #ff6b6b; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #ff6b6b; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        .rank { font-weight: bold; color: #ff6b6b; }
      </style>
    </head>
    <body>
      <h1>🔥 微博热搜榜</h1>
      <p>采集时间: ${new Date().toLocaleString()}</p>
      <table>
        <tr><th>排名</th><th>标题</th><th>热度</th></tr>
        ${hotSearch.map(item => `
          <tr>
            <td class="rank">${item.rank}</td>
            <td>${item.title}</td>
            <td>${item.hot}</td>
          </tr>
        `).join('')}
      </table>
    </body>
    </html>
  `;
  
  await page.setContent(html);
  
  // 保存 PDF
  const pdfFile = `weibo-${Date.now()}.pdf`;
  await page.pdf({ path: pdfFile, format: 'A4' });
  console.log(`✓ PDF已保存: ${pdfFile}`);
  
  // 保存 JSON
  const jsonFile = `weibo-${Date.now()}.json`;
  fs.writeFileSync(jsonFile, JSON.stringify(hotSearch, null, 2));
  console.log(`✓ JSON已保存: ${jsonFile}`);
  
  await browser.close();
}

main().catch(console.error);
