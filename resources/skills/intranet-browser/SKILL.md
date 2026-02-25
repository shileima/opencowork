---
name: intranet-browser
description: 访问美团内网页面。当用户提供 .sankuai.com 或 .meituan.com 域名的 URL 时使用此 skill。
allowed-tools: Bash(agent-browser:*)
---

# 内网页面访问

**必须使用 Bash 工具执行 `agent-browser` 命令，禁止使用 WebFetch 或 Task 工具！**

> Windows 注意：Bash 工具是 bash shell，不识别 PowerShell 内建命令（`Select-String` / `Get-CimInstance` / `Start-Sleep` 等）。
> - 若使用 Bash 工具：请执行文中 **macOS/Linux** 命令，或使用下面提供的 `powershell -Command "..."` 版本
> - 若在 PowerShell 中运行：可去掉外层 `powershell -Command` 直接执行

## 浏览器关闭规则（非常重要）

为避免丢失刚登录的会话（cookies / storage），默认**不要**关闭浏览器。

- **不要在任务结束、会话结束、点击停止按钮后自动关闭浏览器**
- **只有三种情况才允许关闭/清理浏览器**
  - **用户明确要求**（例如“关闭浏览器”、“清理浏览器进程”）
  - **确认僵尸进程**（见下方“异常处理”）
  - **确认当前是无头浏览器，需要切换为有头模式以便扫码登录/人工交互**

## 操作流程

### 第一步：打开目标页面

```bash
agent-browser open "https://目标地址" --headed --no-sandbox
```

> `open` 命令无论浏览器是否已启动都能正常工作：未启动时自动拉起，已启动时直接导航。

**异常处理：命令超时卡住（超过 10 秒无响应）**

说明存在僵尸进程，清理后重开：

**macOS/Linux:**

```bash
agent-browser close 2>/dev/null; pkill -f "Google Chrome for Testing" 2>/dev/null; pkill -f "chrome-headless-shell" 2>/dev/null; sleep 1; agent-browser open "https://目标地址" --headed --no-sandbox
```

**Windows (PowerShell; from Bash tool use the wrapper):**

```bash
powershell -Command "agent-browser close 2>$null; taskkill /f /im chrome.exe /fi 'WINDOWTITLE eq *Chrome for Testing*' 2>$null; Start-Sleep -Seconds 1; agent-browser open 'https://目标地址' --headed --no-sandbox"
```

### 第二步：检查登录状态

```bash
agent-browser get title
```

如果标题包含"登录"或"统一登录中心"，提示用户：
> "请在浏览器窗口中扫码登录，完成后告诉我"

### 第三步：获取页面内容

```bash
agent-browser snapshot -i
```

## 命令速查

| 命令 | 用途 |
|-----|------|
| `open <url> --headed --no-sandbox` | 打开页面（自动启动或导航） |
| `snapshot -i` | 获取可交互元素 |
| `snapshot` | 获取页面内容 |
| `click @eX` | 点击元素 |
| `fill @eX "text"` | 输入文本 |
| `get title` | 获取页面标题 |
| `screenshot /tmp/x.png` | 截图 |

## 禁止

- ❌ 每次都清理重开（会丢失登录状态）
- ❌ `agent-browser launch`（不存在）
- ❌ `agent-browser start`（不存在）
- ❌ `agent-browser open <url>` 不带 `--headed`（用户看不到）
