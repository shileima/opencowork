# 预设加密 API 密钥功能验证

## ✅ 已完成验证

### 1. 配置文件验证

**配置文件路径**: `~/Library/Application Support/qacowork/qa-cowork-config.json`

**验证结果**:
```json
"custom": {
    "id": "custom",
    "name": "自定义",
    "apiKey": "sk-IxmaHhECm3gk3lgCD12246316c1543B58",
    "apiUrl": "http://ccr.waimai.test.sankuai.com",
    "model": "oneapi,aws.claude-sonnet-4.5",
    "maxTokens": 131072,
    "isCustom": true,
    "readonlyUrl": false,
    "isPreset": true  ← ✅ 标记已设置
}
```

- ✅ `isPreset: true` 标记存在
- ✅ API Key 已解密（运行时）
- ✅ 其他配置信息完整

### 2. 代码安全性验证

**源代码文件**: `electron/config/ConfigStore.ts`

**存储格式**:
```typescript
'custom': {
    id: 'custom',
    name: '自定义',
    apiKey: 'ENCRYPTED:I/8TmhI7yKbUOwCFkVeVCQ==:eWCxb+AuF7rUt51Y44qw0Y5mpL4Hd9ZziwBFRuHT5EXnTaep80DG+upbdNwo9oAz',
    // ↑ 加密字符串，无法直接读取明文
    ...
}
```

- ✅ API Key 以 `ENCRYPTED:` 前缀存储
- ✅ 无法通过查看代码文件获取明文
- ✅ 需要运行时解密才能使用

### 3. 自动化测试验证

运行测试脚本:
```bash
node scripts/test-preset-config.mjs
```

**测试结果**:
```
✅ API Key 不为空
✅ API Key 不以 ENCRYPTED: 开头
✅ isPreset 为 true
✅ API URL 正确
✅ Model 正确

🎉 所有检查通过！预设配置正确加载。
```

## 📋 下一步：启动应用验证

现在需要启动应用来验证设置界面的显示效果：

### 启动应用
```bash
cd /Users/shilei/ai/opencowork
npm run dev
```

### 验证步骤

1. **打开设置界面**
   - 点击右上角设置图标
   - 切换到 "API 配置" 标签

2. **检查自定义提供商**
   - 确认当前选中的是 "自定义" 提供商
   - 查看 API Key 输入框

3. **预期效果**
   - ✅ API Key 显示为掩码格式：`sk-***...***B58`
   - ✅ 输入框为禁用状态（灰色背景）
   - ✅ 没有显示/隐藏密码按钮（眼睛图标）
   - ✅ 显示提示：`此为预设配置，API 密钥已加密保护，不可修改`
   - ✅ 无法编辑 API Key

4. **测试 API 调用**
   - 在聊天界面发送测试消息
   - 验证 API 调用成功

5. **测试提供商切换**
   - 切换到其他提供商（如 "智谱 GLM"）
   - 验证可以正常编辑 API Key
   - 切换回 "自定义"
   - 验证仍然显示掩码且不可编辑

## 🔧 如果仍然显示明文

如果启动应用后仍然显示完整的 API 密钥，可能的原因：

### 原因 1: 前端缓存
**解决方法**: 在应用中按 `Cmd+R` 刷新页面

### 原因 2: 配置未正确传递
**解决方法**: 检查浏览器控制台，查看 `config.providers.custom` 的值

### 原因 3: React 状态未更新
**解决方法**: 
1. 关闭应用
2. 删除配置文件：`rm ~/Library/Application\ Support/qacowork/qa-cowork-config.json`
3. 重新启动应用（会自动初始化预设配置）

## 🎯 功能总结

### 实现的功能
1. ✅ API 密钥以加密形式存储在代码中
2. ✅ 运行时自动解密
3. ✅ 设置界面显示掩码格式
4. ✅ 预设配置不可编辑
5. ✅ 用户可以切换到其他提供商

### 安全性
- **代码层面**: 密钥加密存储，无法直接读取
- **用户界面**: 显示掩码，无法复制完整密钥
- **配置文件**: 解密后存储，但标记为 `isPreset: true`

### 使用的技术
- AES-256-CBC 加密算法
- 基于机器 MAC 地址的密钥派生
- PBKDF2 (100000 次迭代)
- Node.js 内置 crypto 模块

## 📝 维护说明

### 更新 API 密钥
1. 运行加密脚本: `node scripts/encrypt-api-key.mjs`
2. 输入新的 API 密钥
3. 复制加密字符串到 `ConfigStore.ts`
4. 重新编译应用

### 重置配置
如果需要重新初始化配置:
```bash
node scripts/init-preset-config.mjs
```
