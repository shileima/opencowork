# 资源自动更新 - 快速入门

## 🎯 快速开始

### 1. 安装依赖

```bash
cd /Users/shilei/ai/opencowork
npm install
```

这会安装 `adm-zip` 和相关类型定义。

### 2. 完成 GitHub Actions 配置

编辑 `.github/workflows/release.yml`,在 `Build and Release` 步骤后添加:

```yaml
      -
        name: Package Resources
        if: success() && matrix.platform == 'linux'
        run: |
          VERSION=$(node -p "require('./package.json').version")
          mkdir -p temp-resources
          cp -r dist temp-resources/
          mkdir -p temp-resources/resources
          cp -r resources/skills temp-resources/resources/ || true
          cp -r resources/mcp temp-resources/resources/ || true
          cp -r resources/node temp-resources/resources/ || true
          cp -r resources/playwright temp-resources/resources/ || true
          cd temp-resources
          zip -r ../resources-v${VERSION}.zip .
          cd ..
          rm -rf temp-resources
```

并更新 `Upload executables to Release` 步骤:

```yaml
      -
        name: Upload executables to Release
        uses: softprops/action-gh-release@v2
        if: success()
        with:
          files: |
            release/*/OpenCowork*.dmg
            release/*/OpenCowork*.exe
            release/*/OpenCowork*.AppImage
            release/*/OpenCowork*.deb
            resource-manifest.json
            resources-*.zip
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 3. 测试清单生成

```bash
npm run build
npm run build:manifest
cat resource-manifest.json
```

应该看到类似输出:

```json
{
  "version": "0.0.13",
  "buildTime": 1704067200000,
  "files": {
    "dist/index.html": {
      "hash": "abc123...",
      "size": 1024,
      "path": "dist/index.html"
    },
    ...
  }
}
```

### 4. 创建测试 Release

```bash
# 创建测试标签
git add .
git commit -m "feat: 添加资源自动更新功能"
git tag v0.0.14-test
git push origin v0.0.14-test
```

### 5. 验证 Release

访问 GitHub Releases 页面,检查是否包含:
- ✅ `resource-manifest.json`
- ✅ `resources-v0.0.14-test.zip`
- ✅ 各平台安装包

### 6. 测试更新功能

1. 安装旧版本应用
2. 打开设置 → 关于
3. 点击"检查资源更新"
4. 应该看到新版本提示
5. 点击"立即更新"
6. 观察进度条
7. 更新完成后重启应用

## 📋 检查清单

- [ ] 依赖已安装 (`npm install`)
- [ ] GitHub Actions 已更新
- [ ] 清单生成正常
- [ ] Release 包含资源文件
- [ ] 更新检测正常
- [ ] 更新下载正常
- [ ] 更新应用正常

## 🔍 验证方法

### 验证清单生成

```bash
npm run build:manifest
# 检查输出
ls -lh resource-manifest.json
```

### 验证 Zip 文件

```bash
# 手动创建测试 zip
mkdir -p temp-resources
cp -r dist temp-resources/
cd temp-resources
zip -r ../test-resources.zip .
cd ..

# 验证 zip 内容
unzip -l test-resources.zip
```

### 验证更新逻辑

打开开发者工具,在 Console 执行:

```javascript
// 检查更新
await window.ipcRenderer.invoke('resource:check-update')

// 查看配置
await window.ipcRenderer.invoke('config:get-all')
```

## ⚠️ 注意事项

1. **版本号**: 确保每次发布使用新的版本号
2. **网络**: 测试时确保网络畅通
3. **空间**: 预留足够磁盘空间(至少 1GB)
4. **权限**: 确保有写入应用目录的权限

## 🐛 常见问题

### 清单文件未生成

**原因**: dist 目录不存在

**解决**:
```bash
npm run build
npm run build:manifest
```

### Zip 文件未上传

**原因**: GitHub Actions 配置错误

**解决**: 检查 `files` 路径是否正确

### 更新检测失败

**原因**: 网络问题或 Release 不存在

**解决**: 
1. 检查网络连接
2. 验证 Release 已发布
3. 查看控制台日志

## 📞 获取帮助

- 查看详细文档: [AUTO_UPDATE.md](./AUTO_UPDATE.md)
- 查看实现方案: [AUTO_UPDATE_IMPLEMENTATION.md](./AUTO_UPDATE_IMPLEMENTATION.md)
- 查看设置指南: [AUTO_UPDATE_SETUP.md](./AUTO_UPDATE_SETUP.md)

## ✅ 完成标志

当你可以:
1. ✅ 成功生成清单文件
2. ✅ Release 包含所有资源
3. ✅ 应用能检测到更新
4. ✅ 更新能正常下载和应用
5. ✅ 重启后新资源生效

则说明功能已正常工作! 🎉

---

**预计完成时间**: 1-2小时
**难度**: 中等
**状态**: 80% 完成,待添加 GitHub Actions 配置
