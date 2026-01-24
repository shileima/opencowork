# 微博热搜自动化采集工具

## 功能介绍

这是一个自动化脚本，可以：
- 🌐 自动打开微博热搜页面
- 📊 抓取实时热搜数据
- 📄 生成精美的 PDF 报告
- 💾 同时保存 JSON 格式数据

## 安装依赖

```bash
# 在 chrome-agent 目录下执行
npm install
```

## 使用方法

### 基本使用

```bash
# 运行脚本
node weibo-hotsearch-to-pdf.js

# 或使用 npm 命令
npm start
```

### 输出文件

脚本运行后会在 `./output` 目录下生成两个文件：

1. **PDF 文件**: `weibo-hotsearch-YYYY-MM-DD.pdf` - 美化排版的热搜报告
2. **JSON 文件**: `weibo-hotsearch-YYYY-MM-DD.json` - 结构化的原始数据

## 配置选项

在脚本中可以修改 `CONFIG` 对象来自定义配置：

```javascript
const CONFIG = {
  weiboUrl: 'https://s.weibo.com/top/summary',  // 微博热搜页面
  outputDir: './output',                         // 输出目录
  pdfFileName: `weibo-hotsearch-${date}.pdf`,   // PDF文件名
  jsonFileName: `weibo-hotsearch-${date}.json`, // JSON文件名
  timeout: 30000,                                // 超时时间(毫秒)
  headless: false,                               // 是否无头模式
};
```

### 无头模式运行

如果不想看到浏览器窗口，可以设置 `headless: true`：

```javascript
const CONFIG = {
  // ...
  headless: true,  // 改为 true
};
```

## 数据格式

### JSON 数据结构

```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "count": 50,
  "data": [
    {
      "rank": 1,
      "title": "热搜标题",
      "link": "https://...",
      "hotValue": "1234567",
      "category": "热"
    }
  ]
}
```

### PDF 报告特点

- ✨ 渐变色设计，视觉效果好
- 🎯 前三名高亮显示
- 📊 包含排名、标题、热度值、分类
- 🕐 标注数据采集时间
- 🖨️ 打印友好格式

## 功能特性

### 1. 智能等待
- 自动等待页面加载完成
- 确保所有热搜数据加载

### 2. 数据采集
- 提取热搜标题
- 获取热度值
- 识别分类标签
- 记录链接地址

### 3. 双重保存
- PDF: 可视化报告，适合阅读和分享
- JSON: 结构化数据，适合二次开发

### 4. 错误处理
- 完善的异常捕获
- 详细的错误信息输出
- 自动清理浏览器资源

## 常见问题

### 1. Puppeteer 下载失败

```bash
# 使用国内镜像
npm config set puppeteer_download_host=https://npm.taobao.org/mirrors
npm install puppeteer
```

### 2. 页面加载超时

增加超时时间：

```javascript
timeout: 60000,  // 改为 60 秒
```

### 3. 无法访问微博

检查网络连接，或更换其他网络环境。

## 二次开发

### 作为模块使用

```javascript
const { getWeiboHotSearch, generateHTML } = require('./weibo-hotsearch-to-pdf');

async function myCustomFunction() {
  const result = await getWeiboHotSearch();
  console.log(result.data); // 热搜数据数组
}
```

### 自定义 HTML 模板

修改 `generateHTML` 函数来自定义 PDF 样式：

```javascript
function generateHTML(hotSearchData) {
  // 自定义你的 HTML 模板
  return `
    <!DOCTYPE html>
    <html>
      <!-- 你的自定义样式 -->
    </html>
  `;
}
```

## 技术栈

- **Node.js**: JavaScript 运行环境
- **Puppeteer**: 无头浏览器自动化
- **原生 Node.js API**: 文件操作

## 许可证

MIT

## 更新日志

### v1.0.0 (2024-01-01)
- ✨ 初始版本发布
- 📊 支持微博热搜采集
- 📄 支持 PDF 生成
- 💾 支持 JSON 导出

## 作者

自动化脚本助手

## 贡献

欢迎提交 Issue 和 Pull Request！
