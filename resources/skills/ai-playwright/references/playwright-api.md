# Playwright 常用 API 速查

## 导航

```javascript
await page.goto(url, { waitUntil: 'networkidle' });  // 导航并等待网络空闲
await page.reload();
await page.goBack();
await page.goForward();
```

## 定位器（推荐使用 Locator API）

```javascript
page.locator('#id')                          // CSS 选择器
page.locator('[name="email"]')
page.getByRole('button', { name: '提交' })   // 语义角色
page.getByText('登录', { exact: true })      // 精确文本
page.getByLabel('用户名')                    // label 关联
page.getByPlaceholder('请输入密码')          // placeholder
page.getByTestId('submit-btn')               // data-testid
```

## 交互操作

```javascript
await locator.click();
await locator.fill('text');          // 清空后输入
await locator.type('text');          // 模拟键盘逐字输入
await locator.press('Enter');
await locator.selectOption('value'); // 下拉选择
await locator.check();               // 勾选 checkbox
await locator.uncheck();
await locator.hover();
await locator.focus();
```

## 等待策略

```javascript
await page.waitForSelector('#el', { timeout: 10000 });
await page.waitForURL('**/dashboard**');
await page.waitForLoadState('networkidle');
await page.waitForLoadState('domcontentloaded');
await page.waitForFunction(() => window.__ready === true);
await locator.waitFor({ state: 'visible' });
```

## 获取信息

```javascript
await locator.textContent()          // 获取文本
await locator.inputValue()           // 获取输入值
await locator.getAttribute('href')   // 获取属性
await page.title()                   // 页面标题
await page.url()                     // 当前 URL
await page.evaluate(() => expression) // 执行 JS
```

## 截图

```javascript
await page.screenshot({ path: 'shot.png' });
await page.screenshot({ path: 'full.png', fullPage: true });
await locator.screenshot({ path: 'el.png' });
```

## 键盘 & 鼠标

```javascript
await page.keyboard.press('Tab');
await page.keyboard.type('text');
await page.mouse.click(x, y);
await page.mouse.move(x, y);
```

## 多标签页

```javascript
const [newPage] = await Promise.all([
  context.waitForEvent('page'),
  page.click('a[target="_blank"]'),
]);
await newPage.waitForLoadState();
```

## 文件上传

```javascript
await page.locator('input[type="file"]').setInputFiles('/path/to/file.pdf');
```

## 网络拦截

```javascript
await page.route('**/api/data', route => {
  route.fulfill({ json: { mock: true } });
});
```
