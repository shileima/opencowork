# 自动化脚本使用指南

## 脚本存储位置

自动化脚本按会话存放在以下目录：

**macOS/Linux**: `~/.qa-cowork/scripts/<sessionId>/`  
**Windows**: `%USERPROFILE%\.qa-cowork\scripts\<sessionId>\`

其中 `<sessionId>` 为当前会话 ID，每次对话的脚本产物存放在对应子目录下，便于按会话管理。

## 如何添加新脚本

### 方法1：直接在脚本目录创建文件

1. **打开脚本目录**：
   - 在自动化脚本下拉列表中，点击文件夹图标（📁）打开脚本根目录 `~/.qa-cowork/scripts/`
   - 可在其下按会话创建子目录，或放入任意子目录中的 `.js` 文件均会被扫描

2. **创建脚本文件**：
   - 在目录中创建新的 `.js` 文件
   - 文件名将作为脚本名称显示在列表中
   - 例如：`my_script.js` → 显示为 "my_script"

3. **刷新列表**：
   - 脚本列表会自动每 5 秒刷新一次
   - 也可以点击刷新按钮（🔄）手动刷新

### 方法2：通过 AI 生成

使用 AI 助手生成脚本时，请将脚本保存到 `~/.qa-cowork/scripts/<sessionId>/` 目录下（当前会话对应子目录）。

## 脚本命名规则

- 文件名必须以 `.js` 结尾
- 脚本名称 = 文件名（不含 `.js` 扩展名）
- 例如：`login_xgpt.js` → 脚本名称 "login_xgpt"

## 脚本列表刷新

### 自动刷新
- 当自动化脚本下拉列表打开时，每 5 秒自动刷新一次
- 新添加的脚本会在下次刷新时自动出现

### 手动刷新
- 点击下拉列表右上角的刷新按钮（🔄）
- 立即刷新脚本列表

### 打开脚本目录
- 点击文件夹图标（📁）打开脚本存储根目录（`~/.qa-cowork/scripts/`）
- 方便查看和编辑脚本文件

## 常见问题

### Q: 新建的脚本没有出现在列表中？

**可能原因和解决方法**：

1. **脚本文件位置不正确**
   - ✅ 确保脚本文件在 `~/.qa-cowork/scripts/` 或其子目录下
   - ✅ 点击文件夹图标打开目录，检查文件位置

2. **文件扩展名不正确**
   - ✅ 确保文件以 `.js` 结尾
   - ✅ 例如：`my_script.js` ✅，`my_script` ❌

3. **列表未刷新**
   - ✅ 等待 5 秒自动刷新
   - ✅ 或点击刷新按钮（🔄）手动刷新
   - ✅ 关闭并重新打开自动化脚本下拉列表

4. **文件权限问题**
   - ✅ 确保文件有读取权限
   - ✅ 检查文件是否被其他程序锁定

### Q: 如何查看脚本目录路径？

1. 在自动化脚本下拉列表中点击文件夹图标（📁）
2. 或在设置 → 目录管理 → 查看 `scriptsDir` 路径

### Q: 脚本文件应该放在哪里？

**正确位置**：
```
~/.qa-cowork/scripts/<sessionId>/my_script.js
或
~/.qa-cowork/scripts/任意子目录/my_script.js
```

**错误位置**（不会被识别）：
```
~/.qa-cowork/skills/my_script.js    ❌ 不在 scripts 目录下
~/Desktop/my_script.js              ❌ 不在应用目录
~/.qa-cowork/my_script.js          ❌ 不在 scripts 子目录
```

### Q: 如何验证脚本是否被识别？

1. 打开自动化脚本下拉列表
2. 检查脚本是否出现在列表中
3. 如果不在，检查：
   - 文件是否在 `~/.qa-cowork/scripts/` 或其子目录下
   - 文件扩展名是否为 `.js`
   - 点击刷新按钮

## Playwright 截图优化（让 AI 识别与执行更快）

脚本中若需要把页面截图交给 AI 识别或执行下一步，可优先从「截图方式」上减小体积与分辨率，从而减少上传/推理时间。

### 1. 使用 JPEG + 质量（优先）

PNG 体积大且不支持质量参数，改为 JPEG 并降低质量可显著缩小体积，多数 UI 截图 30–50 即可。

```js
await page.screenshot({
  path: 'screenshot.jpg',
  type: 'jpeg',
  quality: 40   // 0–100，推荐 30–50，体积小且 AI 识别足够
});
```

### 2. 使用 CSS 缩放（高分辨率设备）

高 DPR 设备默认按设备像素截图，体积大。改为按 CSS 像素可缩小尺寸与体积。

```js
await page.screenshot({
  path: 'screenshot.jpg',
  type: 'jpeg',
  quality: 40,
  scale: 'css'   // 按 CSS 像素，而非 devicePixelRatio 放大后的尺寸
});
```

### 3. 只截可视区域或指定区域

避免整页长图，只截当前视口或关键区域。

```js
// 仅当前视口
await page.screenshot({ path: 'viewport.jpg', type: 'jpeg', quality: 40 });

// 或指定矩形区域
await page.screenshot({
  path: 'area.jpg',
  type: 'jpeg',
  quality: 40,
  clip: { x: 0, y: 0, width: 800, height: 600 }
});
```

### 4. 只截某个元素

只截需要 AI 看的控件或区域，体积最小。

```js
await page.locator('#main-form').screenshot({
  path: 'form.jpg',
  type: 'jpeg',
  quality: 40
});
```

### 5. 应用内对图片的二次压缩

发送给 AI 的消息若带图片（如 base64），应用会在发送前尝试压缩：最大宽高约 1280px、转为 JPEG 质量 82。若项目已安装 `sharp`，会自动生效；未安装则使用原图，不影响功能。

## 浏览器窗口默认最大化（Google Chrome for Testing）

若希望 Playwright 打开的「Google Chrome for Testing」窗口默认**最大化**，避免左侧空隙、右侧被遮挡，需同时做两件事：

1. **启动时加上 `--start-maximized`**
2. **创建 context 时设置 `viewport: null`**（否则 Playwright 会用默认视口大小覆盖窗口，导致无法保持最大化）

示例：

```js
const { chromium } = require('playwright');

const browser = await chromium.launch({
  headless: false,
  args: ['--start-maximized']
});

const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.goto('https://example.com');
// 后续用 page 操作…
```

注意：若用 `browser.newPage()` 而不传 `viewport: null` 的 context，窗口可能仍会被默认视口限制，出现右侧被裁切或未铺满屏幕的情况。
