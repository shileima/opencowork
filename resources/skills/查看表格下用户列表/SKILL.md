---
name: 查看表格下用户列表
description: 查看表格下的所有用户信息。当需要调用此工具API、执行查看表格下用户列表操作时使用。
tool_type: bash_script
callable: true
---

# 查看表格下用户列表

## 调用方式

直接调用下面命令执行技能：

```bash
# 在技能目录中执行
bash ../_skill-common/scripts/execute.sh \
  --skill-id "skill-f56a4da4-3" \
  --parameters '{"workspace_id":"example_workspace_id","base_id":"example_base_id","model_id":"example_model_id","token":"example_token"}'
```

**脚本位置**: `.claude/skills/_skill-common/scripts/execute.sh`

## 功能说明
查看表格下的所有用户信息

> **技能ID**: `skill-f56a4da4-3`

## 输入参数
调用技能时，需要在 `parameters` 字段中传入以下参数：

```json
{
  "token": "<string> (必需)",
  "workspace_id": "<string> (可选)",
  "base_id": "<string> (可选)",
  "model_id": "<string> (必需)"
}
```

**参数说明**：
- **token** (string, **必需**): 调用令牌
- **workspace_id** (string, 可选): 空间id
- **base_id** (string, 可选): 应用id
- **model_id** (string, **必需**): 表格Id

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

