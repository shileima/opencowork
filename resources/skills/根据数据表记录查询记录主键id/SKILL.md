---
name: 根据数据表记录查询记录主键id
description: 根据数据表中的字段名称和字段值，匹配对应记录的主键id。当需要调用此工具API、执行根据数据表记录查询记录主键id操作时使用。
tool_type: bash_script
callable: true
---

# 根据数据表记录查询记录主键id

## 调用方式

直接调用下面命令执行技能：

```bash
# 在技能目录中执行
bash ../_skill-common/scripts/execute.sh \
  --skill-id "skill-7e09f73b-5" \
  --parameters '{"workspace_id":"example_workspace_id","column_title":"example_column_title","base_id":"example_base_id","table_id":"example_table_id","column_value":"example_column_value","token":"example_token"}'
```

**脚本位置**: `.claude/skills/_skill-common/scripts/execute.sh`

## 功能说明
根据数据表中的字段名称和字段值，匹配对应记录的主键id

> **技能ID**: `skill-7e09f73b-5`

## 输入参数
调用技能时，需要在 `parameters` 字段中传入以下参数：

```json
{
  "token": "<string> (必需)",
  "workspace_id": "<string> (可选)",
  "base_id": "<string> (可选)",
  "table_id": "<string> (必需)",
  "column_title": "<string> (必需)",
  "column_value": "<string> (必需)"
}
```

**参数说明**：
- **token** (string, **必需**): 调用令牌
- **workspace_id** (string, 可选): 空间id
- **base_id** (string, 可选): 应用id
- **table_id** (string, **必需**): 表格id
- **column_title** (string, **必需**): 要匹配字段的前端展示名称
- **column_value** (string, **必需**): 要匹配字段的值

## 输出响应
技能执行成功后，会返回以下格式的响应：

```json
{
  "code": "<number>",
  "msg": "<string>",
  "data": "<object>"
}
```

**响应字段说明**：
- **code** (number): code
- **msg** (string): msg
- **data** (object): data

> 注意：具体的响应数据结构请参考技能的实际实现或联系技能开发者。

