const ChromeAgent = require('../index');

/**
 * 示例 1: 基础页面导航和信息提取
 */
async function basicNavigation() {
  const agent = new ChromeAgent('chromium', { headless: true });

  try {
    console.log('=== 基础页面导航示例 ===\n');

    // 启动浏览器
    await agent.launch();

    // 访问网页
    console.log('1. 访问 Example.com');
    await agent.goto('https://example.com');

    // 获取页面信息
    const title = await agent.getTitle();
    const url = await agent.getUrl();
    console.log(`   标题: ${title}`);
    console.log(`   URL: ${url}\n`);

    // 提取页面内容
    console.log('2. 提取页面内容');
    const heading = await agent.getText('h1');
    const paragraph = await agent.getText('p');
    console.log(`   主标题: ${heading}`);
    console.log(`   段落: ${paragraph.substring(0, 100)}...\n`);

    // 截图
    console.log('3. 截图保存');
    const screenshotPath = '/tmp/example-screenshot.png';
    await agent.screenshot(screenshotPath, { fullPage: true });
    console.log(`   截图已保存: ${screenshotPath}\n`);

    console.log('✓ 测试完成！');
  } catch (error) {
    console.error('✗ 错误:', error.message);
  } finally {
    await agent.close();
  }
}

// 运行示例
if (require.main === module) {
  basicNavigation();
}

module.exports = basicNavigation;
