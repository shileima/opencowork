# 退出时自动清理功能说明

## 功能简介

OpenCowork 现在支持在退出客户端时自动清理所有启动的资源。这意味着当你关闭应用时，系统会自动：

- 🌐 关闭所有浏览器标签页
- 💻 终止所有终端进程
- 🔧 清理所有子进程
- 🔌 释放所有占用的端口（包括 3000、5173、8080 等常用开发端口）

## 为什么需要这个功能？

在开发过程中，我们经常会遇到以下问题：

1. **端口被占用**：启动开发服务器后忘记关闭，下次启动时提示端口已被占用
2. **进程残留**：退出应用后，后台还有进程在运行，占用系统资源
3. **浏览器标签页**：打开了 localhost:3000 等本地服务，退出后标签页还在

现在，这些问题都会在退出应用时自动解决！

## 使用示例

### 示例 1：启动 React 开发服务器

```bash
# 在 OpenCowork 中通过 AI 助手启动开发服务器
用户: "启动开发服务器"
AI: 执行 npm run dev
# 服务器运行在 http://localhost:3000

# 在浏览器中预览
AI: 打开 http://localhost:3000

# 用户关闭 OpenCowork 应用
# ✅ 自动清理：
#   - 终止 npm run dev 进程
#   - 释放 3000 端口
#   - 关闭浏览器标签页
```

### 示例 2：多个服务同时运行

```bash
# 前端开发服务器
npm run dev          # 端口 3000

# 后端 API 服务器
npm run server       # 端口 8080

# 数据库服务
npm run db           # 端口 5432

# 用户关闭 OpenCowork 应用
# ✅ 自动清理所有服务和端口
```

### 示例 3：终端会话管理

```bash
# 打开多个终端
终端 1: npm run dev
终端 2: npm run test:watch
终端 3: npm run storybook

# 用户关闭 OpenCowork 应用
# ✅ 自动终止所有终端进程
```

## 清理的端口列表

系统会自动清理以下常用开发端口：

| 端口 | 用途 |
|------|------|
| 3000 | React、Next.js 默认端口 |
| 5173 | Vite 默认端口 |
| 8080 | 通用开发服务器端口 |
| 4200 | Angular 默认端口 |
| 8000 | Python/Django 常用端口 |

## 技术细节

### 清理流程

1. **浏览器清理** - 使用 `agent-browser close` 命令关闭所有浏览器会话
2. **终端清理** - 向所有终端进程发送 SIGKILL 信号
3. **子进程清理** - 终止所有通过 FileSystemTools 启动的子进程
4. **端口清理** - 查找并终止占用常用端口的所有进程
5. **资源清理** - 清理 Agent 和资源更新器

### 跨平台支持

- **macOS/Linux**：使用 `lsof` 和 `kill` 命令
- **Windows**：使用 `netstat` 和 `taskkill` 命令

### 安全性

- 所有清理操作都有超时保护（2-5 秒）
- 清理失败不会阻止应用退出
- 错误会被记录到日志中，方便排查问题

## 查看清理日志

退出应用时，可以在控制台看到清理日志：

```
[Main] Application is quitting, starting cleanup...
[Main] Closing browser sessions...
[Main] Browser session closed
[Main] Cleaning up terminal sessions...
[Main] Killing terminal process 1 (PID: 12345)
[Main] Terminal sessions cleaned up
[Main] Cleaning up child processes and ports...
[Main] Killing processes on port 3000: 12346
[Main] Child processes and ports cleaned up
[Main] Cleanup completed, application will now quit
```

## 测试方法

我们提供了一个测试脚本来验证清理功能：

```bash
# 运行测试脚本
./scripts/test-cleanup.sh

# 按照提示操作：
# 1. 脚本会启动一个测试服务器在 3000 端口
# 2. 启动 OpenCowork 应用
# 3. 在应用中打开 http://localhost:3000
# 4. 退出应用
# 5. 脚本会检查端口是否被释放
```

## 常见问题

### Q1: 如果清理失败会怎样？

A: 清理失败不会阻止应用退出。操作系统会在进程退出后自动回收资源。

### Q2: 我的自定义端口会被清理吗？

A: 如果是通过 OpenCowork 启动的服务，会被自动清理。系统还会额外清理常用的开发端口（3000、5173、8080 等）。

### Q3: 清理过程需要多长时间？

A: 通常在 1-3 秒内完成。每个清理操作都有超时保护，最长不超过 5 秒。

### Q4: 如何查看清理日志？

A: 在开发模式下，可以在终端看到清理日志。在生产模式下，日志会被写入应用日志文件。

### Q5: 可以禁用自动清理吗？

A: 目前不支持禁用。自动清理是为了确保系统资源被正确释放，避免端口占用等问题。

## 相关文件

- `electron/main.ts` - 应用退出事件处理
- `electron/agent/tools/FileSystemTools.ts` - 子进程和端口管理
- `scripts/test-cleanup.sh` - 测试脚本
- `docs/CLEANUP_ON_QUIT.md` - 英文文档
- `docs/CLEANUP_ON_QUIT_CN.md` - 本文档

## 反馈与建议

如果你在使用过程中遇到问题，或者有改进建议，欢迎提交 Issue 或 Pull Request。
