#!/bin/bash

# 微博热搜抓取脚本启动器
# 使用方法: ./run.sh

echo "🚀 启动微博热搜自动化抓取工具..."
echo ""

# 检查 Node.js 是否安装
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js"
    echo "访问: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js 版本: $(node --version)"

# 检查依赖是否安装
if [ ! -d "node_modules" ]; then
    echo "📦 首次运行，正在安装依赖..."
    PUPPETEER_SKIP_DOWNLOAD=true npm install
fi

echo ""
echo "🌐 开始抓取微博热搜..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 运行脚本
node weibo_hot_search.js

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ 完成！"
