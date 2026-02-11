# 部署指南

本文档介绍如何将项目部署到美团 CDN。

## 前置要求

### 1. 安装 webstatic 工具

```bash
pnpm add -g @bfe/webstatic --registry=http://r.npm.sankuai.com/
```

验证安装：

```bash
webstatic --version
```

### 2. 配置 WebStatic

#### 2.1 获取 AppKey 和 Token

1. 访问 [WebStatic 平台](https://webstatic.sankuai.com/)
2. 创建或选择一个项目
3. 在项目设置中获取 `appkey` 和 `token`

#### 2.2 配置环境变量

**方式一：使用 .env 文件（推荐）**

复制 `.env.example` 文件为 `.env`：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入实际的配置值：

```bash
# WebStatic 项目标识（appkey）
WEBSTATIC_APPKEY=com.sankuai.your-project

# WebStatic 上传令牌（token）
WEBSTATIC_TOKEN=your-secret-token-here

# 部署环境（可选，默认为 prod）
WEBSTATIC_ENV=prod
```

**方式二：使用环境变量**

在命令行中设置环境变量：

```bash
export WEBSTATIC_APPKEY=com.sankuai.your-project
export WEBSTATIC_TOKEN=your-secret-token-here
export WEBSTATIC_ENV=prod
```

或者在部署时临时设置：

```bash
WEBSTATIC_APPKEY=com.sankuai.your-project WEBSTATIC_TOKEN=your-secret-token-here pnpm run deploy
```

### 3. 配置权限

确保你有美团 CDN 的上传权限。如果没有，请联系相关负责人。

## 部署方式

### 方式一：使用部署脚本（推荐）

#### 基本部署

```bash
pnpm run deploy
```

这会执行以下步骤：
1. 检查 webstatic 是否安装
2. 自动升级 patch 版本号（如 1.0.0 -> 1.0.1）
3. 构建项目
4. 上传到 CDN
5. 生成部署报告

#### 高级选项

**跳过版本号升级：**

```bash
pnpm run deploy -- --skip-bump
```

**指定版本号升级类型：**

```bash
# 升级主版本号（1.0.0 -> 2.0.0）
pnpm run deploy -- --major

# 升级次版本号（1.0.0 -> 1.1.0）
pnpm run deploy -- --minor

# 升级补丁版本号（1.0.0 -> 1.0.1，默认）
pnpm run deploy -- --patch
```

**跳过构建步骤（使用已有的 dist 目录）：**

```bash
pnpm run deploy -- --skip-build
```

**组合使用：**

```bash
# 跳过版本号升级和构建，直接部署
pnpm run deploy -- --skip-bump --skip-build
```

### 方式二：手动部署

如果你需要更精细的控制，可以手动执行每个步骤：

#### 1. 更新版本号

手动编辑 `package.json` 中的 `version` 字段。

#### 2. 构建项目

```bash
pnpm run build
```

#### 3. 上传到 CDN

```bash
webstatic upload dist --path=code/qacowork/vite/版本号
```

例如：

```bash
webstatic upload dist --path=code/qacowork/vite/1.0.0
```

## 部署后

### 查看部署报告

部署成功后，会在项目根目录生成 `deploy-report.json` 文件，包含以下信息：

```json
{
  "name": "qacowork",
  "version": "1.0.0",
  "description": "QACowork - 你的数字测试同事",
  "cdnUrl": "https://aie.sankuai.com/rdc_host/code/qacowork/vite/1.0.0/",
  "deployTime": "2026-02-11T10:30:00.000Z"
}
```

### 访问部署的应用

部署成功后，可以通过以下地址访问：

```
https://aie.sankuai.com/rdc_host/code/qacowork/vite/版本号/
```

例如：

```
https://aie.sankuai.com/rdc_host/code/qacowork/vite/1.0.0/
```

## 常见问题

### 1. webstatic 未安装

**错误信息：**

```
✗ webstatic not installed
  Run: pnpm add -g @bfe/webstatic --registry=http://r.npm.sankuai.com/
```

**解决方法：**

按照提示安装 webstatic：

```bash
pnpm add -g @bfe/webstatic --registry=http://r.npm.sankuai.com/
```

### 2. 缺少环境变量配置

**错误信息：**

```
✗ 缺少必要的环境变量配置
  请在 .env 文件中配置以下变量：
    WEBSTATIC_APPKEY=你的appkey
    WEBSTATIC_TOKEN=你的token
    WEBSTATIC_ENV=prod (可选，默认为 prod)
```

**解决方法：**

1. 复制 `.env.example` 为 `.env`：
   ```bash
   cp .env.example .env
   ```

2. 编辑 `.env` 文件，填入从 [WebStatic 平台](https://webstatic.sankuai.com/) 获取的配置值

3. 确保 `.env` 文件不要提交到 Git（已在 `.gitignore` 中配置）

### 3. 权限不足

**错误信息：**

```
Error: Permission denied
```

**解决方法：**

1. 确认你的 `WEBSTATIC_TOKEN` 是否正确
2. 确认你的账号是否有该项目的上传权限
3. 联系项目管理员添加权限

### 4. 构建失败

**错误信息：**

```
✗ 项目构建失败
```

**解决方法：**

1. 检查代码是否有语法错误
2. 检查依赖是否安装完整：`pnpm install`
3. 查看具体的错误信息并修复

### 5. dist 目录不存在

**错误信息：**

```
✗ dist 目录不存在，请先构建项目
```

**解决方法：**

先构建项目：

```bash
pnpm run build
```

或者不使用 `--skip-build` 选项。

### 6. 上传失败

**错误信息：**

```
Error: Upload failed
```

**解决方法：**

1. 检查网络连接是否正常
2. 检查 `WEBSTATIC_APPKEY` 和 `WEBSTATIC_TOKEN` 是否正确
3. 检查文件大小是否超过限制
4. 尝试使用 `--force` 选项忽略不合法的文件

## 版本管理建议

### 语义化版本

遵循语义化版本规范（Semantic Versioning）：

- **主版本号（Major）**：不兼容的 API 修改
- **次版本号（Minor）**：向下兼容的功能性新增
- **修订号（Patch）**：向下兼容的问题修正

### 版本号升级示例

| 当前版本 | 变更类型 | 新版本 | 命令 |
|---------|---------|--------|------|
| 1.0.0 | 修复 bug | 1.0.1 | `pnpm run deploy` 或 `pnpm run deploy -- --patch` |
| 1.0.0 | 新增功能 | 1.1.0 | `pnpm run deploy -- --minor` |
| 1.0.0 | 重大变更 | 2.0.0 | `pnpm run deploy -- --major` |

## 部署流程图

```
开始
  ↓
检查 webstatic 是否安装
  ↓
读取项目信息
  ↓
更新版本号（可选）
  ↓
构建项目（可选）
  ↓
上传到 CDN
  ↓
生成部署报告
  ↓
完成
```

## 最佳实践

1. **部署前测试**：确保在本地测试通过后再部署
2. **版本管理**：遵循语义化版本规范
3. **备份**：部署前确保代码已提交到 Git
4. **文档更新**：部署新功能时同步更新文档
5. **回滚准备**：记录每次部署的版本号，便于回滚

## 相关链接

- [webstatic 文档](http://wiki.sankuai.com/pages/viewpage.action?pageId=xxx)
- [美团 CDN 使用指南](http://wiki.sankuai.com/pages/viewpage.action?pageId=xxx)
- [语义化版本规范](https://semver.org/lang/zh-CN/)
