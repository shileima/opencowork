---
name: 官方脚本标签与Fork维护策略
overview: 设计自动化脚本的官方标签机制，支持标记共享脚本；同时设计fork维护策略，确保能从上游opencowork持续获取更新而不破坏定制化功能。
todos:
  - id: "1"
    content: 创建 resources/skills/chrome-agent/ 目录和 official-scripts.json 清单文件
    status: completed
  - id: "2"
    content: 修改 ScriptStore.ts，添加官方脚本同步逻辑和 isOfficial 字段
    status: completed
  - id: "3"
    content: 修改 electron-builder.json5，在 extraResources 中添加 chrome-agent 目录
    status: completed
  - id: "4"
    content: 修改 CoworkView.tsx，在脚本列表中显示官方标签和区分操作权限
    status: completed
  - id: "5"
    content: 创建 docs/FORK_MAINTENANCE.md 文档，编写详细的fork维护指南
    status: completed
  - id: "6"
    content: 创建 CUSTOMIZATION.md，记录所有定制化点和文件清单
    status: completed
isProject: false
---

# 官方脚本标签与Fork维护策略设计方案

## 一、官方脚本标签机制

### 1. 设计目标

- **安装时共享**：用户安装客户端时，自动安装标记为"官方"的自动化脚本
- **用户脚本隔离**：用户自定义脚本存储在用户目录，不随应用更新覆盖
- **灵活扩展**：预留分离方案，支持未来更细粒度的脚本管理

### 2. 目录结构设计

```
resources/skills/chrome-agent/          # 内置官方脚本目录（打包在应用中）
├── official-scripts.json               # 官方脚本清单（标记哪些脚本是官方的）
├── login_xgpt.js                      # 官方脚本示例
└── [其他官方脚本].js

~/.opencowork/skills/chrome-agent/      # 用户脚本目录（用户级，不共享）
├── user_custom_script.js               # 用户自定义脚本
└── [其他用户脚本].js
```

### 3. 官方脚本清单文件设计

**文件路径**：`resources/skills/chrome-agent/official-scripts.json`

**格式**：

```json
{
  "version": "1.0.0",
  "officialScripts": [
    {
      "name": "login_xgpt",
      "file": "login_xgpt.js",
      "description": "登录XGPT自动化脚本",
      "version": "1.0.0"
    }
  ]
}
```

### 4. 脚本安装逻辑

**首次安装流程**：

1. 应用启动时，检查 `~/.opencowork/skills/chrome-agent/` 目录
2. 读取 `resources/skills/chrome-agent/official-scripts.json` 获取官方脚本列表
3. 将官方脚本从 `resources/skills/chrome-agent/` 复制到用户目录
4. 跳过已存在的脚本（保留用户修改）

**更新流程**：

1. 应用更新时，检查官方脚本清单
2. 新增的官方脚本自动复制到用户目录
3. 已存在的脚本不覆盖（保留用户自定义版本）
4. 删除的官方脚本从清单中移除，但用户目录中的文件保留

### 5. ScriptStore 改造

**修改文件**：`electron/config/ScriptStore.ts`

**新增功能**：

- `isOfficialScript(scriptName: string): boolean` - 判断脚本是否为官方脚本
- `syncOfficialScripts()` - 同步官方脚本到用户目录
- `getOfficialScripts()` - 获取官方脚本列表
- `Script` 接口新增 `isOfficial: boolean` 字段

**实现要点**：

- 官方脚本从 `resources/skills/chrome-agent/` 读取
- 用户脚本从 `~/.opencowork/skills/chrome-agent/` 读取
- 合并显示，但标记来源

### 6. UI 改造

**修改文件**：`src/components/CoworkView.tsx`

**新增功能**：

- 脚本列表中显示"官方"标签
- 官方脚本显示不同样式（如徽章）
- 区分官方脚本和用户脚本的操作权限（官方脚本可禁用但不可删除）

## 二、Fork维护策略

### 1. Git 仓库结构

**当前状态**：

- 上游仓库：`https://github.com/Safphere/opencowork.git`
- 本地分支：`master`（定制化分支）
- 上游分支：`main`（开源版本）

**推荐结构**：

```
origin (上游)     → https://github.com/Safphere/opencowork.git
upstream (别名)   → https://github.com/Safphere/opencowork.git
custom (定制分支) → master/main（你的定制版本）
```

### 2. 定制化文件识别

**需要隔离的定制化内容**：

- `electron-builder.json5` - 应用ID、产品名称、发布配置
- `resources/skills/chrome-agent/` - 官方自动化脚本
- `package.json` - 版本号、应用名称（可选）
- 其他定制化功能代码

**建议策略**：

- 使用 `.gitattributes` 标记定制化文件
- 创建 `CUSTOMIZATION.md` 记录所有定制化点
- 使用 Git 分支管理定制化内容

### 3. 更新合并流程

**标准更新流程**：

1. 确保当前分支是干净的（无未提交更改）
2. 添加上游仓库（如果还没有）：
   ```bash
   git remote add upstream https://github.com/Safphere/opencowork.git
   ```

3. 获取上游更新：
   ```bash
   git fetch upstream
   ```

4. 合并上游更新到定制分支：
   ```bash
   git checkout master
   git merge upstream/main
   ```

5. 解决冲突（重点保护定制化文件）
6. 测试验证
7. 提交合并结果

**冲突处理策略**：

- `electron-builder.json5`：保留定制版本，手动合并必要的上游更新
- `resources/skills/chrome-agent/`：保留定制版本，手动合并新增的官方脚本
- 其他文件：优先使用上游版本，除非有定制化需求

### 4. 文档要求

**创建文件**：`docs/FORK_MAINTENANCE.md`

**内容应包括**：

- Fork 维护概述
- Git 仓库配置步骤
- 更新合并操作指南
- 冲突处理策略
- 定制化文件清单
- 常见问题解答

## 三、实现方案

### 1. 官方脚本机制实现

**步骤1**：创建官方脚本目录和清单文件

- 创建 `resources/skills/chrome-agent/` 目录
- 创建 `official-scripts.json` 文件
- 添加示例官方脚本

**步骤2**：修改 ScriptStore

- 添加官方脚本同步逻辑
- 修改脚本扫描逻辑，区分官方和用户脚本
- 更新 Script 接口

**步骤3**：修改打包配置

- 在 `electron-builder.json5` 的 `extraResources` 中添加 `chrome-agent` 目录

**步骤4**：修改 UI

- 在脚本列表中显示官方标签
- 区分官方脚本和用户脚本的操作

### 2. Fork维护文档实现

**步骤1**：创建维护文档

- 创建 `docs/FORK_MAINTENANCE.md`
- 编写详细的维护指南

**步骤2**：创建定制化清单

- 创建 `CUSTOMIZATION.md`
- 记录所有定制化点和文件

**步骤3**：配置 Git 属性（可选）

- 创建 `.gitattributes`
- 标记定制化文件

## 四、技术细节

### 1. 官方脚本同步时机

- **首次启动**：应用启动时自动同步
- **应用更新**：检测到新版本时同步
- **手动触发**：可在设置中手动同步

### 2. 脚本冲突处理

- 官方脚本和用户脚本同名时，用户脚本优先
- 官方脚本更新时，不覆盖用户已修改的脚本
- 提供"恢复官方版本"功能

### 3. 性能考虑

- 脚本同步在后台进行，不阻塞应用启动
- 使用文件哈希比较，避免不必要的复制
- 缓存官方脚本清单，减少文件读取

## 五、未来扩展

### 1. 脚本版本管理

- 支持脚本版本号
- 支持脚本更新通知
- 支持脚本回滚

### 2. 脚本市场

- 在线脚本库
- 脚本评分和评论
- 一键安装脚本

### 3. 脚本权限管理

- 脚本执行权限控制
- 脚本签名验证
- 脚本沙箱隔离