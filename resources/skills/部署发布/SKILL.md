# 前端组件构建与 CDN 部署技能

## 身份定位

你是一名专精于微前端 Module Federation 技术的资深前端架构师，负责使用 React 18、Vite 和 Module Federation 构建组件，并通过 webstatic 工具将构建产物发布到 CDN。

## 技能触发条件

当用户请求以下操作时使用本技能：
- 构建前端项目并发布到 CDN
- 部署 Module Federation 远程模块
- 执行应用内部署或 `deploy.sh` 部署脚本

---

## 阶段一：环境准备

### 1.1 环境说明（应用内部署）

应用内部署时，环境由 **DeployEnvResolver** 自动解析，兼容：
- nvm / fnm / 系统 Node
- 内置 Node（resources/node）
- pnpm / npm / yarn（根据 package.json 或 lockfile 自动检测）

无需预装 webstatic，应用通过 `npx @bfe/webstatic` 直接运行。如需手动部署，可参考下方步骤。

### 1.2 读取项目信息

从 `package.json` 中提取以下变量，后续步骤中统一使用：

| 变量名 | 来源 | 示例值 |
|--------|------|--------|
| `PROJECT_NAME` | `package.json` 的 `name` 字段 | `qa-code-xxx` |
| `VERSION` | `package.json` 的 `version` 字段 | `0.0.1` |

---

## 阶段二：Vite 构建配置

### [!important] 2.1 vite.config.ts 必须包含以下配置

```typescript
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(), // 必须在 federation 之前
    federation({
      // federation 配置
    }),
  ],
  base: `https://aie.sankuai.com/rdc_host/code/${PROJECT_NAME}/vite/${VERSION}/`,
  build: {
    outDir: `dist/code/${PROJECT_NAME}/vite/${VERSION}/`,
    target: 'esnext',
    minify: false,
    sourcemap: false,
    emptyOutDir: true,
    assetsDir: '',
    rollupOptions: {
      output: {
        format: 'esm',
        chunkFileNames: '[name].[hash].js',
        assetFileNames: '[name].[hash].[ext]',
        cssCodeSplit: true,
        manualChunks: {
          tailwind: ['tailwindcss'],
        },
      },
      external: [],
    },
  },
})
```

**关键要点：**
- `base` 路径必须指向 CDN 地址
- `assetsDir: ''` — 禁用 assets 目录，所有文件与 `index.html` 平级输出
- `remoteEntry.js` 由 federation 插件的 `filename` 配置生成，无需额外设置 `entryFileNames`

---

## 阶段三：代码检查

构建前使用 `frontend-code-review` 技能检查前端代码质量。

---

## 阶段四：构建与部署

### 4.1 部署方式

**应用内部署**：在 QACowork 中点击「部署」即可，环境自动解析，无需预装 nvm 或 webstatic。

**手动部署**：以下为 `deploy.sh` 脚本模板，用于在终端中手动执行：

```bash
#!/bin/bash
set -e

# ═══════════════════════════════════════
# 项目配置（从 package.json 读取）
# ═══════════════════════════════════════
PROJECT_NAME="qa-code-xxx"   # 替换为 package.json 中的 name
VERSION="0.0.1"              # 替换为 package.json 中的 version
BUILD_DIR="dist"

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# 可点击链接辅助函数（支持现代终端 OSC 8）
create_clickable_link() {
  local url="$1"
  local text="${2:-$url}"
  printf "\033]8;;%s\033\\%s\033]8;;\033\\" "$url" "$text"
}

# ═══════════════════════════════════════
# Step 1: 检查 webstatic 工具
# ═══════════════════════════════════════
if ! command -v webstatic &> /dev/null; then
  echo -e "${RED}✗ 错误: webstatic 未安装${NC}"
  echo -e "${RED}  请执行: pnpm add -g @bfe/webstatic --registry=http://r.npm.sankuai.com/${NC}"
  exit 1
fi
echo -e "${GREEN}✓ webstatic 已安装${NC}"

# ═══════════════════════════════════════
# Step 2: 执行构建并发布到 CDN
# ═══════════════════════════════════════
echo -e "\n${BLUE}======================================${NC}"
echo -e "${BLUE}  CDN 发布 - 项目: ${PROJECT_NAME} v${VERSION}${NC}"
echo -e "${BLUE}======================================${NC}"

webstatic publish \
  --appkey=com.sankuai.waimaiqafc.aie \
  --env=prod \
  --artifact=dist \
  --build-command='pnpm run build' \
  --token=269883ad-b7b0-4431-b5e7-5886cd1d590f

# ═══════════════════════════════════════
# Step 3: 检查构建产物
# ═══════════════════════════════════════
EXPECTED_BUILD_PATH="${BUILD_DIR}/code/${PROJECT_NAME}/vite/${VERSION}"
EXPECTED_INDEX_HTML="${EXPECTED_BUILD_PATH}/index.html"

echo -e "\n${BLUE}检查构建产物:${NC}"

if [ ! -d "$EXPECTED_BUILD_PATH" ]; then
  echo -e "${RED}✗ 错误: 构建产物目录不存在: ${EXPECTED_BUILD_PATH}${NC}"
  echo -e "${RED}  请检查 vite.config.ts 中的 outDir 配置${NC}"
  exit 1
fi

if [ ! -f "$EXPECTED_INDEX_HTML" ]; then
  echo -e "${RED}✗ 错误: 缺少 index.html: ${EXPECTED_INDEX_HTML}${NC}"
  exit 1
fi

echo -e "${GREEN}✓ 构建产物目录结构正确${NC}"
echo -e "${GREEN}✓ index.html 存在${NC}"

# 产物统计
echo -e "\n${BLUE}构建产物统计:${NC}"
echo "  文件数量: $(find "${EXPECTED_BUILD_PATH}" -type f | wc -l | tr -d ' ')"
echo "  总大小: $(du -sh "${EXPECTED_BUILD_PATH}" | cut -f1)"

# 目录树
echo -e "\n${BLUE}目录结构:${NC}"
if command -v tree &> /dev/null; then
  tree "${BUILD_DIR}"
else
  find "${BUILD_DIR}" -print | sed -e 's;[^/]*/;|____;g;s;____|; |;g'
fi

# ═══════════════════════════════════════
# Step 4: 注册代理地址
# ═══════════════════════════════════════
DEPLOY_BASE_URL="https://aie.sankuai.com/rdc_host/code/${PROJECT_NAME}/vite/${VERSION}"
EXPECTED_DEPLOY_URL="https://${PROJECT_NAME}.autocode.test.sankuai.com/"
EXPECTED_REMOTE_ENTRY_URL="${DEPLOY_BASE_URL}/remoteEntry.js"

# 验证访问地址格式
if [[ ! "$EXPECTED_DEPLOY_URL" =~ ^https://[a-zA-Z0-9-]+\.autocode\.test\.sankuai\.com/?$ ]]; then
  echo -e "${RED}✗ 错误: 访问地址格式不正确${NC}"
  echo -e "${RED}  期望: https://{PROJECT_NAME}.autocode.test.sankuai.com/${NC}"
  echo -e "${RED}  实际: ${EXPECTED_DEPLOY_URL}${NC}"
  exit 1
fi

echo -e "${GREEN}✓ 访问地址格式验证通过${NC}"

# 调用接口注册代理目标
echo -e "\n${BLUE}注册代理地址...${NC}"
HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
  --location --request POST \
  "https://digitalgateway.waimai.test.sankuai.com/testgenius/open/agent/claudeProject/updateProjectProxyTarget?projectId=${PROJECT_NAME}&proxyType=publish&targetUrl=${DEPLOY_BASE_URL}" \
  --header 'Content-Type: application/json' \
  --data-raw '{}')

if [ "$HTTP_RESPONSE" -eq 200 ]; then
  echo -e "${GREEN}✓ 静态资源代理注册成功${NC}"
else
  echo -e "${RED}✗ 静态资源代理注册失败 (HTTP ${HTTP_RESPONSE})${NC}"
  exit 1
fi

# ═══════════════════════════════════════
# Step 5: 输出部署结果
# ═══════════════════════════════════════
echo -e "\n${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  部署成功！${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"

# 终端可点击链接
echo -e "\n${BLUE}访问地址:${NC} $(create_clickable_link "${EXPECTED_DEPLOY_URL}" "点击访问")"
echo "  URL: ${EXPECTED_DEPLOY_URL}"
echo -e "${BLUE}Module Federation 入口:${NC} $(create_clickable_link "${EXPECTED_REMOTE_ENTRY_URL}" "点击访问")"
echo "  URL: ${EXPECTED_REMOTE_ENTRY_URL}"

# Markdown 格式链接（用于 AI 对话渲染）
echo ""
echo "[访问地址](${EXPECTED_DEPLOY_URL})"
echo ""
echo "[Module Federation 入口](${EXPECTED_REMOTE_ENTRY_URL})"
echo ""

echo -e "\n${BLUE}后续操作:${NC}"
echo "  1. 将访问地址写入 .biz/context.json 的 DEPLOY_URL 字段"
echo "  2. 将 DEPLOY_URL 传递给工作流开始节点参数"
```

### 4.2 执行部署

```bash
chmod +x deploy.sh
bash deploy.sh
```

---

## 阶段五：部署验证

部署成功后，必须执行以下验证：

### 5.1 验证访问地址

- **访问地址**: `https://{PROJECT_NAME}.autocode.test.sankuai.com/`
  - 打开页面，确认不是空白页
  - 如果是空白页，检查浏览器控制台错误，修复后重新构建和部署

### 5.2 验证 Module Federation 入口

- **remoteEntry.js**: `https://aie.sankuai.com/rdc_host/code/{PROJECT_NAME}/vite/{VERSION}/remoteEntry.js`
  - 确认返回的是有效的 JavaScript 脚本内容
  - 如果返回 404 或空内容，检查 federation 插件 `filename` 配置

### 5.3 部署后信息写入

将以下信息写入 `.biz/context.json` 的 `DEPLOY_URL` 字段：

```json
{
  "DEPLOY_URL": "https://{PROJECT_NAME}.autocode.test.sankuai.com/"
}
```

---

## 约束与规范

- **依赖库版本**: React 18、Ant Design 5
- **包管理器**: 使用 pnpm
- **构建工具**: Vite + Module Federation
- **CDN 路径规范**: `https://aie.sankuai.com/rdc_host/code/{PROJECT_NAME}/vite/{VERSION}/`
- **访问域名规范**: `https://{PROJECT_NAME}.autocode.test.sankuai.com/`
