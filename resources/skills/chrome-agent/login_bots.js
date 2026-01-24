const { chromium } = require('playwright');

(async () => {
  try {
    console.log('启动浏览器...');
    const browser = await chromium.launch({ 
      headless: false,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('正在打开 https://bots.sankuai.com ...');
    await page.goto('https://bots.sankuai.com', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    console.log('✓ 页面加载完成');
    console.log('  当前页面标题:', await page.title());
    
    // 等待页面稳定
    await page.waitForTimeout(2000);
    
    // 查找并点击"密码登录"按钮（如果有的话）
    console.log('\n正在查找"密码登录"按钮...');
    const passwordLoginButton = page.getByText('密码登录').first();
    const isPasswordButtonVisible = await passwordLoginButton.isVisible().catch(() => false);
    
    if (isPasswordButtonVisible) {
      console.log('✓ 找到"密码登录"按钮，正在点击...');
      await passwordLoginButton.click();
      await page.waitForTimeout(1000);
      console.log('✓ 已点击"密码登录"');
    } else {
      console.log('未找到"密码登录"按钮，可能已经是密码登录页面');
    }
    
    // 输入手机号
    console.log('\n正在输入手机号: 13521326612');
    const phoneInput = await page.locator('input[placeholder*="手机"]').or(page.locator('input[type="tel"]')).or(page.locator('input[name*="phone"]')).or(page.locator('input[name*="mobile"]')).first();
    await phoneInput.fill('13521326612');
    console.log('✓ 手机号已输入');
    
    // 输入密码
    console.log('正在输入密码...');
    const passwordInput = await page.locator('input[type="password"]').first();
    await passwordInput.fill('yytt9988');
    console.log('✓ 密码已输入');
    
    await page.waitForTimeout(1000);
    
    // 点击登录按钮
    console.log('\n正在查找并点击登录按钮...');
    const loginButton = await page.getByRole('button', { name: /登录|登 录|login/i }).first();
    if (loginButton) {
      console.log('✓ 找到登录按钮，正在点击...');
      await loginButton.click();
      console.log('✓ 已点击登录按钮');
      
      // 等待登录完成，等待页面跳转
      console.log('\n等待登录完成...');
      await page.waitForTimeout(3000);
      
      console.log('✓ 登录流程已执行');
      console.log('  当前 URL:', await page.url());
      console.log('  当前页面标题:', await page.title());
    }
    
    // 点击"研发工具" tab
    console.log('\n正在查找"研发工具" tab...');
    await page.waitForTimeout(2000); // 等待页面完全加载
    
    const devToolsTab = page.getByText('研发工具', { exact: true }).first();
    const isDevToolsVisible = await devToolsTab.isVisible().catch(() => false);
    
    if (isDevToolsVisible) {
      console.log('✓ 找到"研发工具" tab，正在点击...');
      await devToolsTab.click();
      await page.waitForTimeout(1500);
      console.log('✓ 已点击"研发工具" tab');
    } else {
      console.log('未找到"研发工具" tab，尝试其他定位方式...');
      // 尝试通过角色和文本查找
      const tabButton = page.locator('button:has-text("研发工具"), div[role="tab"]:has-text("研发工具"), a:has-text("研发工具")').first();
      const isTabVisible = await tabButton.isVisible().catch(() => false);
      
      if (isTabVisible) {
        console.log('✓ 找到"研发工具"元素，正在点击...');
        await tabButton.click();
        await page.waitForTimeout(1500);
        console.log('✓ 已点击"研发工具"');
      } else {
        console.log('⚠️  未能找到"研发工具" tab');
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
      
      // 尝试多种定位方式查找"新会话"按钮
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
        await newPage.waitForTimeout(1500); // 等待新会话创建
      } else {
        console.log('⚠️  未找到"新会话"按钮，尝试通过 SVG 图标定位...');
        // 尝试通过包含 SVG 的按钮定位（通常新会话按钮在右上角）
        const buttonWithIcon = newPage.locator('button:has(svg)').filter({ hasText: /新|会话|对话/ }).first();
        const hasButton = await buttonWithIcon.isVisible().catch(() => false);
        
        if (hasButton) {
          console.log('✓ 通过图标找到按钮，正在点击...');
          await buttonWithIcon.click();
          console.log('✓ 已点击按钮');
          await newPage.waitForTimeout(1500);
        } else {
          console.log('继续尝试其他方式...');
          // 尝试查找右上角区域的按钮
          const topRightButtons = newPage.locator('header button, nav button, [class*="header"] button, [class*="Header"] button');
          const buttonCount = await topRightButtons.count();
          console.log(`在顶部区域找到 ${buttonCount} 个按钮`);
          
          // 遍历查找包含"新"字的按钮
          for (let i = 0; i < buttonCount; i++) {
            const btn = topRightButtons.nth(i);
            const text = await btn.textContent().catch(() => '');
            if (text.includes('新') || text.includes('会话')) {
              console.log(`✓ 找到按钮 "${text}"，正在点击...`);
              await btn.click();
              console.log('✓ 已点击按钮');
              await newPage.waitForTimeout(1500);
              break;
            }
          }
        }
      }
      
      // 在新页面查找输入框并发送消息
      console.log('\n正在查找聊天输入框...');
      await newPage.waitForTimeout(1000);
      
      // 尝试多种定位方式
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
        const element = newPage.locator(selector).last(); // 使用 last() 获取最新的输入框
        const isVisible = await element.isVisible().catch(() => false);
        if (isVisible) {
          inputElement = element;
          console.log(`✓ 找到输入框 (${selector})`);
          break;
        }
      }
      
      if (inputElement) {
        console.log('正在输入消息: "创建一个 button 按钮组件"');
        
        // 先点击输入框获取焦点
        await inputElement.click();
        await newPage.waitForTimeout(300);
        
        // 清空可能存在的内容
        await inputElement.fill('');
        await newPage.waitForTimeout(200);
        
        // 输入消息
        await inputElement.fill('创建一个 button 按钮组件');
        console.log('✓ 消息已输入');
        
        await newPage.waitForTimeout(500);
        
        // 尝试按 Enter 键发送
        console.log('\n正在按 Enter 键发送消息...');
        await inputElement.press('Enter');
        console.log('✓ 已按 Enter 键');
        
        // 如果 Enter 没有效果，尝试点击发送按钮
        await newPage.waitForTimeout(1000);
        
        console.log('正在查找发送按钮...');
        const sendButton = newPage.locator('button:has-text("发送"), button[aria-label*="发送"], button[title*="发送"], button:has(svg)').last();
        const isSendButtonVisible = await sendButton.isVisible().catch(() => false);
        
        if (isSendButtonVisible) {
          console.log('✓ 找到发送按钮，正在点击...');
          await sendButton.click();
          console.log('✓ 已点击发送按钮');
        } else {
          console.log('未找到发送按钮，消息可能已通过 Enter 键发送');
        }
        
        await newPage.waitForTimeout(2000);
        console.log('✓ 消息发送流程已完成');
        
      } else {
        console.log('⚠️  未能找到聊天输入框');
      }
      
    } else {
      console.log('⚠️  未能找到"动态组件开发专家"卡片');
      console.log('尝试通过其他方式定位卡片...');
      
      // 尝试更宽泛的定位
      const cardLocator = page.locator('div:has-text("动态组件开发专家"), a:has-text("动态组件开发专家")').first();
      const isAltCardVisible = await cardLocator.isVisible().catch(() => false);
      
      if (isAltCardVisible) {
        console.log('✓ 通过备选方式找到卡片，正在点击...');
        await cardLocator.click();
        console.log('✓ 已点击卡片');
      }
    }
    
    console.log('\n✓ 自动化流程执行完成！');
    console.log('  浏览器窗口将保持打开状态，您可以继续操作。');
    console.log('  如需关闭浏览器，请告诉我。');
    
    // Keep browser open
    await new Promise(() => {});
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error('详细信息:', error);
    process.exit(1);
  }
})();
