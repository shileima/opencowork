---
name: knowledge-plaza
description: 搜索美团知识广场，获取公司通用知识、术语解释、最佳实践等。当用户问美团相关的通用问题时使用。
allowed-tools: Bash
---

# 美团知识广场

用于搜索和获取美团内部的通用知识，包括：
- 公司术语解释（BU、BG、OKR 等）
- 管理方法论（1ON1、Think Big Picture 等）
- 最佳实践和指南
- AI 编程建议等

## API 调用

```bash
# 浏览知识广场（分页）
curl -s "https://xiaomeiai.meituan.com/weiwei/knowledge/plaza?offset=0&limit=20" \
  -H "Accept: */*" \
  -H "content-type: application/json" \
  -H "access-token: <SSO_TOKEN>"

# 搜索知识（通过关键词）
curl -s "https://xiaomeiai.meituan.com/weiwei/knowledge/plaza?offset=0&limit=20&keyword=<关键词>" \
  -H "Accept: */*" \
  -H "content-type: application/json" \
  -H "access-token: <SSO_TOKEN>"

# 获取单条知识详情
curl -s "https://xiaomeiai.meituan.com/weiwei/knowledge/<知识ID>" \
  -H "Accept: */*" \
  -H "content-type: application/json" \
  -H "access-token: <SSO_TOKEN>"
```

## 使用场景

1. 用户问"什么是 BU"、"OKR 怎么写" → 搜索知识广场
2. 用户问美团相关的通用问题 → 先搜索知识广场
3. 需要引用公司标准说法时 → 引用知识广场内容

## 注意事项

- access-token 使用当前用户的 SSO token
- 返回的 content_preview 是摘要，需要详情时调用详情 API
- 引用时注明来源："根据美团知识广场..."

## 学习笔记

（小美会在这里记录知识广场相关的经验教训）
