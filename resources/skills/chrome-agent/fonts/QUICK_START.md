# 快速开始 - 下载中文字体

## 🚀 最快方法（3 步）

### 1. 打开浏览器
访问：**https://github.com/notofonts/noto-cjk/releases**

### 2. 下载文件
- 找到 "Sans" 版本的 releases（不是 Serif）
- 下载 **TTF** 格式（不要下载 TTC）
- 文件名：`NotoSansCJK-Regular.ttf` 或 `NotoSansCJK-SC-Regular.ttf`

### 3. 放置文件
将下载的文件放到：
```
~/.qa-cowork/skills/chrome-agent/fonts/
```

## ✅ 验证

运行测试：
```bash
cd ~/.qa-cowork/skills/chrome-agent
node test-pdf-chinese.js
```

看到 "✅ 已加载中文字体" 就成功了！

## 📝 详细说明

查看 `下载指南.md` 获取更多下载方法和故障排除。
