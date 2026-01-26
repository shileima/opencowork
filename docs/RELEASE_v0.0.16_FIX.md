# v0.0.16 构建修复记录

## 问题 1：Windows Node.js 下载失败
**第一次构建失败** - Windows Node.js 下载 404 错误

### 原因
Node.js 官方源的 Windows 文件命名格式是 `node-v20.18.0-win-x64.zip`，而不是 `node-v20.18.0-win32-x64.zip`。

### 解决方案
在 `scripts/download-node.mjs` 中添加 `distName` 参数。

---

## 问题 2：Linux 平台不支持
**第二次构建失败** - Linux runner 执行 `prepare-node-npm.mjs` 报错

### 原因
Linux 构建不需要打包 Node.js 运行时。

### 解决方案
修改脚本，让 Linux 平台直接跳过。

---

## 问题 3：Windows 平台找不到 npm
**第三次构建失败** - Windows runner 无法找到 npm

### 原因
Windows 平台的 npm 路径结构与 Unix-like 系统完全不同。

### 解决方案
重构 `scripts/prepare-node-npm.mjs`，让 Windows 和 Linux 都跳过 npm 准备步骤。

---

## 问题 4：多平台并发上传冲突
**第四次构建失败** - macOS 构建时资源文件上传冲突

### 错误信息
```
Error: Validation Failed: {"resource":"ReleaseAsset","code":"already_exists","field":"name"}
```

### 原因
3 个平台（macOS、Windows、Linux）并行构建，都尝试上传 `resource-manifest.json` 和 `resources-*.zip`，导致冲突。

### 解决方案
修改 `.github/workflows/release.yml`，分离上传步骤：

**修改前**：
```yaml
- name: Upload executables to Release
  with:
    files: |
      release/*/*.dmg
      release/*/*.exe
      release/*/*.AppImage
      release/*/*.deb
      resource-manifest.json
      resources-*.zip
```

**修改后**：
```yaml
# 步骤 1: 所有平台上传各自的可执行文件
- name: Upload executables to Release
  with:
    files: |
      release/*/*.dmg
      release/*/*.exe
      release/*/*.AppImage
      release/*/*.deb

# 步骤 2: 只有 Linux 平台上传资源文件（避免冲突）
- name: Upload resource files to Release (Linux only)
  if: success() && matrix.platform == 'linux'
  with:
    files: |
      resource-manifest.json
      resources-*.zip
```

**优点**：
- ✅ 避免多平台同时上传同一文件
- ✅ 减少不必要的警告（pattern not match）
- ✅ 清晰的职责分工

---

## 操作记录
1. ✅ 修复 `download-node.mjs` - Windows URL 问题 (提交 1)
2. ✅ 修复 `prepare-node-npm.mjs` - Linux 平台支持 (提交 2)
3. ✅ 重构 `prepare-node-npm.mjs` - Windows 平台也跳过 (提交 3)
4. ✅ 修复 Playwright 提示优先显示 (提交 4)
5. ✅ 分离资源文件上传，避免并发冲突 (提交 5)
6. ✅ 强制更新 `v0.0.16` 标签（第 4 次）

---

## 预期结果
所有 3 个平台的构建都应该成功：

| 平台 | Node.js 下载 | npm 准备 | 构建 | 上传 |
|------|-------------|----------|------|------|
| **macOS** | ✅ 3个平台 | ✅ macOS only | ✅ DMG | ✅ DMG |
| **Windows** | ✅ 3个平台 | ⏭️ 跳过 | ✅ EXE | ✅ EXE |
| **Linux** | ✅ 3个平台 | ⏭️ 跳过 | ✅ AppImage/deb | ✅ AppImage/deb + 资源 |

---
最后修复时间：2026-01-26 19:00
