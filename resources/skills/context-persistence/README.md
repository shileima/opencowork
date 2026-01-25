# Claude Code 会话上下文保持 Skills

本文档列出了可以帮助保持 Claude Code 会话上下文的 Skills。

## 内置 Skills

### 1. memory (记忆系统)
**位置**: `resources/skills/memory/`

**功能**:
- 自动学习用户偏好、业务知识、工具使用经验
- 持久化存储到 `~/.xiaomei-workspace/user-preferences.md`
- 自动识别可学习内容并记录

**使用场景**:
- 记录用户个人信息（姓名、团队、角色）
- 记录用户偏好（代码风格、沟通方式）
- 记录业务知识和工具用法
- 记录踩坑经验和解决方案

### 2. doc-coauthoring (文档协作)
**位置**: `resources/skills/doc-coauthoring/`

**功能**:
- 结构化收集上下文（Context Gathering 阶段）
- 帮助用户系统地提供项目背景、技术架构等信息
- 通过多轮对话建立完整的上下文

**使用场景**:
- 编写技术文档、提案、规格说明
- 需要收集大量上下文信息的场景
- 协作编写文档

## Awesome Claude Skills

### 3. developer-growth-analysis (开发者成长分析)
**位置**: `resources/skills/awesome-claude-skills/developer-growth-analysis/`

**功能**:
- 分析 Claude Code 聊天历史
- 识别编码模式、开发差距和改进领域
- 从 HackerNews 策划相关学习资源
- 自动发送个性化成长报告到 Slack

**使用场景**:
- 定期回顾开发工作
- 识别技能差距
- 获取学习建议

### 4. langsmith-fetch (LangSmith 调试)
**位置**: `resources/skills/awesome-claude-skills/langsmith-fetch/`

**功能**:
- 导出调试会话（Export Debug Session）
- 保存执行跟踪和线程到本地
- 分析代理行为和执行模式
- 检查内存操作

**使用场景**:
- 调试 LangChain/LangGraph 代理
- 保存会话快照
- 分析代理性能

### 5. file-organizer (文件组织器)
**位置**: `resources/skills/awesome-claude-skills/file-organizer/`

**功能**:
- 理解上下文来组织文件
- 基于文件类型、日期和内容做智能决策
- 维护上下文信息

**使用场景**:
- 整理项目文件
- 保持工作空间整洁
- 基于上下文组织文件结构

## 其他相关工具

### Memento (外部工具)
- **功能**: 自动提取 Claude Code 会话中的可操作洞察
- **存储**: 保存到 `CLAUDE.md` 文件
- **使用**: 在会话结束时运行 `/memento` 命令

### claude-mem (外部插件)
- **功能**: 自动捕获会话中的所有内容
- **处理**: 使用 AI 压缩内容
- **注入**: 将相关内容注入到未来会话中

## Claude Code 内存位置

Claude Code 支持以下内存位置（按优先级）：

1. **组织级别** - 所有用户的托管策略
2. **项目内存** - `./CLAUDE.md` 或 `./.claude/CLAUDE.md`（通过源代码控制共享）
3. **项目规则** - `./.claude/rules/*.md`（模块化、主题特定的指令）
4. **用户内存** - `~/.claude/CLAUDE.md`（跨所有项目的个人偏好）

个人项目偏好存储在 `CLAUDE.local.md`（自动 gitignored）。

## 最佳实践

1. **使用 memory skill** 记录用户偏好和业务知识
2. **使用 doc-coauthoring** 系统化收集上下文
3. **定期使用 developer-growth-analysis** 回顾开发工作
4. **使用 langsmith-fetch** 保存重要会话快照
5. **维护 CLAUDE.md 文件** 记录项目特定的上下文

## 总结

- ✅ **memory** - 自动学习和持久化用户知识
- ✅ **doc-coauthoring** - 结构化上下文收集
- ✅ **developer-growth-analysis** - 分析聊天历史
- ✅ **langsmith-fetch** - 导出和保存会话
- ✅ **file-organizer** - 基于上下文组织文件

这些 Skills 可以帮助你在 Claude Code 中保持会话上下文，避免重复解释相同的信息。
