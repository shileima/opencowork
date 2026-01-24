---
name: 新建应用
description: 根据输入的应用名称和描述，创建应用。。当需要调用此工具API、执行新建应用操作时使用。
tool_type: bash_script
callable: true
---

# 新建应用

## 调用方式

直接调用下面命令执行技能：

```bash
# 在技能目录中执行
bash ../_skill-common/scripts/execute.sh \
  --skill-id "skill-545ddc31-9" \
  --parameters '{"workspace_id":"example_workspace_id","name":"example_name","description":"example_description","token":"example_token"}'
```

**脚本位置**: `.claude/skills/_skill-common/scripts/execute.sh`

## 功能说明
根据输入的应用名称和描述，创建应用。

> **技能ID**: `skill-545ddc31-9`

## 输入参数
调用技能时，需要在 `parameters` 字段中传入以下参数：

```json
{
  "token": "<string> (必需)",
  "workspace_id": "<string> (必需)",
  "name": "<string> (必需)",
  "description": "<string> (可选)"
}
```

**参数说明**：
- **token** (string, **必需**): 调用令牌
- **workspace_id** (string, **必需**): 空间id
- **name** (string, **必需**): 应用名称
- **description** (string, 可选): 应用描述

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

