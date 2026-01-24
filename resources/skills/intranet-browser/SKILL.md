---
name: intranet-browser
description: 访问美团内网页面。当用户提供 .sankuai.com 或 .meituan.com 域名的 URL 时使用此 skill。
allowed-tools: Bash(agent-browser:*)
---

# 内网页面访问

**必须使用 Bash 工具执行 `npx agent-browser` 命令，禁止使用 WebFetch 或 Task 工具！**

## 浏览器关闭规则（非常重要）

为避免丢失刚登录的会话（cookies / storage），默认**不要**关闭浏览器。

- **不要在任务结束、会话结束、点击停止按钮后自动关闭浏览器**
- **只有三种情况才允许关闭/清理浏览器**
  - **用户明确要求**（例如“关闭浏览器”、“清理浏览器进程”）
  - **确认僵尸进程**（见下方“输出 3”）
  - **确认当前是无头浏览器，需要切换为有头模式以便扫码登录/人工交互**（见下方“确保是有头浏览器”）

## 操作流程

### 第一步：检查浏览器状态

```bash
npx agent-browser get url
```

### 第一步（补充）：确保是有头浏览器（必须）

如果当前是无头浏览器（`chrome-headless-shell`），必须切换为有头模式，否则无法扫码登录。

```bash
ps aux | grep "chrome-headless-shell" | grep -v grep | head -n 3
```

如果能看到 `chrome-headless-shell` 相关进程：
```bash
npx agent-browser close 2>/dev/null
sleep 1
npx agent-browser open "https://目标地址" --headed --no-sandbox
```

### 第二步：根据输出决定下一步

**输出 1：返回正常 URL**
```
https://xxx.sankuai.com/...
```
→ 浏览器正常运行，直接用 `goto` 跳转：
```bash
npx agent-browser goto "https://目标地址"
```

**输出 2：Browser not launched**
```
✗ Browser not launched. Call launch first.
```
→ 浏览器未启动，用 `open` 打开：
```bash
npx agent-browser open "https://目标地址" --headed --no-sandbox
```

**输出 3：命令超时卡住（超过 10 秒无响应）**
→ 僵尸进程，需要清理后重开（更稳健的判定：`npx agent-browser get url` 连续 2 次、每次约 1.5 秒都无响应/超时）：
```bash
npx agent-browser close 2>/dev/null; pkill -f "Google Chrome for Testing" 2>/dev/null; pkill -f "chrome-headless-shell" 2>/dev/null; sleep 1; npx agent-browser open "https://目标地址" --headed --no-sandbox
```

### 第三步：检查登录状态

```bash
npx agent-browser get title
```

如果标题包含"登录"或"统一登录中心"，提示用户：
> "请在浏览器窗口中扫码登录，完成后告诉我"

### 第四步：获取页面内容

```bash
npx agent-browser snapshot -i
```

## 命令速查

| 命令 | 用途 |
|-----|------|
| `get url` | 检查浏览器状态 |
| `goto <url>` | 跳转（浏览器已开时用） |
| `open <url> --headed --no-sandbox` | 启动浏览器 |
| `snapshot -i` | 获取可交互元素 |
| `snapshot` | 获取页面内容 |
| `click @eX` | 点击元素 |
| `fill @eX "text"` | 输入文本 |
| `get title` | 获取页面标题 |
| `screenshot /tmp/x.png` | 截图 |

## 禁止

- ❌ 每次都清理重开（会丢失登录状态）
- ❌ `npx agent-browser launch`（不存在）
- ❌ `npx agent-browser start`（不存在）
- ❌ `npx agent-browser open <url>` 不带 `--headed`（用户看不到）
