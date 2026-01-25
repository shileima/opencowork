# 美团内部网站 SSO 登录持久化指南

## 概述

`meituan-sso-login.js` 是专门为美团内部网站（*.sankuai.com）设计的 SSO 登录管理器，可以自动处理 SSO 登录流程，保存和恢复登录状态。

## 核心功能

- ✅ **自动检测登录状态**：智能识别是否已登录
- ✅ **自动处理 SSO 登录流程**：自动点击 SSO 登录按钮，等待扫码
- ✅ **保存登录状态**：保存 Cookies 和 LocalStorage
- ✅ **自动恢复登录状态**：下次启动浏览器时自动恢复登录
- ✅ **支持所有美团内部网站**：bots.sankuai.com、xgpt.sankuai.com 等

## 登录流程

1. **访问目标网站**（如 bots.sankuai.com）
2. **检测登录状态**
   - 如果已登录 → 直接使用
   - 如果未登录 → 进入登录流程
3. **自动跳转到登录中心**（usercenter.sankuai.com/login-center）
4. **自动点击 SSO 登录按钮**
5. **跳转到 SSO 登录页面**（ssosv.sankuai.com/sson/login）
6. **等待用户扫码登录**
7. **登录成功后保存状态**（Cookies + LocalStorage）
8. **下次自动恢复登录状态**

## 快速开始

### 基本使用

```javascript
const { MeituanSSOLogin } = require('./meituan-sso-login');

// 创建登录管理器
const login = new MeituanSSOLogin(
  'bots',  // 网站名称
  'https://bots.sankuai.com'  // 网站URL
);

// 确保已登录（自动恢复或等待登录）
const { browser, context, page, isLoggedIn } = await login.ensureLoggedIn({
  headless: false
});

if (isLoggedIn) {
  // 执行你的业务逻辑
  await page.goto('https://bots.sankuai.com/app/xxx');
  // ...
  
  await browser.close();
}
```

### 使用示例脚本

```bash
# 运行 Bots 平台登录示例
node bots-login-example.js
```

## API 文档

### MeituanSSOLogin

#### 构造函数

```javascript
new MeituanSSOLogin(siteName, siteUrl, options)
```

**参数：**
- `siteName` (string): 网站名称（如 'bots', 'xgpt'）
- `siteUrl` (string): 网站URL（如 'https://bots.sankuai.com'）
- `options` (object, 可选):
  - `loginTimeout` (number): 登录超时时间（毫秒，默认10分钟）

#### 方法

##### `ensureLoggedIn(options) => Promise<{browser, context, page, isLoggedIn}>`
完整的登录流程：自动恢复或等待登录。

**参数：**
- `options` (object): Playwright 浏览器选项
  - `headless` (boolean): 是否无头模式
  - `slowMo` (number): 操作延迟（毫秒）
  - `viewport` (object): 视口大小
  - `userAgent` (string): User Agent

**返回：**
- `browser`: Playwright Browser 对象
- `context`: Playwright BrowserContext 对象
- `page`: Playwright Page 对象
- `isLoggedIn`: 是否已登录

##### `launchBrowser(options) => Promise<{browser, context}>`
启动浏览器，自动恢复登录状态。

##### `clearLoginState() => boolean`
清除保存的登录状态。

## 使用示例

### 示例1：Bots 平台登录

```javascript
const { MeituanSSOLogin } = require('./meituan-sso-login');

const login = new MeituanSSOLogin('bots', 'https://bots.sankuai.com');

const { browser, context, page, isLoggedIn } = await login.ensureLoggedIn();

if (isLoggedIn) {
  // 访问动态组件开发专家
  await page.goto('https://bots.sankuai.com/app/xxx');
  // ...
  
  await browser.close();
}
```

### 示例2：XGPT 平台登录

```javascript
const login = new MeituanSSOLogin('xgpt', 'https://xgpt.sankuai.com');

const { browser, context, page, isLoggedIn } = await login.ensureLoggedIn();
// ...
```

### 示例3：多个网站登录

```javascript
// Bots 平台
const botsLogin = new MeituanSSOLogin('bots', 'https://bots.sankuai.com');
const bots = await botsLogin.ensureLoggedIn();

// XGPT 平台
const xgptLogin = new MeituanSSOLogin('xgpt', 'https://xgpt.sankuai.com');
const xgpt = await xgptLogin.ensureLoggedIn();
```

## 会话数据存储

登录状态保存在用户本地目录 `~/.qa-cowork/skills/chrome-agent/session/meituan-{siteName}/`：

```
~/.qa-cowork/skills/chrome-agent/session/
├── meituan-bots/
│   ├── storage_state.json  # 完整会话状态（Cookies + Storage）
│   └── cookies.json         # Cookies 备份
└── meituan-xgpt/
    ├── storage_state.json
    └── cookies.json
```

## 登录状态检测逻辑

1. **URL 检测**：检查是否在登录页面
2. **页面元素检测**：查找登录按钮或用户头像
3. **LocalStorage 检测**：检查是否有登录相关的 key
4. **综合判断**：结合多个指标判断登录状态

## 支持的网站

- ✅ bots.sankuai.com（Bots 平台）
- ✅ xgpt.sankuai.com（XGPT 平台）
- ✅ 其他所有 *.sankuai.com 网站

## 常见问题

**Q: 为什么还是需要扫码？**
A: 可能是首次运行，或登录状态已过期。重新扫码一次即可。

**Q: 如何切换账号？**
A: 清除登录状态：`login.clearLoginState()`，然后重新登录。

**Q: 登录状态保存在哪里？**
A: `~/.qa-cowork/skills/chrome-agent/session/meituan-{siteName}/` 目录。

**Q: 登录状态会过期吗？**
A: 取决于网站的 Cookie 有效期。如果过期，需要重新登录。

**Q: 支持非交互式环境吗？**
A: 支持。`browser-login-manager.js` 会自动检测环境，非交互式环境会自动轮询检测登录状态。

## 技术细节

### SSO 登录流程

1. 访问目标网站 → 跳转到登录中心
2. 登录中心 → 点击 SSO 登录按钮
3. SSO 登录页面 → 用户扫码
4. 扫码成功 → 跳转回目标网站
5. 保存登录状态 → Cookies + LocalStorage

### 登录状态检测

- 检查 URL 是否包含登录页面
- 检查页面中是否有登录按钮
- 检查页面中是否有用户相关元素
- 检查 LocalStorage 中是否有登录相关的 key

## 完整示例

查看 `bots-login-example.js` 了解完整的使用示例。
