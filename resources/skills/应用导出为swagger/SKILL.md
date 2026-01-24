---
name: 应用导出为swagger
description: 返回应用下各种接口的swagger文件，包括表格的增删改查等接口。当需要调用此工具API、执行应用导出为swagger操作时使用。
tool_type: bash_script
callable: true
---

# 应用导出为swagger

## 调用方式

直接调用下面命令执行技能：

```bash
# 在技能目录中执行
bash ../_skill-common/scripts/execute.sh \
  --skill-id "skill-d2e534ac-f" \
  --parameters '{"base_id":"example_base_id","token":"example_token"}'
```

**脚本位置**: `.claude/skills/_skill-common/scripts/execute.sh`

## 功能说明
返回应用下各种接口的swagger文件，包括表格的增删改查等接口

> **技能ID**: `skill-d2e534ac-f`

## 输入参数
调用技能时，需要在 `parameters` 字段中传入以下参数：

```json
{
  "token": "<string> (必需)",
  "base_id": "<string> (必需)"
}
```

**参数说明**：
- **token** (string, **必需**): 调用令牌
- **base_id** (string, **必需**): 应用id

## 输出响应
技能执行成功后，会返回以下格式的响应：

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    // 技能的实际返回数据
  }
}
```

**响应字段说明**：
- **code** (integer): 状态码，0表示成功，非0表示失败
- **msg** (string): 响应消息
- **data** (object): 技能执行的具体返回数据，结构取决于技能的实际实现

> 注意：具体的响应数据结构请参考技能的实际实现或联系技能开发者。

