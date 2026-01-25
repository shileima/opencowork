# 登录持久化功能测试指南

## 测试环境

- 开发服务器已启动
- 脚本位置：`~/.qa-cowork/skills/chrome-agent/`
- 登录状态保存位置：`~/.qa-cowork/skills/chrome-agent/session/{siteName}/`

## 测试步骤

### 1. 首次登录测试

1. 在 Electron 应用中打开"自动化"标签页
2. 找到并运行 `xiaohongshu-login-example.js` 脚本
3. 浏览器会自动打开并访问小红书
4. 在浏览器中完成登录（扫码或输入账号密码）
5. 登录完成后，回到终端按 **Enter** 键
6. 脚本会自动检测登录状态并保存

**预期结果：**
- ✅ 浏览器打开小红书网站
- ✅ 可以正常登录
- ✅ 登录后按 Enter，终端显示"✅ 已登录！"
- ✅ 终端显示"✅ 登录状态已保存"
- ✅ 在 `~/.qa-cowork/skills/chrome-agent/session/xiaohongshu/` 目录下生成：
  - `storage_state.json`（完整会话状态）
  - `cookies.json`（Cookies 备份）

### 2. 自动恢复登录测试

1. 关闭浏览器（如果还在运行）
2. 再次运行 `xiaohongshu-login-example.js` 脚本
3. 观察浏览器启动后的状态

**预期结果：**
- ✅ 浏览器启动后自动恢复登录状态
- ✅ 直接显示已登录的小红书页面（不需要重新登录）
- ✅ 终端显示"✅ 已登录状态"
- ✅ 不需要手动登录

### 3. 验证会话文件

检查会话文件是否正确保存：

```bash
# 查看会话目录
ls -lh ~/.qa-cowork/skills/chrome-agent/session/xiaohongshu/

# 查看 storage_state.json（应该包含 cookies 和 origins）
cat ~/.qa-cowork/skills/chrome-agent/session/xiaohongshu/storage_state.json | head -20

# 查看 cookies.json
cat ~/.qa-cowork/skills/chrome-agent/session/xiaohongshu/cookies.json | head -10
```

**预期结果：**
- ✅ `storage_state.json` 包含 `cookies` 和 `origins` 字段
- ✅ `cookies.json` 包含小红书相关的 cookies
- ✅ 文件大小合理（通常几 KB 到几十 KB）

### 4. 清除登录状态测试

如果需要测试清除功能，可以手动删除会话文件：

```bash
# 清除小红书登录状态
rm -rf ~/.qa-cowork/skills/chrome-agent/session/xiaohongshu/
```

然后再次运行脚本，应该会要求重新登录。

### 5. 多网站测试

测试不同网站的登录状态是否独立保存：

```javascript
// 创建微博登录管理器
const manager = new BrowserLoginManager('weibo', 'https://weibo.com');
```

**预期结果：**
- ✅ 不同网站的登录状态保存在不同的目录
- ✅ 小红书：`session/xiaohongshu/`
- ✅ 微博：`session/weibo/`
- ✅ 互不干扰

## 常见问题排查

### 问题1：脚本找不到 browser-login-manager.js

**解决方案：**
```bash
# 确保脚本在正确的位置
ls -lh ~/.qa-cowork/skills/chrome-agent/browser-login-manager.js

# 如果不存在，从资源目录复制
cp /path/to/resources/skills/chrome-agent/browser-login-manager.js ~/.qa-cowork/skills/chrome-agent/
```

### 问题2：登录状态没有保存

**检查：**
1. 确认按了 Enter 键（不是 Ctrl+C）
2. 检查终端是否有"✅ 登录状态已保存"的提示
3. 检查目录权限：`ls -ld ~/.qa-cowork/skills/chrome-agent/session/`

### 问题3：自动恢复失败

**检查：**
1. 确认 `storage_state.json` 文件存在且不为空
2. 检查文件内容格式是否正确（JSON）
3. 尝试删除会话文件重新登录

### 问题4：登录检测不准确

**解决方案：**
自定义登录检测函数，根据网站特点调整：

```javascript
const manager = new BrowserLoginManager('xiaohongshu', 'https://www.xiaohongshu.com', {
  isLoggedIn: async (page) => {
    // 更精确的检测逻辑
    const url = page.url();
    if (url.includes('/login')) return false;
    
    // 检查特定的登录标识元素
    const loginButton = await page.getByText('登录').isVisible().catch(() => false);
    if (loginButton) return false;
    
    // 检查用户相关元素
    const userMenu = await page.locator('[data-testid="user-menu"]').isVisible().catch(() => false);
    return userMenu;
  }
});
```

## 测试检查清单

- [ ] 首次登录可以正常保存状态
- [ ] 再次运行自动恢复登录状态
- [ ] 会话文件保存在用户本地目录（不是共享目录）
- [ ] 不同网站的登录状态独立保存
- [ ] 清除会话文件后需要重新登录
- [ ] 登录超时处理正常（5分钟）
- [ ] 错误处理正常（Ctrl+C 取消）

## 成功标准

✅ **功能测试通过**：
- 首次登录后状态正确保存
- 再次运行自动恢复登录
- 会话文件保存在用户本地目录
- 多网站登录状态独立管理

✅ **用户体验良好**：
- 交互提示清晰
- 错误处理友好
- 登录流程顺畅
