---
name: daxiang-chat
description: 访问大象网页版（小美协作）并进行聊天操作。用于查看消息、发送消息、翻译消息等聊天相关任务。
allowed-tools: Bash(agent-browser:*)
---

# 大象网页版聊天操作

**必须使用 Bash 工具执行 `npx agent-browser` 命令！**

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
npx agent-browser open "https://x.sankuai.com/chat" --headed --no-sandbox
```

### 第二步：根据输出决定下一步

**输出 1：返回正常 URL**
```
https://x.sankuai.com/...
```
→ 浏览器正常运行，直接用 `goto` 跳转：
```bash
npx agent-browser goto "https://x.sankuai.com/chat"
```

**输出 2：Browser not launched**
```
✗ Browser not launched. Call launch first.
```
→ 浏览器未启动，用 `open` 打开：
```bash
npx agent-browser open "https://x.sankuai.com/chat" --headed --no-sandbox
```

**输出 3：命令超时卡住（超过 10 秒无响应）**
→ 僵尸进程，需要清理后重开（更稳健的判定：`npx agent-browser get url` 连续 2 次、每次约 1.5 秒都无响应/超时）：
```bash
npx agent-browser close 2>/dev/null; pkill -f "Google Chrome for Testing" 2>/dev/null; pkill -f "chrome-headless-shell" 2>/dev/null; sleep 1; npx agent-browser open "https://x.sankuai.com/chat" --headed --no-sandbox
```

### 第三步：检查登录状态

```bash
npx agent-browser get title
```

如果标题包含"登录"或"统一登录中心"，提示用户：
> "请在浏览器窗口中扫码登录，完成后告诉我"

## 进入目标会话（优先左侧列表，找不到再搜索）

优先检查左侧会话列表是否已经有目标会话（例如最近聊过的人/群）。如果有，直接点击进入；只有在左侧找不到时，才使用下方搜索。

```bash
# 1. 先看左侧会话列表里有没有目标会话
npx agent-browser snapshot

# 2. 获取可点击元素（用于点击左侧目标会话）
npx agent-browser snapshot -i

# 3. 如果左侧已有目标会话，直接 click 对应条目
# npx agent-browser click @eX
```

## 搜索联系人（兜底：左侧没有目标会话时再用）

**重要：搜索后用 click 点击结果，不要按回车！**

```bash
# 1. 获取搜索框
npx agent-browser snapshot -i

# 2. 输入搜索内容
npx agent-browser fill @e1 "张三"

# 3. 等待并查看结果
sleep 2
npx agent-browser snapshot

# 4. 点击目标联系人（不要按回车！）
npx agent-browser click @e15
```

## 发送消息

```bash
# 1. 确认聊天对象（必须！左侧列表 ≠ 当前聊天窗口）
npx agent-browser snapshot
# 检查右侧聊天窗口显示的是谁

# 2. 获取输入框
npx agent-browser snapshot -i

# 3. 输入并发送
npx agent-browser fill @e38 "消息内容"
npx agent-browser click @e39  # 发送按钮
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

## 禁止

- ❌ 每次都清理重开（会丢失登录状态）
- ❌ `npx agent-browser launch`（不存在）
- ❌ `npx agent-browser open <url>` 不带 `--headed`

## 代发消息风格

避免机器感：
- ❌ "根据您的需求..." → ✅ "嗯，我觉得可以这样搞"
- ❌ "这确实是一个值得探讨的话题" → ✅ "确实，挺有意思的"
