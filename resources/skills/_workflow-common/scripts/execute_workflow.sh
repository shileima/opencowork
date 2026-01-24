#!/bin/bash
# 通用工作流执行脚本
# 固定接口地址: https://testgenius.sankuai.com/open/workflow/execution/notStream
# 用法: execute_workflow.sh --workflow-id <ID> --input-list <JSON> [其他参数]

set -e

# 固定配置
API_ENDPOINT="https://testgenius.sankuai.com/open/workflow/execution/notStream"
METHOD="POST"

# 默认值
EXECUTE_TYPE=1
OPERATOR="agent"
SYNC="true"

# 解析命令行参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --workflow-id)
      WORKFLOW_ID="$2"
      shift 2
      ;;
    --input-list)
      INPUT_LIST="$2"
      shift 2
      ;;
    --execute-type)
      EXECUTE_TYPE="$2"
      shift 2
      ;;
    --operator)
      OPERATOR="$2"
      shift 2
      ;;
    --sync)
      SYNC="$2"
      shift 2
      ;;
    *)
      echo "未知参数: $1"
      exit 1
      ;;
  esac
done

# 参数验证
if [ -z "$WORKFLOW_ID" ]; then
  echo "错误: 缺少必需参数 --workflow-id"
  echo "用法: execute_workflow.sh --workflow-id <ID> --input-list <JSON>"
  exit 1
fi

# 如果没有传入 input-list，使用空数组
if [ -z "$INPUT_LIST" ]; then
  INPUT_LIST="[]"
fi

# 构建请求体
REQUEST_BODY=$(cat <<EOF
{
  "workflowId": "$WORKFLOW_ID",
  "inputList": $INPUT_LIST,
  "executeType": $EXECUTE_TYPE,
  "operator": "$OPERATOR",
  "sync": $SYNC
}
EOF
)

echo "🚀 调用工作流接口..."
echo "📋 工作流ID: $WORKFLOW_ID"
echo "📦 输入参数: $INPUT_LIST"
echo "🔧 执行类型: $EXECUTE_TYPE (1=运行 2=调试)"
echo "👤 操作人: $OPERATOR"
echo "⚡ 同步执行: $SYNC"
echo ""

# 调用工作流 API
curl -s -X "$METHOD" "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$REQUEST_BODY"