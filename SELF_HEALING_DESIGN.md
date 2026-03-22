# 代码自愈系统设计文档

## 概述

本文档描述了项目模式下预览/部署过程中的代码自动修复(Self-Healing)系统设计。

## 目标

当预览或部署过程中遇到代码错误时:
1. **自动捕获**错误信息
2. **智能分析**错误类型和根因
3. **自动修复**代码问题
4. **自动重试**预览/部署操作
5. **用户反馈**修复过程和结果

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                         用户操作                              │
│                   (点击预览/部署按钮)                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    执行预览/部署                              │
│              (编译/构建/上传代码)                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                 成功? ──┤
                         │
              ┌──────────┴──────────┐
              │ NO                  │ YES
              ▼                     ▼
    ┌──────────────────┐     ┌─────────────┐
    │   错误捕获模块    │     │   完成操作   │
    │ Error Detector   │     └─────────────┘
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │   错误分析模块    │
    │ Error Analyzer   │
    │  - 提取错误信息   │
    │  - 识别错误类型   │
    │  - 定位错误文件   │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │  自动修复模块     │
    │  Auto Fixer      │
    │  - 调用 Agent    │
    │  - 生成修复方案   │
    │  - 应用代码修改   │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │   重试管理模块    │
    │  Retry Manager   │
    │  - 重试计数      │
    │  - 重试策略      │
    │  - 状态管理      │
    └────────┬─────────┘
             │
      达到最大重试次数?
             │
      ┌──────┴──────┐
      │ YES         │ NO
      ▼             ▼
┌──────────┐  ┌────────────┐
│ 失败通知  │  │  重新执行   │
└──────────┘  └─────┬──────┘
                    │
                    └──────> (循环回到执行预览/部署)
```

## 核心模块设计

### 1. 错误检测器 (Error Detector)

**文件**: `electron/selfHealing/ErrorDetector.ts`

**职责**:
- 监听构建/部署进程的输出
- 识别错误信号(非零退出码、错误关键词)
- 收集完整的错误日志

**接口**:
```typescript
interface BuildError {
  type: ErrorType;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  stack?: string;
  fullLog: string;
  timestamp: number;
}

enum ErrorType {
  SYNTAX_ERROR = 'syntax',
  TYPE_ERROR = 'type',
  MODULE_NOT_FOUND = 'module',
  DEPENDENCY_ERROR = 'dependency',
  RUNTIME_ERROR = 'runtime',
  BUILD_ERROR = 'build',
  UNKNOWN = 'unknown'
}

class ErrorDetector {
  detectError(output: string, exitCode: number): BuildError | null;
  parseErrorMessage(message: string): ParsedError;
}
```

### 2. 错误分析器 (Error Analyzer)

**文件**: `electron/selfHealing/ErrorAnalyzer.ts`

**职责**:
- 分析错误类型
- 提取关键信息(文件路径、行号、错误描述)
- 判断是否可自动修复

**接口**:
```typescript
interface ErrorAnalysis {
  isFixable: boolean;
  errorType: ErrorType;
  affectedFiles: string[];
  suggestion: string;
  confidence: number; // 0-1, 修复成功的置信度
}

class ErrorAnalyzer {
  analyze(error: BuildError): ErrorAnalysis;
  extractFileAndLine(error: BuildError): { file: string; line: number } | null;
  categorizeError(message: string): ErrorType;
}
```

### 3. 自动修复器 (Auto Fixer)

**文件**: `electron/selfHealing/AutoFixer.ts`

**职责**:
- 根据错误分析生成修复提示
- 调用 Agent 执行代码修复
- 验证修复结果

**接口**:
```typescript
interface FixResult {
  success: boolean;
  changes: FileChange[];
  message: string;
}

interface FileChange {
  file: string;
  before: string;
  after: string;
}

class AutoFixer {
  async fix(
    error: BuildError,
    analysis: ErrorAnalysis,
    projectPath: string
  ): Promise<FixResult>;

  async callAgent(
    prompt: string,
    context: FixContext
  ): Promise<string>;

  async applyFix(
    projectPath: string,
    changes: FileChange[]
  ): Promise<boolean>;
}
```

### 4. 重试管理器 (Retry Manager)

**文件**: `electron/selfHealing/RetryManager.ts`

**职责**:
- 管理重试次数
- 决定是否继续重试
- 记录修复历史

**接口**:
```typescript
interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  exponentialBackoff: boolean;
}

interface RetryState {
  attempt: number;
  errors: BuildError[];
  fixes: FixResult[];
  startTime: number;
}

class RetryManager {
  constructor(config: RetryConfig);

  shouldRetry(state: RetryState): boolean;
  getNextDelay(attempt: number): number;
  recordAttempt(error: BuildError, fix: FixResult): void;
  reset(): void;
}
```

### 5. 自愈协调器 (Self Healing Coordinator)

**文件**: `electron/selfHealing/SelfHealingCoordinator.ts`

**职责**:
- 协调各模块工作
- 提供统一的自愈入口
- 管理自愈流程

**接口**:
```typescript
interface HealingOptions {
  operation: 'preview' | 'deploy';
  projectPath: string;
  maxRetries?: number;
  onProgress?: (message: string) => void;
}

interface HealingResult {
  success: boolean;
  attempts: number;
  errors: BuildError[];
  fixes: FixResult[];
  finalMessage: string;
}

class SelfHealingCoordinator {
  async heal(
    error: BuildError,
    options: HealingOptions
  ): Promise<HealingResult>;

  async executeWithHealing(
    operation: () => Promise<void>,
    options: HealingOptions
  ): Promise<HealingResult>;
}
```

## 错误类型和修复策略

### 1. 语法错误 (Syntax Error)

**示例**:
```
SyntaxError: Unexpected token '}'
at Module._compile (internal/modules/cjs/loader.js:723:23)
```

**修复策略**:
- 提取错误文件和行号
- 读取相关代码上下文
- 让 Agent 分析并修复语法问题

### 2. 类型错误 (Type Error)

**示例**:
```
error TS2339: Property 'foo' does not exist on type 'Bar'
```

**修复策略**:
- 提取类型错误信息
- 分析类型定义
- 让 Agent 修复类型注解或接口定义

### 3. 模块未找到 (Module Not Found)

**示例**:
```
Cannot find module 'react' or its corresponding type declarations
```

**修复策略**:
- 检查 package.json
- 尝试安装缺失的依赖
- 修复 import 语句

### 4. 依赖错误 (Dependency Error)

**示例**:
```
npm ERR! peer dep missing: react@^18.0.0
```

**修复策略**:
- 分析依赖冲突
- 更新 package.json
- 重新安装依赖

### 5. 构建错误 (Build Error)

**示例**:
```
Build failed with 3 errors:
src/App.tsx:45:10: ERROR: Expected ")" but found "{"
```

**修复策略**:
- 提取所有错误位置
- 批量修复代码问题
- 重新构建验证

## Agent 提示词设计

### 修复提示词模板

```typescript
const FIX_PROMPT_TEMPLATE = `你是一个代码修复专家。项目在{operation}过程中遇到错误,请分析并修复。

**错误信息**:
\`\`\`
{errorMessage}
\`\`\`

**错误类型**: {errorType}

**受影响的文件**: {affectedFiles}

**相关代码**:
\`\`\`{language}
{codeContext}
\`\`\`

**任务**:
1. 分析错误的根本原因
2. 提供具体的修复方案
3. 生成修复后的代码
4. 解释修复的理由

**要求**:
- 只修复错误,不要添加额外功能
- 保持代码风格一致
- 确保修复后代码可以正常编译
- 如果需要安装依赖,明确说明

请按以下格式回复:

## 问题分析
[分析错误原因]

## 修复方案
[说明如何修复]

## 修复代码
\`\`\`{language}
[修复后的完整代码]
\`\`\`

## 额外步骤
[如果需要安装依赖或其他操作,在此说明]
`;
```

## 用户交互流程

### 自动模式 (默认)

```
用户点击预览
  ↓
执行预览
  ↓
遇到错误
  ↓
显示: "🔧 检测到错误,正在自动修复..."
  ↓
AI 分析并修复代码
  ↓
显示: "✅ 已自动修复 1 个问题,重新预览中..."
  ↓
重新执行预览
  ↓
成功 OR 继续修复 (最多3次)
```

### 手动确认模式 (可选)

```
用户点击预览
  ↓
遇到错误
  ↓
显示错误信息和修复建议
  ↓
询问: "是否自动修复此问题?"
  [确认] [取消]
  ↓
用户确认后执行修复
```

## 配置选项

在 `electron/config/ConfigStore.ts` 中添加自愈配置:

```typescript
interface SelfHealingConfig {
  enabled: boolean;
  autoMode: boolean; // true: 自动修复, false: 询问用户
  maxRetries: number;
  retryDelay: number;
  exponentialBackoff: boolean;
  notifyOnFix: boolean; // 修复成功后是否通知用户
}
```

## 安全性考虑

1. **代码备份**: 修复前自动备份原文件
2. **修复验证**: 修复后检查语法正确性
3. **回滚机制**: 如果修复失败,自动回滚
4. **修复审计**: 记录所有修复操作,可供审查
5. **权限检查**: 确保有文件写入权限

## 性能优化

1. **增量分析**: 只分析错误相关的文件
2. **缓存修复**: 相同错误使用缓存的修复方案
3. **并行处理**: 多个独立错误并行修复
4. **智能重试**: 根据错误类型调整重试策略

## 监控和日志

记录以下信息用于改进:
- 错误类型分布
- 修复成功率
- 平均修复时间
- 常见错误模式

日志文件位置: `~/.qa-cowork/logs/self-healing.log`

## 限制和边界

**自动修复的范围**:
- ✅ 语法错误
- ✅ 简单的类型错误
- ✅ 缺失的导入
- ✅ 简单的依赖问题
- ❌ 复杂的业务逻辑错误
- ❌ 架构级别的问题
- ❌ 需要外部配置的问题

**最大重试次数**: 3次
- 防止无限循环
- 超过3次后提示用户手动介入

## 实施计划

### Phase 1: 基础设施 (已完成)
- [x] 设计系统架构
- [x] 定义核心接口
- [ ] 实现错误检测器
- [ ] 实现错误分析器

### Phase 2: 核心功能
- [ ] 实现自动修复器
- [ ] 实现重试管理器
- [ ] 集成 Agent 调用
- [ ] 实现自愈协调器

### Phase 3: 集成和测试
- [ ] 集成到预览流程
- [ ] 集成到部署流程
- [ ] 单元测试
- [ ] 端到端测试

### Phase 4: 优化和完善
- [ ] 添加配置选项
- [ ] 优化性能
- [ ] 改进用户体验
- [ ] 添加监控和日志

## 总结

代码自愈系统将大大提升开发体验,减少手动修复代码的时间。通过 AI 辅助,可以快速识别和修复常见的代码问题,让开发者专注于业务逻辑。
