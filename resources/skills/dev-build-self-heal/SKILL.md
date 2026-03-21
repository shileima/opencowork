---
name: dev-build-self-heal
description: 本地预览/构建失败时的自愈流程。适用于 Vite 红屏、esbuild/TS 报错、依赖解析失败、pnpm build 失败；与 OpenCowork 内置 validate_page + ErrorFixer 协同。
---

# 开发与构建自愈（预览 / 部署前）

## 何时使用

- 用户点击「预览」、或 `pnpm dev` / `open_browser_preview` 后出现 **Vite 错误覆盖层**
- `validate_page` 返回 `❌ Page validation failed`
- `pnpm build`、部署日志中出现 **Transform failed**、**Failed to resolve import** 等

## 内置能力说明

OpenCowork 在 **`pnpm dev` 启动成功** 或 **`open_browser_preview`** 之后，会尝试在后台用 Playwright 拉取页面并运行 **自动修复循环**（依赖安装、部分导入问题、**.ts 中含 JSX → 重命名为 .tsx** 等）。你仍应在对话中根据工具结果继续排查，直到校验通过或明确无法自动修复。

## 推荐执行顺序

1. **确认依赖**：项目根目录执行 `pnpm install`（预览/构建前不要跳过）。
2. **启动或保持 dev**：`pnpm dev`（端口以项目为准，模板默认为 **3000**）。
3. **打开预览**：`open_browser_preview`（带正确 URL）。
4. **显式校验（可选但推荐）**：`validate_page`，`url` 为预览地址，`cwd` 为当前项目根路径。
5. **解析报错并修复**（按类型）：
   - **Failed to resolve import / Cannot find module**：`pnpm add <包名>`；路径别名错误则改 `import` 路径。
   - **`[plugin:vite:esbuild]` + JSX / `Expected ">" but found`**：将对应文件 **`*.ts` → `*.tsx`**，并修正带 `.ts` 后缀的 import。
   - **`require is not defined`**：改为 ESM `import`。
   - **纯语法/类型错误**：`read_file` 定位行号，`write_file` 最小修改修复。
6. **修复后无需重启开发服务器**：Vite 会热更新，内置浏览器会自动展示正确页面。**禁止**在修复后调用 `kill_project_dev_server` 或 `pnpm dev`——重启会导致整个客户端刷新。仅当用户**显式要求关闭服务**时才使用 `kill_project_dev_server`。
7. **部署前**：先 `pnpm build`；若失败，用构建日志中的文件路径与行号重复上述修复流程。

## 与 `auto-heal-script` 技能的关系

- **`auto-heal-script`**（若已安装）：侧重 **脚本执行**（Python/Shell/Node）的「运行→报错→改→再跑」循环。
- **本技能**：侧重 **前端工程 / Vite / 浏览器预览** 的错误模式与项目内文件修复。

两者可同时存在：脚本类任务走 `auto-heal-script`，React+Vite 项目预览/构建走本技能 + 内置 `validate_page`。

## 停止条件

- `validate_page` 返回 **`✅ Page validation successful`**，或
- 连续多轮无法产生可自动修复项：向用户说明**剩余错误原文**与**建议手动操作**（勿谎称已成功）。
