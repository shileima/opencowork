# 退出时自动清理功能

## 功能概述

当用户退出 OpenCowork 客户端时，系统会自动清理所有启动的资源，包括：

1. **浏览器会话** - 关闭所有通过 agent-browser 打开的浏览器标签页
2. **终端会话** - 终止所有活动的终端进程
3. **子进程** - 清理所有通过 FileSystemTools 启动的子进程
4. **端口占用** - 释放所有被占用的端口（特别是开发服务器端口）

## 实现细节

### 1. FileSystemTools 子进程跟踪

在 `electron/agent/tools/FileSystemTools.ts` 中：

- 添加了静态属性 `childProcesses` 和 `activePorts` 来跟踪所有启动的进程和端口
- 当启动开发服务器时，自动将进程和端口添加到跟踪列表
- 提供 `cleanupAll()` 静态方法来清理所有跟踪的资源

```typescript
private static childProcesses: Set<import('child_process').ChildProcess> = new Set();
private static activePorts: Set<number> = new Set();

public static async cleanupAll(): Promise<void> {
  // 清理所有子进程
  // 清理所有端口
}
```

### 2. 应用退出时的清理流程

在 `electron/main.ts` 的 `before-quit` 事件处理器中：

```typescript
app.on('before-quit', async () => {
  // 1. 关闭浏览器会话
  // 2. 清理终端会话
  // 3. 清理子进程和端口
  // 4. 清理 Agent 资源
  // 5. 停止资源更新器
})
```

### 3. 清理的端口列表

系统会自动清理以下常用开发端口：

- **3000** - React, Next.js 默认端口
- **5173** - Vite 默认端口
- **8080** - 常用开发服务器端口
- **4200** - Angular 默认端口
- **8000** - Python/Django 常用端口

### 4. 跨平台支持

清理逻辑支持不同操作系统：

- **macOS/Linux**: 使用 `lsof` 查找端口占用，使用 `kill -9` 终止进程
- **Windows**: 使用 `netstat` 查找端口占用，使用 `taskkill /F` 终止进程

## 使用场景

### 场景 1: 启动开发服务器后退出

```bash
# 用户通过 AI 助手启动开发服务器
npm run dev  # 启动在 localhost:3000

# 用户退出客户端
# ✅ 系统自动清理：
#   - 终止 npm run dev 进程
#   - 释放 3000 端口
#   - 关闭浏览器标签页（如果打开了 localhost:3000）
```

### 场景 2: 多个终端会话

```bash
# 用户打开多个终端
Terminal 1: npm run dev
Terminal 2: npm run test
Terminal 3: python manage.py runserver

# 用户退出客户端
# ✅ 系统自动清理所有终端进程
```

### 场景 3: 浏览器预览

```bash
# 用户启动开发服务器并在浏览器中预览
npm run dev
# AI 助手打开 http://localhost:3000

# 用户退出客户端
# ✅ 系统自动：
#   - 关闭浏览器会话
#   - 终止开发服务器
#   - 释放 3000 端口
```

## 技术实现

### 子进程管理

```typescript
// 启动开发服务器时
const child = spawn(command, [], { detached: true });

// 跟踪子进程
FileSystemTools.childProcesses.add(child);
FileSystemTools.activePorts.add(3000);

// 进程退出时自动移除
child.on('exit', () => {
  FileSystemTools.childProcesses.delete(child);
  FileSystemTools.activePorts.delete(3000);
});
```

### 端口清理

```typescript
// macOS/Linux
const { stdout } = await execAsync(`lsof -ti :${port}`);
const pids = stdout.trim().split(/\s+/);
for (const pid of pids) {
  await execAsync(`kill -9 ${pid}`);
}

// Windows
const { stdout } = await execAsync(`netstat -ano | findstr ":${port}"`);
// 解析 PID 并使用 taskkill 终止
```

### 浏览器清理

```typescript
// 使用 agent-browser 命令关闭浏览器
await execAsync('agent-browser close', {
  timeout: 5000,
  encoding: 'utf-8'
});
```

## 注意事项

1. **优雅关闭**: 系统会尝试优雅地关闭所有资源，但在必要时会使用强制终止（SIGKILL/taskkill /F）
2. **错误处理**: 清理过程中的错误不会阻止应用退出，只会记录警告日志
3. **超时保护**: 所有清理操作都有超时限制，避免应用退出被阻塞
4. **资源泄漏**: 如果清理失败，操作系统会在进程退出后自动回收资源

## 日志输出

退出时会看到以下日志：

```
[Main] Application is quitting, starting cleanup...
[Main] Closing browser sessions...
[Main] Browser session closed
[Main] Cleaning up terminal sessions...
[Main] Killing terminal process 1 (PID: 12345)
[Main] Terminal sessions cleaned up
[Main] Cleaning up child processes and ports...
[FileSystemTools] Cleaning up all child processes and ports...
[FileSystemTools] Killing child process 12346
[Main] Killing processes on port 3000: 12346
[Main] Child processes and ports cleaned up
[Main] Cleaning up agent resources...
[Main] Cleanup completed, application will now quit
```

## 测试建议

1. 启动开发服务器，然后退出应用，检查端口是否被释放
2. 打开多个终端会话，退出应用，检查所有终端进程是否被终止
3. 在浏览器中打开 localhost:3000，退出应用，检查浏览器是否关闭
4. 在 Windows/macOS/Linux 上分别测试，确保跨平台兼容性

## 相关文件

- `electron/main.ts` - 应用退出事件处理
- `electron/agent/tools/FileSystemTools.ts` - 子进程和端口管理
- `docs/CLEANUP_ON_QUIT.md` - 本文档
