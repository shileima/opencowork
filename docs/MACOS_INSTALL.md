# macOS 安装指南

## 常见问题

### ❌ "应用已损坏,无法打开" 错误

当您首次打开从 GitHub Release 下载的 macOS 应用时,可能会看到以下错误:

```
"测试助手" 已损坏,无法打开。你应该将它移到废纸篓。
```

**原因:** 这是 macOS Gatekeeper 安全机制,阻止未经 Apple 公证的应用运行。

## 解决方案

### 方法 1: 移除隔离属性 (推荐)

这是最简单快速的方法。在终端执行以下命令:

#### 如果应用在下载文件夹:

```bash
# 移除 DMG 文件的隔离属性
xattr -cr ~/Downloads/测试助手-Mac-*.dmg

# 或者移除应用的隔离属性
xattr -cr ~/Downloads/测试助手.app
```

#### 如果应用已安装到应用程序文件夹:

```bash
xattr -cr /Applications/测试助手.app
```

然后重新打开应用即可。

### 方法 2: 通过系统设置允许

1. 尝试打开应用(会被阻止)
2. 打开 **系统设置** (或 **系统偏好设置**)
3. 进入 **隐私与安全性** (或 **安全性与隐私**)
4. 在 **通用** 标签页底部,找到被阻止的应用提示
5. 点击 **仍要打开** 按钮
6. 确认打开

### 方法 3: 右键打开 (简单)

1. 在 Finder 中找到应用
2. 按住 `Control` 键点击应用(或右键点击)
3. 选择 **打开**
4. 在弹出的对话框中点击 **打开**

## 安装步骤

### 1. 下载

从 [GitHub Releases](https://github.com/shileima/opencowork/releases) 下载最新的 macOS 安装包:

- 文件名格式: `测试助手-Mac-0.0.13-Installer.dmg` 或类似

### 2. 安装

1. 双击下载的 `.dmg` 文件
2. 将 `测试助手.app` 拖到 `Applications` 文件夹
3. 等待复制完成

### 3. 首次运行

如果遇到 "已损坏" 错误,使用上述解决方案之一。

### 4. 验证安装

成功打开后,应该能看到应用主界面。

## 开发者选项 (可选)

如果您是开发者,想要避免每次都需要移除隔离属性,可以:

### 选项 1: 从源码直接运行

```bash
# 克隆仓库
git clone https://github.com/shileima/opencowork.git
cd opencowork

# 安装依赖
npm install

# 开发模式运行
npm run dev
```

### 选项 2: 本地构建

```bash
# 构建应用
npm run build:mac

# 构建的应用在 release 目录
```

本地构建的应用不会有隔离属性。

## Apple 公证 (生产环境)

如果您需要分发给更多用户,建议进行 Apple 公证:

### 前置条件

- Apple Developer 账号 ($99/年)
- 开发者证书 (Developer ID Application)

### 公证流程

1. **代码签名**

```bash
# 设置环境变量
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"

# 构建并签名
npm run build:mac
```

2. **提交公证**

```bash
xcrun notarytool submit \
  "release/测试助手-Mac-0.0.13-Installer.dmg" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
```

3. **附加公证信息**

```bash
xcrun stapler staple "release/测试助手-Mac-0.0.13-Installer.dmg"
```

### 在 GitHub Actions 中自动化

修改 `.github/workflows/release.yml`:

```yaml
- name: Code sign and notarize (macOS)
  if: matrix.platform == 'macos'
  env:
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  run: |
    # electron-builder 会自动处理签名和公证
    npx electron-builder --mac --publish never
```

需要在 GitHub Secrets 中添加:
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD` (App专用密码)
- `APPLE_TEAM_ID`

## 系统要求

- **macOS 版本:** 10.15 (Catalina) 或更高
- **架构:** x64 (Intel) / arm64 (Apple Silicon)

## 卸载

删除以下文件:

```bash
# 应用程序
rm -rf /Applications/测试助手.app

# 应用数据 (可选)
rm -rf ~/Library/Application\ Support/opencowork
rm -rf ~/Library/Logs/opencowork
rm -rf ~/Library/Caches/opencowork
```

## 常见问题

### Q: 应用可以打开,但功能异常?

A: 检查控制台日志:

```bash
# 查看日志
tail -f ~/Library/Logs/opencowork/main.log
```

### Q: 如何更新应用?

A: 使用内置的资源自动更新功能:

1. 打开应用
2. 进入 **设置** → **资源热更新**
3. 点击 **检查资源更新**
4. 如果有更新,点击 **立即更新**

### Q: 更新失败?

A: 参考 [AUTO_UPDATE_TROUBLESHOOTING.md](./AUTO_UPDATE_TROUBLESHOOTING.md)

## 技术支持

如有问题,请:

1. 查看 [文档目录](./README.md)
2. 提交 [GitHub Issue](https://github.com/shileima/opencowork/issues)
3. 查看日志文件: `~/Library/Logs/opencowork/main.log`

## 相关文档

- [资源自动更新](./AUTO_UPDATE.md)
- [故障排查](./AUTO_UPDATE_TROUBLESHOOTING.md)
- [开发指南](./development.md)
