#!/bin/bash
# 通用技能执行脚本
# 固定接口地址: https://testgenius.sankuai.com/open/skill/thirdParty/skillInvoke
# 用法: execute.sh --skill-id <ID> --parameters <JSON>

set -e

# 固定配置
API_ENDPOINT="https://testgenius.sankuai.com/open/skill/thirdParty/skillInvoke"
METHOD="POST"
TYPE="workflow"

# 解析命令行参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --skill-id)
      SKILL_ID="$2"
      shift 2
      ;;
    --parameters)
      PARAMETERS="$2"
      shift 2
      ;;
    *)
      echo "未知参数: $1"
      exit 1
      ;;
  esac
done

# 参数验证
if [ -z "$SKILL_ID" ]; then
  echo "错误: 缺少必需参数 --skill-id"
  echo "用法: execute.sh --skill-id <ID> [--parameters <JSON>]"
  exit 1
fi

# 如果没有传入 parameters，使用空对象
if [ -z "$PARAMETERS" ]; then
  PARAMETERS="{}"
fi

# 构建请求体
REQUEST_BODY=$(cat <<EOF
{
  "skillId": "$SKILL_ID",
  "type": "$TYPE",
  "parameters": $PARAMETERS
}
EOF
)

echo "🚀 调用技能接口..."
echo "📋 技能ID: $SKILL_ID"
echo "📦 参数: $PARAMETERS"
echo ""

# 调用技能 API
curl -s -X "$METHOD" "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$REQUEST_BODY"