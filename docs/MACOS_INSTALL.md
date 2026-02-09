# macOS 安装指南 / macOS Installation Guide

## 问题：无法打开应用

如果你在 macOS 上遇到 "已损坏，无法打开" 的错误，这是因为应用未经过 Apple 公证。

If you see "damaged and can't be opened" error on macOS, it's because the app is not notarized by Apple.

## 解决方法 / Solutions

### 方法 1：使用自动脚本（推荐）/ Method 1: Use Auto Script (Recommended)

下载并运行移除隔离属性脚本：

Download and run the quarantine removal script:

```bash
# 下载脚本 / Download script
curl -O https://raw.githubusercontent.com/shileima/opencowork/main/scripts/remove-quarantine.sh

# 运行脚本 / Run script
bash remove-quarantine.sh
```

### 方法 2：手动执行命令 / Method 2: Manual Command

在终端中执行以下命令：

Run this command in Terminal:

```bash
xattr -cr /Applications/QACowork.app
```

然后启动应用：

Then launch the app:

```bash
open -a QACowork
```

### 方法 3：通过 Finder 打开 / Method 3: Open via Finder

1. 在 Finder 中找到 QACowork.app
2. **按住 Control 键点击**（或右键点击）
3. 选择 "打开"
4. 在弹出的对话框中点击 "打开"

---

1. Find QACowork.app in Finder
2. **Control-click** (or right-click) on it
3. Select "Open"
4. Click "Open" in the dialog

### 方法 4：系统设置 / Method 4: System Settings

1. 打开 **系统设置 > 隐私与安全性**
2. 找到 "仍要打开" 按钮
3. 点击 "打开"

---

1. Open **System Settings > Privacy & Security**
2. Find "Open Anyway" button
3. Click "Open"

## 为什么会出现这个问题？/ Why does this happen?

这个应用是开源项目，没有购买 Apple Developer 账号（99美元/年）进行代码签名和公证。

This is an open-source project without an Apple Developer account ($99/year) for code signing and notarization.

## 安全性 / Security

- ✅ 代码完全开源，可在 GitHub 上审查
- ✅ 构建过程在 GitHub Actions 上公开透明
- ✅ 没有恶意代码

---

- ✅ Code is fully open source and reviewable on GitHub
- ✅ Build process is transparent on GitHub Actions
- ✅ No malicious code

## 未来计划 / Future Plans

我们计划在获得足够支持后购买 Apple Developer 账号，提供官方签名版本。

We plan to purchase an Apple Developer account and provide officially signed versions once we have enough support.
