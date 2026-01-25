const { chromium } = require('playwright');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * 微博热搜抓取脚本
 * 功能：打开微博、点击热搜、抓取新闻并保存为PDF
 */

// 配置项
const CONFIG = {
  weiboUrl: 'https://weibo.com',
  hotSearchUrl: 'https://s.weibo.com/top/summary',
  outputDir: './output',
  screenshotDir: './screenshots',
  timeout: 60000, // 增加到60秒
  navigationTimeout: 60000,
  headless: false, // 设置为true可无头模式运行
  maxRetries: 3 // 最大重试次数
};

// 确保输出目录存在
function ensureDirectories() {
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }
  if (!fs.existsSync(CONFIG.screenshotDir)) {
    fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
  }
}

/**
 * 查找系统中文字体
 */
function findChineseFont() {
  const scriptDir = __dirname;
  const possibleFontPaths = [
    // 脚本目录下的字体（优先级最高）
    path.join(scriptDir, 'fonts', 'NotoSansSC-Regular.ttf'),
    path.join(scriptDir, 'fonts', 'NotoSansSC-Regular.otf'),
    path.join(scriptDir, 'fonts', 'NotoSansCJK-Regular.ttf'),
    path.join(scriptDir, 'fonts', 'NotoSansCJK-SC-Regular.ttf'),
    // macOS 系统字体（只使用 TTF/OTF）
    '/Library/Fonts/NotoSansCJK-Regular.ttf',
    '/Library/Fonts/NotoSansCJKsc-Regular.ttf',
    '/Library/Fonts/NotoSansCJK-Regular.otf',
    '/Library/Fonts/NotoSansCJKsc-Regular.otf',
    '/Library/Fonts/Microsoft/SimHei.ttf',
    '/Library/Fonts/Microsoft/SimSun.ttf',
    '/System/Library/Fonts/PingFang.ttc',
    // Linux 字体路径
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    // Windows 字体路径
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/simsun.ttc',
  ];

  for (const fontPath of possibleFontPaths) {
    if (fs.existsSync(fontPath)) {
      return fontPath;
    }
  }

  return null;
}

/**
 * 生成PDF文档
 */
function generatePDF(hotSearchData, filename) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const outputPath = path.join(CONFIG.outputDir, filename);
      const stream = fs.createWriteStream(outputPath);
      
      doc.pipe(stream);

      // 查找并注册中文字体
      const chineseFontPath = findChineseFont();
      let fontRegistered = false;
      
      if (chineseFontPath) {
        try {
          // 直接使用字体文件路径
          doc.registerFont('ChineseFont', chineseFontPath);
          doc.font('ChineseFont');
          fontRegistered = true;
          console.log(`✅ 已加载中文字体: ${chineseFontPath}`);
        } catch (fontError) {
          console.warn(`⚠️  字体加载失败: ${fontError.message}`);
          console.warn('   将使用默认字体（可能无法正确显示中文）');
        }
      } else {
        console.warn('⚠️  未找到中文字体，PDF 中的中文可能显示为乱码');
        console.warn('');
        console.warn('📝 解决方案：');
        console.warn('   字体文件已在 fonts 目录中，请确认文件完整性');
      }

      // 标题
      doc.fontSize(24)
         .text('微博热搜榜', { align: 'center' })
         .moveDown();

      // 抓取时间
      doc.fontSize(12)
         .text(`抓取时间: ${hotSearchData.timestamp}`, { align: 'center' })
         .moveDown(2);

      // 热搜列表
      hotSearchData.items.forEach((item, index) => {
        // 排名
        doc.fontSize(14)
           .fillColor('#FF6B6B')
           .text(`${item.rank}. `, { continued: true })
           .fillColor('#000000')
           .text(item.title || '');

        // 热度
        if (item.hotValue) {
          doc.fontSize(10)
             .fillColor('#666666')
             .text(`   热度: ${item.hotValue}`)
             .fillColor('#000000');
        }

        // 链接
        if (item.link) {
          doc.fontSize(9)
             .fillColor('#0066CC')
             .text(`   链接: ${item.link}`, { link: item.link })
             .fillColor('#000000');
        }

        doc.moveDown(0.5);

        // 分页处理
        if (doc.y > 700) {
          doc.addPage();
        }
      });

      // 页脚
      doc.fontSize(10)
         .text('--- 数据来源：微博热搜 ---', { align: 'center' });

      doc.end();

      stream.on('finish', () => {
        console.log(`✅ PDF已生成: ${outputPath}`);
        resolve(outputPath);
      });

      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 等待并重试页面加载
 */
async function gotoWithRetry(page, url, retries = CONFIG.maxRetries) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`📡 尝试访问 (${i + 1}/${retries})...`);
      
      // 使用更宽松的等待条件
      await page.goto(url, { 
        waitUntil: 'load', // 从 networkidle 改为 load
        timeout: CONFIG.navigationTimeout 
      });
      
      // 额外等待一下确保内容加载
      await page.waitForTimeout(3000);
      
      console.log('✅ 页面加载成功');
      return true;
    } catch (error) {
      console.warn(`⚠️  第 ${i + 1} 次尝试失败: ${error.message}`);
      
      if (i === retries - 1) {
        throw error;
      }
      
      // 等待后重试
      console.log('⏳ 等待5秒后重试...');
      await page.waitForTimeout(5000);
    }
  }
}

/**
 * 主函数：抓取微博热搜
 */
async function scrapeWeiboHotSearch() {
  console.log('🚀 开始抓取微博热搜...\n');
  
  ensureDirectories();
  
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    slowMo: 100 // 放慢操作速度，便于观察
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    // 使用更真实的 User Agent
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    // 添加更多浏览器特征
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai'
  });

  const page = await context.newPage();
  
  // 设置默认超时
  page.setDefaultTimeout(CONFIG.timeout);
  page.setDefaultNavigationTimeout(CONFIG.navigationTimeout);
  
  try {
    console.log('📱 步骤1: 访问微博热搜页面...');
    await gotoWithRetry(page, CONFIG.hotSearchUrl);
    
    // 截图保存页面
    const screenshotPath = path.join(CONFIG.screenshotDir, `weibo-hotsearch-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 页面截图已保存: ${screenshotPath}`);

    console.log('\n🔍 步骤2: 等待热搜列表加载...');
    
    // 尝试多种选择器等待
    try {
      await page.waitForSelector('table', { timeout: CONFIG.timeout });
    } catch (e) {
      console.log('⚠️  未找到table元素，尝试其他选择器...');
      await page.waitForSelector('[class*="list"], [class*="item"]', { timeout: CONFIG.timeout });
    }
    
    await page.waitForTimeout(2000); // 额外等待确保内容完全加载

    console.log('\n📊 步骤3: 抓取热搜数据...');
    // 抓取热搜数据
    const hotSearchData = await page.evaluate(() => {
      const items = [];
      
      // 尝试多种选择器以适应页面结构变化
      const rows = document.querySelectorAll('table tbody tr');
      
      rows.forEach((row, index) => {
        try {
          // 获取排名
          const rank = index + 1;
          
          // 获取标题和链接
          const linkElement = row.querySelector('a');
          const title = linkElement ? linkElement.textContent.trim() : '';
          const link = linkElement ? linkElement.href : '';
          
          // 获取热度值
          const hotElement = row.querySelector('td:last-child');
          const hotValue = hotElement ? hotElement.textContent.trim() : '';
          
          if (title) {
            items.push({
              rank,
              title,
              link,
              hotValue
            });
          }
        } catch (e) {
          console.error(`解析第 ${index} 行出错:`, e.message);
        }
      });
      
      return items;
    });

    console.log(`✅ 成功抓取 ${hotSearchData.length} 条热搜\n`);

    if (hotSearchData.length === 0) {
      throw new Error('未能抓取到任何热搜数据，可能页面结构已变化');
    }

    // 显示前10条热搜
    console.log('🔥 热搜预览（前10条）:');
    hotSearchData.slice(0, 10).forEach(item => {
      console.log(`${item.rank}. ${item.title} ${item.hotValue ? `(${item.hotValue})` : ''}`);
    });

    // 准备PDF数据
    const pdfData = {
      timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      items: hotSearchData
    };

    // 生成PDF
    console.log('\n📄 步骤4: 生成PDF文档...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const pdfFilename = `weibo-hotsearch-${timestamp}.pdf`;
    await generatePDF(pdfData, pdfFilename);

    // 保存JSON格式的原始数据
    const jsonPath = path.join(CONFIG.outputDir, `weibo-hotsearch-${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(pdfData, null, 2), 'utf-8');
    console.log(`💾 JSON数据已保存: ${jsonPath}`);

    console.log('\n✨ 所有任务完成！');
    
  } catch (error) {
    console.error('❌ 抓取过程出错:', error.message);
    
    // 错误时也保存截图
    try {
      const errorScreenshot = path.join(CONFIG.screenshotDir, `error-${Date.now()}.png`);
      await page.screenshot({ path: errorScreenshot, fullPage: true });
      console.log(`📸 错误截图已保存: ${errorScreenshot}`);
    } catch (e) {
      console.error('保存错误截图失败:', e.message);
    }
    
    throw error;
  } finally {
    await browser.close();
    console.log('\n🔚 浏览器已关闭');
  }
}

// 运行脚本
if (require.main === module) {
  scrapeWeiboHotSearch()
    .then(() => {
      console.log('\n程序执行完毕');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n程序执行失败:', error);
      process.exit(1);
    });
}

module.exports = { scrapeWeiboHotSearch, generatePDF };
