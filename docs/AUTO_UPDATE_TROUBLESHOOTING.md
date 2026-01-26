# GitHub Actions 失败问题修复

## 🐛 问题描述

在推送 `v0.0.14-test` 标签后,GitHub Actions 工作流失败了。

### 问题1: 文件名匹配错误 (已修复)

**失败原因:** GitHub Actions 无法找到安装包文件

### 问题2: package-lock.json 不同步 (已修复)

**失败原因:** `npm ci` 要求 `package.json` 和 `package-lock.json` 完全同步

错误信息:
```
npm ci can only install packages when your package.json and 
package-lock.json or npm-shrinkwrap.json are in sync.
```

## 🔍 原因分析

### 问题1: 文件名不匹配

查看代码发现问题出在 `.github/workflows/release.yml` 的文件上传步骤:

```yaml
files: |
  release/*/OpenCowork*.dmg    # ❌ 错误:实际文件名是"测试助手-Mac-*.dmg"
  release/*/OpenCowork*.exe
  release/*/OpenCowork*.AppImage
  release/*/OpenCowork*.deb
```

**实际情况:**
- 应用的 `productName` 配置为 `"测试助手"` (在 `electron-builder.json5` 中)
- 生成的安装包文件名是: `测试助手-Mac-0.0.13-Installer.dmg`
- 文件名模式 `OpenCowork*.dmg` 无法匹配中文文件名

## ✅ 解决方案

### 修复1: 文件名匹配模式

```yaml
files: |
  release/*/*.dmg              # ✅ 正确:匹配任意 .dmg 文件
  release/*/*.exe
  release/*/*.AppImage
  release/*/*.deb
  resource-manifest.json
  resources-*.zip
```

### 修复2: 更新 package-lock.json

当添加新依赖后,需要更新 `package-lock.json`:

```bash
# 更新 package-lock.json
npm install

# 提交更改
git add package-lock.json
git commit -m "fix: 更新 package-lock.json"
git push opencowork master

# 重新推送标签
git push opencowork :refs/tags/v0.0.14-test
git push opencowork v0.0.14-test
```

## 🔧 已修复

### 第一次修复 (文件名匹配)

**提交信息:**
```
fix: 修正 GitHub Actions 文件名匹配模式

- 将文件匹配从 OpenCowork* 改为 *
- 支持中文文件名(如:测试助手-Mac-*.dmg)
- 确保所有平台的安装包都能正确上传
```

**修改文件:**
- `.github/workflows/release.yml` (line 152-157)

### 第二次修复 (依赖同步)

**提交信息:**
```
fix: 更新 package-lock.json 以包含 adm-zip 依赖

- 添加 adm-zip@0.5.10 及其依赖
- 修复 GitHub Actions npm ci 失败问题
- 同步 package.json 和 package-lock.json
```

**修改文件:**
- `package-lock.json` (添加 adm-zip 相关依赖)

## 📝 验证步骤

由于遇到推送权限问题,需要手动操作:

### 方法1: 通过 GitHub 网页修改

1. 访问 GitHub 仓库
2. 编辑 `.github/workflows/release.yml`
3. 修改第 152-157 行
4. 提交更改

### 方法2: 配置 Git 凭据后推送

```bash
# 配置 Git 凭据
git config credential.helper store
git push origin master

# 删除远程旧标签
git push origin :refs/tags/v0.0.14-test

# 推送新标签
git push origin v0.0.14-test
```

### 方法3: 创建新的测试标签

```bash
# 创建新版本标签
git tag v0.0.14-test2 -m "测试资源自动更新功能(修复文件名匹配)"
git push origin v0.0.14-test2
```

## 🎯 预期结果

修复后,GitHub Actions 应该能够:
1. ✅ 找到并上传所有平台的安装包
2. ✅ 上传资源清单 `resource-manifest.json`
3. ✅ 上传资源包 `resources-v*.zip`

## 📊 Release 文件清单

成功后,Release 应该包含:

```
v0.0.14-test/
├── 测试助手-Mac-0.0.14-Installer.dmg        (macOS)
├── 测试助手-Windows-0.0.14-Setup.exe         (Windows)
├── 测试助手-Windows-0.0.14-Portable.exe      (Windows 绿色版)
├── 测试助手-Linux-0.0.14.AppImage            (Linux)
├── 测试助手-Linux-0.0.14.deb                 (Debian/Ubuntu)
├── resource-manifest.json                    (资源清单)
└── resources-v0.0.14.zip                     (资源包)
```

## 🔄 下次避免

为了避免类似问题,建议:

1. **统一产品名称**
   - 在 `electron-builder.json5` 中使用英文产品名
   - 或确保 CI 脚本正确处理中文文件名

2. **使用更宽松的文件匹配**
   - 使用 `*.dmg` 而不是 `ProductName*.dmg`
   - 减少文件名变更的影响

3. **本地测试 CI 脚本**
   - 在本地验证文件匹配逻辑
   - 确保文件确实存在于预期位置

## 📚 相关文档

- [AUTO_UPDATE_FINAL_STEPS.md](./AUTO_UPDATE_FINAL_STEPS.md) - 完整实施指南
- [AUTO_UPDATE_TROUBLESHOOTING.md](./AUTO_UPDATE_TROUBLESHOOTING.md) - 本文件

---

**修复时间:** 2026-01-26  
**状态:** ✅ 已修复(待推送)  
**影响:** GitHub Actions 文件上传
