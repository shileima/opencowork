---
name: daxiang-chat
description: 访问大象网页版（小美协作）并进行聊天操作。用于查看消息、发送消息、翻译消息等聊天相关任务。
allowed-tools: Bash(agent-browser:*)
---

# 大象网页版聊天操作

**必须使用 Bash 工具执行 `agent-browser` 命令！**

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
agent-browser open "https://x.sankuai.com/chat" --headed --no-sandbox
```

> `open` 命令无论浏览器是否已启动都能正常工作：未启动时自动拉起，已启动时直接导航。

**异常处理：命令超时卡住（超过 10 秒无响应）**

说明存在僵尸进程，清理后重开：

**macOS/Linux:**

```bash
agent-browser close 2>/dev/null; pkill -f "Google Chrome for Testing" 2>/dev/null; pkill -f "chrome-headless-shell" 2>/dev/null; sleep 1; agent-browser open "https://x.sankuai.com/chat" --headed --no-sandbox
```

**Windows (PowerShell; from Bash tool use the wrapper):**

```bash
powershell -Command "agent-browser close 2>$null; taskkill /f /im chrome.exe /fi 'WINDOWTITLE eq *Chrome for Testing*' 2>$null; Start-Sleep -Seconds 1; agent-browser open 'https://x.sankuai.com/chat' --headed --no-sandbox"
```

### 第二步：检查登录状态

```bash
agent-browser get title
```

如果标题包含"登录"或"统一登录中心"，提示用户：
> "请在浏览器窗口中扫码登录，完成后告诉我"

## 进入目标会话（优先左侧列表，找不到再搜索）

优先检查左侧会话列表是否已经有目标会话（例如最近聊过的人/群）。如果有，直接点击进入；只有在左侧找不到时，才使用下方搜索。

```bash
# 1. 先看左侧会话列表里有没有目标会话
agent-browser snapshot

# 2. 获取可点击元素（用于点击左侧目标会话）
agent-browser snapshot -i

# 3. 如果左侧已有目标会话，直接 click 对应条目
# agent-browser click @eX
```

## 搜索联系人（兜底：左侧没有目标会话时再用）

**重要：搜索后用 click 点击结果，不要按回车！**

**macOS/Linux:**

```bash
# 1. 获取搜索框
agent-browser snapshot -i

# 2. 输入搜索内容
agent-browser fill @e1 "张三"

# 3. 等待并查看结果
sleep 2
agent-browser snapshot

# 4. 点击目标联系人（不要按回车！）
agent-browser click @e15
```

**Windows (PowerShell; from Bash tool use the wrapper):**

```bash
powershell -Command "agent-browser snapshot -i; agent-browser fill @e1 '张三'; Start-Sleep -Seconds 2; agent-browser snapshot; agent-browser click @e15"
```

## 发送消息

```bash
# 1. 确认聊天对象（必须！左侧列表 ≠ 当前聊天窗口）
agent-browser snapshot
# 检查右侧聊天窗口显示的是谁

# 2. 获取输入框
agent-browser snapshot -i

# 3. 输入并发送
agent-browser fill @e38 "消息内容"
agent-browser click @e39  # 发送按钮
```

## 命令速查

| 命令 | 用途 |
|-----|------|
| `open <url> --headed --no-sandbox` | 打开页面（自动启动或导航） |
| `snapshot -i` | 获取可交互元素 |
| `snapshot` | 获取页面内容 |
| `click @eX` | 点击元素 |
| `fill @eX "text"` | 输入文本 |

## 禁止

- ❌ 每次都清理重开（会丢失登录状态）
- ❌ `agent-browser launch`（不存在）
- ❌ `agent-browser open <url>` 不带 `--headed`

## 代发消息风格

避免机器感：
- ❌ "根据您的需求..." → ✅ "嗯，我觉得可以这样搞"
- ❌ "这确实是一个值得探讨的话题" → ✅ "确实，挺有意思的"
