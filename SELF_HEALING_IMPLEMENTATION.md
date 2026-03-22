# 代码自愈系统 - 实施指南

## 已完成的工作

### ✅ 核心模块实现 (100%)

1. **类型定义** (`electron/selfHealing/types.ts`)
   - 完整的类型系统
   - 10+ 个接口和枚举
   - 涵盖所有核心概念

2. **错误检测器** (`electron/selfHealing/ErrorDetector.ts`)
   - 支持多种错误格式解析
   - TypeScript、ESLint、Vite 错误
   - 语法错误、模块错误、依赖错误
   - 批量错误检测

3. **错误分析器** (`electron/selfHealing/ErrorAnalyzer.ts`)
   - 错误类型分类
   - 可修复性判断
   - 置信度计算
   - 代码上下文提取
   - 依赖分析

4. **自动修复器** (`electron/selfHealing/AutoFixer.ts`)
   - Agent 集成
   - 提示词生成
   - 响应解析
   - 文件备份/恢复
   - 修复应用

5. **重试管理器** (`electron/selfHealing/RetryManager.ts`)
   - 重试次数管理
   - 指数退避
   - 重复错误检测
   - 状态追踪

6. **自愈协调器** (`electron/selfHealing/SelfHealingCoordinator.ts`)
   - 整体流程协调
   - 进度报告
   - 批量修复
   - 干运行模式

7. **AgentRuntime 扩展** (`electron/selfHealing/AgentRuntimeExtension.ts`)
   - 添加自愈方法
   - 静默修复支持

8. **集成示例** (`electron/selfHealing/integration-example.ts`)
   - 部署流程集成
   - 预览流程集成
   - 完整示例代码

## 下一步: 集成到实际流程

### 步骤 1: 扩展 AgentRuntime

在 `electron/agent/AgentRuntime.ts` 中添加方法:

```typescript
import { extendAgentRuntimeForHealing } from '../selfHealing/AgentRuntimeExtension';

// 在构造函数的末尾添加:
constructor(...) {
  // ... 现有代码 ...

  // 添加自愈支持
  extendAgentRuntimeForHealing(this);
}
```

### 步骤 2: 修改部署流程

在 `electron/main.ts` 中修改 `ipcMain.handle('deploy:start')`:

```typescript
import { SelfHealingCoordinator } from './selfHealing/SelfHealingCoordinator';
import { HealingOptions } from './selfHealing/types';

ipcMain.handle('deploy:start', async (event, projectPath: string) => {
  const sender = event.sender;
  const coordinator = new SelfHealingCoordinator();

  // 定义构建操作
  const buildOperation = async () => {
    // 将现有的构建逻辑包装为函数
    const result = await runBuildWithNode();
    return {
      success: result,
      exitCode: result ? 0 : 1,
      output: allOutput // 需要从外部作用域访问
    };
  };

  // Agent 回调
  const agentCallback = async (prompt: string) => {
    // 获取 mainAgent 实例
    return await mainAgent.sendMessageForHealing(prompt);
  };

  // 配置选项
  const options: HealingOptions = {
    operation: 'deploy',
    projectPath,
    maxRetries: 3,
    autoMode: true,
    onProgress: (message, phase) => {
      sender.send('deploy:log', `[自愈] ${message}\n`);
    }
  };

  // 执行带自愈的部署
  const result = await coordinator.executeWithHealing(
    buildOperation,
    options,
    agentCallback
  );

  if (!result.success) {
    updateDeployTaskStatus('failed', sender);
    sender.send('deploy:error', result.finalMessage);
    return { success: false, error: result.finalMessage };
  }

  // 继续原有的上传逻辑...
});
```

### 步骤 3: 添加前端反馈

在 `src/components/ProjectView.tsx` 中添加自愈进度显示:

```typescript
useEffect(() => {
  // 监听自愈进度
  const removeHealingProgress = window.ipcRenderer.on(
    'deploy:healing:progress',
    (_event, data: { message: string; phase: HealingPhase }) => {
      // 显示自愈进度
      setHealingMessage(data.message);
      setHealingPhase(data.phase);
    }
  );

  return () => {
    removeHealingProgress();
  };
}, []);
```

## 测试计划

### 测试场景 1: 语法错误

**创建测试文件** (`test-syntax-error.tsx`):
```typescript
import React from 'react';

export function TestComponent() {
  return (
    <div>
      <h1>Hello</h1>
      // 语法错误: 缺少闭合标签
      <p>Test
    </div>
  );
}
```

**预期行为**:
1. 检测到语法错误
2. 自动修复闭合标签
3. 重新编译成功

### 测试场景 2: 类型错误

**创建测试文件** (`test-type-error.ts`):
```typescript
interface User {
  name: string;
  age: number;
}

const user: User = {
  name: 'John',
  // 类型错误: age 应该是 number
  age: '25'
};
```

**预期行为**:
1. 检测到类型错误
2. 自动修复为 `age: 25`
3. 重新编译成功

### 测试场景 3: 模块未找到

**创建测试文件** (`test-missing-module.ts`):
```typescript
// 错误: lodash 未安装
import { debounce } from 'lodash';

export const debouncedFn = debounce(() => {
  console.log('Hello');
}, 1000);
```

**预期行为**:
1. 检测到模块未找到
2. 自动安装 lodash
3. 重新编译成功

### 测试场景 4: 重复错误

**创建测试文件** (故意创建无法修复的错误):
```typescript
// 这个错误可能需要人工介入
import { nonExistentFunction } from './non-existent-file';
```

**预期行为**:
1. 尝试修复
2. 第一次失败
3. 检测到重复错误
4. 停止重试,提示用户

### 测试脚本

```bash
#!/bin/bash
# test-self-healing.sh

echo "=== 测试代码自愈系统 ==="

# 测试 1: 语法错误
echo "\n测试 1: 语法错误"
cp test-cases/test-syntax-error.tsx src/
npm run build
# 检查是否自动修复

# 测试 2: 类型错误
echo "\n测试 2: 类型错误"
cp test-cases/test-type-error.ts src/
npm run build
# 检查是否自动修复

# 测试 3: 模块未找到
echo "\n测试 3: 模块未找到"
cp test-cases/test-missing-module.ts src/
npm run build
# 检查是否自动安装依赖

echo "\n=== 测试完成 ==="
```

## 性能指标

### 目标指标

| 指标 | 目标值 |
|------|--------|
| 错误检测时间 | < 100ms |
| 错误分析时间 | < 200ms |
| 修复生成时间 | < 5s (Agent调用) |
| 单次重试延迟 | 2-4s (指数退避) |
| 总修复时间 | < 30s (3次重试内) |

### 成功率目标

| 错误类型 | 目标成功率 |
|---------|-----------|
| 语法错误 | > 80% |
| 类型错误 | > 70% |
| 模块未找到 | > 90% |
| 依赖错误 | > 60% |
| 构建错误 | > 50% |

## 配置选项

在 `electron/config/ConfigStore.ts` 中添加:

```typescript
interface SelfHealingConfig {
  enabled: boolean;           // 是否启用自愈
  autoMode: boolean;          // 自动模式 vs 手动确认
  maxRetries: number;         // 最大重试次数
  retryDelay: number;         // 重试延迟(毫秒)
  exponentialBackoff: boolean; // 是否使用指数退避
  notifyOnFix: boolean;       // 修复成功后是否通知
  backupBeforeFix: boolean;   // 修复前是否备份
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// 默认配置
const defaultSelfHealingConfig: SelfHealingConfig = {
  enabled: true,
  autoMode: true,
  maxRetries: 3,
  retryDelay: 2000,
  exponentialBackoff: true,
  notifyOnFix: true,
  backupBeforeFix: true,
  logLevel: 'info'
};
```

## 用户界面改进

### 1. 自愈进度指示器

在部署/预览过程中显示:
```
🔧 检测到错误,正在自动修复... (85% 置信度)
   ├─ 问题: 语法错误 at App.tsx:45
   ├─ 正在生成修复方案...
   ├─ ✅ 已修复 1 个文件
   └─ 🔄 2 秒后重新编译...
```

### 2. 修复历史记录

在设置中显示:
```
最近修复记录:
1. 2026-03-22 14:30 - 语法错误 (App.tsx) ✅
2. 2026-03-22 14:25 - 类型错误 (utils.ts) ✅
3. 2026-03-22 14:20 - 模块未找到 (lodash) ✅
```

### 3. 配置面板

```
[ ] 启用代码自愈
    [ ] 自动修复 (不询问)
    [3] 最大重试次数
    [2s] 重试延迟
    [ ] 指数退避
    [ ] 修复前备份文件
```

## 监控和日志

### 日志文件

位置: `~/.qa-cowork/logs/self-healing.log`

格式:
```
[2026-03-22 14:30:15] [DETECT] Syntax error detected in App.tsx:45
[2026-03-22 14:30:16] [ANALYZE] Confidence: 0.85, Fixable: true
[2026-03-22 14:30:18] [FIX] Applying fix to App.tsx
[2026-03-22 14:30:19] [RETRY] Retrying build (attempt 1/3)
[2026-03-22 14:30:25] [SUCCESS] Build succeeded after 1 retry
```

### 统计数据

```typescript
interface HealingStats {
  totalAttempts: number;
  successfulFixes: number;
  failedFixes: number;
  averageFixTime: number;
  errorTypeDistribution: Record<ErrorType, number>;
  successRateByType: Record<ErrorType, number>;
}
```

## 安全考虑

1. **代码备份**: 所有修复前自动备份 (`.backup` 文件)
2. **修复验证**: 修复后检查语法正确性
3. **回滚机制**: 修复失败自动回滚
4. **审计日志**: 记录所有修复操作
5. **权限检查**: 确保有文件写入权限
6. **沙盒执行**: 修复操作在隔离环境中验证

## 限制和已知问题

### 当前限制

1. **不支持**:
   - 复杂的业务逻辑错误
   - 架构级别的问题
   - 需要外部配置的问题
   - 多文件间的复杂依赖

2. **最大重试次数**: 3 次
   - 防止无限循环
   - 超过后需要手动介入

3. **超时限制**: 5 分钟
   - 防止长时间阻塞

### 已知问题

1. Agent 响应解析可能不完美
   - 需要改进提示词
   - 需要更强的响应验证

2. 依赖安装未完全实现
   - 需要集成包管理器

3. 多文件修复支持有限
   - 当前主要处理单文件错误

## 后续改进计划

### Phase 1: 完善核心功能 (本周)
- [x] 完成核心模块
- [ ] 集成到部署流程
- [ ] 集成到预览流程
- [ ] 基础测试

### Phase 2: 增强功能 (下周)
- [ ] 实现依赖自动安装
- [ ] 改进错误检测精度
- [ ] 添加更多错误类型支持
- [ ] 优化 Agent 提示词

### Phase 3: 用户体验 (下下周)
- [ ] 添加 UI 反馈
- [ ] 实现配置面板
- [ ] 添加修复历史
- [ ] 改进进度显示

### Phase 4: 高级特性 (未来)
- [ ] 多文件批量修复
- [ ] 智能学习用户偏好
- [ ] 修复模式推荐
- [ ] 团队共享修复方案

## 总结

代码自愈系统的核心架构已经完成,包括:
- ✅ 完整的类型系统
- ✅ 错误检测和分析
- ✅ 自动修复逻辑
- ✅ 重试管理
- ✅ 流程协调

下一步需要:
1. 集成到实际的部署和预览流程
2. 进行充分测试
3. 完善用户界面反馈
4. 优化修复成功率

预计完成集成和测试后,可以显著提升开发体验,减少手动修复代码的时间!
