# Workflow Patterns

## Sequential Workflows

For complex tasks, break operations into clear, sequential steps. It is often helpful to give Claude an overview of the process towards the beginning of SKILL.md:

```markdown
Filling a PDF form involves these steps:

1. Analyze the form (run analyze_form.py)
2. Create field mapping (edit fields.json)
3. Validate mapping (run validate_fields.py)
4. Fill the form (run fill_form.py)
5. Verify output (run verify_output.py)
```

## Conditional Workflows

For tasks with branching logic, guide Claude through decision points:

```markdown
1. Determine the modification type:
   **Creating new content?** → Follow "Creation workflow" below
   **Editing existing content?** → Follow "Editing workflow" below

2. Creation workflow: [steps]
3. Editing workflow: [steps]
```

## Browser Automation Workflows

For skills using `agent-browser` to automate browser interactions, follow these patterns:

### Verify Browser State

**关键原则**：打开浏览器后必须验证，不能假设用户能看到窗口。

```markdown
## 打开浏览器的正确流程

1. 打开浏览器（首次用 `--headed`）
   ```bash
   npx agent-browser open <url> --headed
   ```

2. 等待并截图验证
   ```bash
   sleep 2
   npx agent-browser screenshot /tmp/browser-check.png
   ```

3. 根据截图结果：
   - 截图成功 → 浏览器已打开，提示用户 Command+Tab 切换窗口
   - 截图失败 → 重试打开
```

**为什么需要验证**：
- 浏览器窗口可能在后台运行，用户看不到
- macOS 窗口焦点管理问题，新窗口不会自动获得焦点
- 首次启动需要下载 Chrome，窗口还在准备中

### Common Mistakes to Avoid

**❌ 常见错误命令**：
```bash
npx agent-browser launch --headed  # ❌ 不存在 launch 命令
npx agent-browser goto <url>       # ❌ 浏览器未打开时无法使用
npx agent-browser start            # ❌ 不存在 start 命令
```

**✅ 正确做法**：
```bash
npx agent-browser open <url> --headed  # ✅ 首次打开浏览器
npx agent-browser goto <url>           # ✅ 浏览器已打开后跳转
```

**关键区别**：
- `open` - 启动浏览器并打开页面（首次使用）
- `goto` - 在已打开的浏览器中跳转（浏览器必须已启动）

### Common Commands Reference

在 SKILL.md 中包含常用命令速查，避免 AI 瞎猜命令：

```markdown
## agent-browser 命令速查

| 命令 | 语法 | 说明 |
|-----|------|------|
| 打开页面 | `open <url> --headed` | 首次访问用 `--headed` |
| 跳转 | `goto <url>` | 在当前标签页跳转 |
| 点击 | `click <ref>` | 使用 snapshot -i 获取的 ref |
| 输入 | `fill <ref> <text>` | 清空后输入 |
| 截图 | `screenshot [path]` | 验证页面状态 |
| 查看元素 | `snapshot -i` | 获取可交互元素 |
| 查看内容 | `snapshot` | 获取完整页面内容 |

**禁止**：
- ❌ `npx agent-browser close` - 会丢失登录状态
- ❌ 瞎猜命令 - 先查 `npx agent-browser --help`
```

### Login Flow Pattern

```markdown
## 登录流程

1. 用 `--headed` 打开页面
2. 检查标题是否包含"登录"
3. 如需登录，提示用户在浏览器窗口中操作
4. 登录状态自动保存到 `~/.agent-browser/default/`
5. 下次无需 `--headed`，自动复用登录状态
```