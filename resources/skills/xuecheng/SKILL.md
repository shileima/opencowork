---
name: xuecheng
description: 搜索美团学城文档。先检查浏览器状态，再决定用 goto 还是 open。
allowed-tools: Bash(agent-browser:*)
---

# 学城搜索

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
npx agent-browser open "https://km.sankuai.com/search?key=关键词&searchType=1" --headed --no-sandbox
```

### 第二步：根据输出决定下一步

**输出 1：返回正常 URL**
```
https://km.sankuai.com/...
```
→ 浏览器正常运行，直接用 `goto`：
```bash
npx agent-browser goto "https://km.sankuai.com/search?key=关键词&searchType=1"
```

**输出 2：Browser not launched**
```
✗ Browser not launched. Call launch first.
```
→ 浏览器未启动，用 `open`：
```bash
npx agent-browser open "https://km.sankuai.com/search?key=关键词&searchType=1" --headed --no-sandbox
```

**输出 3：命令超时卡住（超过 10 秒无响应）**
→ 僵尸进程，清理后重开（更稳健的判定：`npx agent-browser get url` 连续 2 次、每次约 1.5 秒都无响应/超时）：
```bash
npx agent-browser close 2>/dev/null; pkill -f "Google Chrome for Testing" 2>/dev/null; pkill -f "chrome-headless-shell" 2>/dev/null; sleep 1; npx agent-browser open "https://km.sankuai.com/search?key=关键词&searchType=1" --headed --no-sandbox
```

### 第三步：获取搜索结果

```bash
sleep 2
npx agent-browser snapshot -i
```

## 获取页面内容

```bash
# 获取页面文本
npx agent-browser get text body

# 如果输出保存到文件，用 grep 提取
grep -i "关键词" /path/to/file.txt | head -n 50
```

## 禁止

- ❌ 每次都清理重开（会丢失登录状态）
- ❌ 用 `keyword=` 或 `query=`（正确是 `key=`）
- ❌ `npx agent-browser launch`（不存在）
