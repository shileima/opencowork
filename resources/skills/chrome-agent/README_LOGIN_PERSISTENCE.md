# 浏览器登录持久化使用指南

## 概述

`browser-login-manager.js` 是一个通用的浏览器登录持久化管理器，可以用于任何网站的登录状态保存和恢复。

## 核心功能

- ✅ **自动保存登录状态**：保存 Cookies 和 Storage（LocalStorage、SessionStorage）
- ✅ **自动恢复登录状态**：下次启动浏览器时自动恢复登录
- ✅ **智能检测登录状态**：自动检测是否已登录
- ✅ **智能登录流程**：
  - 交互式终端：等待用户按 Enter 键确认登录
  - 非交互式环境（API 调用等）：自动轮询检测登录状态
- ✅ **多网站支持**：可以为不同网站创建独立的登录管理器
- ✅ **多账号管理**：通过不同的 `siteName` 管理多个账号

## 快速开始

### 1. 基本使用

```javascript
const { BrowserLoginManager } = require('./browser-login-manager');

// 创建登录管理器
const manager = new BrowserLoginManager(
  'xiaohongshu',  // 网站名称（用于创建会话目录）
  'https://www.xiaohongshu.com'  // 登录页面URL
);

// 确保已登录（自动恢复或等待登录）
const { browser, context, page, isLoggedIn } = await manager.ensureLoggedIn({
  headless: false
});

if (isLoggedIn) {
  // 执行你的业务逻辑
  await page.goto('https://www.xiaohongshu.com/user/profile');
  // ...
  
  await browser.close();
}
```

### 2. 自定义登录检测

```javascript
const manager = new BrowserLoginManager('xiaohongshu', 'https://www.xiaohongshu.com', {
  // 自定义登录检测函数
  isLoggedIn: async (page) => {
    // 检查是否有用户头像
    const hasAvatar = await page.locator('[class*="avatar"]').first().isVisible().catch(() => false);
    
    // 检查URL是否包含登录页面
    const url = page.url();
    if (url.includes('/login')) return false;
    
    return hasAvatar;
  }
});
```

### 3. 手动管理登录状态

```javascript
const manager = new BrowserLoginManager('xiaohongshu', 'https://www.xiaohongshu.com');

// 检查是否有保存的状态
if (manager.hasSavedState()) {
  console.log('✅ 有保存的登录状态');
}

// 启动浏览器（自动恢复状态）
const { browser, context } = await manager.launchBrowser();
const page = await context.newPage();
await page.goto('https://www.xiaohongshu.com');

// 检查登录状态
const isLoggedIn = await manager.visitAndCheckLogin(page);

if (!isLoggedIn) {
  // 等待用户登录
  await manager.waitForLogin(page);
  // 保存登录状态
  await manager.saveLoginState(context, page);
}

// 清除登录状态（切换账号时）
manager.clearLoginState();
```

## API 文档

### BrowserLoginManager

#### 构造函数

```javascript
new BrowserLoginManager(siteName, loginUrl, options)
```

**参数：**
- `siteName` (string): 网站名称，用于创建会话目录
- `loginUrl` (string): 登录页面URL
- `options` (object, 可选):
  - `sessionDir` (string): 会话保存目录（默认：`./session/{siteName}`）
  - `isLoggedIn` (function): 自定义登录检测函数 `(page) => Promise<boolean>`
  - `loginTimeout` (number): 登录超时时间（毫秒，默认5分钟）

#### 方法

##### `hasSavedState() => boolean`
检查是否有保存的登录状态。

##### `loadStorageState() => object | null`
加载保存的存储状态。

##### `saveLoginState(context, page) => Promise<boolean>`
保存登录状态（Cookies + Storage）。

##### `clearLoginState() => boolean`
清除保存的登录状态。

##### `launchBrowser(options) => Promise<{browser, context}>`
启动浏览器，自动恢复登录状态。

**参数：**
- `options` (object): Playwright 浏览器选项
  - `headless` (boolean): 是否无头模式
  - `slowMo` (number): 操作延迟（毫秒）
  - `viewport` (object): 视口大小
  - `userAgent` (string): User Agent

##### `visitAndCheckLogin(page, options) => Promise<boolean>`
访问网站并检查登录状态。

##### `waitForLogin(page) => Promise<boolean>`
等待用户完成登录（交互式）。

##### `ensureLoggedIn(options) => Promise<{browser, context, page, isLoggedIn}>`
完整的登录流程：自动恢复或等待登录。

## 使用示例

### 示例1：小红书登录

```javascript
const { BrowserLoginManager } = require('./browser-login-manager');

const manager = new BrowserLoginManager(
  'xiaohongshu',
  'https://www.xiaohongshu.com',
  {
    isLoggedIn: async (page) => {
      const url = page.url();
      if (url.includes('/login')) return false;
      return await page.locator('[class*="avatar"]').first().isVisible().catch(() => false);
    }
  }
);

const { browser, context, page, isLoggedIn } = await manager.ensureLoggedIn();
// 执行任务...
await browser.close();
```

### 示例2：微博登录

```javascript
const manager = new BrowserLoginManager(
  'weibo',
  'https://weibo.com',
  {
    isLoggedIn: async (page) => {
      // 检查是否有"登录"按钮（未登录）
      const hasLoginButton = await page.getByText('登录').isVisible().catch(() => false);
      return !hasLoginButton;
    }
  }
);
```

### 示例3：多账号管理

```javascript
// 账号1
const manager1 = new BrowserLoginManager('xiaohongshu-account1', 'https://www.xiaohongshu.com');

// 账号2
const manager2 = new BrowserLoginManager('xiaohongshu-account2', 'https://www.xiaohongshu.com');
```

## 会话数据存储

登录状态保存在用户本地目录 `~/.qa-cowork/skills/chrome-agent/session/{siteName}/`：

```
~/.qa-cowork/skills/chrome-agent/session/
├── xiaohongshu/
│   ├── storage_state.json  # 完整会话状态（Cookies + Storage）
│   └── cookies.json         # Cookies 备份
└── weibo/
    ├── storage_state.json
    └── cookies.json
```

**重要说明：**
- 会话数据保存在用户本地目录，每个用户独立，不会共享
- 不同用户之间的登录状态互不影响
- 会话文件包含敏感信息，请妥善保管

## 安全提示

⚠️ **重要**：
- `session/` 目录包含敏感信息（Cookies、登录凭证）
- 不要将 `session/` 目录提交到 Git
- 不要分享或传输会话文件
- 建议将 `session/` 添加到 `.gitignore`

## 环境支持

### 交互式终端（TTY）
在交互式终端中运行时：
- 浏览器打开后，等待用户在浏览器中完成登录
- 登录完成后，在终端按 **Enter** 键继续
- 脚本会自动检测登录状态并保存

### 非交互式环境（非 TTY）
在非交互式环境中运行时（如通过 API 调用、自动化脚本等）：
- 浏览器打开后，脚本会自动轮询检测登录状态
- 每 2 秒检查一次是否已登录
- 检测到登录后自动保存状态
- 无需用户交互，适合自动化场景

## 常见问题

**Q: 为什么还是需要登录？**
A: 可能是首次运行，或登录状态已过期。重新登录一次即可。

**Q: 如何切换账号？**
A: 清除登录状态：`manager.clearLoginState()`，然后重新登录。

**Q: 登录状态保存在哪里？**
A: `~/.qa-cowork/skills/chrome-agent/session/{siteName}/` 目录（用户本地目录，每个用户独立）。

**Q: 多台电脑如何使用？**
A: 每台电脑需要独立登录一次，会话文件不能跨设备使用。

**Q: 登录状态会过期吗？**
A: 取决于网站的 Cookie 有效期。如果过期，需要重新登录。

**Q: 在非交互式环境中如何使用？**
A: 脚本会自动检测环境。如果是非 TTY 环境（如 API 调用），会自动切换到轮询模式，无需用户按 Enter 键。

## 完整示例

查看 `xiaohongshu-login-example.js` 了解完整的使用示例。
