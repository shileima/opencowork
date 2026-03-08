---
name: agent-browser
description: 浏览器自动化备用方案。仅在用户明确要求使用 agent-browser、或 Playwright 脚本执行失败时使用。自动化模式默认应使用 ai-playwright（Playwright 脚本），不要默认使用本技能。Cowork 模式下若用户明确要求用 agent-browser 则可使用。Project 模式禁止使用。
allowed-tools: Bash(agent-browser:*,node:*)
---

# Browser Automation with agent-browser

> 版本：v0.15.2（2026-03-03 最新）｜[官方文档](https://agent-browser.dev) ｜[GitHub](https://github.com/vercel-labs/agent-browser)

## 执行策略：默认 Playwright 脚本，agent-browser 仅作备用

**默认选择：Playwright 脚本**（ai-playwright 技能：DOM 探测 → 生成脚本 → 执行 → 截图验证）
**备用选择：agent-browser CLI**（仅当用户明确要求「用 agent-browser」、或 Playwright 不可用/执行失败时使用）

> 自动化任务应优先创建并执行 Playwright 脚本，尽量不使用 agent-browser。仅在用户明确指定或 Playwright 失败时再使用 agent-browser。

- 命令参考：[agent-browser 官方命令](https://agent-browser.dev/commands)
- 带鉴权打开：使用 `agent-browser open <url> --session <name>` 或由本应用自动添加 `--session meituan-sso` 并注入 SSO cookies，无需额外 Playwright 脚本。

## 脚本自动固化（Script Persistence）

每次执行浏览器自动化任务后，**必须**将本次使用的脚本或命令序列固化保存，方便后续复用。

### 存储规则

- **存储路径**：`~/.qa-cowork/scripts/<chat-id>/`
- `<chat-id>` 取当前聊天任务的唯一标识（如对话 ID、任务短标题的 slug，例如 `2026-03-02-search-bigmodel`）
- 每个聊天目录下可保存多个脚本文件，按执行顺序命名，如 `01_open_page.sh`、`02_fill_form.sh`，或对于 Playwright 脚本使用 `.js` 扩展名

### 固化内容

对于 **agent-browser CLI** 任务，将命令序列写入 shell 脚本：

```bash
#!/usr/bin/env bash
# Task: <任务描述>
# Chat: <chat-id>
# Date: <YYYY-MM-DD>

agent-browser open "https://example.com" --headed
agent-browser snapshot -i
agent-browser fill @e1 "search text"
agent-browser click @e2
```

对于 **Playwright JS** 脚本，直接保存 `.js` 文件。

### 执行时机

1. 任务执行**成功后**，立即将本次脚本写入 `~/.qa-cowork/scripts/<chat-id>/` 目录
2. 若目录不存在，先创建目录：`mkdir -p ~/.qa-cowork/scripts/<chat-id>/`
3. 告知用户脚本已保存的完整路径，方便下次直接运行

## Browser close rule (important)

To avoid losing freshly logged-in sessions (cookies / storage), **do not close the browser by default**.

- **Do not auto-close the browser when a task ends, a session ends, or the user clicks stop**
- Only close/cleanup the browser when:
  - The user explicitly asks to close/cleanup
  - You have confirmed the agent-browser process is stuck (zombie) and needs cleanup
  - You have confirmed the current browser is headless and must be relaunched in headed mode for QR login/CAPTCHA/manual interaction
- If When Run browser and error out with "Looks Like Playwright Test or PlayWright was just installed or updated", YOU NEED TO RUN "set PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright playwright install chromium" TO CONFIG PLAYWRIGHT.

### If Chrome/Chromium never opens
If `agent-browser open <url> --headed` runs but no browser window appears:
1. Run the **same command in your system terminal** (outside the app) to see the real error (e.g. "Executable doesn't exist", "Chromium not found").
2. agent-browser 优先使用系统已安装的 Chrome（macOS：`/Applications/Google Chrome.app`），无需下载 Chromium。若系统 Chrome 不存在，Chromium 会自动下载到 `~/.qa-cowork/skills/agent-browser/browsers/`（**仅首次安装**，后续复用）。
3. Ensure `agent-browser` is on your PATH and is the CLI you expect (e.g. `which agent-browser`).

## Quick start

```bash
agent-browser open <url> --headed  # Navigate to page (headed)
agent-browser snapshot -i          # Get interactive elements with refs
agent-browser click @e1            # Click element by ref
agent-browser fill @e2 "text"      # Fill input by ref
agent-browser close                # Close browser
```

Examples below use `agent-browser ...`.

## Core workflow

1. Navigate: `agent-browser open <url> --headed`
2. Snapshot: `agent-browser snapshot -i` (returns elements with refs like `@e1`, `@e2`)
3. Interact using refs from the snapshot
4. Re-snapshot after navigation or significant DOM changes

## Commands

完整命令与全局选项见 [agent-browser 官方文档](https://agent-browser.dev/commands)。常用全局选项：`--session <name>` 隔离会话，`--headed` 显示窗口，`--session-name <name>` 自动保存/恢复登录态。

### Navigation
```bash
agent-browser open <url> --headed  # Navigate to URL (headed)
agent-browser back                 # Go back
agent-browser forward              # Go forward
agent-browser reload               # Reload page
agent-browser close                # Close browser (aliases: quit, exit)
```

### Snapshot (page analysis)
```bash
agent-browser snapshot              # Full accessibility tree
agent-browser snapshot -i           # Interactive elements only (recommended)
agent-browser snapshot -i -C        # Also include cursor-interactive (divs with onclick)
agent-browser snapshot -c           # Compact output (remove empty structural elements)
agent-browser snapshot -d 3         # Limit depth to 3
agent-browser snapshot -s "#main"   # Scope to CSS selector
agent-browser snapshot -i -c -d 5   # Combine options
```

| Option | Description |
|--------|-------------|
| `-i, --interactive` | Only show interactive elements (buttons, links, inputs) |
| `-C, --cursor` | Include cursor-interactive elements (cursor:pointer, onclick, tabindex) |
| `-c, --compact` | Remove empty structural elements |
| `-d, --depth <n>` | Limit tree depth |
| `-s, --selector <sel>` | Scope to CSS selector |

### Interactions (use @refs from snapshot)
```bash
agent-browser click @e1            # Click
agent-browser dblclick @e1         # Double-click
agent-browser focus @e1            # Focus element
agent-browser fill @e2 "text"      # Clear and type
agent-browser type @e2 "text"      # Type without clearing
agent-browser press Enter          # Press key
agent-browser press Control+a      # Key combination
agent-browser keydown Shift        # Hold key down
agent-browser keyup Shift          # Release key
agent-browser keyboard type "text" # Type with real keystrokes (no selector, current focus)
agent-browser keyboard inserttext "text" # Insert text without key events
agent-browser hover @e1            # Hover
agent-browser check @e1            # Check checkbox
agent-browser uncheck @e1          # Uncheck checkbox
agent-browser select @e1 "value"   # Select dropdown
agent-browser scroll down 500      # Scroll page (up/down/left/right, --selector <sel>)
agent-browser scrollintoview @e1   # Scroll element into view
agent-browser drag @e1 @e2         # Drag and drop
agent-browser upload @e1 file.pdf  # Upload files
```

### Get information
```bash
agent-browser get text @e1         # Get element text
agent-browser get html @e1         # Get innerHTML
agent-browser get value @e1        # Get input value
agent-browser get attr @e1 href    # Get attribute
agent-browser get title            # Get page title
agent-browser get url              # Get current URL
agent-browser get count ".item"    # Count matching elements
agent-browser get box @e1          # Get bounding box
agent-browser get styles @e1       # Get computed styles
```

### Check state
```bash
agent-browser is visible @e1       # Check if visible
agent-browser is enabled @e1       # Check if enabled
agent-browser is checked @e1       # Check if checked
```

### Screenshots & PDF
```bash
agent-browser screenshot           # Screenshot (saves to temp dir)
agent-browser screenshot path.png  # Save to file
agent-browser screenshot --full    # Full page
agent-browser screenshot --annotate           # 标注交互元素编号（multimodal AI 推荐）
agent-browser screenshot --annotate ./page.png
# 输出示例：[1] @e1 button "Submit"  [2] @e2 link "Home"
# 标注后可直接用 @e1/@e2 等 ref 操作元素
agent-browser pdf output.pdf       # Save as PDF
```

### Wait
```bash
agent-browser wait @e1                      # Wait for element to be visible
agent-browser wait 2000                     # Wait milliseconds
agent-browser wait --text "Success"         # Wait for text
agent-browser wait --url "**/dashboard"     # Wait for URL pattern
agent-browser wait --load networkidle       # Wait for network idle
agent-browser wait --fn "window.ready"      # Wait for JS condition
```

**Load states:** `load`, `domcontentloaded`, `networkidle`

### Mouse control
```bash
agent-browser mouse move 100 200   # Move mouse
agent-browser mouse down left      # Press button (left/right/middle)
agent-browser mouse up left        # Release button
agent-browser mouse wheel 100      # Scroll wheel
```

### Semantic locators (alternative to refs)
```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find placeholder "Search" fill "keyword"
agent-browser find alt "Logo" hover
agent-browser find testid "submit-btn" click
agent-browser find first ".item" click
agent-browser find last ".item" click
agent-browser find nth 2 "a" text
```

**Actions:** `click`, `fill`, `type`, `hover`, `focus`, `check`, `uncheck`, `text`  
**Options:** `--name <name>` (filter role by accessible name), `--exact` (require exact text match)

### Browser settings
```bash
agent-browser set viewport 1920 1080       # Set viewport size
agent-browser set device "iPhone 14"       # Emulate device
agent-browser set geo 37.7749 -122.4194    # Set geolocation
agent-browser set offline on               # Toggle offline mode
agent-browser set headers '{"X-Key":"v"}'  # Extra HTTP headers
agent-browser set credentials user pass    # HTTP basic auth
agent-browser set media dark               # Emulate color scheme (dark/light)
```

### Cookies & Storage
```bash
agent-browser cookies                      # Get all cookies
agent-browser cookies set name value       # Set cookie
agent-browser cookies clear                # Clear cookies
agent-browser storage local                # Get all localStorage
agent-browser storage local key            # Get specific key
agent-browser storage local set k v        # Set value
agent-browser storage local clear          # Clear all
agent-browser storage session              # Same for sessionStorage
```

### Network
```bash
agent-browser network route <url>               # Intercept requests
agent-browser network route <url> --abort       # Block requests
agent-browser network route <url> --body '{}'   # Mock response
agent-browser network unroute [url]             # Remove routes
agent-browser network requests                  # View tracked requests
agent-browser network requests --filter api     # Filter requests
```

### Tabs & Windows
```bash
agent-browser tab                  # List tabs
agent-browser tab new [url]        # New tab (optionally with URL)
agent-browser tab 2                # Switch to tab
agent-browser tab close [n]        # Close tab
agent-browser window new           # New window
agent-browser click @e1 --new-tab  # Open link in new tab
```

**多标签页与当前激活 tab**：点击、导航等操作可能在本 tab 或新 tab 打开；关闭 tab 后激活 tab 会变化。**【重要】** 下一步的 DOM 探测（snapshot）和截图**必须**在当前激活的 tab 上进行，否则会错位。

- **脚本/步骤标注**：若某一步会打开新浏览器 tab（如搜索、带 `target="_blank"` 的链接），必须在步骤中**明确标注**「本步会打开新 tab」，并在执行该步后先 `agent-browser tab` 查看列表，再用 `agent-browser tab <N>` 切换到新 tab，再在该 tab 上执行 snapshot/screenshot 并继续；未明确标注会导致在错误 tab 上继续操作而执行出错。
- **每步执行前核实**：在知情每一步前，先核实「是否有新 tab 已打开需要切换？」以及「当前是否在激活的 tab 下操作？」再在当前激活的 tab 上进行 snapshot 与后续点击/填写。

若用 `click --new-tab` 或操作后新 tab 已打开，先用 `agent-browser tab` 查看列表，再用 `agent-browser tab <N>` 切换到新 tab，再在该 tab 上执行 snapshot/screenshot 并继续后续步骤；关闭 tab 后同样先 `tab` 确认当前激活 tab，再在该 tab 上探测与截图。

### Frames
```bash
agent-browser frame "#iframe"      # Switch to iframe
agent-browser frame main           # Back to main frame
```

### Dialogs
```bash
agent-browser dialog accept [text] # Accept dialog (with optional prompt text)
agent-browser dialog dismiss        # Dismiss dialog
```

### JavaScript
```bash
agent-browser eval "document.title"    # Run JavaScript
agent-browser eval -b <base64>         # Run base64-encoded JS
# piped input: echo "document.title" | agent-browser eval --stdin
```

### Diff（对比功能）
```bash
# 快照对比
agent-browser diff snapshot                              # 与上次快照对比
agent-browser diff snapshot --baseline before.txt        # 与已保存快照文件对比
agent-browser diff snapshot --selector "#main" --compact # 范围内快照对比
# 截图像素级对比
agent-browser diff screenshot --baseline before.png      # 视觉像素对比
agent-browser diff screenshot --baseline b.png -o d.png  # 保存差异图
agent-browser diff screenshot --baseline b.png -t 0.2    # 调整颜色阈值 (0-1)
# URL 对比（两个页面）
agent-browser diff url https://v1.com https://v2.com     # 快照对比两个 URL
agent-browser diff url https://v1.com https://v2.com --screenshot  # 同时视觉对比
agent-browser diff url https://v1.com https://v2.com --selector "#main"  # 范围内对比
```

### Debug & Profiling
```bash
agent-browser trace start [path]       # Start recording trace
agent-browser trace stop trace.zip     # Stop and save trace
agent-browser profiler start           # Start Chrome DevTools profiling
agent-browser profiler stop [path]     # Stop and save profile (.json)
agent-browser console                  # View console messages
agent-browser console --clear          # Clear console
agent-browser errors                   # View page errors
agent-browser errors --clear           # Clear errors
agent-browser highlight @e1            # Highlight element
agent-browser --cdp 9222 snapshot      # Connect via CDP
```

### Auth State Management
```bash
agent-browser state save auth.json     # Save auth state
agent-browser state load auth.json     # Load auth state
agent-browser state list               # List saved state files
agent-browser state show auth.json     # Show state summary
agent-browser state rename old new     # Rename state file
agent-browser state clear [name]       # Clear states for session
agent-browser state clear --all        # Clear all saved states
agent-browser state clean --older-than 30  # Delete old states
```

## Sessions（并行浏览器）

```bash
# 独立会话（每个会话有独立 cookies/存储/历史）
agent-browser --session agent1 open site-a.com
agent-browser --session agent2 open site-b.com
agent-browser session list   # 查看所有活跃会话
agent-browser session        # 查看当前会话
```

## 持久化 Profile（跨重启保留登录态）

```bash
# --profile 跨浏览器重启保留 cookies/localStorage/IndexedDB
agent-browser --profile ~/.myapp-profile open myapp.com
# 登录一次，之后复用
agent-browser --profile ~/.myapp-profile open myapp.com/dashboard
# 或通过环境变量
AGENT_BROWSER_PROFILE=~/.myapp-profile agent-browser open myapp.com
```

## Session Persistence（自动保存/恢复登录态）

```bash
# --session-name 自动保存/恢复 cookies 和 localStorage
agent-browser --session-name twitter open twitter.com
# 登录一次，状态自动持久化到 ~/.agent-browser/sessions/
AGENT_BROWSER_SESSION_NAME=twitter agent-browser open twitter.com
```

## CDP 模式（接管已有浏览器）

```bash
# 连接本地调试端口（Chrome 需以 --remote-debugging-port=9222 启动）
agent-browser connect 9222
agent-browser snapshot

# 自动发现运行中的 Chrome（无需指定端口）
agent-browser --auto-connect open example.com
agent-browser --auto-connect snapshot
AGENT_BROWSER_AUTO_CONNECT=1 agent-browser snapshot

# 连接远程 CDP WebSocket
agent-browser --cdp "wss://your-browser-service.com/cdp?token=..." snapshot
```

## Streaming（浏览器实时预览）

```bash
# 通过 WebSocket 流式传输视口，人机协同观看
AGENT_BROWSER_STREAM_PORT=9223 agent-browser open example.com
# 连接 ws://localhost:9223 接收帧和发送输入事件
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

## 直接打开浏览器带鉴权（优先 agent-browser，可不使用 Playwright）

- **普通站点**：`agent-browser open <url> --headed`；可选 `--session <name>` 隔离会话，或使用 `agent-browser state save/load` 持久化登录态（见官方 [Commands](https://agent-browser.dev/commands)）。
- **美团内网**：不使用 agent-browser / Google Chrome for Testing；**默认使用本地默认浏览器**打开，见下方「Meituan Intranet」节。

## Meituan Intranet (.sankuai.com / .meituan.com) — 使用本地默认浏览器

**美团内网默认使用本地默认浏览器打开，不使用 Google Chrome for Testing（agent-browser）。**

使用 `run_command` 执行系统打开 URL 命令即可，登录态由用户默认浏览器（如 Safari、Chrome）自行保存：
- **macOS**: `open "https://km.sankuai.com/..."` 或 `open "https://123.sankuai.com/..."`
- **Windows**: `start "https://..."`
- **Linux**: `xdg-open "https://..."`

即使你写了 `agent-browser open "https://km.sankuai.com/..."`，应用也会自动改为用默认浏览器打开，无需 agent-browser 或 Chromium。

---

## 安全特性（Security，可选启用）

```bash
# 域名白名单（只允许访问指定域名）
agent-browser --allowed-domains "example.com,*.example.com" open example.com

# Action Policy（拦截危险操作）
agent-browser --action-policy ./policy.json open example.com

# 操作确认（eval/download 等危险操作需人工确认）
agent-browser --confirm-actions eval,download open example.com

# 输出长度限制（防止 context flooding）
agent-browser --max-output 50000 snapshot

# LLM 安全边界标记（区分工具输出与不可信内容）
agent-browser --content-boundaries snapshot

# Auth Vault（本地加密存储凭据，LLM 不可见密码）
echo "pass" | agent-browser auth save github --url https://github.com/login --username user --password-stdin
agent-browser auth login github
```

| 环境变量 | 说明 |
|---------|------|
| `AGENT_BROWSER_CONTENT_BOUNDARIES` | 页面输出加安全边界标记 |
| `AGENT_BROWSER_MAX_OUTPUT` | 页面输出最大字符数 |
| `AGENT_BROWSER_ALLOWED_DOMAINS` | 逗号分隔的允许域名 |
| `AGENT_BROWSER_ACTION_POLICY` | Action policy JSON 路径 |
| `AGENT_BROWSER_CONFIRM_ACTIONS` | 需要确认的操作类别 |
| `AGENT_BROWSER_ENCRYPTION_KEY` | AES-256-GCM 加密 key（64位十六进制） |

---

## 云端浏览器集成（Cloud Providers）

### Browserbase
```bash
export BROWSERBASE_API_KEY="your-api-key"
export BROWSERBASE_PROJECT_ID="your-project-id"
agent-browser -p browserbase open https://example.com
```

### Browser Use
```bash
export BROWSER_USE_API_KEY="your-api-key"
agent-browser -p browseruse open https://example.com
```

### Kernel
```bash
export KERNEL_API_KEY="your-api-key"
agent-browser -p kernel open https://example.com
# 可选：KERNEL_STEALTH=true KERNEL_PROFILE_NAME=myprofile
```

---

## iOS Simulator 集成

```bash
# 安装依赖（一次性）
npm install -g appium
appium driver install xcuitest

# 查看可用模拟器
agent-browser device list

# 在 iPhone 16 Pro 上打开 Safari
agent-browser -p ios --device "iPhone 16 Pro" open https://example.com
agent-browser -p ios snapshot -i
agent-browser -p ios tap @e1
agent-browser -p ios fill @e2 "text"
agent-browser -p ios swipe up
agent-browser -p ios screenshot mobile.png
agent-browser -p ios close
```

---

## Example: Form submission

```bash
agent-browser open https://example.com/form --headed
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
agent-browser open https://app.example.com/login --headed
agent-browser snapshot -i
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
agent-browser state save auth.json

# Later sessions: load saved state
agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard --headed
```

## Example: Annotated screenshot + multimodal interaction

```bash
# 获取带编号标注的截图（适合多模态 AI 视觉分析）
agent-browser open https://example.com --headed
agent-browser screenshot --annotate ./page.png
# 输出: [1] @e1 button "Submit"  [2] @e2 link "Home"  [3] @e3 textbox "Email"
# 直接用编号 ref 操作
agent-browser click @e2
agent-browser fill @e3 "user@example.com"
```

## Example: Page diff (A/B 测试或版本对比)

```bash
# 对比两个版本页面的快照差异
agent-browser diff url https://v1.example.com https://v2.example.com
# 同时进行视觉截图对比
agent-browser diff url https://v1.example.com https://v2.example.com --screenshot
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
agent-browser is visible @e2 --json
```

## Debugging

```bash
agent-browser open example.com --headed   # Show browser window
agent-browser console                     # View console messages
agent-browser console --clear             # Clear console
agent-browser errors                      # View page errors
agent-browser errors --clear              # Clear errors
agent-browser highlight @e1               # Highlight element
agent-browser trace start                 # Start recording trace
agent-browser trace stop trace.zip        # Stop and save trace
agent-browser profiler start              # Start CPU profiling
agent-browser profiler stop profile.json  # Stop and save profile
```

---

## 何时使用 agent-browser（备用）

仅在以下情况使用 agent-browser，其余情况一律使用 Playwright 脚本（ai-playwright）：

- 用户明确说「用 agent-browser」「不要用 Playwright」等
- Playwright 脚本执行失败（如依赖安装失败、node 不可用）
- agent-browser 已由用户在前序步骤中打开，需要继续用 CLI 操作同一会话

## Playwright 为默认时的降级说明（本技能被选用时）

若因上述原因选用了 agent-browser，当出现以下情况时，**可再切换回 Playwright 脚本**（无需告知用户，直接继续）：

- `agent-browser` 命令返回连接错误 / ECONNREFUSED
- "Looks like Playwright Test or Playwright was just installed or updated"
- agent-browser 进程启动失败或无响应
- 用户随后明确要求改用 Playwright / ai-playwright

### 切换后的执行流程

```
0. 解析路径(可选) → 1. DOM探测 → 2. 生成脚本 → 3. 安装依赖+node执行 → 4. 截图验证
```

### Node/npm/pnpm 绝对路径（减少查找与重试）

在**安装依赖**或**执行 node 脚本**前，先解析可执行文件绝对路径，再用绝对路径执行，避免因 PATH 未设置导致的 "command not found" 和多轮回退（如「npm 有问题→手动创建 package.json→尝试绝对路径 npm」）。

- **解析命令**（一次执行即可，后续复用）：
  - macOS/Linux：`NODE=$(which node); NPM=$(which npm 2>/dev/null); PNPM=$(which pnpm 2>/dev/null); echo "NODE=$NODE NPM=$NPM PNPM=$PNPM"`
  - Windows：`where node`、`where npm`、`where pnpm`（或 PowerShell `(Get-Command node).Source`）
- **使用方式**：若得到绝对路径，则用其执行，例如：
  - 安装：`"$NPM" install playwright --no-package-lock` 或 `"$PNPM" add playwright`（优先 pnpm）
  - 运行：`"$NODE" /tmp/pw-task.js`
- **未找到时**：若 `which npm` 和 `which pnpm` 都为空，再创建 `package.json` 并用系统 `node` 执行 `node script.js`（Playwright 可能已全局或已在应用内置环境中可用）。

**步骤1：DOM 探测**（获取真实选择器，避免猜测）

```javascript
// 写入 /tmp/probe-dom.js 后执行: node /tmp/probe-dom.js <URL>
const { chromium } = require('playwright');
const url = process.argv[2];
(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/pw-probe.png' });
  const info = await page.evaluate(() => {
    const get = el => ({
      tag: el.tagName.toLowerCase(), id: el.id||null,
      name: el.getAttribute('name')||null, type: el.getAttribute('type')||null,
      placeholder: el.getAttribute('placeholder')||null,
      text: (el.innerText||el.value||'').trim().slice(0,60)||null,
      'data-testid': el.getAttribute('data-testid')||null,
      'aria-label': el.getAttribute('aria-label')||null,
    });
    return {
      title: document.title,
      inputs: [...document.querySelectorAll('input,textarea,select')].map(get),
      buttons: [...document.querySelectorAll('button,[role="button"]')].slice(0,20).map(get),
      forms: [...document.querySelectorAll('form')].map(f=>({
        id:f.id, fields:[...f.querySelectorAll('input,textarea,select')].map(get)
      })),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
```

**选择器优先级**：`data-testid` > `aria-label` > `#id` > `[name]` > `text=` > CSS class

**步骤2-3：生成并执行完整脚本**

```javascript
// 写入 /tmp/pw-task.js 后执行: node /tmp/pw-task.js
const { chromium } = require('playwright');
const fs = require('fs');
const SHOTS = '/tmp/pw-screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0;

async function step(page, desc, fn) {
  n++;
  console.log(`[步骤 ${n}] ${desc}`);
  await fn();
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2,'0')}-${desc.replace(/\W/g,'_').slice(0,20)}.png` });
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const page = await (await browser.newContext({ viewport:{width:1280,height:720} })).newPage();
  try {
    await step(page, '导航', () => page.goto('TARGET_URL', { waitUntil: 'networkidle' }));
    // await step(page, '操作描述', () => page.click('selector'));
    console.log(`✅ 完成！截图: ${SHOTS}`);
  } catch(e) {
    await page.screenshot({ path: `${SHOTS}/ERROR.png` });
    console.error('❌ 失败:', e.message);
  } finally { await browser.close(); }
})();
```

**步骤4：截图验证**

每步执行后用 Read 工具读取截图：`/tmp/pw-screenshots/01-*.png`

若截图未达预期 → 重新运行 DOM 探测 → 修正选择器 → 重新执行。

### 常用等待

```javascript
await page.waitForSelector('#el', { timeout: 10000 });
await page.waitForURL('**/path**');
await page.waitForLoadState('networkidle');
```

### 脚本固化

Playwright 任务成功后，将脚本保存到 `~/.qa-cowork/scripts/<chat-id>/pw-task.js`。
