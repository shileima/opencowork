---
name: agent-browser
description: Automates browser interactions for web testing, form filling, screenshots, and data extraction. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, test web applications, or extract information from web pages.
allowed-tools: Bash(agent-browser:*)
---

## ⚠️ 自动化脚本规范要求

**重要**：所有自动化脚本、自动化用例、自动化执行、UI自动化测试等与自动化 UI 测试相关的脚本都必须遵循以下规范：

### 必须遵守的规范

1. **浏览器自动化框架限制**
   - ✅ **只能使用 Playwright** 进行浏览器自动化
   - ❌ **禁止使用 Selenium** 及其相关包（selenium-webdriver, webdriverio 等）
   - ❌ **禁止使用 Puppeteer** 及其相关包（puppeteer, puppeteer-core 等）
   - ✅ 正确示例：`const { chromium } = require('playwright');`
   - ❌ 错误示例：`const { Builder } = require('selenium-webdriver');`
   - ❌ 错误示例：`const puppeteer = require('puppeteer');`

2. **脚本存储位置**
   - ✅ 脚本文件必须存储在 `~/.opencowork/skills/chrome-agent/` 目录下
   - ❌ 不能存储在其他位置

3. **文件扩展名**
   - ✅ 文件扩展名必须为 `.js`
   - ❌ 其他扩展名不会被识别

4. **文件权限**
   - ✅ 文件必须有读取权限
   - ❌ 无权限的文件无法执行

5. **脚本列表刷新**
   - ✅ 新建脚本后，在自动化脚本列表中点击刷新按钮（🔄）或等待自动刷新（5秒）
   - ❌ 未刷新的脚本可能不会出现在列表中

### 规范检查

在执行自动化脚本前，系统会自动检查：
- 脚本文件是否在正确的目录下
- 文件扩展名是否为 `.js`
- 文件是否存在且有读取权限
- **脚本内容是否使用了禁止的自动化框架（Selenium 或 Puppeteer）**
- **命令中是否包含禁止的包安装（selenium-webdriver, puppeteer 等）**

**如果不遵守规范，系统会提示错误并阻止执行。**

### 如何创建符合规范的脚本

1. **确定脚本目录**：
   ```bash
   # macOS/Linux
   ~/.opencowork/skills/chrome-agent/
   
   # Windows
   %USERPROFILE%\.opencowork\skills\chrome-agent\
   ```

2. **安装 Playwright（如果尚未安装）**：
   ```bash
   cd ~/.opencowork/skills/chrome-agent
   npm install playwright
   npx playwright install
   ```

3. **创建脚本文件**：
   ```bash
   # 在正确的目录下创建 .js 文件
   touch ~/.opencowork/skills/chrome-agent/my_test.js
   ```

4. **编写脚本内容（必须使用 Playwright）**：
   ```javascript
   // my_test.js
   const { chromium } = require('playwright');
   
   (async () => {
     const browser = await chromium.launch({ headless: false });
     const page = await browser.newPage();
     await page.goto('https://example.com');
     // ... 你的自动化测试代码
     await browser.close();
   })();
   ```
   
   **⚠️ 禁止使用以下框架：**
   ```javascript
   // ❌ 禁止：Selenium
   const { Builder } = require('selenium-webdriver');
   
   // ❌ 禁止：Puppeteer
   const puppeteer = require('puppeteer');
   ```

5. **刷新脚本列表**：
   - 在应用的"自动化"标签页中点击刷新按钮
   - 或等待 5 秒自动刷新

6. **执行脚本**：
   ```bash
   # 从正确的目录执行
   cd ~/.opencowork/skills/chrome-agent
   node my_test.js
   ```

### 常见错误示例

❌ **错误1：使用了禁止的自动化框架**
```javascript
// ❌ 错误：使用 Selenium
const { Builder } = require('selenium-webdriver');
const driver = new Builder().forBrowser('chrome').build();

// ❌ 错误：使用 Puppeteer
const puppeteer = require('puppeteer');
const browser = await puppeteer.launch();
```

✅ **正确做法**：
```javascript
// ✅ 正确：使用 Playwright
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: false });
```

❌ **错误2：安装禁止的包**
```bash
# ❌ 错误：安装 Selenium 或 Puppeteer
npm install selenium-webdriver
npm install puppeteer
```

✅ **正确做法**：
```bash
# ✅ 正确：只安装 Playwright
npm install playwright
npx playwright install
```

❌ **错误3：脚本不在正确目录**
```bash
# 错误：在其他目录执行
cd ~/Desktop
node my_test.js  # ❌ 不在 chrome-agent 目录
```

✅ **正确做法**：
```bash
cd ~/.opencowork/skills/chrome-agent
node my_test.js  # ✅ 在正确目录
```

❌ **错误4：文件扩展名不正确**
```bash
# 错误：文件名为 my_test.txt
node my_test.txt  # ❌ 扩展名不是 .js
```

✅ **正确做法**：
```bash
# 文件名为 my_test.js
node my_test.js  # ✅ 扩展名为 .js
```

### 验证脚本是否符合规范

在创建或修改脚本后，可以通过以下方式验证：

1. **检查文件位置**：
   ```bash
   ls -la ~/.opencowork/skills/chrome-agent/*.js
   ```

2. **检查文件权限**：
   ```bash
   ls -l ~/.opencowork/skills/chrome-agent/my_test.js
   # 应该显示 -rw-r--r-- 或类似权限
   ```

3. **在应用中检查**：
   - 打开应用的"自动化"标签页
   - 查看脚本是否出现在列表中
   - 如果不在，点击刷新按钮

---

# Browser Automation with agent-browser

## Browser close rule (important)

To avoid losing freshly logged-in sessions (cookies / storage), **do not close the browser by default**.

- **Do not auto-close the browser when a task ends, a session ends, or the user clicks stop**
- Only close/cleanup the browser when:
  - The user explicitly asks to close/cleanup
  - You have confirmed the agent-browser process is stuck (zombie) and needs cleanup
  - You have confirmed the current browser is headless and must be relaunched in headed mode for QR login/CAPTCHA/manual interaction

## Quick start

```bash
npx agent-browser open <url>        # Navigate to page
npx agent-browser snapshot -i       # Get interactive elements with refs
npx agent-browser click @e1         # Click element by ref
npx agent-browser fill @e2 "text"   # Fill input by ref
npx agent-browser close             # Close browser
```

Examples below may show either `npx agent-browser ...` or `agent-browser ...`. If `agent-browser` is available on PATH, they are equivalent.

## Core workflow

1. Navigate: `npx agent-browser open <url>`
2. Snapshot: `npx agent-browser snapshot -i` (returns elements with refs like `@e1`, `@e2`)
3. Interact using refs from the snapshot
4. Re-snapshot after navigation or significant DOM changes

## Commands

### Navigation
```bash
npx agent-browser open <url>      # Navigate to URL
npx agent-browser back            # Go back
npx agent-browser forward         # Go forward
npx agent-browser reload          # Reload page
npx agent-browser close           # Close browser
```

### Snapshot (page analysis)
```bash
npx agent-browser snapshot            # Full accessibility tree
npx agent-browser snapshot -i         # Interactive elements only (recommended)
npx agent-browser snapshot -c         # Compact output
npx agent-browser snapshot -d 3       # Limit depth to 3
npx agent-browser snapshot -s "#main" # Scope to CSS selector
```

### Interactions (use @refs from snapshot)
```bash
npx agent-browser click @e1           # Click
npx agent-browser dblclick @e1        # Double-click
npx agent-browser focus @e1           # Focus element
npx agent-browser fill @e2 "text"     # Clear and type
npx agent-browser type @e2 "text"     # Type without clearing
npx agent-browser press Enter         # Press key
npx agent-browser press Control+a     # Key combination
npx agent-browser keydown Shift       # Hold key down
npx agent-browser keyup Shift         # Release key
npx agent-browser hover @e1           # Hover
npx agent-browser check @e1           # Check checkbox
npx agent-browser uncheck @e1         # Uncheck checkbox
npx agent-browser select @e1 "value"  # Select dropdown
npx agent-browser scroll down 500     # Scroll page
npx agent-browser scrollintoview @e1  # Scroll element into view
npx agent-browser drag @e1 @e2        # Drag and drop
npx agent-browser upload @e1 file.pdf # Upload files
```

### Get information
```bash
npx agent-browser get text @e1        # Get element text
npx agent-browser get html @e1        # Get innerHTML
npx agent-browser get value @e1       # Get input value
npx agent-browser get attr @e1 href   # Get attribute
npx agent-browser get title           # Get page title
npx agent-browser get url             # Get current URL
npx agent-browser get count ".item"   # Count matching elements
npx agent-browser get box @e1         # Get bounding box
```

### Check state
```bash
npx agent-browser is visible @e1      # Check if visible
npx agent-browser is enabled @e1      # Check if enabled
npx agent-browser is checked @e1      # Check if checked
```

### Screenshots & PDF
```bash
agent-browser screenshot          # Screenshot to stdout
agent-browser screenshot path.png # Save to file
agent-browser screenshot --full   # Full page
agent-browser pdf output.pdf      # Save as PDF
```

### Video recording
```bash
agent-browser record start ./demo.webm    # Start recording (uses current URL + state)
agent-browser click @e1                   # Perform actions
agent-browser record stop                 # Stop and save video
agent-browser record restart ./take2.webm # Stop current + start new recording
```
Recording creates a fresh context but preserves cookies/storage from your session. If no URL is provided, it automatically returns to your current page. For smooth demos, explore first, then start recording.

### Wait
```bash
agent-browser wait @e1                     # Wait for element
agent-browser wait 2000                    # Wait milliseconds
agent-browser wait --text "Success"        # Wait for text
agent-browser wait --url "**/dashboard"    # Wait for URL pattern
agent-browser wait --load networkidle      # Wait for network idle
agent-browser wait --fn "window.ready"     # Wait for JS condition
```

### Mouse control
```bash
agent-browser mouse move 100 200      # Move mouse
agent-browser mouse down left         # Press button
agent-browser mouse up left           # Release button
agent-browser mouse wheel 100         # Scroll wheel
```

### Semantic locators (alternative to refs)
```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find first ".item" click
agent-browser find nth 2 "a" text
```

### Browser settings
```bash
agent-browser set viewport 1920 1080      # Set viewport size
agent-browser set device "iPhone 14"      # Emulate device
agent-browser set geo 37.7749 -122.4194   # Set geolocation
agent-browser set offline on              # Toggle offline mode
agent-browser set headers '{"X-Key":"v"}' # Extra HTTP headers
agent-browser set credentials user pass   # HTTP basic auth
agent-browser set media dark              # Emulate color scheme
```

### Cookies & Storage
```bash
agent-browser cookies                     # Get all cookies
agent-browser cookies set name value      # Set cookie
agent-browser cookies clear               # Clear cookies
agent-browser storage local               # Get all localStorage
agent-browser storage local key           # Get specific key
agent-browser storage local set k v       # Set value
agent-browser storage local clear         # Clear all
```

### Network
```bash
agent-browser network route <url>              # Intercept requests
agent-browser network route <url> --abort      # Block requests
agent-browser network route <url> --body '{}'  # Mock response
agent-browser network unroute [url]            # Remove routes
agent-browser network requests                 # View tracked requests
agent-browser network requests --filter api    # Filter requests
```

### Tabs & Windows
```bash
agent-browser tab                 # List tabs
agent-browser tab new [url]       # New tab
agent-browser tab 2               # Switch to tab
agent-browser tab close           # Close tab
agent-browser window new          # New window
```

### Frames
```bash
agent-browser frame "#iframe"     # Switch to iframe
agent-browser frame main          # Back to main frame
```

### Dialogs
```bash
agent-browser dialog accept [text]  # Accept dialog
agent-browser dialog dismiss        # Dismiss dialog
```

### JavaScript
```bash
agent-browser eval "document.title"   # Run JavaScript
```

## Example: Form submission

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# Output shows: textbox "Email" [ref=e1], textbox "Password" [ref=e2], button "Submit" [ref=e3]

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # Check result
```

## Example: Authentication with saved state

```bash
# Login once
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
agent-browser state save auth.json

# Later sessions: load saved state
agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard
```

## Sessions (parallel browsers)

```bash
agent-browser --session test1 open site-a.com
agent-browser --session test2 open site-b.com
agent-browser session list
```

## JSON output (for parsing)

Add `--json` for machine-readable output:
```bash
agent-browser snapshot -i --json
agent-browser get text @e1 --json
```

## Debugging

```bash
agent-browser open example.com --headed              # Show browser window
agent-browser console                                # View console messages
agent-browser errors                                 # View page errors
agent-browser record start ./debug.webm   # Record from current page
agent-browser record stop                            # Save recording
agent-browser open example.com --headed  # Show browser window
agent-browser --cdp 9222 snapshot        # Connect via CDP
agent-browser console                    # View console messages
agent-browser console --clear            # Clear console
agent-browser errors                     # View page errors
agent-browser errors --clear             # Clear errors
agent-browser highlight @e1              # Highlight element
agent-browser trace start                # Start recording trace
agent-browser trace stop trace.zip       # Stop and save trace
```

## ✅ Using --headed Parameter Correctly

**The `--headed` parameter WORKS! You must use it correctly.**

**Correct usage**:
```bash
agent-browser open <url> --headed
```

**Key points**:
- `--headed` must be placed AFTER the URL
- When used correctly, it launches `chromium-1200/Google Chrome for Testing` (headed mode)
- Browser window will be visible for user interaction
- Login state is automatically saved to `~/.agent-browser/default/`

**How to verify it's working**:
```bash
ps aux | grep "chromium" | grep -v grep | head -3
```

**Signs of headed mode (correct)**:
- Process shows `chromium-1200/chrome-mac-arm64/Google Chrome for Testing`
- NO `--headless` flag in the process
- Browser window is visible

**Signs of headless mode (incorrect)**:
- Process shows `chromium_headless_shell`
- Process shows `--headless=old` flag
- Browser window is NOT visible
- This means you forgot `--headed` or placed it incorrectly

**Common use cases**:
- First-time login to internal websites (.sankuai.com, .meituan.com)
- Completing CAPTCHAs
- OAuth authentication flows
- QR code scanning for login
