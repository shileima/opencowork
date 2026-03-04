# 退出清理功能 - 快速参考

## 🎯 功能概述

退出 OpenCowork 时自动清理所有资源，避免端口占用和进程残留。

## ✅ 清理内容

| 类型 | 说明 |
|------|------|
| 🌐 浏览器 | 关闭所有 agent-browser 会话 |
| 💻 终端 | 终止所有终端进程（PTY/普通进程） |
| 🔧 子进程 | 清理所有启动的子进程 |
| 🔌 端口 | 释放 3000, 5173, 8080, 4200, 8000 等端口 |

## 📝 使用示例

### 开发服务器

```bash
# 启动开发服务器
npm run dev  # 运行在 localhost:3000

# 退出应用
# ✅ 自动清理：进程、端口、浏览器标签页
```

### 多个服务

```bash
# 同时运行多个服务
npm run dev      # 3000
npm run server   # 8080
npm run db       # 5432

# 退出应用
# ✅ 自动清理所有服务
```

## 🧪 测试方法

```bash
# 运行测试脚本
./scripts/test-cleanup.sh

# 或手动测试
lsof -ti :3000  # macOS/Linux
netstat -ano | findstr ":3000"  # Windows
```

## 📊 清理日志

```
[Main] Application is quitting, starting cleanup...
[Main] Closing browser sessions...
[Main] Cleaning up terminal sessions...
[Main] Cleaning up child processes and ports...
[Main] Killing processes on port 3000: 12346
[Main] Cleanup completed, application will now quit
```

## 🔗 相关文档

- [详细文档（中文）](./CLEANUP_ON_QUIT_CN.md)
- [详细文档（英文）](./CLEANUP_ON_QUIT.md)
- [实现总结](../CLEANUP_IMPLEMENTATION.md)

## ⚙️ 技术细节

- **超时保护**：每个操作 2-5 秒超时
- **错误容错**：清理失败不阻止退出
- **跨平台**：支持 macOS/Linux/Windows
- **自动跟踪**：启动时自动注册，退出时自动注销

## 💡 提示

1. 清理过程通常在 1-3 秒内完成
2. 失败的清理操作会记录到日志
3. 操作系统会在进程退出后回收残留资源
4. 开发模式下可在终端查看详细日志
