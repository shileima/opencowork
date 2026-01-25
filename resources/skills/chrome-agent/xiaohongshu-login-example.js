/**
 * 小红书登录持久化示例
 * 
 * 演示如何使用 BrowserLoginManager 实现小红书登录持久化
 */

const { BrowserLoginManager } = require('./browser-login-manager');

(async () => {
  try {
    // 创建登录管理器
    const manager = new BrowserLoginManager(
      'xiaohongshu',
      'https://www.xiaohongshu.com',
      {
        // 自定义登录检测函数
        isLoggedIn: async (page) => {
          try {
            // 检查是否在登录页面
            const url = page.url();
            if (url.includes('/login') || url.includes('/signin')) {
              return false;
            }
            
            // 检查是否有用户头像或用户名（表示已登录）
            const hasUserAvatar = await page.locator('[class*="avatar"], [class*="Avatar"], img[alt*="头像"]').first().isVisible().catch(() => false);
            const hasUserMenu = await page.locator('[class*="user"], [class*="User"], [class*="profile"]').first().isVisible().catch(() => false);
            
            return hasUserAvatar || hasUserMenu;
          } catch (error) {
            return false;
          }
        }
      }
    );

    console.log('🚀 启动浏览器...');
    
    // 确保已登录（自动恢复或等待登录）
    const { browser, context, page, isLoggedIn } = await manager.ensureLoggedIn({
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
    // 例如：查询粉丝数、发布内容等
    
    // 示例：访问个人主页
    console.log('📱 访问小红书首页...');
    await page.goto('https://www.xiaohongshu.com', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
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
