# Playwright 浏览器下载说明

## 自动下载

运行以下命令自动下载 Playwright Chromium 浏览器：

```bash
npm run prepare:playwright
```

## 手动下载

如果自动下载失败（网络问题等），可以手动下载：

### 方法 1：使用 npm 脚本

```bash
PLAYWRIGHT_BROWSERS_PATH=./resources/playwright/browsers npx playwright install chromium
```

### 方法 2：使用完整路径

```bash
# macOS/Linux
PLAYWRIGHT_BROWSERS_PATH=/Users/shilei/ai/opencowork/resources/playwright/browsers npx playwright install chromium

# Windows
set PLAYWRIGHT_BROWSERS_PATH=.\resources\playwright\browsers
npx playwright install chromium
```

### 方法 3：从缓存复制

如果之前已经下载过 Playwright 浏览器（在 `~/.cache/ms-playwright/`），可以直接复制：

```bash
# macOS/Linux
cp -r ~/.cache/ms-playwright/* ./resources/playwright/browsers/

# Windows
xcopy %USERPROFILE%\.cache\ms-playwright\* .\resources\playwright\browsers\ /E /I
```

## 验证下载

下载完成后，验证浏览器文件：

```bash
# 检查目录大小（应该约 100-200MB）
du -sh resources/playwright/browsers/

# 检查 Chromium 目录
ls -la resources/playwright/browsers/
```

## 常见问题

### 1. 网络连接问题

如果遇到 `ECONNRESET` 错误：
- 检查网络连接
- 尝试使用代理或 VPN
- 稍后重试（脚本会自动重试 3 次）

### 2. 下载速度慢

浏览器文件较大（约 100-200MB），下载可能需要一些时间：
- 耐心等待
- 确保网络连接稳定
- 可以考虑使用代理加速

### 3. 磁盘空间不足

确保有足够的磁盘空间（至少 500MB 可用空间）

## 构建时自动下载

如果希望在构建时自动下载浏览器，可以在 `package.json` 的 `build` 脚本中添加：

```json
{
  "scripts": {
    "build": "npm run prepare:playwright && node scripts/verify-builtin-resources.cjs && tsc && vite build && electron-builder"
  }
}
```

注意：这会在每次构建时都尝试下载浏览器，如果已经存在则不会重复下载。
