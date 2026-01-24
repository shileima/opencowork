# 定制化清单

本文档记录本仓库相对于上游 [OpenCowork](https://github.com/Safphere/opencowork) 的所有定制化点和文件清单。

## 定制化概述

本仓库是基于 OpenCowork 的定制化版本，主要定制化内容包括：

1. **应用配置**：修改了应用ID、产品名称、发布配置
2. **官方脚本**：添加了官方自动化脚本支持
3. **其他功能**：根据需求添加的其他定制化功能

## 定制化文件清单

### 1. 应用配置

#### `electron-builder.json5`

**定制化内容**：
- `appId`: `com.qacowork.app`（定制化应用ID）
- `productName`: `测试助手`（定制化产品名称）
- `publish.owner`: `MrCatAI`（定制化发布配置）
- `publish.repo`: `opencowork`（定制化仓库名）

**处理策略**：保留定制版本，手动合并必要的上游更新（如新的打包配置选项）

**影响范围**：应用打包和发布

---

#### `package.json`

**定制化内容**：
- `version`: 可能修改了版本号
- `name`: 可能修改了包名

**处理策略**：保留定制版本，合并依赖更新

**影响范围**：包管理和版本控制

---

### 2. 官方脚本系统

#### `resources/skills/chrome-agent/`

**定制化内容**：
- `official-scripts.json`: 官方脚本清单文件
- `*.js`: 官方自动化脚本文件

**目录结构**：
```
resources/skills/chrome-agent/
├── official-scripts.json    # 官方脚本清单
├── login_xgpt.js           # 官方脚本示例
└── [其他官方脚本].js
```

**处理策略**：保留定制版本，手动合并新增的官方脚本（如果有）

**影响范围**：自动化脚本功能

---

#### `electron/config/ScriptStore.ts`

**定制化内容**：
- 添加了官方脚本同步逻辑
- 添加了 `isOfficial` 字段支持
- 添加了 `syncOfficialScripts()` 方法
- 添加了 `getOfficialScripts()` 方法
- 添加了 `isOfficialScript()` 方法
- 修改了 `deleteScript()` 方法，禁止删除官方脚本

**处理策略**：保留定制版本，合并上游的功能更新

**影响范围**：脚本管理功能

---

#### `electron/main.ts`

**定制化内容**：
- 在应用启动时调用 `scriptStore.syncOfficialScripts()`

**处理策略**：保留定制版本，合并上游的功能更新

**影响范围**：应用启动流程

---

#### `src/components/CoworkView.tsx`

**定制化内容**：
- 脚本列表中显示"官方"标签
- 官方脚本不显示删除按钮
- 更新了 `Script` 接口，添加 `isOfficial` 字段

**处理策略**：保留定制版本，合并上游的 UI 更新

**影响范围**：用户界面

---

### 3. 文档

#### `docs/FORK_MAINTENANCE.md`

**定制化内容**：Fork 维护指南文档

**处理策略**：保留定制版本（Fork 专用文档）

**影响范围**：文档

---

#### `CUSTOMIZATION.md`

**定制化内容**：本文件，定制化清单

**处理策略**：保留定制版本（Fork 专用文档）

**影响范围**：文档

---

## 定制化功能说明

### 官方脚本标签机制

**功能描述**：
- 支持标记某些自动化脚本为"官方"脚本
- 官方脚本在用户安装客户端时自动安装
- 官方脚本不允许用户删除
- 官方脚本和用户脚本合并显示，但标记来源

**实现文件**：
- `resources/skills/chrome-agent/official-scripts.json`
- `electron/config/ScriptStore.ts`
- `src/components/CoworkView.tsx`

**使用方式**：
1. 在 `resources/skills/chrome-agent/` 目录下添加脚本文件
2. 在 `official-scripts.json` 中注册脚本信息
3. 应用启动时自动同步到用户目录

---

## 合并上游更新时的注意事项

### 高优先级（必须手动处理）

1. **`electron-builder.json5`**
   - 检查是否有新的打包配置选项
   - 手动合并必要的上游更新
   - 保留定制化的应用ID和产品名称

2. **`resources/skills/chrome-agent/`**
   - 检查是否有新的官方脚本
   - 手动合并新增的脚本
   - 保留定制化的脚本清单

### 中优先级（需要审查）

1. **`electron/config/ScriptStore.ts`**
   - 检查上游是否有相关更新
   - 手动合并功能更新
   - 保留定制化的官方脚本逻辑

2. **`src/components/CoworkView.tsx`**
   - 检查上游是否有 UI 更新
   - 手动合并 UI 改进
   - 保留定制化的官方标签显示

### 低优先级（通常自动合并）

1. **依赖更新**（`package.json`）
   - 通常可以直接合并
   - 注意检查是否有破坏性更改

2. **源代码文件**
   - 通常优先使用上游版本
   - 检查是否有定制化的修改

---

## 版本对应关系

| 定制版本 | 基于上游版本 | 更新日期 | 主要变更 |
|---------|------------|---------|---------|
| 0.0.3 | - | 2026-01-23 | 添加官方脚本标签机制 |
| 0.0.4 | - | 2026-01-23 | 实现超级管理员权限系统、预设管理员机制、用户账户信息获取 |
| 0.0.5 | - | 2026-01-24 | 自动化脚本规范检查、Playwright 框架约束、预设管理员修复、Commit 规范 |

---

## 维护记录

### 2026-01-23

- 创建定制化清单文档
- 添加官方脚本标签机制
- 实现官方脚本同步功能
- 更新 UI 显示官方标签

---

## v0.0.5 (2026-01-24)

### 新增功能
- **自动化脚本规范检查**：添加自动化脚本规范验证机制
  - 检查脚本文件是否在正确的目录下（`~/.opencowork/skills/chrome-agent/`）
  - 检查文件扩展名是否为 `.js`
  - 检查文件权限
  - 自动刷新脚本列表（每5秒）
  - 手动刷新按钮和打开脚本文件夹按钮

- **Playwright 框架约束**：强制使用 Playwright 进行浏览器自动化
  - 禁止使用 Selenium 和 Puppeteer
  - 在执行脚本前检查脚本内容
  - 在安装包时检查是否安装禁止的框架
  - 提供详细的错误提示和修复建议

- **预设管理员角色切换**：修复预设管理员无法切换角色的问题
  - 添加 `isCurrentUserPresetAdmin()` 公共方法
  - 允许预设管理员切换为管理员角色
  - 解决循环依赖问题

- **Commit 规范**：添加项目 commit 规范文档
  - 创建 `.cursor/COMMIT_CONVENTION.md`
  - 创建 `.cursor/rules/COMMIT.md`
  - 规范 commit message 格式和类型

### 优化改进
- 优化自动化脚本检测逻辑，避免误判 Playwright 为 Puppeteer
- 改进错误提示信息，提供更清晰的修复建议
- 更新 `agent-browser` 技能文档，添加详细的规范说明和示例

### 文档更新
- 创建 `docs/AUTOMATION_SCRIPTS.md`：自动化脚本使用指南
- 更新 `agent-browser` 技能文档：添加 Playwright 约束说明

---

## 相关文档

- [Fork 维护指南](./docs/FORK_MAINTENANCE.md)
- [OpenCowork 官方文档](https://github.com/Safphere/opencowork)

---

## 注意事项

1. **定期更新**：建议每月至少合并一次上游更新
2. **测试验证**：合并后务必测试应用功能
3. **记录变更**：每次定制化更改都要更新本文档
4. **备份重要文件**：合并前备份定制化文件
