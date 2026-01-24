const ChromeAgent = require('../index');

/**
 * 示例 2: 表单交互和提交
 */
async function formInteraction() {
  const agent = new ChromeAgent('chromium', { headless: false }); // 使用可见模式便于观察

  try {
    console.log('=== 表单交互示例 ===\n');

    await agent.launch();

    // 访问包含表单的页面（这里使用一个测试网站）
    console.log('1. 访问表单测试页面');
    await agent.goto('https://www.w3schools.com/html/html_forms.asp');

    // 等待页面加载
    await agent.waitForSelector('input[type="text"]', { timeout: 5000 });

    console.log('2. 填写表单');
    // 填充输入框
    await agent.fill('input[name="firstname"]', 'John');
    await agent.fill('input[name="lastname"]', 'Doe');

    console.log('   已填写: First Name = John, Last Name = Doe\n');

    // 获取页面标题
    const title = await agent.getTitle();
    console.log(`3. 当前页面: ${title}\n`);

    // 截图保存表单填写结果
    await agent.screenshot('/tmp/form-filled.png');
    console.log('4. 表单截图已保存: /tmp/form-filled.png\n');

    console.log('✓ 表单交互测试完成！');

    // 等待 3 秒以便观察
    await new Promise(resolve => setTimeout(resolve, 3000));
  } catch (error) {
    console.error('✗ 错误:', error.message);
  } finally {
    await agent.close();
  }
}

// 运行示例
if (require.main === module) {
  formInteraction();
}

module.exports = formInteraction;
