/**
 * 通用浏览器登录持久化管理器
 * 
 * 功能：
 * - 自动保存登录状态（Cookies + Storage）
 * - 自动恢复登录状态
 * - 智能检测登录状态
 * - 支持多网站、多账号管理
 * 
 * 使用方法：
 * const { BrowserLoginManager } = require('./browser-login-manager');
 * const manager = new BrowserLoginManager('xiaohongshu', 'https://www.xiaohongshu.com');
 * const { browser, context } = await manager.launchBrowser();
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 获取用户本地会话目录
 * 会话数据保存在用户目录：~/.qa-cowork/skills/chrome-agent/session/
 */
function getUserSessionDir() {
  const homeDir = os.homedir();
  return path.join(homeDir, '.qa-cowork', 'skills', 'chrome-agent', 'session');
}

class BrowserLoginManager {
  /**
   * @param {string} siteName - 网站名称（用于创建会话目录，如 'xiaohongshu', 'weibo'）
   * @param {string} loginUrl - 登录页面URL
   * @param {object} options - 配置选项
   * @param {string} options.sessionDir - 会话保存目录（默认：~/.qa-cowork/skills/chrome-agent/session/{siteName}）
   * @param {function} options.isLoggedIn - 自定义登录检测函数 (page) => Promise<boolean>
   * @param {number} options.loginTimeout - 登录超时时间（毫秒，默认5分钟）
   */
  constructor(siteName, loginUrl, options = {}) {
    this.siteName = siteName;
    this.loginUrl = loginUrl;
    // 默认保存到用户本地目录，而不是共享资源目录
    const defaultSessionDir = path.join(getUserSessionDir(), siteName);
    this.sessionDir = options.sessionDir || defaultSessionDir;
    this.storageStatePath = path.join(this.sessionDir, 'storage_state.json');
    this.cookiesPath = path.join(this.sessionDir, 'cookies.json');
    this.isLoggedIn = options.isLoggedIn || this.defaultIsLoggedIn;
    this.loginTimeout = options.loginTimeout || 5 * 60 * 1000; // 5分钟
    
    // 确保会话目录存在
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  /**
   * 默认登录检测函数：检查页面URL和标题
   */
  async defaultIsLoggedIn(page) {
    try {
      const url = page.url();
      const title = await page.title();
      
      // 如果URL包含登录相关关键词，认为未登录
      const loginKeywords = ['login', 'signin', '登录', '登陆', 'sign-in'];
      if (loginKeywords.some(keyword => url.toLowerCase().includes(keyword))) {
        return false;
      }
      
      // 如果标题包含登录相关关键词，认为未登录
      if (loginKeywords.some(keyword => title.toLowerCase().includes(keyword))) {
        return false;
      }
      
      // 默认认为已登录（需要用户自定义检测函数）
      return true;
    } catch (error) {
      console.warn('登录状态检测失败:', error.message);
      return false;
    }
  }

  /**
   * 检查是否有保存的登录状态
   */
  hasSavedState() {
    return fs.existsSync(this.storageStatePath) || fs.existsSync(this.cookiesPath);
  }

  /**
   * 加载保存的登录状态
   */
  loadStorageState() {
    if (fs.existsSync(this.storageStatePath)) {
      try {
        const content = fs.readFileSync(this.storageStatePath, 'utf-8');
        return JSON.parse(content);
      } catch (error) {
        console.warn('加载存储状态失败:', error.message);
        return null;
      }
    }
    return null;
  }

  /**
   * 保存登录状态
   */
  async saveLoginState(context, page) {
    try {
      // 保存完整的存储状态（推荐方式）
      const storageState = await context.storageState();
      fs.writeFileSync(this.storageStatePath, JSON.stringify(storageState, null, 2), 'utf-8');
      console.log(`✅ 登录状态已保存: ${this.storageStatePath}`);
      
      // 同时保存 Cookies 作为备份
      const cookies = await context.cookies();
      fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2), 'utf-8');
      console.log(`✅ Cookies 已保存: ${this.cookiesPath}`);
      
      return true;
    } catch (error) {
      console.error('保存登录状态失败:', error.message);
      return false;
    }
  }

  /**
   * 清除登录状态
   */
  clearLoginState() {
    try {
      if (fs.existsSync(this.storageStatePath)) {
        fs.unlinkSync(this.storageStatePath);
        console.log(`✅ 已清除存储状态: ${this.storageStatePath}`);
      }
      if (fs.existsSync(this.cookiesPath)) {
        fs.unlinkSync(this.cookiesPath);
        console.log(`✅ 已清除 Cookies: ${this.cookiesPath}`);
      }
      return true;
    } catch (error) {
      console.error('清除登录状态失败:', error.message);
      return false;
    }
  }

  /**
   * 启动浏览器（自动恢复登录状态）
   */
  async launchBrowser(options = {}) {
    const {
      headless = false,
      slowMo = 0,
      viewport = { width: 1920, height: 1080 },
      userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ...browserOptions
    } = options;

    // 尝试加载保存的登录状态
    const storageState = this.loadStorageState();
    
    const browser = await chromium.launch({
      headless,
      slowMo,
      ...browserOptions
    });

    // 如果有保存的状态，使用它创建上下文
    const context = storageState
      ? await browser.newContext({
          storageState,
          viewport,
          userAgent,
          locale: 'zh-CN',
          timezoneId: 'Asia/Shanghai'
        })
      : await browser.newContext({
          viewport,
          userAgent,
          locale: 'zh-CN',
          timezoneId: 'Asia/Shanghai'
        });

    return { browser, context };
  }

  /**
   * 访问网站并检查登录状态
   * @param {Page} page - Playwright Page 对象
   * @param {object} options - 选项
   * @returns {Promise<boolean>} - 是否已登录
   */
  async visitAndCheckLogin(page, options = {}) {
    const { waitUntil = 'networkidle', timeout = 30000 } = options;
    
    console.log(`🌐 访问 ${this.loginUrl}...`);
    await page.goto(this.loginUrl, { waitUntil, timeout });
    await page.waitForTimeout(2000); // 等待页面稳定
    
    // 检查登录状态
    const isLoggedIn = await this.isLoggedIn(page);
    
    if (isLoggedIn) {
      console.log('✅ 已登录状态');
    } else {
      console.log('⚠️  未登录，需要登录');
    }
    
    return isLoggedIn;
  }

  /**
   * 检查是否为交互式终端（TTY）
   */
  isTTY() {
    return process.stdin.isTTY && process.stdout.isTTY;
  }

  /**
   * 等待用户登录（支持交互式和非交互式环境）
   * @param {Page} page - Playwright Page 对象
   * @returns {Promise<boolean>} - 是否登录成功
   */
  async waitForLogin(page) {
    const isTTY = this.isTTY();
    
    if (isTTY) {
      // 交互式终端：等待用户按 Enter 键
      return this.waitForLoginInteractive(page);
    } else {
      // 非交互式环境（如 API 调用）：自动轮询检测
      return this.waitForLoginPolling(page);
    }
  }

  /**
   * 交互式等待登录（TTY 环境）
   * @param {Page} page - Playwright Page 对象
   * @returns {Promise<boolean>} - 是否登录成功
   */
  async waitForLoginInteractive(page) {
    console.log('\n📱 请在浏览器中完成登录...');
    console.log('   登录完成后，请在终端按 Enter 键继续');
    
    const startTime = Date.now();
    const checkInterval = 2000; // 每2秒检查一次
    
    return new Promise((resolve) => {
      // 监听用户输入
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      
      const checkLogin = async () => {
        try {
          const isLoggedIn = await this.isLoggedIn(page);
          if (isLoggedIn) {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            console.log('\n✅ 检测到已登录！');
            resolve(true);
            return;
          }
          
          // 检查超时
          if (Date.now() - startTime > this.loginTimeout) {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            console.log('\n⏰ 登录超时');
            resolve(false);
            return;
          }
          
          // 继续检查
          setTimeout(checkLogin, checkInterval);
        } catch (error) {
          console.error('检查登录状态时出错:', error.message);
          setTimeout(checkLogin, checkInterval);
        }
      };
      
      // 监听 Enter 键
      process.stdin.once('data', async (key) => {
        if (key === '\r' || key === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          
          const isLoggedIn = await this.isLoggedIn(page);
          if (isLoggedIn) {
            console.log('\n✅ 已登录！');
            resolve(true);
          } else {
            console.log('\n⚠️  未检测到登录状态，请确认是否已登录');
            console.log('   继续等待登录... (按 Ctrl+C 取消)');
            checkLogin();
          }
        } else if (key === '\u0003') { // Ctrl+C
          process.stdin.setRawMode(false);
          process.stdin.pause();
          console.log('\n❌ 已取消');
          resolve(false);
        }
      });
      
      // 开始自动检查
      checkLogin();
    });
  }

  /**
   * 非交互式等待登录（自动轮询，适用于 API 调用等非 TTY 环境）
   * @param {Page} page - Playwright Page 对象
   * @returns {Promise<boolean>} - 是否登录成功
   */
  async waitForLoginPolling(page) {
    console.log('\n📱 请在浏览器中完成登录...');
    console.log('   正在自动检测登录状态（非交互式模式）...');
    
    const startTime = Date.now();
    const checkInterval = 2000; // 每2秒检查一次
    
    return new Promise((resolve) => {
      const checkLogin = async () => {
        try {
          const isLoggedIn = await this.isLoggedIn(page);
          if (isLoggedIn) {
            console.log('\n✅ 检测到已登录！');
            resolve(true);
            return;
          }
          
          // 检查超时
          if (Date.now() - startTime > this.loginTimeout) {
            console.log('\n⏰ 登录超时');
            resolve(false);
            return;
          }
          
          // 继续检查
          setTimeout(checkLogin, checkInterval);
        } catch (error) {
          console.error('检查登录状态时出错:', error.message);
          setTimeout(checkLogin, checkInterval);
        }
      };
      
      // 开始自动检查
      checkLogin();
    });
  }

  /**
   * 完整的登录流程（自动恢复或等待登录）
   * @param {object} options - 浏览器启动选项
   * @returns {Promise<{browser: Browser, context: BrowserContext, page: Page, isLoggedIn: boolean}>}
   */
  async ensureLoggedIn(options = {}) {
    const { browser, context } = await this.launchBrowser(options);
    const page = await context.newPage();
    
    try {
      // 访问网站
      const wasLoggedIn = await this.visitAndCheckLogin(page);
      
      if (wasLoggedIn) {
        // 已登录，保存状态（更新）
        await this.saveLoginState(context, page);
        return { browser, context, page, isLoggedIn: true };
      } else {
        // 未登录，等待用户登录
        console.log('\n🔐 需要登录...');
        const loginSuccess = await this.waitForLogin(page);
        
        if (loginSuccess) {
          // 登录成功，保存状态
          await this.saveLoginState(context, page);
          return { browser, context, page, isLoggedIn: true };
        } else {
          return { browser, context, page, isLoggedIn: false };
        }
      }
    } catch (error) {
      console.error('登录流程出错:', error.message);
      return { browser, context, page, isLoggedIn: false };
    }
  }
}

module.exports = { BrowserLoginManager };
