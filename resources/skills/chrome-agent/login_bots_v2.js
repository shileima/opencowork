/**
 * Bots 平台登录脚本（使用 SSO 登录管理器）
 * 
 * 自动处理 SSO 登录流程，保存和恢复登录状态
 * 下次运行脚本时自动登录，无需重复扫码
 */

const { MeituanSSOLogin } = require('./meituan-sso-login');

(async () => {
  try {
    console.log('🚀 启动浏览器...');
    
    // 创建美团 SSO 登录管理器
    const login = new MeituanSSOLogin(
      'bots',
      'https://bots.sankuai.com'
    );

    // 确保已登录（自动恢复或等待登录）
    const { browser, context, page, isLoggedIn } = await login.ensureLoggedIn({
      headless: false,
      slowMo: 100
    });

    if (!isLoggedIn) {
      console.log('❌ 登录失败或已取消');
      await browser.close();
      process.exit(1);
    }

    console.log('\n✅ 登录成功！可以开始执行任务了\n');
    
    // 访问 Bots 平台首页
    console.log('📱 访问 Bots 平台...');
    await page.goto('https://bots.sankuai.com', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // 点击"研发工具" tab
    console.log('\n正在查找"研发工具" tab...');
    const devToolsTab = page.getByText('研发工具', { exact: true }).first();
    const isDevToolsVisible = await devToolsTab.isVisible().catch(() => false);
    
    if (isDevToolsVisible) {
      console.log('✓ 找到"研发工具" tab，正在点击...');
      await devToolsTab.click();
      await page.waitForTimeout(1500);
      console.log('✓ 已点击"研发工具" tab');
    } else {
      console.log('⚠️  未找到"研发工具" tab，尝试其他定位方式...');
      const tabButton = page.locator('button:has-text("研发工具"), div[role="tab"]:has-text("研发工具"), a:has-text("研发工具")').first();
      const isTabVisible = await tabButton.isVisible().catch(() => false);
      
      if (isTabVisible) {
        console.log('✓ 找到"研发工具"元素，正在点击...');
        await tabButton.click();
        await page.waitForTimeout(1500);
        console.log('✓ 已点击"研发工具"');
      }
    }
    
    // 点击"动态组件开发专家"卡片
    console.log('\n正在查找"动态组件开发专家"卡片...');
    await page.waitForTimeout(1000);
    
    const expertCard = page.getByText('动态组件开发专家').first();
    const isCardVisible = await expertCard.isVisible().catch(() => false);
    
    if (isCardVisible) {
      console.log('✓ 找到"动态组件开发专家"卡片，正在点击...');
      
      // 等待新标签页打开
      const [newPage] = await Promise.all([
        context.waitForEvent('page'),
        expertCard.click()
      ]);
      
      console.log('✓ 已点击"动态组件开发专家"卡片');
      console.log('✓ 新标签页已打开');
      
      // 等待新页面加载
      await newPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await newPage.waitForTimeout(2000);
      
      console.log('  新页面 URL:', await newPage.url());
      console.log('  新页面标题:', await newPage.title());
      
      // 点击右上角"新会话"按钮
      console.log('\n正在查找右上角"新会话"按钮...');
      
      const newSessionSelectors = [
        'button:has-text("新会话")',
        'button:has-text("新建会话")',
        'button:has-text("新对话")',
        'div:has-text("新会话")',
        'a:has-text("新会话")',
        '[title="新会话"]',
        '[aria-label="新会话"]'
      ];
      
      let newSessionButton = null;
      for (const selector of newSessionSelectors) {
        const element = newPage.locator(selector).first();
        const isVisible = await element.isVisible().catch(() => false);
        if (isVisible) {
          newSessionButton = element;
          console.log(`✓ 找到"新会话"按钮 (${selector})`);
          break;
        }
      }
      
      if (newSessionButton) {
        console.log('正在点击"新会话"按钮...');
        await newSessionButton.click();
        console.log('✓ 已点击"新会话"按钮');
        await newPage.waitForTimeout(1500);
      }
      
      // 在新页面查找输入框并发送消息
      console.log('\n正在查找聊天输入框...');
      await newPage.waitForTimeout(1000);
      
      const inputSelectors = [
        'textarea[placeholder*="输入"]',
        'textarea[placeholder*="消息"]',
        'textarea[placeholder*="聊天"]',
        'input[placeholder*="输入"]',
        'textarea',
        'div[contenteditable="true"]'
      ];
      
      let inputElement = null;
      for (const selector of inputSelectors) {
        const element = newPage.locator(selector).last();
        const isVisible = await element.isVisible().catch(() => false);
        if (isVisible) {
          inputElement = element;
          console.log(`✓ 找到输入框 (${selector})`);
          break;
        }
      }
      
      if (inputElement) {
        console.log('正在输入消息: "创建一个 button 按钮组件"');
        
        await inputElement.click();
        await newPage.waitForTimeout(300);
        
        await inputElement.fill('创建一个 button 按钮组件');
        console.log('✓ 消息已输入');
        
        await newPage.waitForTimeout(500);
        
        console.log('\n正在按 Enter 键发送消息...');
        await inputElement.press('Enter');
        console.log('✓ 已按 Enter 键');
        
        await newPage.waitForTimeout(2000);
        console.log('✓ 消息发送流程已完成');
      }
    }
    
    console.log('\n✅ 任务完成！');
    console.log('\n💡 提示：登录状态已自动保存，下次运行脚本将自动登录');
    
    // 保持浏览器打开
    console.log('\n浏览器窗口将保持打开状态，您可以继续操作。');
    await new Promise(() => {});
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
