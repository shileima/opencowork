# 目录结构说明文档

本文档详细说明 OpenCowork 应用的目录结构、用途和管理方式。

## 目录概览

OpenCowork 使用统一的目录管理系统（`DirectoryManager`）来管理所有目录路径。所有目录路径都通过 `DirectoryManager` 获取，确保一致性和可维护性。

## 目录分类

### 1. 客户端运行目录（~/.qa-cowork/）

**路径**：`~/.qa-cowork/`（macOS/Linux）或 `%USERPROFILE%\.qa-cowork\`（Windows）

**用途**：存储应用配置、用户数据和用户自定义内容

**特点**：
- 用户级目录，每个用户独立
- 应用首次启动时自动创建
- 不随应用更新而覆盖用户数据
- 可以导出/导入分享

**子目录结构**：

```
~/.qa-cowork/
├── config/                    # 配置目录（electron-store 自动管理）
│   ├── qa-cowork-config.json    # 应用配置（API Keys、模型选择等）
│   ├── qa-cowork-sessions.json   # 会话历史
│   └── qa-cowork-scripts.json    # 脚本索引
├── skills/                    # 用户技能目录
│   ├── chrome-agent/          # 自动化脚本目录
│   │   ├── login_xgpt.js     # 用户脚本
│   │   └── ...
│   └── [user-custom-skills]/  # 其他用户自定义技能
├── mcp/                       # MCP 配置目录
│   ├── mcp.json               # MCP 服务器配置（用户级）
│   └── mcp_storage.json       # MCP 存储数据（用户级）
├── cache/                     # 缓存目录（可清理）
│   └── ...
└── logs/                      # 日志目录
    └── ...
```

### 2. 内置资源目录（resources/）

**路径**：开发环境为 `项目根目录/resources/`，生产环境为 `process.resourcesPath/resources/`

**用途**：存储应用内置的资源文件

**特点**：
- 随应用打包分发
- 所有用户共享
- 首次运行时复制到用户目录
- 更新应用时自动更新

**子目录结构**：

```
resources/
├── skills/                    # 内置技能目录
│   ├── chrome-agent/          # 官方自动化脚本
│   │   ├── official-scripts.json  # 官方脚本清单
│   │   ├── login_xgpt.js     # 官方脚本示例
│   │   └── ...
│   └── [builtin-skills]/      # 其他内置技能
└── mcp/                       # 内置 MCP 配置
    └── builtin-mcp.json       # 内置 MCP 服务器配置模板
```

### 3. 工作目录（用户选择）

**路径**：用户在协作模式下选择的项目工作目录

**用途**：存储项目文件和 AI 生成的代码

**特点**：
- 用户主动选择，可多个
- 需要授权才能访问
- AI 可以直接在此目录内进行文件操作
- 支持信任级别设置（strict/standard/trust）

**示例**：`/Users/shilei/projects/my-app`

## 目录管理 API

### DirectoryManager 方法

所有目录路径都通过 `DirectoryManager` 获取：

```typescript
import { directoryManager } from './config/DirectoryManager';

// 获取基础目录
const baseDir = directoryManager.getBaseDir(); // ~/.qa-cowork/

// 获取配置目录
const configDir = directoryManager.getConfigDir(); // ~/.qa-cowork/config/

// 获取技能目录
const skillsDir = directoryManager.getSkillsDir(); // ~/.qa-cowork/skills/

// 获取脚本目录
const scriptsDir = directoryManager.getScriptsDir(); // ~/.qa-cowork/skills/chrome-agent/

// 获取 MCP 目录
const mcpDir = directoryManager.getMcpDir(); // ~/.qa-cowork/mcp/

// 获取缓存目录
const cacheDir = directoryManager.getCacheDir(); // ~/.qa-cowork/cache/

// 获取日志目录
const logsDir = directoryManager.getLogsDir(); // ~/.qa-cowork/logs/

// 获取内置资源目录
const builtinResourcesDir = directoryManager.getBuiltinResourcesDir();
const builtinSkillsDir = directoryManager.getBuiltinSkillsDir();
const builtinMcpDir = directoryManager.getBuiltinMcpDir();

// 获取特定文件路径
const userMcpConfigPath = directoryManager.getUserMcpConfigPath(); // ~/.qa-cowork/mcp/mcp.json
const builtinMcpConfigPath = directoryManager.getBuiltinMcpConfigPath(); // resources/mcp/builtin-mcp.json

// 获取所有路径（用于 UI 显示）
const allPaths = directoryManager.getAllPaths();
```

### 初始化

应用启动时自动初始化所有目录：

```typescript
// 在 main.ts 中
app.whenReady().then(() => {
  // 1. Initialize directory structure FIRST
  directoryManager.initialize();
  // ...
});
```

## 目录用途详解

### config/ 目录

**存储内容**：
- 应用配置（API Keys、模型选择、快捷键等）
- 会话历史
- 脚本索引

**管理方式**：通过 `electron-store` 自动管理，无需手动创建文件

**文件说明**：
- `qa-cowork-config.json`：应用配置，由 `ConfigStore` 管理
- `qa-cowork-sessions.json`：会话历史，由 `SessionStore` 管理
- `qa-cowork-scripts.json`：脚本索引，由 `ScriptStore` 管理

### skills/ 目录

**存储内容**：
- 用户自定义技能
- 自动化脚本（chrome-agent）

**管理方式**：
- 内置技能首次运行时从 `resources/skills/` 复制到 `~/.qa-cowork/skills/`
- 用户自定义技能直接创建在此目录
- 更新应用时，新增的内置技能会自动添加，但不会覆盖用户修改的技能

**chrome-agent/ 子目录**：
- 存储自动化脚本（.js 文件）
- 官方脚本从 `resources/skills/chrome-agent/` 同步
- 用户脚本直接创建在此目录

### mcp/ 目录

**存储内容**：
- MCP 服务器配置
- MCP 存储数据

**管理方式**：
- 首次运行时从 `resources/mcp/builtin-mcp.json` 创建 `mcp.json`
- 用户可以通过 UI 添加、删除、启用/禁用 MCP 服务器
- 配置更新时，内置服务器配置会更新，但用户禁用的服务器会被保留

### cache/ 目录

**存储内容**：应用缓存数据

**特点**：可以安全删除，应用会重新生成

### logs/ 目录

**存储内容**：应用日志文件

**特点**：用于调试和问题排查

## 迁移和兼容性

### 现有数据迁移

如果从旧版本升级，DirectoryManager 会自动处理：

1. **目录创建**：首次运行时自动创建所有必要的目录
2. **配置迁移**：`ConfigStore` 会自动迁移旧格式的配置
3. **向后兼容**：保持与旧版本的兼容性

### 版本升级

- **内置技能**：更新应用时，新增的技能会自动添加到用户目录
- **用户数据**：用户自定义的技能、配置、会话历史保持不变
- **配置格式**：自动迁移到新格式，保持向后兼容

## 安全考虑

### 工作目录权限

- 用户主动授权，支持多个授权目录
- 支持信任级别设置（strict/standard/trust）
- 写入已授权目录根据信任级别决定是否需要确认

### 客户端目录权限

- 应用自动创建和管理
- 用户可以直接访问
- 支持手动修改配置

### 敏感信息

- API Keys 等敏感信息存储在 `config/` 目录
- 会话历史包含敏感信息，不共享
- 建议定期备份重要数据

## 最佳实践

1. **不要手动修改目录结构**：让应用自动管理
2. **定期备份**：备份 `~/.qa-cowork/` 目录以保留配置和会话历史
3. **清理缓存**：可以定期清理 `cache/` 目录释放空间
4. **导出配置**：重要配置可以导出备份
5. **使用 DirectoryManager**：所有目录路径都通过 `DirectoryManager` 获取，不要硬编码路径

## 常见问题

### Q: 如何重置应用配置？

A: 删除 `~/.qa-cowork/config/` 目录，应用会重新创建默认配置。

### Q: 如何备份用户数据？

A: 备份整个 `~/.qa-cowork/` 目录即可。

### Q: 如何迁移到新电脑？

A: 将 `~/.qa-cowork/` 目录复制到新电脑的相同位置即可。

### Q: 内置技能在哪里？

A: 内置技能在 `resources/skills/` 目录，首次运行时复制到 `~/.qa-cowork/skills/`。

### Q: 如何查看所有目录路径？

A: 在设置界面的"目录管理"tab 中查看所有目录路径。

## 相关文档

- [Fork 维护指南](./FORK_MAINTENANCE.md)
- [定制化清单](../CUSTOMIZATION.md)
- [开发指南](./development_cn.md)
