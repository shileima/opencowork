/**
 * 美团内部网站 SSO 登录管理器
 * 
 * 专门处理美团内部网站（*.sankuai.com）的 SSO 登录流程：
 * 1. 自动检测是否需要登录
 * 2. 引导用户完成 SSO 登录（扫码）
 * 3. 保存登录状态（Cookies + LocalStorage）
 * 4. 下次自动恢复登录状态
 * 
 * 使用方法：
 * const { MeituanSSOLogin } = require('./meituan-sso-login');
 * const login = new MeituanSSOLogin('bots', 'https://bots.sankuai.com');
 * const { browser, context, page, isLoggedIn } = await login.ensureLoggedIn();
 */

const { BrowserLoginManager } = require('./browser-login-manager');

class MeituanSSOLogin {
  /**
   * @param {string} siteName - 网站名称（如 'bots', 'xgpt'）
   * @param {string} siteUrl - 网站URL（如 'https://bots.sankuai.com'）
   * @param {object} options - 配置选项
   */
  constructor(siteName, siteUrl, options = {}) {
    this.siteName = siteName;
    this.siteUrl = siteUrl;
    
    // 美团 SSO 登录相关 URL 模式
    this.ssoLoginPatterns = [
      /usercenter\.sankuai\.com\/login-center/,
      /ssosv\.sankuai\.com\/sson\/login/,
      /sso\.sankuai\.com/,
    ];
    
    // 创建登录管理器
    this.loginManager = new BrowserLoginManager(
      `meituan-${siteName}`,
      siteUrl,
      {
        // 自定义登录检测函数
        isLoggedIn: async (page) => {
          return await this.checkMeituanLoginStatus(page);
        },
        loginTimeout: options.loginTimeout || 10 * 60 * 1000, // 默认10分钟（扫码可能需要更长时间）
      }
    );
  }

  /**
   * 检查美团内部网站登录状态
   * @param {Page} page - Playwright Page 对象
   * @returns {Promise<boolean>} - 是否已登录
   */
  async checkMeituanLoginStatus(page) {
    try {
      const url = page.url();
      
      // 如果 URL 包含登录页面，认为未登录
      if (this.ssoLoginPatterns.some(pattern => pattern.test(url))) {
        return false;
      }
      
      // 检查是否在目标网站（不是登录页面）
      if (!url.includes('sankuai.com')) {
        return false;
      }
      
      // 检查页面中是否有登录相关的元素（表示未登录）
      const loginIndicators = [
        '登录',
        'SSO登录',
        '扫码登录',
        '请登录',
        'login',
        'sign in'
      ];
      
      for (const indicator of loginIndicators) {
        try {
          const element = await page.getByText(indicator, { exact: false }).first();
          if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
            // 检查是否在登录按钮区域
            const text = await element.textContent().catch(() => '');
            if (text.includes('登录') || text.includes('login')) {
              return false;
            }
          }
        } catch {
          // 继续检查下一个
        }
      }
      
      // 检查是否有用户相关的元素（表示已登录）
      const userIndicators = [
        '[class*="user"]',
        '[class*="User"]',
        '[class*="avatar"]',
        '[class*="Avatar"]',
        '[data-testid*="user"]',
        'img[alt*="头像"]',
        'img[alt*="avatar"]'
      ];
      
      for (const selector of userIndicators) {
        try {
          const element = await page.locator(selector).first();
          if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
            return true;
          }
        } catch {
          // 继续检查下一个
        }
      }
      
      // 检查 localStorage 中是否有登录相关的 key
      try {
        const localStorage = await page.evaluate(() => {
          return Object.keys(window.localStorage);
        });
        
        // 美团内部网站常见的登录相关 key
        const loginKeys = ['token', 'auth', 'user', 'login', 'session'];
        if (localStorage.some(key => loginKeys.some(loginKey => key.toLowerCase().includes(loginKey)))) {
          return true;
        }
      } catch {
        // 忽略错误
      }
      
      // 默认认为已登录（如果不在登录页面）
      return true;
    } catch (error) {
      console.warn('检查登录状态失败:', error.message);
      return false;
    }
  }

  /**
   * 处理 SSO 登录流程
   * @param {Page} page - Playwright Page 对象
   * @returns {Promise<boolean>} - 是否登录成功
   */
  async handleSSOLogin(page) {
    try {
      const url = page.url();
      
      // 如果已经在 SSO 登录页面，等待用户扫码
      if (/ssosv\.sankuai\.com\/sson\/login/.test(url)) {
        console.log('📱 检测到 SSO 登录页面，请扫码登录...');
        console.log('   等待登录完成...');
        
        // 等待 URL 变化（登录成功后通常会跳转）
        const loginSuccess = await Promise.race([
          // 等待跳转到非 SSO 登录页面
          page.waitForURL((url) => {
            return !url.includes('ssosv.sankuai.com/sson/login');
          }, { timeout: 10 * 60 * 1000 }).then(() => {
            console.log('✅ 检测到页面跳转，登录可能成功');
            return true;
          }).catch(() => false),
          // 定期检查登录状态
          new Promise((resolve) => {
            let checkCount = 0;
            const checkInterval = setInterval(async () => {
              checkCount++;
              try {
                const isLoggedIn = await this.checkMeituanLoginStatus(page);
                if (isLoggedIn) {
                  clearInterval(checkInterval);
                  console.log('✅ 检测到已登录状态');
                  resolve(true);
                } else if (checkCount % 10 === 0) {
                  // 每20秒输出一次提示
                  console.log('   仍在等待扫码登录...');
                }
              } catch (error) {
                // 忽略检查错误
              }
            }, 2000);
            
            // 10分钟后超时
            setTimeout(() => {
              clearInterval(checkInterval);
              console.log('⏰ 登录超时');
              resolve(false);
            }, 10 * 60 * 1000);
          })
        ]);
        
        return loginSuccess;
      }
      
      // 如果在登录中心页面，点击 SSO 登录按钮
      if (/usercenter\.sankuai\.com\/login-center/.test(url)) {
        console.log('🔐 检测到登录中心页面，尝试点击 SSO 登录...');
        
        // 等待页面加载完成
        await page.waitForTimeout(2000);
        
        // 查找并点击 SSO 登录按钮（多种选择器）
        const ssoButtonSelectors = [
          'text=SSO登录',
          'text=SSO 登录',
          'text=扫码登录',
          'button:has-text("SSO")',
          'a:has-text("SSO")',
          '[class*="sso"]',
          '[class*="SSO"]',
          'button[class*="sso"]',
          'a[class*="sso"]'
        ];
        
        let clicked = false;
        for (const selector of ssoButtonSelectors) {
          try {
            const button = page.locator(selector).first();
            const isVisible = await button.isVisible({ timeout: 3000 }).catch(() => false);
            
            if (isVisible) {
              // 滚动到按钮位置（确保可见）
              await button.scrollIntoViewIfNeeded();
              await page.waitForTimeout(500);
              
              await button.click();
              console.log(`✅ 已点击 SSO 登录按钮 (${selector})`);
              clicked = true;
              
              // 等待跳转到 SSO 登录页面
              try {
                await page.waitForURL(/ssosv\.sankuai\.com\/sson\/login/, { timeout: 10000 });
                console.log('✅ 已跳转到 SSO 登录页面');
              } catch {
                // 如果 URL 没变化，等待一下再检查
                await page.waitForTimeout(2000);
                const currentUrl = page.url();
                if (/ssosv\.sankuai\.com\/sson\/login/.test(currentUrl)) {
                  console.log('✅ 已跳转到 SSO 登录页面（延迟检测）');
                }
              }
              
              // 递归处理 SSO 登录
              return await this.handleSSOLogin(page);
            }
          } catch (error) {
            // 继续尝试下一个选择器
            continue;
          }
        }
        
        if (!clicked) {
          console.log('⚠️  未找到 SSO 登录按钮，等待用户手动操作...');
          console.log('   请在浏览器中点击 SSO 登录按钮');
          
          // 等待用户手动操作或页面自动跳转
          const manualLoginSuccess = await Promise.race([
            // 等待跳转到 SSO 登录页面
            page.waitForURL(/ssosv\.sankuai\.com\/sson\/login/, { timeout: 30 * 1000 }).then(() => {
              console.log('✅ 检测到跳转到 SSO 登录页面');
              return true;
            }).catch(() => false),
            // 或者等待登录状态变化
            new Promise((resolve) => {
              const checkInterval = setInterval(async () => {
                const currentUrl = page.url();
                if (/ssosv\.sankuai\.com\/sson\/login/.test(currentUrl)) {
                  clearInterval(checkInterval);
                  resolve(true);
                }
              }, 1000);
              
              setTimeout(() => {
                clearInterval(checkInterval);
                resolve(false);
              }, 30 * 1000);
            })
          ]);
          
          if (manualLoginSuccess) {
            return await this.handleSSOLogin(page);
          } else {
            console.log('⏰ 等待超时，请手动完成登录');
            return false;
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error('处理 SSO 登录失败:', error.message);
      return false;
    }
  }

  /**
   * 确保已登录（自动恢复或等待登录）
   * @param {object} options - 浏览器启动选项
   * @returns {Promise<{browser: Browser, context: BrowserContext, page: Page, isLoggedIn: boolean}>}
   */
  async ensureLoggedIn(options = {}) {
    const { browser, context, page, isLoggedIn: wasLoggedIn } = await this.loginManager.ensureLoggedIn(options);
    
    if (wasLoggedIn) {
      // 已登录，更新登录状态
      await this.loginManager.saveLoginState(context, page);
      return { browser, context, page, isLoggedIn: true };
    }
    
    // 未登录，处理 SSO 登录流程
    console.log('\n🔐 需要登录，开始 SSO 登录流程...');
    
    try {
      // 访问目标网站
      await page.goto(this.siteUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);
      
      // 检查是否需要登录
      const needsLogin = !(await this.checkMeituanLoginStatus(page));
      
      if (!needsLogin) {
        // 已经登录了
        await this.loginManager.saveLoginState(context, page);
        return { browser, context, page, isLoggedIn: true };
      }
      
      // 处理 SSO 登录
      const loginSuccess = await this.handleSSOLogin(page);
      
      if (loginSuccess) {
        // 登录成功，保存状态
        await this.loginManager.saveLoginState(context, page);
        console.log('\n✅ SSO 登录成功！登录状态已保存');
        return { browser, context, page, isLoggedIn: true };
      } else {
        // 登录失败或超时
        console.log('\n❌ SSO 登录失败或超时');
        return { browser, context, page, isLoggedIn: false };
      }
    } catch (error) {
      console.error('登录流程出错:', error.message);
      return { browser, context, page, isLoggedIn: false };
    }
  }

  /**
   * 启动浏览器（自动恢复登录状态）
   */
  async launchBrowser(options = {}) {
    return await this.loginManager.launchBrowser(options);
  }

  /**
   * 清除登录状态
   */
  clearLoginState() {
    return this.loginManager.clearLoginState();
  }
}

module.exports = { MeituanSSOLogin };
