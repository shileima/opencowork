/**
 * Bots 平台登录示例（使用美团 SSO 登录管理器）
 * 
 * 演示如何使用 MeituanSSOLogin 实现 Bots 平台的登录持久化
 */

const { MeituanSSOLogin } = require('./meituan-sso-login');

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

    console.log('\n✅ 登录成功！可以开始执行任务了\n');
    
    // 在这里执行你的业务逻辑
    // 例如：访问动态组件开发专家页面
    console.log('📱 访问 Bots 平台...');
    await page.goto('https://bots.sankuai.com', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // 示例：访问动态组件开发专家
    console.log('🔍 访问动态组件开发专家...');
    await page.goto('https://bots.sankuai.com/app/xxx', { waitUntil: 'networkidle' }).catch(() => {
      console.log('⚠️  页面可能不存在或需要权限');
    });
    
    console.log('✅ 任务完成！');
    console.log('\n💡 提示：登录状态已自动保存，下次运行脚本将自动登录');
    
    // 保持浏览器打开（可选）
    // await new Promise(() => {});
    
    await browser.close();
    console.log('\n🔚 浏览器已关闭');
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
