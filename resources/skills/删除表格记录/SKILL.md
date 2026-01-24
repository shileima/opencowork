---
name: 删除表格记录
description: 根据指定的记录主键id，删除对应的记录。当需要调用此工具API、执行删除表格记录操作时使用。
tool_type: bash_script
callable: true
---

# 删除表格记录

## 调用方式

直接调用下面命令执行技能：

```bash
# 在技能目录中执行
bash ../_skill-common/scripts/execute.sh \
  --skill-id "skill-d42e5f67-8" \
  --parameters '{"workspace_id":"example_workspace_id","base_id":"example_base_id","pk_id_list":[],"table_id":"example_table_id","token":"example_token"}'
```

**脚本位置**: `.claude/skills/_skill-common/scripts/execute.sh`

## 功能说明
根据指定的记录主键id，删除对应的记录

> **技能ID**: `skill-d42e5f67-8`

## 输入参数
调用技能时，需要在 `parameters` 字段中传入以下参数：

```json
{
  "token": "<string> (必需)",
  "workspace_id": "<string> (可选)",
  "base_id": "<string> (必需)",
  "table_id": "<string> (必需)",
  "pk_id_list": "<array> (必需)"
}
```

**参数说明**：
- **token** (string, **必需**): 调用令牌
- **workspace_id** (string, 可选): 空间id
- **base_id** (string, **必需**): 数据库（应用）id
- **table_id** (string, **必需**): 表格id
- **pk_id_list** (array, **必需**): 要删除的记录的主键id

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

