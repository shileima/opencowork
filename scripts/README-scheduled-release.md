# 定时发布（本地 cron / launchd）

通过本地定时任务在指定时间自动执行 `pnpm release patch`，打 tag 推送到远端后由 GitHub Actions 完成构建与 Release 上传。

## 前提

- 本机已 clone 仓库并配置好 `opencowork` remote，能 `git push opencowork`
- 已安装 Node、pnpm

## macOS（launchd）

1. 复制示例 plist 到用户目录并修改仓库路径：
   ```bash
   cp scripts/com.opencowork.scheduled-release.plist.example ~/Library/LaunchAgents/com.opencowork.scheduled-release.plist
   # 编辑 plist，将 /path/to/opencowork 改为实际仓库路径
   ```

2. 启用定时任务：
   ```bash
   launchctl load ~/Library/LaunchAgents/com.opencowork.scheduled-release.plist
   ```

3. 管理：
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.opencowork.scheduled-release.plist   # 停用
   launchctl list | grep opencowork   # 查看是否已加载
   ```

默认每周一 10:00 执行；可在 plist 中修改 `StartCalendarInterval`（Weekday/Hour/Minute）。

## Linux（cron）

1. 编辑 crontab：
   ```bash
   crontab -e
   ```

2. 添加一行（将 `/path/to/opencowork` 改为实际路径），参考 `scripts/crontab.example`：
   ```cron
   0 10 * * 1 /path/to/opencowork/scripts/scheduled-release.sh
   ```

即每周一 10:00 执行。若 pnpm 通过 nvm/fnm 安装，可改用：
   ```cron
   0 10 * * 1 cd /path/to/opencowork && /usr/bin/env bash -lc 'pnpm release patch' >> /path/to/opencowork/.release.log 2>&1
   ```

## 日志

- 包装脚本输出会追加到仓库根目录的 `.release.log`
- macOS launchd 的 stdout/stderr 在 plist 中配置为 `/tmp/opencowork-release.out` 和 `/tmp/opencowork-release.err`

## 使用 minor/major

编辑 `scripts/scheduled-release.sh`，将 `pnpm release patch` 改为 `pnpm release minor` 或 `pnpm release major`。
