# 微博热搜自动抓取工具

## 功能说明

这个脚本可以自动访问微博，点击热搜菜单，抓取热搜列表内容，并生成以下文件：

1. **weibo_hotsearch.txt** - 纯文本格式的热搜列表
2. **weibo_hotsearch.html** - 美化的HTML格式热搜列表
3. **weibo_hotsearch.pdf** - PDF格式的热搜列表报告

## 使用方法

### 快速执行

```bash
cd ~/.opencowork/skills/chrome-agent
node weibo_hotsearch.js
```

### 首次使用（如需安装依赖）

```bash
cd ~/.opencowork/skills/chrome-agent
npm install playwright
npx playwright install chromium
node weibo_hotsearch.js
```

## 脚本特点

✅ **使用 Playwright** - 符合自动化脚本规范要求  
✅ **可视化运行** - 浏览器窗口可见，方便观察执行过程  
✅ **多格式输出** - 同时生成 TXT、HTML、PDF 三种格式  
✅ **美观的排版** - PDF文档使用专业排版，前三名高亮显示  
✅ **智能提取** - 支持多种页面结构，自动识别热搜内容  
✅ **错误处理** - 发生错误时自动截图保存，方便调试  

## 输出文件

### 文本文件 (weibo_hotsearch.txt)
```
微博热搜榜
抓取时间: 2026/1/24 22:11:10
共 20 条
============================================================

1. 总书记的12次开年第一课
2. 亚洲杯
3. 温瑞博男单夺冠
...
```

### HTML文件 (weibo_hotsearch.html)
美化的网页格式，带有：
- 橙色主题配色
- 排名高亮显示（前3名特殊颜色）
- 悬停效果
- 响应式布局

### PDF文件 (weibo_hotsearch.pdf)
专业的PDF报告，包含：
- A4纸张大小
- 适当的页边距
- 完整的样式保留
- 适合打印和分享

## 技术实现

- **自动化框架**: Playwright（符合规范要求）
- **浏览器**: Chromium（有头模式）
- **内容提取**: 多选择器策略，智能识别页面结构
- **PDF生成**: Playwright内置PDF功能
- **错误处理**: 完善的异常捕获和日志记录

## 自定义修改

### 修改热搜数量限制

在脚本中找到：
```javascript
return items.slice(0, 50); // 限制最多50条
```

修改数字即可改变抓取的热搜数量。

### 修改输出路径

在脚本中修改路径变量：
```javascript
const txtPath = '/Users/shilei/.opencowork/skills/chrome-agent/weibo_hotsearch.txt';
const htmlPath = '/Users/shilei/.opencowork/skills/chrome-agent/weibo_hotsearch.html';
const pdfPath = '/Users/shilei/.opencowork/skills/chrome-agent/weibo_hotsearch.pdf';
```

### 修改PDF样式

在 `htmlContent` 变量的 `<style>` 标签中修改 CSS 样式。

## 常见问题

### Q: 为什么浏览器不自动关闭？
A: 这是有意设计的，让您可以查看抓取结果。如果想自动关闭，取消脚本末尾的注释：
```javascript
// await browser.close();  // 取消这行注释
```

### Q: 如果抓取失败怎么办？
A: 脚本会自动保存错误截图到 `error_screenshot.png`，以及页面HTML到 `weibo_page.html`，方便调试。

### Q: 需要登录吗？
A: 通常不需要。脚本会尝试访问公开的热搜页面。如果遇到登录页面，可以在浏览器窗口中手动登录。

### Q: 可以定时执行吗？
A: 可以！使用 cron（Linux/Mac）或任务计划程序（Windows）：

**Mac/Linux cron 示例**（每小时执行一次）：
```bash
0 * * * * cd ~/.opencowork/skills/chrome-agent && node weibo_hotsearch.js
```

## 许可

MIT License - 自由使用和修改

## 更新记录

- 2026-01-24: 初始版本，支持热搜抓取和多格式输出
