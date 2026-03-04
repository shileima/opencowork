#!/bin/bash

# 测试内置 Node.js 功能
# 使用方法：./scripts/test-builtin-node.sh

set -e

echo "🧪 测试内置 Node.js 功能"
echo "================================"

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_DIR="$PROJECT_ROOT/resources/node/darwin-arm64"

echo ""
echo "📁 项目目录: $PROJECT_ROOT"
echo "📁 Node.js 目录: $NODE_DIR"
echo ""

# 测试 1：检查 Node.js 可执行文件
echo "测试 1: 检查 Node.js 可执行文件"
if [ -f "$NODE_DIR/node" ]; then
    echo -e "${GREEN}✅ Node.js 可执行文件存在${NC}"
    NODE_VERSION=$("$NODE_DIR/node" --version)
    echo "   版本: $NODE_VERSION"
else
    echo -e "${RED}❌ Node.js 可执行文件不存在${NC}"
    echo "   请运行: npm run prepare:node-npm"
    exit 1
fi

# 测试 2：检查 npm 文件
echo ""
echo "测试 2: 检查 npm 文件"
if [ -f "$NODE_DIR/npm" ]; then
    echo -e "${GREEN}✅ npm 脚本存在${NC}"
else
    echo -e "${RED}❌ npm 脚本不存在${NC}"
    exit 1
fi

if [ -f "$NODE_DIR/npm-cli.js" ]; then
    echo -e "${GREEN}✅ npm-cli.js 存在${NC}"
else
    echo -e "${RED}❌ npm-cli.js 不存在${NC}"
    exit 1
fi

# 测试 3：检查 npm 模块目录
echo ""
echo "测试 3: 检查 npm 模块目录"
if [ -d "$NODE_DIR/lib/node_modules/npm" ]; then
    echo -e "${GREEN}✅ npm 模块目录存在${NC}"
    NPM_SIZE=$(du -sh "$NODE_DIR/lib/node_modules/npm" | cut -f1)
    echo "   大小: $NPM_SIZE"
else
    echo -e "${RED}❌ npm 模块目录不存在${NC}"
    exit 1
fi

# 测试 4：检查符号链接
echo ""
echo "测试 4: 检查符号链接"
if [ -L "$NODE_DIR/node_modules/npm" ]; then
    echo -e "${GREEN}✅ 符号链接存在${NC}"
    LINK_TARGET=$(readlink "$NODE_DIR/node_modules/npm")
    echo "   链接到: $LINK_TARGET"
else
    echo -e "${YELLOW}⚠️  符号链接不存在（可能不影响功能）${NC}"
fi

# 测试 5：测试 npm 命令
echo ""
echo "测试 5: 测试 npm 命令"
export PATH="$NODE_DIR:$PATH"
export NODE_PATH="$NODE_DIR/lib/node_modules"

NPM_VERSION=$("$NODE_DIR/npm" --version 2>&1)
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ npm 命令可以执行${NC}"
    echo "   版本: $NPM_VERSION"
else
    echo -e "${RED}❌ npm 命令执行失败${NC}"
    echo "   错误: $NPM_VERSION"
    exit 1
fi

# 测试 6：检查构建产物
echo ""
echo "测试 6: 检查构建产物"
BUILD_APP="$PROJECT_ROOT/release/0.0.33/mac-arm64/QACowork.app"
if [ -d "$BUILD_APP" ]; then
    echo -e "${GREEN}✅ 构建的应用存在${NC}"
    
    # 检查打包的 Node.js
    PACKAGED_NODE="$BUILD_APP/Contents/Resources/node/darwin-arm64/node"
    if [ -f "$PACKAGED_NODE" ]; then
        echo -e "${GREEN}✅ 内置 Node.js 已打包${NC}"
        PACKAGED_SIZE=$(ls -lh "$PACKAGED_NODE" | awk '{print $5}')
        echo "   大小: $PACKAGED_SIZE"
    else
        echo -e "${YELLOW}⚠️  内置 Node.js 未打包${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  构建的应用不存在（可能还未构建）${NC}"
    echo "   运行 'npm run build:dir' 来构建应用"
fi

# 测试 7：测试 npm install（可选）
echo ""
echo "测试 7: 测试 npm install（可选，跳过）"
echo -e "${YELLOW}⏭️  跳过实际安装测试（避免修改文件系统）${NC}"
echo "   如需测试，可以手动运行："
echo "   cd /tmp && mkdir test-npm && cd test-npm"
echo "   PATH=\"$NODE_DIR:\$PATH\" NODE_PATH=\"$NODE_DIR/lib/node_modules\" npm init -y"
echo "   PATH=\"$NODE_DIR:\$PATH\" NODE_PATH=\"$NODE_DIR/lib/node_modules\" npm install lodash"

# 总结
echo ""
echo "================================"
echo -e "${GREEN}✅ 所有测试通过！${NC}"
echo ""
echo "📝 下一步："
echo "   1. 启动应用: npm run dev"
echo "   2. 点击 '立即安装' 按钮安装 Playwright"
echo "   3. 检查控制台日志，确认使用内置 Node.js"
echo ""
