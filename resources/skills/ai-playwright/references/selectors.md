# 选择器优先级策略

按以下优先级选择 Playwright 选择器，优先使用语义化、稳定的属性：

## 优先级表

| 优先级 | 选择器类型 | Playwright 写法 | 稳定性 |
|--------|-----------|----------------|--------|
| 1 | `data-testid` | `page.locator('[data-testid="login-btn"]')` | ★★★★★ |
| 2 | `aria-label` / role | `page.getByRole('button', { name: '登录' })` | ★★★★★ |
| 3 | `id` 属性 | `page.locator('#username')` | ★★★★ |
| 4 | `name` 属性 | `page.locator('[name="password"]')` | ★★★★ |
| 5 | `placeholder` | `page.getByPlaceholder('请输入密码')` | ★★★ |
| 6 | 精确文本 | `page.getByText('立即登录', { exact: true })` | ★★★ |
| 7 | label 关联 | `page.getByLabel('用户名')` | ★★★ |
| 8 | 稳定 CSS class | `page.locator('.login-submit-btn')` | ★★ |
| 9 | XPath（最后手段）| `page.locator('//button[contains(text(),"提交")]')` | ★ |

## 选择原则

- **避免**使用随机生成的 class（如 `._3xDg7`、`css-abc123`）
- **避免**使用基于位置的 nth-child，容易因布局变化失效
- **优先**使用 Playwright 内置语义定位器（`getByRole`、`getByLabel`、`getByPlaceholder`）
- 若多个元素匹配，用 `.first()` / `.nth(n)` 或添加更具体的属性缩小范围

## 示例：表单填写选择器决策

探测到以下 DOM：
```json
{ "tag": "input", "id": "user-email", "name": "email", "placeholder": "请输入邮箱", "aria-label": null }
```

选择 `#user-email`（id，优先级3），备选 `[name="email"]`（优先级4）。

## 动态内容处理

页面动态渲染时，选择器可能在 DOM 加载完成后才出现：

```javascript
// 等待选择器出现再操作
await page.waitForSelector('[data-testid="submit-btn"]');
await page.click('[data-testid="submit-btn"]');

// 或使用 locator 的自动等待
await page.locator('[data-testid="submit-btn"]').click();
```
