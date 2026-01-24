---
name: 新建空间
description: 新建一个空间。当需要调用此工具API、执行新建空间操作时使用。
tool_type: bash_script
callable: true
---

# 新建空间

## 调用方式

直接调用下面命令执行技能：

```bash
# 在技能目录中执行
bash ../_skill-common/scripts/execute.sh \
  --skill-id "skill-9ae98992-c" \
  --parameters '{"title":"example_title","token":"example_token"}'
```

**脚本位置**: `.claude/skills/_skill-common/scripts/execute.sh`

## 功能说明
新建一个空间

> **技能ID**: `skill-9ae98992-c`

## 输入参数
调用技能时，需要在 `parameters` 字段中传入以下参数：

```json
{
  "token": "<string> (必需)",
  "title": "<string> (必需)"
}
```

**参数说明**：
- **token** (string, **必需**): 调用令牌
- **title** (string, **必需**): 空间名称

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

