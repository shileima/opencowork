# 中文字体说明

## 问题

pdfkit 不支持 TTC（TrueType Collection）字体文件，只支持 TTF/OTF 格式。

## 解决方案

### 方法 1：手动下载 NotoSansCJK（推荐）

1. **访问 GitHub Releases**：
   ```
   https://github.com/notofonts/noto-cjk/releases
   ```

2. **下载 TTF 文件**（不要下载 TTC）：
   - 查找 "Subset TTF" 或 "Variable TTF" 格式
   - 推荐下载：`NotoSansCJK-Regular.ttf` 或 `NotoSansCJK-SC-Regular.ttf`
   - 文件大小约 2-5 MB

3. **放置字体文件**：
   将下载的 `.ttf` 文件放到此目录：
   ```
   ~/.qa-cowork/skills/chrome-agent/fonts/
   ```

4. **验证**：
   ```bash
   cd ~/.qa-cowork/skills/chrome-agent
   node test-pdf-chinese.js
   ```
   如果看到 "✅ 已加载中文字体"，说明配置成功。

### 方法 2：使用系统字体

如果系统已安装 Microsoft 字体（SimHei.ttf 或 SimSun.ttf），脚本会自动使用。

### 方法 3：安装到系统字体目录

- **macOS**: `/Library/Fonts/`
- **Linux**: `/usr/share/fonts/truetype/noto/`
- **Windows**: `C:/Windows/Fonts/`

## 快速下载链接

如果网络允许，可以直接下载：

```bash
# 简体中文版本
curl -L -o NotoSansCJK-SC-Regular.ttf \
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/Subset/TTF/SC/NotoSansCJKsc-Regular.ttf"
```

## 字体文件命名

脚本会自动查找以下文件名：
- `NotoSansCJK-Regular.ttf`
- `NotoSansCJK-SC-Regular.ttf`
- `SimHei.ttf`
- `SimSun.ttf`

## 故障排除

如果仍然出现乱码：

1. **检查字体文件格式**：
   ```bash
   file fonts/NotoSansCJK-SC-Regular.ttf
   ```
   应该显示 "TrueType font"

2. **检查文件权限**：
   ```bash
   ls -l fonts/*.ttf
   ```
   确保文件可读

3. **查看脚本日志**：
   运行脚本时会显示找到的字体路径，确认是否正确
