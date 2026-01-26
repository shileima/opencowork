# v0.0.17 发布说明

## 版本信息
- **版本号**：0.0.17
- **发布日期**：2026-01-26
- **主要变更**：修复 Node.js 运行时问题 + Playwright 提示优化

---

## 🎉 主要功能

### 1. Node.js 运行时动态下载
- ✅ CI 构建时自动下载 Node.js 运行时
- ✅ 支持 macOS (arm64/x64) 和 Windows (x64)
- ✅ 减小 Git 仓库大小（移除 ~200MB 二进制文件）

### 2. Playwright 提示优化
- ✅ Playwright 安装提示始终显示在最上方
- ✅ 不受模式切换和历史记录影响
- ✅ 自动隐藏逻辑：已安装或用户选择稍后安装

### 3. 构建流程优化
- ✅ 修复多平台并发上传冲突
- ✅ 优化资源文件上传策略
- ✅ 添加构建失败容错机制

---

## 🔧 技术改进

### Node.js 运行时管理
```
macOS 应用：   内置 Node.js + npm
Windows 应用： 内置 node.exe（npm 通过 node 调用）
Linux 应用：   不打包 Node.js（使用系统环境）
```

### CI/CD 优化
- 分离可执行文件和资源文件上传
- 避免多平台同时上传同一文件
- 添加 `fail_on_unmatched_files: false` 避免误报

---

## 📦 发布文件

### macOS
- `测试助手-Mac-0.0.17-Installer.dmg` (约 150-200 MB)

### Windows
- `测试助手-Windows-0.0.17-Setup.exe`
- `测试助手-Windows-0.0.17-Portable.exe`

### Linux
- `测试助手-Linux-0.0.17.AppImage`
- `测试助手-Linux-0.0.17.deb`

### 资源文件
- `resource-manifest.json` - 资源清单
- `resources-v0.0.17.zip` - 资源包（用于自动更新）

---

## 🧪 测试指南

### 1. 测试 Playwright 安装
1. 全新安装应用
2. 启动后应看到 Playwright 安装提示（黄色警告框）
3. 点击"立即安装"按钮
4. 验证：不应再出现"内置 Node.js 不存在"错误
5. 等待安装完成（约 150MB，需要几分钟）

### 2. 测试自动更新
如果您有 v0.0.14-v0.0.16 的客户端：
1. 启动旧版本客户端
2. 等待 1 分钟（自动更新检查）
3. 应显示"发现新版本 v0.0.17"提示
4. 点击"立即更新"
5. 验证更新流程

### 3. macOS 安装注意事项
首次安装需要清除隔离属性：
```bash
xattr -cr /Applications/测试助手.app
```

详见：`docs/MACOS_INSTALL.md`

---

## 🐛 已修复的问题

### v0.0.16 构建问题（已在 v0.0.17 解决）
1. ✅ Windows Node.js 下载 404 错误
2. ✅ Linux 平台不支持错误
3. ✅ Windows 找不到 npm
4. ✅ 多平台并发上传冲突
5. ✅ Playwright 提示被历史记录遮挡

详见：`docs/RELEASE_v0.0.16_FIX.md`

---

## 📚 相关文档
- 📖 [Node.js 运行时管理](../docs/NODE_RUNTIME.md)
- 📖 [自动更新故障排查](../docs/AUTO_UPDATE_TROUBLESHOOTING.md)
- 📖 [macOS 安装指南](../docs/MACOS_INSTALL.md)
- 📖 [v0.0.16 修复记录](../docs/RELEASE_v0.0.16_FIX.md)

---

## ⚠️ 已知限制

### 自动更新频率
当前设置为**每 1 分钟**检查一次（用于测试）。
生产环境建议改为 24 小时：
```typescript
// electron/main.ts
resourceUpdater.startAutoUpdateCheck(24)
```

### Windows npm 支持
Windows 应用跳过了 npm 准备步骤，Playwright 功能依赖系统 npm。
如需完整支持，可以在后续版本中改进。

---

## 🎯 下一步计划

1. 测试 v0.0.17 的稳定性
2. 根据测试结果决定是否需要 v0.0.18
3. 将自动更新检查频率改回 24 小时
4. 考虑添加 Apple 代码签名和公证

---

**感谢测试！有任何问题请及时反馈。** 🚀
