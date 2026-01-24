# Fork 维护指南

本文档说明如何维护基于 [OpenCowork](https://github.com/Safphere/opencowork) 的定制化版本，确保能够持续从上游获取更新而不破坏定制化功能。

## 目录

- [概述](#概述)
- [Git 仓库配置](#git-仓库配置)
- [更新合并流程](#更新合并流程)
- [冲突处理策略](#冲突处理策略)
- [定制化文件清单](#定制化文件清单)
- [常见问题](#常见问题)

## 概述

本仓库是基于 OpenCowork 的定制化版本，主要定制化内容包括：

- 应用配置（应用ID、产品名称、发布配置）
- 官方自动化脚本（`resources/skills/chrome-agent/`）
- 其他定制化功能

为了保持与上游的同步，需要定期合并上游更新。本指南提供了详细的维护流程。

## Git 仓库配置

### 1. 添加上游仓库

如果还没有添加上游仓库，执行以下命令：

```bash
git remote add upstream https://github.com/Safphere/opencowork.git
```

### 2. 查看远程仓库

```bash
git remote -v
```

应该看到类似输出：

```
origin    https://github.com/YourUsername/opencowork.git (fetch)
origin    https://github.com/YourUsername/opencowork.git (push)
upstream  https://github.com/Safphere/opencowork.git (fetch)
upstream  https://github.com/Safphere/opencowork.git (push)
```

### 3. 分支说明

- `master` 或 `main`：你的定制化分支
- `upstream/main`：上游开源版本

## 更新合并流程

### 标准更新流程

1. **确保当前分支干净**

   ```bash
   git status
   ```

   如果有未提交的更改，先提交或暂存：

   ```bash
   git add .
   git commit -m "Your commit message"
   # 或者
   git stash
   ```

2. **切换到主分支**

   ```bash
   git checkout master  # 或 main
   ```

3. **获取上游更新**

   ```bash
   git fetch upstream
   ```

4. **查看上游更新**

   ```bash
   git log HEAD..upstream/main --oneline
   ```

   这会显示上游有哪些新的提交。

5. **合并上游更新**

   ```bash
   git merge upstream/main
   ```

   或者使用 rebase（推荐，保持历史更清晰）：

   ```bash
   git rebase upstream/main
   ```

6. **解决冲突**

   如果出现冲突，Git 会提示哪些文件有冲突。按照[冲突处理策略](#冲突处理策略)处理。

7. **测试验证**

   合并后，务必测试应用功能：

   ```bash
   npm install  # 如果有新的依赖
   npm run dev  # 开发模式测试
   npm run build  # 构建测试
   ```

8. **提交合并结果**

   ```bash
   git add .
   git commit -m "Merge upstream/main: [描述更新的主要内容]"
   ```

9. **推送到远程**

   ```bash
   git push origin master  # 或 main
   ```

### 使用 Pull Request（推荐）

如果你使用 GitHub，可以通过 Pull Request 方式合并：

1. 创建一个新分支用于更新：

   ```bash
   git checkout -b update-from-upstream
   git fetch upstream
   git merge upstream/main
   ```

2. 解决冲突后，推送到远程并创建 Pull Request。

3. 在 Pull Request 中审查更改，确认无误后合并。

## 冲突处理策略

### 1. 定制化文件（保留定制版本）

以下文件通常需要保留定制版本：

- **`electron-builder.json5`**
  - 保留定制版本的应用ID、产品名称、发布配置
  - 手动合并必要的上游更新（如新的打包配置选项）

- **`resources/skills/chrome-agent/`**
  - 保留定制版本的官方脚本
  - 手动合并新增的官方脚本（如果有）

- **`package.json`**
  - 保留定制版本的版本号和产品名称（如果修改了）
  - 合并依赖更新（通常使用上游版本）

### 2. 通用文件（优先使用上游版本）

以下文件通常优先使用上游版本：

- 源代码文件（`src/`、`electron/`）
- 配置文件（`tsconfig.json`、`vite.config.ts` 等）
- 文档文件（`docs/`，除了本文件）

### 3. 冲突解决步骤

1. **识别冲突文件**

   ```bash
   git status
   ```

2. **查看冲突内容**

   ```bash
   git diff
   ```

3. **手动编辑冲突文件**

   打开冲突文件，查找冲突标记：

   ```
   <<<<<<< HEAD
   你的更改
   =======
   上游的更改
   >>>>>>> upstream/main
   ```

4. **选择保留的版本**

   - 对于定制化文件：保留 `<<<<<<< HEAD` 部分，手动合并必要的上游更新
   - 对于通用文件：保留 `>>>>>>> upstream/main` 部分，手动合并必要的定制化更改

5. **标记冲突已解决**

   ```bash
   git add <冲突文件>
   ```

6. **继续合并**

   ```bash
   git commit  # 如果使用 merge
   # 或
   git rebase --continue  # 如果使用 rebase
   ```

## 定制化文件清单

### 核心定制化文件

| 文件路径 | 定制化内容 | 处理策略 |
|---------|-----------|---------|
| `electron-builder.json5` | 应用ID、产品名称、发布配置 | 保留定制版本，手动合并必要更新 |
| `resources/skills/chrome-agent/` | 官方自动化脚本 | 保留定制版本，手动合并新增脚本 |
| `package.json` | 版本号、产品名称（可选） | 保留定制版本，合并依赖更新 |

### 其他可能定制化的文件

| 文件路径 | 说明 |
|---------|------|
| `src/components/CoworkView.tsx` | UI 组件（如果修改了） |
| `electron/main.ts` | 主进程逻辑（如果修改了） |
| `docs/FORK_MAINTENANCE.md` | 本文件（Fork 专用） |
| `CUSTOMIZATION.md` | 定制化清单（Fork 专用） |

## 常见问题

### Q1: 合并后应用无法启动

**原因**：可能是依赖更新或配置变更导致的。

**解决方法**：

1. 检查是否有新的依赖：

   ```bash
   npm install
   ```

2. 检查构建配置是否有变更：

   ```bash
   npm run build
   ```

3. 查看错误日志，定位问题。

### Q2: 官方脚本丢失

**原因**：可能是 `resources/skills/chrome-agent/` 目录被上游覆盖。

**解决方法**：

1. 检查定制化脚本是否还在：

   ```bash
   ls -la resources/skills/chrome-agent/
   ```

2. 如果丢失，从备份或 Git 历史恢复：

   ```bash
   git checkout HEAD -- resources/skills/chrome-agent/
   ```

3. 重新合并，这次手动处理冲突。

### Q3: 合并后功能异常

**原因**：可能是上游的破坏性更改。

**解决方法**：

1. 查看上游的 CHANGELOG 或 Release Notes。
2. 检查是否有迁移指南。
3. 逐步测试各个功能模块。
4. 如果问题严重，考虑回滚到上一个稳定版本。

### Q4: 如何回滚到合并前的状态

**解决方法**：

```bash
# 查看提交历史
git log --oneline

# 回滚到合并前的提交
git reset --hard <合并前的提交哈希>

# 强制推送（谨慎使用）
git push origin master --force
```

### Q5: 如何查看定制化更改

**解决方法**：

```bash
# 查看与上游的差异
git diff upstream/main..HEAD

# 查看特定文件的差异
git diff upstream/main..HEAD -- <文件路径>
```

## 最佳实践

1. **定期更新**：建议每月至少合并一次上游更新，避免积累过多冲突。

2. **提交前测试**：合并后务必测试应用功能，确保没有破坏性更改。

3. **记录定制化点**：在 `CUSTOMIZATION.md` 中记录所有定制化内容，便于后续维护。

4. **使用分支**：在合并前创建新分支，便于回滚和审查。

5. **关注上游动态**：关注上游仓库的 Issues 和 Pull Requests，了解重要变更。

## 相关资源

- [OpenCowork 官方仓库](https://github.com/Safphere/opencowork)
- [Git 合并文档](https://git-scm.com/docs/git-merge)
- [Git Rebase 文档](https://git-scm.com/docs/git-rebase)

## 更新日志

- 2026-01-23：创建初始版本
