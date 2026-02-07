# 快速开始：内置 Node.js

## 🚀 5 分钟快速开始

### 开发者

```bash
# 1. 安装依赖
npm install

# 2. 准备内置 Node.js（首次运行）
npm run prepare:node-npm

# 3. 验证（可选）
./scripts/test-builtin-node.sh

# 4. 启动开发
npm run dev
```

### 用户

1. 启动应用
2. 点击"立即安装" Playwright 按钮
3. 等待 2-3 分钟
4. 开始使用！

## 📖 详细文档

- **实现文档**：[BUILTIN_NODE_IMPLEMENTATION.md](./BUILTIN_NODE_IMPLEMENTATION.md)
- **修复文档**：[../PLAYWRIGHT_FIX.md](../PLAYWRIGHT_FIX.md)
- **总结文档**：[../IMPLEMENTATION_SUMMARY.md](../IMPLEMENTATION_SUMMARY.md)

## ❓ 常见问题

### Q: 为什么需要内置 Node.js？

A: 为了确保所有用户使用相同的 Node.js 版本，避免环境差异导致的问题。

### Q: 会增加多少应用大小？

A: 约 99MB（Node.js 84MB + npm 15MB）

### Q: 如何更新 Node.js 版本？

A: 
```bash
# 1. 更新系统 Node.js 到目标版本
nvm install v20.x.x
nvm use v20.x.x

# 2. 重新准备
npm run prepare:node-npm

# 3. 重新构建
npm run build
```

### Q: 支持哪些平台？

A: 
- ✅ macOS ARM64 (Apple Silicon)
- ✅ macOS x64 (Intel)
- ⚠️  Windows（待实现）
- ❌ Linux（使用系统 Node.js）

## 🐛 遇到问题？

1. **运行测试脚本**：
   ```bash
   ./scripts/test-builtin-node.sh
   ```

2. **重新准备**：
   ```bash
   npm run prepare:node-npm
   ```

3. **查看日志**：
   打开开发者工具，查看控制台输出

4. **查看文档**：
   - [故障排查](./BUILTIN_NODE_IMPLEMENTATION.md#故障排查)
   - [已知问题](../IMPLEMENTATION_SUMMARY.md#已知问题)

## 📞 获取帮助

- 查看详细文档：`docs/BUILTIN_NODE_IMPLEMENTATION.md`
- 运行测试脚本：`./scripts/test-builtin-node.sh`
- 提交 Issue：[GitHub Issues](https://github.com/shileima/opencowork/issues)
