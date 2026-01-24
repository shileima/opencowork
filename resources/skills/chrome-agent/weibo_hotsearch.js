const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  // 启动浏览器（有头模式，方便查看）
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--start-maximized']
  });
  
  const context = await browser.newContext({
    viewport: null
  });
  
  const page = await context.newPage();
  
  // 设置更长的默认超时时间
  page.setDefaultTimeout(60000);
  
  try {
    console.log('正在访问微博...');
    await page.goto('https://weibo.com', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    // 等待页面加载
    console.log('等待页面加载...');
    await page.waitForTimeout(5000);
    
    console.log('正在寻找热搜菜单...');
    // 尝试多种方式点击热搜
    try {
      // 等待热搜链接出现
      await page.waitForSelector('a:has-text("热搜")', { timeout: 10000 });
      await page.click('a:has-text("热搜")');
      console.log('已点击热搜菜单');
    } catch (e) {
      console.log('尝试直接访问热搜页面...');
      await page.goto('https://s.weibo.com/top/summary', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
    }
    
    await page.waitForTimeout(5000);
    
    console.log('正在提取热搜内容...');
    console.log('当前URL:', page.url());
    
    // 提取热搜列表
    const hotSearchItems = await page.evaluate(() => {
      const items = [];
      
      // 尝试多种选择器
      const selectors = [
        'table tbody tr',
        '.list_a tbody tr', 
        '[class*="list"] tbody tr',
        'tr[class*="td"]',
        '.data_box tbody tr',
        '.Hot_list_2c1pk tr',
        'a[href*="/weibo?q="]',
        'a[action-type="feed_list_item"]'
      ];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(`找到选择器: ${selector}, 元素数: ${elements.length}`);
          
          if (selector.includes('tbody') || selector.includes('tr')) {
            // 表格行格式
            elements.forEach((tr, index) => {
              // 尝试多种方式提取排名
              const rankEl = tr.querySelector('.td-01, [class*="td_01"], [class*="rank"], td:first-child');
              const rank = rankEl?.textContent.trim() || (index + 1).toString();
              
              // 尝试多种方式提取标题
              const titleEl = tr.querySelector('.td-02 a, [class*="td_02"] a, a, .title');
              const title = titleEl?.textContent.trim();
              
              // 尝试提取热度
              const hotEl = tr.querySelector('.td-03, [class*="td_03"], [class*="hot"], [class*="num"]');
              const hot = hotEl?.textContent.trim() || '';
              
              if (title && title.length > 0 && !title.includes('刷新')) {
                items.push({
                  rank: rank,
                  title: title,
                  hot: hot
                });
              }
            });
          } else {
            // 链接格式
            elements.forEach((el, index) => {
              const text = el.textContent.trim();
              const href = el.getAttribute('href') || '';
              
              // 过滤无效内容
              if (text && text.length > 2 && text.length < 100 && 
                  !text.includes('查看') && 
                  !text.includes('刷新') &&
                  !text.includes('微博') && 
                  !text.includes('首页') && 
                  !text.includes('推荐')) {
                items.push({
                  rank: (index + 1).toString(),
                  title: text,
                  hot: ''
                });
              }
            });
          }
          
          if (items.length > 5) break; // 如果找到足够多的数据就停止
        }
      }
      
      // 如果还是没找到，尝试获取所有包含 # 的文本
      if (items.length === 0) {
        console.log('尝试查找包含#的热搜话题...');
        const allElements = document.querySelectorAll('a, span, div');
        const seen = new Set();
        
        allElements.forEach(el => {
          const text = el.textContent.trim();
          if (text.includes('#') && text.length > 3 && text.length < 100 && !seen.has(text)) {
            seen.add(text);
            items.push({
              rank: (items.length + 1).toString(),
              title: text,
              hot: ''
            });
          }
        });
      }
      
      return items.slice(0, 50); // 限制最多50条
    });
    
    console.log(`成功提取 ${hotSearchItems.length} 条热搜`);
    
    if (hotSearchItems.length === 0) {
      console.log('未能提取到热搜内容，保存页面信息供调试...');
      
      // 保存页面HTML
      const html = await page.content();
      fs.writeFileSync('/Users/shilei/.opencowork/skills/chrome-agent/weibo_page.html', html, 'utf8');
      console.log('已保存页面HTML到 weibo_page.html');
      
      // 截图保存当前页面状态
      await page.screenshot({ 
        path: '/Users/shilei/.opencowork/skills/chrome-agent/weibo_page.png', 
        fullPage: true 
      });
      console.log('已保存页面截图到 weibo_page.png');
      
      throw new Error('未能提取到热搜数据');
    }
    
    // 生成文本内容
    const currentTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    let textContent = `微博热搜榜\n`;
    textContent += `抓取时间: ${currentTime}\n`;
    textContent += `共 ${hotSearchItems.length} 条\n`;
    textContent += `${'='.repeat(60)}\n\n`;
    
    hotSearchItems.forEach(item => {
      textContent += `${item.rank}. ${item.title}`;
      if (item.hot) {
        textContent += ` (热度: ${item.hot})`;
      }
      textContent += '\n';
    });
    
    // 保存到文本文件
    const txtPath = '/Users/shilei/.opencowork/skills/chrome-agent/weibo_hotsearch.txt';
    fs.writeFileSync(txtPath, textContent, 'utf8');
    console.log(`✓ 已保存到文本文件: ${txtPath}`);
    
    // 生成HTML内容（用于后续转PDF）
    const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>微博热搜榜</title>
  <style>
    body {
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #ff8200;
      text-align: center;
      margin-bottom: 10px;
      font-size: 32px;
    }
    .meta {
      text-align: center;
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .item {
      padding: 15px;
      border-bottom: 1px solid #eee;
      display: flex;
      align-items: center;
      transition: background 0.2s;
    }
    .item:hover {
      background: #f9f9f9;
    }
    .item:last-child {
      border-bottom: none;
    }
    .rank {
      font-size: 20px;
      font-weight: bold;
      color: #999;
      min-width: 50px;
      text-align: right;
      margin-right: 20px;
    }
    .item:nth-child(1) .rank { color: #ff4757; }
    .item:nth-child(2) .rank { color: #ff6348; }
    .item:nth-child(3) .rank { color: #ffa502; }
    .title {
      flex: 1;
      font-size: 16px;
      color: #333;
      line-height: 1.5;
    }
    .hot {
      color: #ff8200;
      font-size: 14px;
      font-weight: bold;
      margin-left: 10px;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔥 微博热搜榜</h1>
    <div class="meta">
      抓取时间: ${currentTime}<br>
      共 ${hotSearchItems.length} 条热搜
    </div>
    ${hotSearchItems.map((item, index) => `
    <div class="item">
      <div class="rank">${item.rank}</div>
      <div class="title">${item.title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      ${item.hot ? `<div class="hot">${item.hot}</div>` : ''}
    </div>
    `).join('')}
  </div>
</body>
</html>
    `;
    
    const htmlPath = '/Users/shilei/.opencowork/skills/chrome-agent/weibo_hotsearch.html';
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    console.log(`✓ 已保存HTML文件: ${htmlPath}`);
    
    // 生成PDF
    const pdfPath = '/Users/shilei/.opencowork/skills/chrome-agent/weibo_hotsearch.pdf';
    const pdfPage = await context.newPage();
    await pdfPage.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    await pdfPage.pdf({ 
      path: pdfPath,
      format: 'A4',
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
      },
      printBackground: true
    });
    await pdfPage.close();
    
    console.log(`✓ 已生成PDF文件: ${pdfPath}`);
    console.log('\n✓ 任务完成！已生成以下文件：');
    console.log(`  - ${txtPath}`);
    console.log(`  - ${htmlPath}`);
    console.log(`  - ${pdfPath}`);
    
  } catch (error) {
    console.error('\n✗ 发生错误:', error.message);
    // 截图保存错误状态
    try {
      await page.screenshot({ 
        path: '/Users/shilei/.opencowork/skills/chrome-agent/error_screenshot.png',
        fullPage: true 
      });
      console.log('已保存错误截图到 error_screenshot.png');
    } catch (e) {
      console.error('无法保存截图:', e.message);
    }
  } finally {
    // 不自动关闭浏览器，让用户可以查看结果
    console.log('\n浏览器将保持打开状态，您可以手动关闭或查看结果');
    // await browser.close();
  }
})();
