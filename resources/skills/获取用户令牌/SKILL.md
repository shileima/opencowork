---
name: 获取用户令牌
description: 根据用户的xc-auth，获取用户的xc-token。当需要调用此工具API、执行获取用户令牌操作时使用。
tool_type: bash_script
callable: true
---

# 获取用户令牌

## 调用方式

直接调用下面命令执行技能：

```bash
# 在技能目录中执行
bash ../_skill-common/scripts/execute.sh \
  --skill-id "skill-6fd5c743-5" \
  --parameters '{"xc-auth":"example_xc-auth"}'
```

**脚本位置**: `.claude/skills/_skill-common/scripts/execute.sh`

## 功能说明
根据用户的xc-auth，获取用户的xc-token

> **技能ID**: `skill-6fd5c743-5`

## 输入参数
调用技能时，需要在 `parameters` 字段中传入以下参数：

```json
{
  "xc-auth": "<string> (必需)"
}
```

**参数说明**：
- **xc-auth** (string, **必需**): 认证

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

