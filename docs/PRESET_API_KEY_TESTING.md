# 预设加密 API 密钥测试指南

## 功能概述

本功能实现了 API 密钥的加密预设，确保：
1. API 密钥以加密形式存储在代码中
2. 用户界面显示为掩码格式（如 `sk-***...***B58`）
3. 预设配置不可编辑
4. 用户可以切换到其他提供商并配置自己的 API Key

## 实现文件

### 新增文件
1. `electron/utils/encryption.ts` - 加密工具模块
2. `scripts/encrypt-api-key.mjs` - 加密脚本

### 修改文件
1. `electron/config/ConfigStore.ts` - 添加解密逻辑和预设配置
2. `src/components/SettingsView.tsx` - 添加掩码显示和禁用编辑

## 测试步骤

### 1. 验证加密脚本

```bash
cd /Users/shilei/ai/opencowork
node scripts/encrypt-api-key.mjs
```

**预期结果**：
- 显示机器信息（MAC 地址、主机名）
- 成功加密默认密钥
- 输出加密字符串（格式：`ENCRYPTED:base64:base64`）
- 验证解密成功

### 2. 检查配置文件

查看 `electron/config/ConfigStore.ts` 中的 `defaultProviders`：

```typescript
'custom': {
    id: 'custom',
    name: '自定义',
    apiKey: 'ENCRYPTED:I/8TmhI7yKbUOwCFkVeVCQ==:eWCxb+AuF7rUt51Y44qw0Y5mpL4Hd9ZziwBFRuHT5EXnTaep80DG+upbdNwo9oAz',
    apiUrl: 'http://ccr.waimai.test.sankuai.com',
    model: 'oneapi,aws.claude-sonnet-4.5',
    maxTokens: 131072,
    isCustom: true,
    readonlyUrl: false,
    isPreset: true
}
```

**验证点**：
- ✅ `apiKey` 以 `ENCRYPTED:` 开头
- ✅ `isPreset: true` 标记存在
- ✅ 其他配置信息正确

### 3. 启动应用测试

```bash
npm run dev
```

#### 3.1 检查应用启动

**验证点**：
- ✅ 应用正常启动，无错误
- ✅ 控制台显示解密日志：`[ConfigStore] Decrypted API key for provider: custom`

#### 3.2 检查设置界面

1. 打开应用设置（点击右上角设置图标）
2. 切换到 "API 配置" 标签
3. 选择 "自定义" 提供商

**验证点**：
- ✅ API Key 输入框显示掩码格式：`sk-***...***B58`
- ✅ 输入框为禁用状态（灰色背景）
- ✅ 没有显示/隐藏密码按钮（眼睛图标）
- ✅ 显示提示信息：`此为预设配置，API 密钥已加密保护，不可修改`
- ✅ API URL 和 Model 显示正确配置
- ✅ 无法编辑 API Key 字段

#### 3.3 测试 API 调用

1. 在聊天界面发送一条测试消息
2. 观察是否成功调用 API

**验证点**：
- ✅ API 调用成功
- ✅ 收到正常响应
- ✅ 无认证错误

#### 3.4 测试提供商切换

1. 在设置中切换到其他提供商（如 "智谱 GLM"）
2. 输入测试 API Key
3. 保存配置

**验证点**：
- ✅ 可以正常切换提供商
- ✅ 其他提供商的 API Key 可以正常编辑
- ✅ 显示/隐藏密码按钮正常工作
- ✅ 切换回 "自定义" 后，预设配置仍然生效

### 4. 检查配置文件持久化

查看配置文件：

```bash
cat ~/Library/Application\ Support/qacowork/qa-cowork-config.json | python3 -m json.tool | grep -A 10 "custom"
```

**验证点**：
- ✅ `custom` 提供商的 `apiKey` 为解密后的明文（运行时解密）
- ✅ `isPreset: true` 标记存在
- ✅ 配置信息完整

### 5. 代码安全性验证

1. 在代码编辑器中打开 `electron/config/ConfigStore.ts`
2. 查找 `apiKey` 字段

**验证点**：
- ✅ 只能看到 `ENCRYPTED:` 开头的加密字符串
- ✅ 无法直接读取明文 API Key
- ✅ 需要运行时解密才能获取

### 6. 跨机器测试（可选）

如果在不同机器上部署：

1. 复制加密后的配置到另一台机器
2. 启动应用

**预期结果**：
- ⚠️ 可能无法解密（因为加密密钥基于机器特征）
- 需要在新机器上重新运行加密脚本

## 安全性说明

### 加密方案
- **算法**：AES-256-CBC
- **密钥派生**：基于 MAC 地址 + 应用密钥（PBKDF2，100000 次迭代）
- **IV**：每次加密随机生成

### 安全级别
1. **代码层面**：✅ 密钥以加密形式存储，无法直接读取
2. **用户界面**：✅ 显示为掩码，无法复制完整密钥
3. **配置文件**：⚠️ 运行时解密后存储明文（但标记为 `isPreset`）
4. **调试攻击**：⚠️ 有经验的开发者可通过调试获取运行时明文

### 限制
1. 加密密钥基于机器特征，不同机器需要重新加密
2. 这不是绝对安全的加密方案，主要防止普通用户查看
3. 建议结合服务端鉴权机制，限制 API Key 的使用范围

## 故障排查

### 问题 1：应用启动失败

**可能原因**：解密失败

**解决方法**：
1. 检查控制台错误日志
2. 确认加密字符串格式正确
3. 在当前机器重新运行加密脚本

### 问题 2：API 调用失败

**可能原因**：解密后的密钥不正确

**解决方法**：
1. 检查原始密钥是否正确
2. 重新加密并更新配置
3. 检查 API URL 和 Model 配置

### 问题 3：设置界面显示异常

**可能原因**：前端状态未正确更新

**解决方法**：
1. 刷新应用（Cmd+R）
2. 检查 `isPreset` 标记是否正确
3. 检查浏览器控制台错误

## 开发者注意事项

### 更新加密密钥

如果需要更新预设的 API 密钥：

1. 运行加密脚本：
```bash
node scripts/encrypt-api-key.mjs
```

2. 输入新的 API 密钥

3. 复制输出的加密字符串

4. 更新 `electron/config/ConfigStore.ts` 中的 `apiKey` 字段

5. 重新编译应用

### 多环境部署

如果需要在多台机器上部署：

**方案 1：统一加密密钥**
- 修改 `getMachineId()` 返回固定值
- 所有机器使用相同的加密字符串

**方案 2：环境变量**
- 将加密字符串存储在环境变量中
- 启动时从环境变量读取

**方案 3：配置文件**
- 使用外部配置文件存储加密字符串
- 部署时替换配置文件

## 总结

本功能成功实现了 API 密钥的加密预设，满足以下需求：

✅ 密钥以加密形式存储在代码中  
✅ 用户界面显示为掩码格式  
✅ 预设配置不可编辑  
✅ 用户可以切换到其他提供商  
✅ 无需额外依赖（使用 Node.js 内置 crypto）  
✅ TypeScript 类型安全  
✅ 无 linter 错误  

建议在生产环境部署前进行完整的端到端测试。
