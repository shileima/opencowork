# 部署快速开始

本文档提供快速部署指南，让你在 5 分钟内完成首次部署。

## 步骤 1：环境准备

**应用内部署**：无需预装 nvm 或 webstatic，应用会自动解析 Node 环境（兼容 nvm/fnm/内置 Node）并通过 `npx @bfe/webstatic` 执行部署。

**命令行部署**（`pnpm run deploy`）：需确保 Node.js 和 pnpm 可用。可选安装 webstatic：

```bash
pnpm add -g @bfe/webstatic --registry=http://r.npm.sankuai.com/
```

## 步骤 2：配置环境变量

### 2.1 复制配置模板

```bash
cp .env.example .env
```

### 2.2 获取 AppKey 和 Token

1. 访问 [WebStatic 平台](https://webstatic.sankuai.com/)
2. 登录你的美团账号
3. 创建或选择一个项目
4. 在项目设置中找到：
   - **AppKey**：项目唯一标识，格式如 `com.sankuai.your-project`
   - **Token**：上传令牌，用于身份验证

### 2.3 编辑 .env 文件

打开 `.env` 文件，填入你的配置：

```bash
# WebStatic 项目标识
WEBSTATIC_APPKEY=com.sankuai.your-project

# WebStatic 上传令牌
WEBSTATIC_TOKEN=your-secret-token-here

# 部署环境（可选，默认为 prod）
WEBSTATIC_ENV=prod
```

**重要提示：**
- `.env` 文件包含敏感信息，不要提交到 Git
- 已在 `.gitignore` 中配置，确保不会被意外提交

## 步骤 3：首次部署

运行部署命令：

```bash
pnpm run deploy
```

部署过程会自动执行：
1. ✓ 检查 webstatic 是否安装
2. ✓ 读取项目信息
3. ✓ 升级版本号（patch）
4. ✓ 构建项目
5. ✓ 上传到 CDN
6. ✓ 生成部署报告

## 步骤 4：验证部署

部署成功后，你会看到类似输出：

```
============================================================
部署完成！
============================================================
项目名称: qacowork
版本号: 1.0.1
CDN 地址: https://aie.sankuai.com/com.sankuai.your-project/qacowork/1.0.1/
部署时间: 2026-02-11T10:30:00.000Z
============================================================
```

访问 CDN 地址验证部署是否成功。

## 常用命令

### 部署新版本（自动升级 patch 版本号）

```bash
pnpm run deploy
```

### 部署 minor 版本

```bash
pnpm run deploy -- --minor
```

### 部署 major 版本

```bash
pnpm run deploy -- --major
```

### 跳过构建，直接部署

```bash
pnpm run deploy -- --skip-build
```

### 不升级版本号，直接部署

```bash
pnpm run deploy -- --skip-bump
```

## 故障排查

### 问题 1：webstatic 未安装（仅命令行部署）

```
✗ webstatic not installed
```

**说明：** 应用内部署通过 `npx @bfe/webstatic` 执行，无需预装。此问题仅出现在 `pnpm run deploy` 等命令行场景。

**解决：** 运行安装命令

```bash
pnpm add -g @bfe/webstatic --registry=http://r.npm.sankuai.com/
```

### 问题 2：缺少环境变量

```
✗ 缺少必要的环境变量配置
```

**解决：** 确保 `.env` 文件存在且配置正确

```bash
# 检查 .env 文件是否存在
ls -la .env

# 如果不存在，复制模板
cp .env.example .env

# 编辑 .env 文件
vim .env  # 或使用其他编辑器
```

### 问题 3：权限不足

```
Error: Permission denied
```

**解决：**
1. 确认 Token 是否正确
2. 确认账号是否有项目权限
3. 联系项目管理员添加权限

### 问题 4：构建失败

```
✗ 项目构建失败
```

**解决：**

```bash
# 清理依赖并重新安装
rm -rf node_modules
pnpm install

# 手动构建测试
pnpm run build
```

## 下一步

- 查看 [完整部署文档](./DEPLOYMENT.md) 了解更多高级选项
- 学习 [版本管理最佳实践](./DEPLOYMENT.md#版本管理建议)
- 配置 CI/CD 自动部署

## 需要帮助？

- 查看 [WebStatic 文档](https://webstatic.sankuai.com/docs)
- 联系项目维护者
- 提交 Issue
