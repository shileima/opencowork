---
name: xuecheng
description: 搜索美团学城文档。
allowed-tools: Bash(agent-browser:*)
---

# 学城搜索

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
agent-browser open "https://km.sankuai.com/search?key=关键词&searchType=1" --headed --no-sandbox
```

> `open` 命令无论浏览器是否已启动都能正常工作：未启动时自动拉起，已启动时直接导航。

**异常处理：命令超时卡住（超过 10 秒无响应）**

说明存在僵尸进程，清理后重开：

**macOS/Linux:**

```bash
agent-browser close 2>/dev/null; pkill -f "Google Chrome for Testing" 2>/dev/null; pkill -f "chrome-headless-shell" 2>/dev/null; sleep 1; agent-browser open "https://km.sankuai.com/search?key=关键词&searchType=1" --headed --no-sandbox
```

**Windows (PowerShell; from Bash tool use the wrapper):**

```bash
powershell -Command "agent-browser close 2>$null; taskkill /f /im chrome.exe /fi 'WINDOWTITLE eq *Chrome for Testing*' 2>$null; Start-Sleep -Seconds 1; agent-browser open 'https://km.sankuai.com/search?key=关键词&searchType=1' --headed --no-sandbox"
```

### 第二步：获取搜索结果

**macOS/Linux:**

```bash
sleep 2
agent-browser snapshot -i
```

**Windows (PowerShell; from Bash tool use the wrapper):**

```bash
powershell -Command "Start-Sleep -Seconds 2; agent-browser snapshot -i"
```

## 获取页面内容

```bash
# 获取页面文本
agent-browser get text body

# 如果输出保存到文件：
# macOS/Linux
#   grep -i "关键词" /path/to/file.txt | head -n 50
# Windows (PowerShell; from Bash tool use the wrapper)
#   powershell -Command "Select-String -Path C:\path\to\file.txt -Pattern '关键词' | Select-Object -First 50"
```

## 禁止

- ❌ 每次都清理重开（会丢失登录状态）
- ❌ 用 `keyword=` 或 `query=`（正确是 `key=`）
- ❌ `agent-browser launch`（不存在）
