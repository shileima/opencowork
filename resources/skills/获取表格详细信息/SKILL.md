---
name: 获取表格详细信息
description: 获取某张表的详细信息，包括表格的视图和字段信息。当需要调用此工具API、执行获取表格详细信息操作时使用。
tool_type: bash_script
callable: true
---

# 获取表格详细信息

## 调用方式

直接调用下面命令执行技能：

```bash
# 在技能目录中执行
bash ../_skill-common/scripts/execute.sh \
  --skill-id "skill-a5df871c-a" \
  --parameters '{"workspace_id":"example_workspace_id","base_id":"example_base_id","table_id":"example_table_id","token":"example_token"}'
```

**脚本位置**: `.claude/skills/_skill-common/scripts/execute.sh`

## 功能说明
获取某张表的详细信息，包括表格的视图和字段信息

> **技能ID**: `skill-a5df871c-a`

## 输入参数
调用技能时，需要在 `parameters` 字段中传入以下参数：

```json
{
  "token": "<string> (必需)",
  "workspace_id": "<string> (可选)",
  "base_id": "<string> (可选)",
  "table_id": "<string> (必需)"
}
```

**参数说明**：
- **token** (string, **必需**): 调用令牌
- **workspace_id** (string, 可选): 空间id
- **base_id** (string, 可选): 应用id
- **table_id** (string, **必需**): 表格id

## 输出响应
技能执行成功后，会返回以下格式的响应：

```json
{
  "id": "<string>",
  "source_id": "<string>",
  "base_id": "<string>",
  "directory_id": "<object>",
  "table_name": "<string>",
  "title": "<string>",
  "type": "<string>",
  "meta": "<object>",
  "schema": "<object>",
  "enabled": "<number>",
  "mm": "<number>",
  "tags": "<object>",
  "pinned": "<object>",
  "deleted": "<object>",
  "order": "<number>",
  "created_at": "<string>",
  "updated_at": "<string>",
  "description": "<object>",
  "synced": "<number>",
  "created_by": "<object>",
  "owned_by": "<object>",
  "uuid": "<object>",
  "password": "<object>",
  "fk_custom_url_id": "<object>",
  "views": "<array>",
  "columns": "<array>",
  "columnsById": "<object>",
  "columnsHash": "<string>"
}
```

**响应字段说明**：
- **id** (string): id
- **source_id** (string): source_id
- **base_id** (string): base_id
- **directory_id** (object): directory_id
- **table_name** (string): table_name
- **title** (string): title
- **type** (string): type
- **meta** (object): meta
- **schema** (object): schema
- **enabled** (number): enabled
- **mm** (number): mm
- **tags** (object): tags
- **pinned** (object): pinned
- **deleted** (object): deleted
- **order** (number): order
- **created_at** (string): created_at
- **updated_at** (string): updated_at
- **description** (object): description
- **synced** (number): synced
- **created_by** (object): created_by
- **owned_by** (object): owned_by
- **uuid** (object): uuid
- **password** (object): password
- **fk_custom_url_id** (object): fk_custom_url_id
- **views** (array): views
- **columns** (array): columns
- **columnsById** (object): columnsById
- **columnsHash** (string): columnsHash

> 注意：具体的响应数据结构请参考技能的实际实现或联系技能开发者。

