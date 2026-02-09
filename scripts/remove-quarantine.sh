#!/bin/bash
# 移除 QACowork 的隔离属性，解决 macOS Gatekeeper 阻止问题
# Remove quarantine attribute from QACowork to bypass macOS Gatekeeper

set -e

APP_PATH="/Applications/QACowork.app"

echo "🔧 正在移除 QACowork 的隔离属性..."
echo "🔧 Removing quarantine attribute from QACowork..."

if [ ! -d "$APP_PATH" ]; then
    echo "❌ 错误: 未找到 QACowork.app"
    echo "❌ Error: QACowork.app not found in /Applications"
    echo "请确保已将 QACowork 拖到应用程序文件夹"
    echo "Please make sure you have moved QACowork to Applications folder"
    exit 1
fi

# 移除隔离属性
xattr -cr "$APP_PATH"

echo "✅ 完成！现在可以正常启动 QACowork 了"
echo "✅ Done! You can now launch QACowork normally"
echo ""
echo "如果仍然无法启动，请尝试："
echo "If still cannot launch, try:"
echo "1. 右键点击 QACowork.app，选择'打开'"
echo "   Right-click QACowork.app and select 'Open'"
echo "2. 或在终端运行: open -a QACowork"
echo "   Or run in terminal: open -a QACowork"
