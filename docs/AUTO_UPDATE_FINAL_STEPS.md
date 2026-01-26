# 完成资源自动更新 - 最后步骤

## 🎯 目标

完成最后 15% 的工作,让资源自动更新功能完全可用。

---

## ✅ Step 1: 安装依赖(5分钟)

```bash
cd /Users/shilei/ai/opencowork
npm install
```

验证安装:
```bash
npm list adm-zip
# 应该显示: adm-zip@0.5.10
```

---

## ✅ Step 2: 更新 GitHub Actions(10分钟)

编辑 `.github/workflows/release.yml`:

### 在 `Generate Resource Manifest` 步骤**后面**添加:

```yaml
      -
        name: Package Resources
        if: success() && matrix.platform == 'linux'  # 只在 Linux 平台执行一次
        run: |
          # 提取版本号
          VERSION=$(node -p "require('./package.json').version")
          echo "Packaging resources for version ${VERSION}"
          
          # 创建临时目录
          mkdir -p temp-resources
          
          # 复制前端资源
          if [ -d "dist" ]; then
            echo "Copying dist/"
            cp -r dist temp-resources/
          fi
          
          # 创建 resources 目录
          mkdir -p temp-resources/resources
          
          # 复制各个资源子目录(使用 || true 避免目录不存在时失败)
          if [ -d "resources/skills" ]; then
            echo "Copying resources/skills/"
            cp -r resources/skills temp-resources/resources/
          fi
          
          if [ -d "resources/mcp" ]; then
            echo "Copying resources/mcp/"
            cp -r resources/mcp temp-resources/resources/
          fi
          
          if [ -d "resources/node" ]; then
            echo "Copying resources/node/"
            cp -r resources/node temp-resources/resources/
          fi
          
          if [ -d "resources/playwright" ]; then
            echo "Copying resources/playwright/"
            cp -r resources/playwright temp-resources/resources/
          fi
          
          # 打包为 zip
          cd temp-resources
          zip -r ../resources-v${VERSION}.zip . -x "*.DS_Store" -x "__MACOSX/*"
          cd ..
          
          # 验证 zip 文件
          ls -lh resources-v${VERSION}.zip
          unzip -l resources-v${VERSION}.zip | head -20
          
          # 清理临时目录
          rm -rf temp-resources
          
          echo "Resource package created: resources-v${VERSION}.zip"
```

### 更新 `Upload executables to Release` 步骤:

找到这个步骤,修改 `files` 部分:

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

保存并提交:

```bash
git add .github/workflows/release.yml
git commit -m "feat: 添加资源打包到 GitHub Actions"
git push origin master
```

---

## ✅ Step 3: 测试本地构建(15分钟)

```bash
# 1. 构建前端
npm run build

# 2. 生成清单
npm run build:manifest

# 3. 查看清单内容
cat resource-manifest.json | jq '.version,.files | keys | length'
# 应该显示版本号和文件数量

# 4. 手动测试打包(可选)
mkdir -p temp-resources
cp -r dist temp-resources/
mkdir -p temp-resources/resources
cp -r resources/skills temp-resources/resources/ 2>/dev/null || true
cp -r resources/mcp temp-resources/resources/ 2>/dev/null || true
cd temp-resources
zip -r ../test-resources.zip .
cd ..

# 5. 验证 zip 内容
unzip -l test-resources.zip | head -30
ls -lh test-resources.zip

# 6. 清理
rm -rf temp-resources test-resources.zip
```

---

## ✅ Step 4: 创建测试 Release(20分钟)

```bash
# 1. 确保所有代码已提交
git status

# 2. 提交所有更改
git add .
git commit -m "feat: 完成资源自动更新功能

- 实现 ResourceUpdater 核心类
- 集成到主进程
- 添加前端更新 UI
- 实现清单生成器
- 配置 GitHub Actions 自动打包
- 添加完整文档"

# 3. 推送到远程
git push origin master

# 4. 创建测试标签
git tag v0.0.14-test -m "测试资源自动更新功能"

# 5. 推送标签
git push origin v0.0.14-test

# 6. 等待 GitHub Actions 完成(约 10-15 分钟)
# 访问: https://github.com/Safphere/opencowork/actions
```

---

## ✅ Step 5: 验证 Release(10分钟)

### 5.1 检查 Release 页面

访问: https://github.com/Safphere/opencowork/releases/tag/v0.0.14-test

验证是否包含:
- [ ] `resource-manifest.json`
- [ ] `resources-v0.0.14-test.zip`
- [ ] 各平台安装包 (.dmg, .exe, .AppImage, .deb)

### 5.2 下载并验证文件

```bash
# 下载清单文件
curl -L -o downloaded-manifest.json \
  https://github.com/Safphere/opencowork/releases/download/v0.0.14-test/resource-manifest.json

# 查看清单
cat downloaded-manifest.json | jq '.version, .buildTime'

# 下载资源包
curl -L -o downloaded-resources.zip \
  https://github.com/Safphere/opencowork/releases/download/v0.0.14-test/resources-v0.0.14-test.zip

# 验证 zip 内容
unzip -l downloaded-resources.zip | head -30

# 清理
rm -f downloaded-manifest.json downloaded-resources.zip
```

---

## ✅ Step 6: 测试更新功能(30分钟)

### 6.1 准备测试环境

需要两个版本的应用:
1. 旧版本(v0.0.13 或更早)
2. 新版本(v0.0.14-test)

### 6.2 测试步骤

1. **安装旧版本**
   - 下载 v0.0.13 安装包
   - 安装并运行

2. **测试更新检测**
   - 打开应用设置 → 关于
   - 点击"检查资源更新"按钮
   - 应该显示: "发现新资源版本! v0.0.14-test"

3. **测试更新下载**
   - 点击"立即更新"按钮
   - 观察进度条
   - 验证没有错误

4. **测试更新应用**
   - 更新完成后点击"立即重启"
   - 应用重启
   - 验证新资源已生效

5. **查看日志**
   - 打开开发者工具 (View → Toggle Developer Tools)
   - Console 标签
   - 搜索 "[ResourceUpdater]"
   - 验证没有错误日志

### 6.3 测试检查清单

- [ ] 更新检测正常
- [ ] 进度显示正常
- [ ] 下载成功
- [ ] 文件应用成功
- [ ] 重启后生效
- [ ] 无错误日志

---

## ✅ Step 7: 清理和正式发布(可选)

### 如果测试通过:

```bash
# 1. 删除测试标签
git tag -d v0.0.14-test
git push origin :refs/tags/v0.0.14-test

# 2. 创建正式版本
git tag v0.0.14 -m "Release v0.0.14: 添加资源自动更新功能"
git push origin v0.0.14

# 3. 等待 GitHub Actions 完成
# 4. 在 Release 页面编辑发布说明
```

### 如果测试失败:

1. 查看错误日志
2. 修复问题
3. 重新提交
4. 创建新的测试标签(如 v0.0.14-test2)

---

## 🐛 故障排查

### GitHub Actions 失败

**查看日志:**
```
GitHub → Actions → 最新 workflow 运行 → 失败的 job
```

**常见问题:**

1. **找不到 dist 目录**
   - 确保 `vite build` 在打包资源前执行
   - 检查 build 步骤是否成功

2. **zip 命令失败**
   - 确保 Linux 环境有 zip 命令
   - 检查文件路径是否正确

3. **文件上传失败**
   - 检查 `files` 路径通配符
   - 验证文件确实存在

### 更新检测失败

**控制台日志:**
```javascript
await window.ipcRenderer.invoke('resource:check-update')
```

**常见问题:**

1. **网络错误**
   - 检查网络连接
   - 验证 GitHub API 可访问

2. **清单文件不存在**
   - 验证 Release 包含 resource-manifest.json
   - 检查文件名是否正确

3. **版本比较错误**
   - 确保版本号格式正确 (X.Y.Z)
   - 检查 compareVersions 逻辑

### 更新下载失败

**常见问题:**

1. **资源包不存在**
   - 验证 Release 包含 resources-*.zip
   - 检查文件名匹配逻辑

2. **zip 解压失败**
   - 验证 zip 文件完整性
   - 检查 adm-zip 是否正确安装

3. **磁盘空间不足**
   - 检查剩余空间
   - 清理临时文件

---

## 📋 最终检查清单

- [ ] 依赖已安装 (`npm install`)
- [ ] GitHub Actions 已更新
- [ ] 本地构建测试通过
- [ ] 测试 Release 已创建
- [ ] Release 包含所有必需文件
- [ ] 更新检测正常工作
- [ ] 更新下载正常工作
- [ ] 更新应用正常工作
- [ ] 无错误日志
- [ ] 文档已阅读

---

## 🎉 完成!

完成以上步骤后,资源自动更新功能即可正式使用!

### 后续工作

1. **监控使用情况**
   - 收集用户反馈
   - 观察错误日志
   - 优化用户体验

2. **持续优化**
   - 实现更新重试
   - 添加更详细的错误提示
   - 优化下载速度

3. **文档完善**
   - 添加实际截图
   - 补充常见问题
   - 编写视频教程

---

## 📞 需要帮助?

- 查看详细文档: `docs/AUTO_UPDATE*.md`
- 搜索相关日志: `[ResourceUpdater]`
- 检查 GitHub Actions 日志
- 查看控制台错误信息

**预计总时间**: 1.5 - 2 小时

祝你顺利! 🚀
