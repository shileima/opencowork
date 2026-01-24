const { chromium } = require('playwright');

(async () => {
  try {
    console.log('启动浏览器...');
    const browser = await chromium.launch({ 
      headless: false,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();

    console.log('正在打开 https://xgpt.waimai.test.sankuai.com/explore ...');
    await page.goto('https://xgpt.waimai.test.sankuai.com/explore', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    console.log('✓ 页面加载完成');
    console.log('  当前页面标题:', await page.title());
    
    // 等待页面稳定
    await page.waitForTimeout(2000);
    
    // 查找并点击"密码登录"按钮
    console.log('\n正在查找"密码登录"按钮...');
    const passwordLoginButton = await page.getByText('密码登录').first();
    if (passwordLoginButton) {
      console.log('✓ 找到"密码登录"按钮，正在点击...');
      await passwordLoginButton.click();
      await page.waitForTimeout(1000);
      console.log('✓ 已点击"密码登录"');
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
      
      // 等待登录完成
      console.log('\n等待登录完成...');
      await page.waitForTimeout(3000);
      
      console.log('✓ 登录流程已执行');
      console.log('  当前 URL:', await page.url());
      console.log('  当前页面标题:', await page.title());
    }
    
    console.log('\n✓ 浏览器窗口将保持打开状态，您可以继续操作。');
    console.log('  如需关闭浏览器，请告诉我。');
    
    // Keep browser open
    await new Promise(() => {});
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error('详细信息:', error);
    process.exit(1);
  }
})();
