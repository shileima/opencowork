# 微博热搜自动化抓取工具

这个脚本可以自动打开微博，点击热搜菜单，获取热搜列表，并输出到 PDF 文档。

## 功能特性

- ✅ 自动打开微博网站
- ✅ 自动点击热搜菜单
- ✅ 提取完整的热搜列表数据
- ✅ 生成格式化的 PDF 报告
- ✅ 同时保存 JSON 格式数据
- ✅ 支持多种选择器自动适配

## 安装依赖

```bash
npm install
```

或者手动安装 Puppeteer：

```bash
npm install puppeteer
```

## 使用方法

### 方式一：直接运行
```bash
node weibo_hot_search.js
```

### 方式二：使用 npm 脚本
```bash
npm start
```

## 输出文件

脚本运行成功后，会在当前目录生成两个文件：

1. **PDF 文档**: `微博热搜_YYYY-MM-DD.pdf` - 格式化的热搜报告
2. **JSON 数据**: `微博热搜_YYYY-MM-DD.json` - 原始数据文件

## 配置选项

你可以在脚本中修改以下配置：

```javascript
// 是否使用无头模式（不显示浏览器窗口）
headless: false  // 改为 true 可以后台运行

// 视口尺寸
defaultViewport: {
    width: 1920,
    height: 1080
}

// PDF 页边距
margin: {
    top: '20mm',
    right: '15mm',
    bottom: '20mm',
    left: '15mm'
}
```

## 数据结构

提取的每条热搜包含以下信息：

```json
{
  "rank": "1",           // 排名
  "title": "热搜标题",    // 标题
  "heat": "1234567",     // 热度值
  "tag": "热"            // 标签（如果有）
}
```

## 注意事项

1. **首次运行**: Puppeteer 首次运行会自动下载 Chromium，可能需要几分钟
2. **网络要求**: 需要能够正常访问微博网站
3. **反爬虫**: 如果频繁运行可能触发微博的反爬虫机制，建议合理使用
4. **登录**: 脚本无需登录即可获取公开的热搜数据

## 故障排除

### 问题：无法找到热搜菜单
- 脚本会自动尝试直接访问热搜页面 `https://weibo.com/hot/weibo`

### 问题：数据提取失败
- 脚本内置了多种选择器，会自动尝试不同的方式提取数据
- 如果仍然失败，会提取页面主要内容作为备选方案

### 问题：PDF 生成失败
- 确保有足够的磁盘空间
- 检查目录写入权限

## 高级用法

### 作为模块使用

```javascript
const { getWeiboHotSearch } = require('./weibo_hot_search.js');

async function customUsage() {
    try {
        const result = await getWeiboHotSearch();
        console.log('PDF路径:', result.pdfPath);
        console.log('数据条数:', result.count);
    } catch (error) {
        console.error('错误:', error);
    }
}

customUsage();
```

## 技术栈

- **Node.js**: JavaScript 运行环境
- **Puppeteer**: 浏览器自动化框架
- **HTML/CSS**: PDF 样式生成

## 许可证

MIT License
