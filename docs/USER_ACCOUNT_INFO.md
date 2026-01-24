# 用户账户信息获取指南

## 概述

OpenCowork 提供了多种方式获取用户的本地账户信息，用于用户识别、权限管理和个性化设置。

## 获取方式

### 1. Node.js `os` 模块（主要方式）

应用使用 Node.js 的 `os` 模块获取系统用户信息：

```typescript
import os from 'os';

// 获取用户信息
const userInfo = os.userInfo();
// 返回: { username, uid, gid, homedir, shell }

// 获取主机名
const hostname = os.hostname();

// 获取平台信息
const platform = os.platform(); // 'darwin', 'win32', 'linux'
const arch = os.arch(); // 'x64', 'arm64', etc.
```

### 2. 通过 IPC 获取（前端）

前端可以通过 IPC 调用获取用户账户信息：

```typescript
// 获取用户标识符（用户名，小写）
const identifier = await window.ipcRenderer.invoke('permission:get-user-identifier');

// 获取完整的用户账户信息
const accountInfo = await window.ipcRenderer.invoke('permission:get-user-account-info');
```

## 用户账户信息结构

### 完整账户信息对象

```typescript
interface UserAccountInfo {
    username: string;      // 系统用户名（例如: "shilei", "admin"）
    uid: number;           // 用户ID（Unix/Linux/macOS），Windows 返回 -1
    gid: number;           // 组ID（Unix/Linux/macOS），Windows 返回 -1
    homedir: string;       // 用户主目录路径
    shell: string;         // 默认 Shell（Unix/Linux/macOS），Windows 返回空字符串
    hostname: string;      // 计算机主机名
    platform: string;      // 操作系统平台（'darwin', 'win32', 'linux'）
    arch: string;          // CPU 架构（'x64', 'arm64', 'ia32'）
}
```

### 各平台差异

#### macOS / Linux
```javascript
{
    username: "shilei",
    uid: 501,
    gid: 20,
    homedir: "/Users/shilei",
    shell: "/bin/zsh",
    hostname: "MacBook-Pro.local",
    platform: "darwin",
    arch: "x64"
}
```

#### Windows
```javascript
{
    username: "Administrator",
    uid: -1,              // Windows 不支持 UID
    gid: -1,              // Windows 不支持 GID
    homedir: "C:\\Users\\Administrator",
    shell: "",            // Windows 不使用 Shell
    hostname: "DESKTOP-ABC123",
    platform: "win32",
    arch: "x64"
}
```

## 使用场景

### 1. 用户识别（预设管理员）

应用使用 `username` 来识别预设管理员：

```typescript
// PermissionService.ts
const username = os.userInfo().username;
const normalizedUsername = username.toLowerCase();

// 检查是否在预设管理员列表中
const isPresetAdmin = adminUsers.includes(normalizedUsername);
```

### 2. 权限管理

基于用户名进行权限检查：

```typescript
// 获取当前用户角色
const role = permissionService.getUserRole();

// 检查是否为管理员
const isAdmin = permissionService.isAdmin();
```

### 3. 个性化设置

使用用户主目录存储用户配置：

```typescript
const userInfo = os.userInfo();
const configPath = path.join(userInfo.homedir, '.opencowork', 'config.json');
```

## API 参考

### PermissionService 方法

#### `getCurrentUserIdentifier(): string`
获取当前用户标识符（用户名的小写形式）

```typescript
const identifier = permissionService.getCurrentUserIdentifier();
// 返回: "shilei"
```

#### `getUserAccountInfo(): UserAccountInfo`
获取完整的用户账户信息

```typescript
const info = permissionService.getUserAccountInfo();
// 返回完整的账户信息对象
```

### IPC Handlers

#### `permission:get-user-identifier`
获取用户标识符（前端调用）

```typescript
const identifier = await window.ipcRenderer.invoke('permission:get-user-identifier');
```

#### `permission:get-user-account-info`
获取完整用户账户信息（前端调用）

```typescript
const info = await window.ipcRenderer.invoke('permission:get-user-account-info');
```

## 在 UI 中查看

用户可以在设置页面查看账户信息：

1. 打开应用设置
2. 切换到"管理员"标签页
3. 在"当前角色"下方可以看到：
   - 当前用户名
   - 点击"查看账户详情"可以展开查看完整信息：
     - UID / GID
     - 主目录路径
     - Shell（如果可用）
     - 主机名
     - 平台和架构信息

## 安全考虑

### 用户隐私
- 用户账户信息仅在本地使用，不会发送到远程服务器
- 用户名用于权限识别，不会泄露敏感信息

### 权限控制
- 只有管理员可以查看预设管理员列表
- 普通用户只能查看自己的账户信息

### 跨平台兼容性
- Windows 系统不支持 UID/GID，返回 -1
- Windows 系统不使用 Shell，返回空字符串
- 用户名在所有平台上都可用

## 扩展功能

### 未来可扩展的识别方式

当前实现支持基于用户名的识别，未来可以扩展：

1. **邮箱地址识别**
   ```json
   {
     "adminEmails": ["admin@example.com"]
   }
   ```

2. **MAC 地址识别**
   ```json
   {
     "adminMacAddresses": ["00:1B:44:11:3A:B7"]
   }
   ```

3. **设备指纹识别**
   - CPU 序列号
   - 主板序列号
   - 其他硬件标识符

## 代码示例

### 后端：获取用户信息

```typescript
// electron/config/PermissionService.ts
import os from 'os';

public getUserAccountInfo() {
    const userInfo = os.userInfo();
    return {
        username: userInfo.username,
        uid: userInfo.uid || -1,
        gid: userInfo.gid || -1,
        homedir: userInfo.homedir,
        shell: userInfo.shell || '',
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch()
    };
}
```

### 前端：显示用户信息

```typescript
// src/components/SettingsView.tsx
useEffect(() => {
    window.ipcRenderer.invoke('permission:get-user-account-info')
        .then((info) => {
            setUserAccountInfo(info);
        });
}, []);

// 显示用户信息
{userAccountInfo && (
    <div>
        <p>用户名: {userAccountInfo.username}</p>
        <p>主目录: {userAccountInfo.homedir}</p>
        <p>主机名: {userAccountInfo.hostname}</p>
    </div>
)}
```

## 常见问题

### Q: 如何获取当前登录用户的用户名？
A: 使用 `os.userInfo().username` 或通过 IPC 调用 `permission:get-user-identifier`。

### Q: Windows 和 macOS/Linux 获取的信息有什么不同？
A: Windows 不支持 UID/GID，返回 -1；Windows 不使用 Shell，返回空字符串。其他字段在所有平台都可用。

### Q: 用户名会改变吗？
A: 系统用户名通常不会改变，除非用户重命名系统账户。如果用户名改变，需要更新预设管理员列表。

### Q: 如何确保用户识别的准确性？
A: 
- 使用系统提供的 `os.userInfo()` API，这是最可靠的方式
- 用户名比较时不区分大小写
- 可以结合多个标识符（用户名、主机名、MAC地址）提高准确性

### Q: 用户信息会泄露吗？
A: 不会。所有用户信息仅在本地使用，不会发送到任何远程服务器。

## 相关文件

- `electron/config/PermissionService.ts`：用户账户信息获取服务
- `electron/main.ts`：IPC handlers 定义
- `src/components/SettingsView.tsx`：用户信息显示 UI
