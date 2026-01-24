---
name: ai生成应用工作流
description: 专注AI生成技术的应用工作流设计，提供高效自动化解决方案，助力提升生产力与创新能力。。当需要执行此工作流时使用。
tool_type: bash_script
callable: true
---

# ai生成应用工作流

## 调用方式

直接调用下面命令执行工作流：

```bash
# 在工作流目录中执行
bash ../_workflow-common/scripts/execute_workflow.sh \
  --workflow-id "workflow-9ed4e644-b" \
  --input-list '[]'
```

**参数说明**：
- `--workflow-id`: 工作流ID（必需）
- `--input-list`: 输入参数列表 JSON 数组（必需）
- `--execute-type`: 执行类型，1=运行 2=调试（可选，默认1）
- `--operator`: 操作人（可选，默认"agent"）
- `--sync`: 是否同步执行，true/false（可选，默认true）

**脚本位置**: `.claude/skills/_workflow-common/scripts/execute_workflow.sh`

## 功能说明
专注AI生成技术的应用工作流设计，提供高效自动化解决方案，助力提升生产力与创新能力。

> **工作流ID**: `workflow-9ed4e644-b`

## 输入参数
此工作流暂无输入参数配置，调用时 `inputList` 可传空数组：
```json
[]
```

## 输出响应
工作流执行成功后，会返回以下格式的响应：

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    // 工作流的执行结果数据
  }
}
```

**响应字段说明**：
- **code** (integer): 状态码，0表示成功，非0表示失败
- **msg** (string): 响应消息
- **data** (object): 工作流执行的具体返回数据

> 注意：具体的响应数据结构取决于工作流的实际实现。

