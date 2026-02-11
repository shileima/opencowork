# 启动优化分析报告

## 📊 当前启动性能

从日志分析（开发模式）：

| 阶段 | 耗时 | 说明 |
|------|------|------|
| 窗口创建到 ready | ~50ms | 窗口显示 |
| did-finish-load 触发 | ~150ms | 页面加载完成 |
| AgentRuntime 初始化 | ~139ms | Skills + MCP 加载 |
| **总启动时间** | **~340ms** | ✅ 非常快 |

## ✅ 已优化项（本次改造）

1. **延迟初始化生效**
   - ✅ 窗口先显示 SplashScreen
   - ✅ AgentRuntime 在 `did-finish-load` 后异步初始化
   - ✅ 不阻塞主进程

2. **SkillManager 单例化**
   - ✅ 浮窗 agent 命中缓存：`Skills loaded recently (cache hit), skipping reload.`
   - ✅ 避免重复加载 63 个 skills 文件

3. **MCP 单例化**
   - ✅ MCPClientService 已是单例
   - ✅ 浮窗 agent 复用连接

## ⚠️ 待优化项

### 1. ConfigStore.setAll 重复调用 8 次（高优先级）

**问题**：
```log
[ConfigStore] setAll called with: [...] (第99-243行，重复8次)
```

**原因**：
- `SettingsView.tsx` 的 `useEffect` 监听 `config` 变化并自动保存
- 初始化时 `config` 被多次更新（可能来自多个组件或 IPC 事件）
- 每次更新都触发 500ms 防抖后的保存

**影响**：
- 不必要的磁盘 IO
- 配置文件被重复写入 8 次
- 虽然有防抖，但仍会触发多次 IPC 调用

**解决方案**：

#### 方案 A：优化初始化逻辑（推荐）
```typescript
// src/components/SettingsView.tsx
useEffect(() => {
    window.ipcRenderer.invoke('config:get-all').then((cfg) => {
        if (cfg) {
            const config = cfg as Config;
            const initializedProviders = { ...config.providers };
            
            if (!initializedProviders['custom']) {
                initializedProviders['custom'] = {
                    id: 'custom',
                    name: '自定义',
                    apiKey: '',
                    apiUrl: '',
                    model: '',
                    isCustom: true,
                    isPreset: false
                };
            }
            
            // 一次性设置完整配置，避免多次触发 useEffect
            const finalConfig = { ...config, providers: initializedProviders };
            setConfig(finalConfig);
            prevConfigRef.current = JSON.stringify(finalConfig); // 关键：立即更新 ref
        }
    }).finally(() => {
        setIsLoading(false);
    });
}, []);
```

#### 方案 B：增加初始化标志
```typescript
const [isInitialized, setIsInitialized] = useState(false);

// 自动保存 effect
useEffect(() => {
    if (!isInitialized) return; // 初始化期间不保存
    
    if (isFirstRender.current) {
        isFirstRender.current = false;
        return;
    }

    const timer = setTimeout(() => {
        saveConfig(config);
    }, 500);

    return () => clearTimeout(timer);
}, [config, isInitialized]);

// 初始化完成后设置标志
useEffect(() => {
    window.ipcRenderer.invoke('config:get-all').then((cfg) => {
        // ... 设置 config
        setIsInitialized(true); // 标记初始化完成
    });
}, []);
```

### 2. ResourceUpdater 并发检查（低优先级）

**问题**：
```log
[ResourceUpdater] getCurrentVersion: ... (重复4次)
```

**原因**：
- 多个组件并发调用 `getCurrentVersion()`
- 虽然有 `Check already in progress, skipping...` 保护，但仍有冗余调用

**影响**：
- 轻微性能开销
- 日志噪音

**解决方案**：
在 `DirectoryManager` 中缓存 `getCurrentVersion()` 结果：

```typescript
// electron/utils/DirectoryManager.ts
private cachedVersion: string | null = null;
private cacheTimestamp: number = 0;
private readonly CACHE_TTL = 5000; // 5秒缓存

getCurrentVersion(): string {
    const now = Date.now();
    if (this.cachedVersion && (now - this.cacheTimestamp) < this.CACHE_TTL) {
        return this.cachedVersion;
    }
    
    // ... 原有逻辑
    this.cachedVersion = version;
    this.cacheTimestamp = now;
    return version;
}
```

### 3. Skills 初始化日志冗长（极低优先级）

**问题**：
```log
[SkillManager] ⊙ Skipped existing skill: ... (71条，第313-383行)
```

**影响**：
- 日志文件体积大
- 开发时查找信息困难

**解决方案**：
```typescript
// electron/agent/skills/SkillManager.ts
// 只输出摘要，不逐个输出
console.log(`[SkillManager] ✅ Default skills initialization complete: ${installedCount} installed, ${skippedCount} skipped.`);
// 删除循环中的 console.log('⊙ Skipped existing skill: ...')
```

## 🎯 优化优先级

| 优先级 | 优化项 | 预期收益 | 实施难度 |
|--------|--------|----------|----------|
| 🔴 高 | 修复 ConfigStore 重复调用 | 减少 8 次磁盘 IO | 低 |
| 🟡 中 | 缓存 getCurrentVersion | 减少冗余计算 | 低 |
| 🟢 低 | 精简 Skills 日志 | 改善开发体验 | 极低 |

## 📈 性能对比（预期）

| 指标 | 优化前 | 优化后（预期） |
|------|--------|----------------|
| 启动时间 | ~340ms | ~340ms（无变化） |
| ConfigStore 调用次数 | 8次 | 1次 |
| 磁盘 IO 次数 | 8次 | 1次 |
| 日志行数 | ~670行 | ~600行 |

## 🎉 总结

**当前状态**：启动性能已经非常优秀（340ms），本次改造成功解决了白屏问题。

**建议**：
1. **立即修复**：ConfigStore 重复调用问题（高优先级，简单修复）
2. **可选优化**：ResourceUpdater 缓存、日志精简（低优先级，锦上添花）

**不建议**：
- ❌ 不要过度优化 Skills 加载（139ms 已经很快）
- ❌ 不要移除日志（对调试很有价值）
