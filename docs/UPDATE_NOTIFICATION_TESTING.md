# 更新通知功能测试指南

## 问题分析

Project 模式下没有触发更新弹框的原因：

1. **时序问题**: 更新检查在应用启动后 5 秒触发，但此时 ProjectView 组件可能还没有完全挂载
2. **事件监听**: 如果事件在组件挂载前发送，监听器无法接收到

## 解决方案

### 1. 主动检查更新

在 ProjectView 组件挂载时，主动调用一次更新检查：

```typescript
// 组件挂载时主动检查一次更新
window.ipcRenderer.invoke('resource:check-update').then((result: unknown) => {
    const updateInfo = result as { success: boolean; hasUpdate: boolean; currentVersion: string; latestVersion: string; updateSize?: number };
    console.log('[ProjectView] Manual update check result:', updateInfo);
    if (updateInfo && updateInfo.hasUpdate) {
        setResourceUpdateAvailable({
            currentVersion: updateInfo.currentVersion,
            latestVersion: updateInfo.latestVersion,
            updateSize: updateInfo.updateSize
        });
    }
}).catch((err: unknown) => {
    console.error('[ProjectView] Failed to check for updates:', err);
});
```

### 2. 事件监听

同时保留事件监听，以便接收后续的更新通知：

```typescript
const removeUpdateListener = window.ipcRenderer.on('resource:update-available', (_event, ...args) => {
    const updateInfo = args[0] as { currentVersion: string; latestVersion: string; updateSize?: number };
    console.log('[ProjectView] Resource update available:', updateInfo);
    setResourceUpdateAvailable({
        currentVersion: updateInfo.currentVersion,
        latestVersion: updateInfo.latestVersion,
        updateSize: updateInfo.updateSize
    });
});
```

## 测试步骤

### 1. 启动应用

```bash
npm run dev
```

### 2. 切换到 Project 模式

- 应用启动后，确保在 Project 模式下（默认就是 Project 模式）

### 3. 查看控制台日志

打开开发者工具（Cmd+Option+I 或 Ctrl+Shift+I），查看控制台：

```
[ProjectView] Component mounted, registering event listeners...
[ProjectView] Manual update check result: { hasUpdate: true, currentVersion: "0.0.42", latestVersion: "1.0.0", ... }
```

### 4. 验证弹框显示

- 如果有更新，应该在右上角看到橙色的更新通知弹框
- 弹框显示当前版本和最新版本
- 有"立即更新"和"稍后提醒"两个按钮

### 5. 测试更新流程

1. 点击"立即更新"按钮
2. 观察进度条显示
3. 等待更新完成
4. 选择是否重启应用

## 调试技巧

### 1. 查看后端日志

在终端中查看 Electron 主进程的日志：

```
[ResourceUpdater] Auto check triggered
[ResourceUpdater] Check result: hasUpdate=true, current=0.0.42, latest=1.0.0, files=47
[Main] Resource update found, notifying renderer...
```

### 2. 查看前端日志

在浏览器控制台中查看：

```
[ProjectView] Component mounted, registering event listeners...
[ProjectView] Manual update check result: {...}
[ProjectView] Resource update available: {...}
```

### 3. 手动触发更新检查

在浏览器控制台中手动触发：

```javascript
window.ipcRenderer.invoke('resource:check-update').then(console.log)
```

## 常见问题

### Q: 弹框没有显示

**A**: 检查以下几点：
1. 确保在 Project 模式下
2. 检查控制台是否有错误日志
3. 确认后端确实检测到了更新（查看终端日志）
4. 尝试手动触发更新检查

### Q: 更新检查失败

**A**: 可能的原因：
1. GitHub API 速率限制（每小时 60 次）
2. 网络连接问题
3. GitHub 仓库没有发布新版本

### Q: 更新下载失败

**A**: 检查：
1. 网络连接是否正常
2. GitHub Release 中是否有资源包
3. 查看详细错误日志

## 后续优化

1. **缓存更新状态**: 避免每次组件挂载都检查更新
2. **智能检查间隔**: 根据上次检查时间动态调整
3. **后台下载**: 允许用户在后台下载更新，不阻塞使用
4. **增量更新**: 只下载变化的文件，减少下载量
