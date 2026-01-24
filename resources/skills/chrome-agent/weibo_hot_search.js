/**
 * 微博热搜自动化脚本
 * 功能：打开微博，点击热搜菜单，获取热搜列表并输出到PDF
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// 查找系统 Chrome 路径
function findChrome() {
    const possiblePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium'
    ];
    
    for (const chromePath of possiblePaths) {
        if (fs.existsSync(chromePath)) {
            return chromePath;
        }
    }
    
    return null;
}

async function getWeiboHotSearch() {
    const executablePath = findChrome();
    
    if (!executablePath) {
        console.error('❌ 未找到 Chrome/Chromium 浏览器，请先安装 Google Chrome');
        process.exit(1);
    }
    
    console.log(`✅ 使用浏览器: ${executablePath}`);
    
    const browser = await puppeteer.launch({
        headless: false, // 设置为 true 可以无头模式运行
        executablePath: executablePath,
        defaultViewport: {
            width: 1920,
            height: 1080
        },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    try {
        const page = await browser.newPage();
        
        // 设置用户代理，模拟真实浏览器
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // 隐藏 webdriver 标识
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        });
        
        console.log('正在打开微博...');
        await page.goto('https://weibo.com', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        // 等待页面加载
        await page.waitForTimeout(3000);
        
        console.log('查找热搜菜单...');
        
        // 尝试多种可能的热搜链接选择器
        const hotSearchSelectors = [
            'a[href*="hot/weibo"]',
            'a[href*="top/hot"]',
            '.left_nav a[href*="hot"]',
            'nav a[href*="hot"]',
            '[href="/hot/weibo"]'
        ];
        
        let hotSearchClicked = false;
        for (const selector of hotSearchSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 3000 });
                console.log(`找到热搜菜单: ${selector}`);
                await page.click(selector);
                hotSearchClicked = true;
                break;
            } catch (e) {
                continue;
            }
        }
        
        // 如果没找到链接，尝试直接访问热搜页面
        if (!hotSearchClicked) {
            console.log('未找到热搜菜单，直接访问热搜页面...');
            await page.goto('https://weibo.com/hot/weibo', {
                waitUntil: 'networkidle2',
                timeout: 60000
            });
        }
        
        // 等待热搜内容加载
        await page.waitForTimeout(5000);
        
        console.log('正在提取热搜列表...');
        
        // 提取热搜列表数据
        const hotSearchData = await page.evaluate(() => {
            const results = [];
            
            // 尝试多种可能的热搜列表选择器
            const selectors = [
                '.td-02',  // 热搜榜单项
                '.list_a li',
                '.hot-list li',
                '.card-list article',
                '[class*="hot"] [class*="item"]',
                '[class*="list"] [class*="item"]',
                'tbody tr'
            ];
            
            let items = [];
            for (const selector of selectors) {
                items = document.querySelectorAll(selector);
                if (items.length > 5) {  // 至少要有5条才算有效
                    console.log(`使用选择器: ${selector}, 找到 ${items.length} 条`);
                    break;
                }
            }
            
            // 如果还是没找到，尝试获取所有文本内容
            if (items.length === 0) {
                const mainContent = document.querySelector('main') || 
                                  document.querySelector('.main') || 
                                  document.querySelector('#app');
                if (mainContent) {
                    const text = mainContent.innerText;
                    const lines = text.split('\n').filter(line => line.trim().length > 0);
                    return lines.slice(0, 50).map((line, index) => ({
                        rank: index + 1,
                        title: line.substring(0, 100),
                        heat: '',
                        tag: ''
                    }));
                }
            }
            
            items.forEach((item, index) => {
                try {
                    // 获取排名
                    const rankEl = item.querySelector('.rank, .num, [class*="rank"]');
                    const rank = rankEl ? rankEl.innerText.trim() : (index + 1);
                    
                    // 获取标题 - 尝试多种方式
                    let title = '';
                    const titleSelectors = ['.title', '.text', 'a', '[class*="title"]', 'td:nth-child(2)'];
                    for (const sel of titleSelectors) {
                        const titleEl = item.querySelector(sel);
                        if (titleEl && titleEl.innerText.trim()) {
                            title = titleEl.innerText.trim();
                            break;
                        }
                    }
                    
                    if (!title) {
                        title = item.innerText.split('\n')[0] || item.innerText.substring(0, 50);
                    }
                    
                    // 获取热度
                    const heatEl = item.querySelector('.num, .hot, [class*="hot"], [class*="num"]');
                    const heat = heatEl ? heatEl.innerText.trim() : '';
                    
                    // 获取标签
                    const tagEl = item.querySelector('.icon, .tag, [class*="icon"]');
                    const tag = tagEl ? tagEl.innerText.trim() : '';
                    
                    if (title && title.length > 2) {
                        results.push({
                            rank: rank,
                            title: title,
                            heat: heat,
                            tag: tag
                        });
                    }
                } catch (e) {
                    console.error('提取项目失败:', e);
                }
            });
            
            return results;
        });
        
        console.log(`成功提取 ${hotSearchData.length} 条热搜数据`);
        
        if (hotSearchData.length === 0) {
            console.warn('⚠️  未能提取到热搜数据，尝试截图保存...');
            const screenshotPath = path.join(__dirname, `微博热搜截图_${new Date().toISOString().split('T')[0]}.png`);
            await page.screenshot({
                path: screenshotPath,
                fullPage: true
            });
            console.log(`📸 截图已保存: ${screenshotPath}`);
        }
        
        // 创建HTML内容用于生成PDF
        const htmlContent = generateHTML(hotSearchData);
        
        // 创建临时HTML文件
        const tempHtmlPath = path.join(__dirname, 'temp_weibo_hot.html');
        fs.writeFileSync(tempHtmlPath, htmlContent);
        
        // 打开临时HTML页面并生成PDF
        const pdfPage = await browser.newPage();
        await pdfPage.goto(`file://${tempHtmlPath}`, {
            waitUntil: 'networkidle2'
        });
        
        const pdfPath = path.join(__dirname, `微博热搜_${new Date().toISOString().split('T')[0]}.pdf`);
        await pdfPage.pdf({
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
        
        console.log(`📄 PDF已生成: ${pdfPath}`);
        
        // 清理临时文件
        fs.unlinkSync(tempHtmlPath);
        
        // 同时保存JSON数据
        const jsonPath = path.join(__dirname, `微博热搜_${new Date().toISOString().split('T')[0]}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(hotSearchData, null, 2), 'utf-8');
        console.log(`📊 JSON数据已保存: ${jsonPath}`);
        
        return {
            pdfPath,
            jsonPath,
            count: hotSearchData.length
        };
        
    } catch (error) {
        console.error('执行过程中出错:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

function generateHTML(data) {
    const timestamp = new Date().toLocaleString('zh-CN');
    
    let tableRows = '';
    if (data.length === 0) {
        tableRows = '<tr><td colspan="4" style="text-align: center; color: #999;">未获取到数据，请检查网络连接或微博页面结构</td></tr>';
    } else {
        tableRows = data.map(item => `
            <tr>
                <td style="text-align: center; font-weight: bold; color: #ff6b6b;">${item.rank}</td>
                <td style="font-weight: 500;">${item.title}</td>
                <td style="text-align: center; color: #ff8c00;">${item.heat || '-'}</td>
                <td style="text-align: center;">
                    ${item.tag ? `<span style="background: #ff6b6b; color: white; padding: 2px 8px; border-radius: 3px; font-size: 12px;">${item.tag}</span>` : '-'}
                </td>
            </tr>
        `).join('');
    }
    
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>微博热搜榜</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", 
                         "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #fff;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 3px solid #ff6b6b;
        }
        
        .header h1 {
            color: #ff6b6b;
            font-size: 32px;
            margin-bottom: 10px;
        }
        
        .header .subtitle {
            color: #666;
            font-size: 14px;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        thead {
            background: linear-gradient(135deg, #ff6b6b 0%, #ff8c8c 100%);
            color: white;
        }
        
        th {
            padding: 15px;
            text-align: left;
            font-weight: 600;
            font-size: 14px;
            text-transform: uppercase;
        }
        
        td {
            padding: 12px 15px;
            border-bottom: 1px solid #f0f0f0;
            font-size: 14px;
        }
        
        tr:hover {
            background-color: #fff5f5;
        }
        
        tr:last-child td {
            border-bottom: none;
        }
        
        .footer {
            margin-top: 30px;
            text-align: center;
            color: #999;
            font-size: 12px;
            padding-top: 20px;
            border-top: 1px solid #eee;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 微博热搜榜</h1>
        <div class="subtitle">数据获取时间: ${timestamp}</div>
    </div>
    
    <table>
        <thead>
            <tr>
                <th style="width: 80px; text-align: center;">排名</th>
                <th>热搜标题</th>
                <th style="width: 120px; text-align: center;">热度</th>
                <th style="width: 100px; text-align: center;">标签</th>
            </tr>
        </thead>
        <tbody>
            ${tableRows}
        </tbody>
    </table>
    
    <div class="footer">
        <p>数据来源: 微博热搜 | 共 ${data.length} 条热搜 | 自动生成</p>
    </div>
</body>
</html>
    `;
}

// 执行主函数
if (require.main === module) {
    getWeiboHotSearch()
        .then(result => {
            console.log('\n✅ 任务完成！');
            console.log(`📄 PDF文件: ${result.pdfPath}`);
            console.log(`📊 JSON文件: ${result.jsonPath}`);
            console.log(`📈 获取数据: ${result.count} 条`);
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ 任务失败:', error.message);
            process.exit(1);
        });
}

module.exports = { getWeiboHotSearch };
