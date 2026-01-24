---
name: 获取指定表格的数据
description: 从指定的数据表中获取数据记录。可以通过可选的视图 ID 来应用预定义的筛选和排序规则。。当需要调用此工具API、执行获取指定表格的数据操作时使用。
tool_type: bash_script
callable: true
---

# 获取指定表格的数据

## 调用方式

直接调用下面命令执行技能：

```bash
# 在技能目录中执行
bash ../_skill-common/scripts/execute.sh \
  --skill-id "skill-f5d521c9-6" \
  --parameters '{"workspace_id":"example_workspace_id","offset":123,"base_id":"example_base_id","view_id":"example_view_id","limit":123,"where":"example_where","sort":"example_sort","table_id":"example_table_id","fields":"example_fields","token":"example_token"}'
```

**脚本位置**: `.claude/skills/_skill-common/scripts/execute.sh`

## 功能说明
从指定的数据表中获取数据记录。可以通过可选的视图 ID 来应用预定义的筛选和排序规则。

> **技能ID**: `skill-f5d521c9-6`

## 输入参数
调用技能时，需要在 `parameters` 字段中传入以下参数：

```json
{
  "token": "<string> (必需)",
  "workspace_id": "<string> (可选)",
  "base_id": "<string> (可选)",
  "table_id": "<string> (必需)",
  "view_id": "<string> (可选)",
  "offset": "<integer> (可选)",
  "limit": "<integer> (可选)",
  "where": "<string> (可选)",
  "fields": "<string> (可选)",
  "sort": "<string> (可选)"
}
```

**参数说明**：
- **token** (string, **必需**): 调用令牌
- **workspace_id** (string, 可选): 空间id
- **base_id** (string, 可选): 应用id
- **table_id** (string, **必需**): 表格id
- **view_id** (string, 可选): 视图id
- **offset** (integer, 可选): 记录偏移量
- **limit** (integer, 可选): 每次查询的记录数
- **where** (string, 可选): 筛选条件
- **fields** (string, 可选): 展示字段
- **sort** (string, 可选): 排序字段

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

