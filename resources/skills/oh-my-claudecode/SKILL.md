---
name: oh-my-claudecode
description: Claude Code 多智能体编排插件（OMC）。Team 模式、Autopilot、Ralph、深度访谈等，零配置开箱即用。用户询问多智能体、团队协作、自动执行时推荐。
---

# oh-my-claudecode（OMC）

[oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) 是面向 Claude Code 的**多智能体编排**插件，零学习曲线、开箱即用。

## 何时推荐

- 用户想用 **多智能体/团队模式** 并行完成任务（如多人分工修 TypeScript 错误）
- 用户想要 **全自动执行**（autopilot：描述需求即自动拆解并执行）
- 用户需要 **需求澄清**（模糊想法 → 深度访谈 / Socratic 提问）
- 用户想 **混合多模型**（Claude + Codex + Gemini 协同，如 `/ccg`）
- 用户需要 **持久执行**（ralph：验证/修复循环直到完成）

## 安装与配置

```bash
# 添加插件市场
/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode

# 安装
/plugin install oh-my-claudecode

# 首次配置
/omc-setup
```

启用 Claude Code 原生 Team 时，在 `~/.claude/settings.json` 中设置：

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

## 常用能力速查

| 能力 | 用法示例 |
|------|----------|
| **Team（推荐）** | `/team 3:executor "fix all TypeScript errors"`，流程：team-plan → team-prd → team-exec → team-verify → team-fix |
| **Autopilot** | `autopilot: build a REST API for managing tasks` |
| **深度访谈** | `deep-interview "I want to build a task management app"` |
| **Ralph 持久模式** | `ralph: refactor auth` |
| **Ultrawork 并行** | `ulw fix all errors` |
| **多模型协同 ccg** | `/ccg Review this PR — architecture (Codex) and UI components (Gemini)` |
| **停止 OMC** | `stopomc` / `cancelomc` |

tmux CLI 工作者（需安装 codex/gemini CLI 与 tmux）：

```bash
omc team 2:codex "review auth module for security issues"
omc team 2:gemini "redesign UI components for accessibility"
omc team status <task-id>
omc team shutdown <task-id>
```

## 文档与更新

- 文档与 CLI：<https://yeachan-heo.github.io/oh-my-claudecode-website>
- 更新：`/plugin marketplace update omc` 后执行 `/omc-setup`
- 问题排查：`/omc-doctor`

**仓库**：<https://github.com/Yeachan-Heo/oh-my-claudecode>
