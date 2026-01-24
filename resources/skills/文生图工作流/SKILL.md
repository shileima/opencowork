---
name: 文生图工作流
description: 专注探索文生图技术，打造高效创意工作流，助力生成独特视觉内容，提升设计与表达效率。。当需要执行此工作流时使用。
tool_type: bash_script
callable: true
---

# 文生图工作流

## 调用方式

直接调用下面命令执行工作流：

```bash
# 在工作流目录中执行
bash ../_workflow-common/scripts/execute_workflow.sh \
  --workflow-id "workflow-83e74a4a-c" \
  --input-list '[{"name":"imageSize","value":"\"1k\""},{"name":"aspectRatio","value":"\"4:3\""},{"name":"content","value":"example_value"},{"name":"modelName","value":"flux"},{"name":"size","value":"256x256"}]'
```

**参数说明**：
- `--workflow-id`: 工作流ID（必需）
- `--input-list`: 输入参数列表 JSON 数组（必需）
- `--execute-type`: 执行类型，1=运行 2=调试（可选，默认1）
- `--operator`: 操作人（可选，默认"agent"）
- `--sync`: 是否同步执行，true/false（可选，默认true）

**脚本位置**: `.claude/skills/_workflow-common/scripts/execute_workflow.sh`

## 功能说明
专注探索文生图技术，打造高效创意工作流，助力生成独特视觉内容，提升设计与表达效率。

> **工作流ID**: `workflow-83e74a4a-c`

## 输入参数
调用工作流时，需要在 `inputList` 数组中传入以下参数（每个参数包含 name 和 value）：

```json
[
  {"name": "imageSize", "value": "<string> (可选)"},
  {"name": "aspectRatio", "value": "<string> (可选)"},
  {"name": "content", "value": "<string> (必需)"},
  {"name": "modelName", "value": "<string> (可选)"},
  {"name": "size", "value": "<string> (可选)"}
]
```

**参数说明**：
- **imageSize** (string, 可选): 图片大小 (图片大小)，默认值: `"1k"`
- **aspectRatio** (string, 可选): 图片比例 (图片比例)，默认值: `"4:3"`
- **content** (string, **必需**): 文生图提示词 (文生图提示词)
- **modelName** (string, 可选): 模型名称 (文生图模型)，默认值: `flux`
- **size** (string, 可选): 生成的图像的大小，默认256x256，flux模型建议最大1024x1024
dall-e-3 必须是 "1792x1024"、"1024x1024" 或 "1024x1792" (分辨率尺寸)，默认值: `256x256`

> 注意：inputList 是一个对象数组，每个对象包含 name 和 value 两个字段。

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

