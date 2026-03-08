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

## 多标签页与当前激活页

**原则**：DOM 探测和截图**必须**在**当前激活的 tab**（当前要操作的 `page`）上进行，否则下一步操作或脚本会错位。

### 已知会打开新 tab 的点击（推荐：精确获取 newPage）

当**明确知道**该步会打开新窗口/新 tab 时（如指令含 `opensNewTab: true`），**必须**用 `context.waitForEvent('page')` 与 click 的 `Promise.all` 精确获取新 page，不要依赖「新 tab 是最后一个」的假设（不同浏览器/系统下激活顺序可能不一致，会导致识别错误）。

```javascript
// 点击前先等待可能的新 page，再在 newPage 上继续操作与截图
const [newPage] = await Promise.all([
  context.waitForEvent('page'),
  page.click('a[target="_blank"]'),  // 或可能打开新 tab 的按钮
]);
await newPage.waitForLoadState('networkidle');
// 后续所有操作、探测、截图均在 newPage 上：page = newPage;
```

### 检测是否打开了新 tab（未预先标注时）

当未预先标注「会打开新 tab」时，通过比较执行前后页面列表来检测。**新 tab 不一定是 `pages()` 的最后一个**（例如某些环境下新 tab 会插入到当前激活位置），应通过「执行前不存在的 page」来识别新 tab：

```javascript
const pagesBefore = context.pages().slice();  // 保存执行前的 page 引用列表
await page.click('...');
await page.waitForTimeout(800);  // 或 waitForLoadState，给新 tab 时间出现
const pagesAfter = context.pages();
const newPage = pagesAfter.find(p => !pagesBefore.includes(p));
if (newPage) {
  await newPage.waitForLoadState('networkidle');
  page = newPage;  // 切换到新 tab
}
```

### 获取当前激活的 page（关闭 tab 后）

```javascript
// 关闭当前 tab 后，从剩余 pages 中确定「当前操作 page」
await page.close();
const pages = context.pages();
const activePage = pages.length ? pages[pages.length - 1] : null;
if (activePage) page = activePage;  // 后续探测与截图均在 activePage
```

### 多 tab 时统一维护「当前 page」

脚本中用一个变量（如 `page`）表示当前操作的页面；每次「可能新 tab」的点击后更新为 `newPage`，每次 `page.close()` 后更新为 `context.pages()` 中的激活页，所有 `page.screenshot()`、DOM 探测、`page.fill()` 等均使用该变量。

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
