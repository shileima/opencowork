#!/bin/bash
# 下载 NotoSansCJK 字体脚本

FONT_DIR="$(cd "$(dirname "$0")" && pwd)"
FONT_URL="https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/07_NotoSansCJK-Regular.ttc"

echo "📥 正在下载 NotoSansCJK 字体..."
echo "   目标目录: $FONT_DIR"

# 尝试下载 TTC 文件（需要提取）
if curl -L --connect-timeout 30 -o "$FONT_DIR/NotoSansCJK-Regular.ttc" "$FONT_URL" 2>/dev/null; then
    echo "✅ 下载成功: NotoSansCJK-Regular.ttc"
    echo ""
    echo "⚠️  注意：下载的是 TTC 文件，pdfkit 不支持。"
    echo "   请访问以下链接下载 TTF 格式："
    echo "   https://github.com/notofonts/noto-cjk/releases"
    echo "   或使用以下命令提取 TTF："
    echo "   brew install fonttools  # 安装工具"
    echo "   ttx -t cmap NotoSansCJK-Regular.ttc  # 提取字体"
else
    echo "❌ 自动下载失败"
    echo ""
    echo "📝 请手动下载："
    echo "   1. 访问: https://github.com/notofonts/noto-cjk/releases"
    echo "   2. 下载 'NotoSansCJK-Regular.ttf' 或 'NotoSansCJK-SC-Regular.ttf'"
    echo "   3. 将文件放到: $FONT_DIR/"
fi
