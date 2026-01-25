/**
 * Bots 平台自动聊天输入示例
 * 
 * 登录后在主体聊天框中输入指定内容并发送
 * 支持通过命令行参数或代码修改消息内容
 * 智能判断是否关闭浏览器
 * 
 * 使用方式:
 * node bots-chat-input.js "你的消息内容"
 * 或直接修改代码中的 DEFAULT_MESSAGE
 */

const { MeituanSSOLogin } = require('./meituan-sso-login');

// 默认消息内容
const DEFAULT_MESSAGE = '创建一个 http 请求指令';

// 从命令行参数获取消息，如果没有则使用默认值
const messageText = process.argv[2] || DEFAULT_MESSAGE;

/**
 * 判断消息是否包含"关闭浏览器"的意思
 */
function shouldCloseBrowser(message) {
  const closeKeywords = [
    '关闭浏览器',
    '关闭窗口',
    '退出浏览器',
    '关闭页面',
    '退出',
    'close browser',
    'close window',
    'exit',
    'quit'
  ];
  
  const lowerMessage = message.toLowerCase();
  return closeKeywords.some(keyword => lowerMessage.includes(keyword));
}

(async () => {
  try {
    // 创建美团 SSO 登录管理器
    const login = new MeituanSSOLogin(
      'bots',
      'https://bots.sankuai.com'
    );

    console.log('🚀 启动浏览器...');
    
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

    console.log('\n✅ 登录成功！开始执行聊天输入任务\n');
    
    // 访问 Bots 平台首页
    console.log('📱 访问 Bots 平台...');
    await page.goto('https://bots.sankuai.com', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // 等待页面加载完成
    console.log('⏳ 等待页面加载...');
    await page.waitForLoadState('domcontentloaded');
    
    // 尝试多种可能的聊天框选择器
    console.log('🔍 查找聊天输入框...');
    
    const possibleSelectors = [
      'div[contenteditable="true"]',
      'textarea[placeholder*="消息"]',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="请输入"]',
      'textarea[class*="input"]',
      'textarea[class*="chat"]',
      'textarea[class*="message"]',
      'input[placeholder*="消息"]',
      'input[placeholder*="输入"]',
      '[role="textbox"]',
      'textarea',
      'input[type="text"]'
    ];
    
    let inputElement = null;
    let usedSelector = '';
    
    // 尝试找到可用的输入框
    for (const selector of possibleSelectors) {
      try {
        const element = await page.locator(selector).first();
        const count = await element.count();
        
        if (count > 0) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            inputElement = element;
            usedSelector = selector;
            console.log(`✅ 找到输入框: ${selector}`);
            break;
          }
        }
      } catch (e) {
        // 继续尝试下一个选择器
      }
    }
    
    if (!inputElement) {
      console.log('⚠️  未找到标准输入框，尝试打印页面结构...');
      
      // 打印页面中所有的 textarea 和 input 元素
      const textareas = await page.locator('textarea').all();
      const inputs = await page.locator('input').all();
      
      console.log(`📋 页面中有 ${textareas.length} 个 textarea 元素`);
      console.log(`📋 页面中有 ${inputs.length} 个 input 元素`);
      
      // 尝试点击页面上可能触发输入框的区域
      console.log('🖱️  尝试点击页面激活输入区域...');
      try {
        await page.click('body');
        await page.waitForTimeout(1000);
        
        // 再次尝试查找
        for (const selector of possibleSelectors) {
          try {
            const element = await page.locator(selector).first();
            const count = await element.count();
            
            if (count > 0) {
              const isVisible = await element.isVisible();
              if (isVisible) {
                inputElement = element;
                usedSelector = selector;
                console.log(`✅ 点击后找到输入框: ${selector}`);
                break;
              }
            }
          } catch (e) {
            // 继续尝试
          }
        }
      } catch (e) {
        console.log('⚠️  点击页面失败');
      }
    }
    
    if (inputElement) {
      // 点击输入框以确保焦点
      console.log('🖱️  点击输入框...');
      await inputElement.click();
      await page.waitForTimeout(500);
      
      console.log(`⌨️  输入文本: "${messageText}"`);
      
      // 根据输入框类型选择不同的输入方法
      if (usedSelector.includes('contenteditable')) {
        // 对于 contenteditable 的 div，使用 type 方法
        console.log('📝 使用 type 方法输入（contenteditable）');
        await inputElement.clear();
        await page.waitForTimeout(300);
        await inputElement.type(messageText, { delay: 50 });
      } else {
        // 对于 textarea 或 input，使用 fill 方法
        console.log('📝 使用 fill 方法输入');
        await inputElement.fill('');
        await page.waitForTimeout(300);
        await inputElement.fill(messageText);
      }
      
      await page.waitForTimeout(500);
      
      console.log('✅ 文本输入成功！');
      
      // 尝试发送消息
      console.log('📤 尝试发送消息...');
      let messageSent = false;
      
      // 方法1: 按 Enter 键发送
      try {
        console.log('🔹 方法1: 按 Enter 键...');
        await inputElement.press('Enter');
        await page.waitForTimeout(1000);
        messageSent = true;
        console.log('✅ 已按 Enter 键发送消息');
      } catch (e) {
        console.log('⚠️  按 Enter 键失败，尝试其他方法');
      }
      
      // 如果 Enter 键没成功，尝试查找并点击发送按钮
      if (!messageSent) {
        const sendButtonSelectors = [
          'button[type="submit"]',
          'button:has-text("发送")',
          'button:has-text("Send")',
          'button[aria-label*="发送"]',
          'button[class*="send"]',
          '[class*="send-button"]',
          'svg[class*="send"]'
        ];
        
        for (const selector of sendButtonSelectors) {
          try {
            console.log(`🔹 尝试点击发送按钮: ${selector}`);
            const sendButton = await page.locator(selector).first();
            const count = await sendButton.count();
            
            if (count > 0) {
              const isVisible = await sendButton.isVisible();
              if (isVisible) {
                await sendButton.click();
                await page.waitForTimeout(1000);
                messageSent = true;
                console.log(`✅ 已点击发送按钮: ${selector}`);
                break;
              }
            }
          } catch (e) {
            // 继续尝试下一个选择器
          }
        }
      }
      
      if (messageSent) {
        console.log('🎉 消息已成功发送！');
      } else {
        console.log('⚠️  未能自动发送消息，文本已输入到输入框');
        console.log('💡 提示：可能需要手动点击发送按钮或按 Enter 键');
      }
      
      // 等待响应（可选）
      console.log('⏳ 等待响应...');
      await page.waitForTimeout(3000);
      
    } else {
      console.log('❌ 未能找到聊天输入框');
      console.log('💡 建议：手动检查页面结构，或提供正确的选择器');
      
      // 保存页面截图用于调试
      const screenshotPath = '/Users/shilei/.qa-cowork/skills/chrome-agent/debug-screenshot.png';
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 页面截图已保存: ${screenshotPath}`);
    }
    
    // 判断是否应该关闭浏览器
    const closeBrowser = shouldCloseBrowser(messageText);
    
    if (closeBrowser) {
      console.log('\n💡 检测到消息中包含"关闭浏览器"的意思');
      console.log('⏸️  浏览器将在 3 秒后关闭...');
      await page.waitForTimeout(3000);
      await browser.close();
      console.log('🔚 浏览器已关闭');
    } else {
      console.log('\n💡 消息中未包含"关闭浏览器"的意思');
      console.log('🌐 浏览器将保持打开状态，可以继续与页面交互');
      console.log('💡 提示：手动关闭浏览器窗口即可结束程序');
      console.log('📝 如需关闭浏览器，请在消息中包含"关闭浏览器"等关键词');
      
      // 保持浏览器打开，等待用户手动关闭
      await new Promise(() => {});
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
