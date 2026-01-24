---
name: 修改单选多选字段可选值
description: 全量更新 或 增加 单选/多选字段的选项。当需要调用此工具API、执行修改单选/多选字段可选值操作时使用。
tool_type: bash_script
callable: true
---

# 修改单选/多选字段可选值

## 调用方式

直接调用下面命令执行技能：

```bash
# 在技能目录中执行
bash ../_skill-common/scripts/execute.sh \
  --skill-id "skill-9cf20ccd-c" \
  --parameters '{"workspace_id":"example_workspace_id","column_id":"example_column_id","base_id":"example_base_id","options":[],"table_id":"example_table_id","type":"example_type","token":"example_token"}'
```

**脚本位置**: `.claude/skills/_skill-common/scripts/execute.sh`

## 功能说明
全量更新 或 增加 单选/多选字段的选项

> **技能ID**: `skill-9cf20ccd-c`

## 输入参数
调用技能时，需要在 `parameters` 字段中传入以下参数：

```json
{
  "token": "<string> (必需)",
  "workspace_id": "<string> (可选)",
  "base_id": "<string> (可选)",
  "table_id": "<string> (必需)",
  "column_id": "<string> (必需)",
  "type": "<string> (必需)",
  "options": "<array> (必需)"
}
```

**参数说明**：
- **token** (string, **必需**): 调用令牌
- **workspace_id** (string, 可选): 空间id
- **base_id** (string, 可选): 应用
- **table_id** (string, **必需**): 表格id
- **column_id** (string, **必需**): 字段id
- **type** (string, **必需**): 操作类型，支持增加(insert) 或 全量更新(update)
- **options** (array, **必需**): 选项，举例["a","b","c"]

## 输出响应
技能执行成功后，会返回以下格式的响应：

```json
{
  "code": "<number>",
  "msg": "<string>",
  "data": "<string>"
}
```

**响应字段说明**：
- **code** (number): code
- **msg** (string): msg
- **data** (string): data

> 注意：具体的响应数据结构请参考技能的实际实现或联系技能开发者。

