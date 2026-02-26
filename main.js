import { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard } from "electron";
import { exec, execSync } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
import { ipcMainHandle, isDev, DEV_PORT } from "./util.js";
import { getPreloadPath, getUIPath, getIconPath } from "./pathResolver.js";
import { getStaticData, pollResources } from "./test.js";
import { handleClientEvent, sessions, initializeScheduler, stopScheduler } from "./ipc-handlers.js";
import { generateSessionTitle, ensureGitBash, setCachedGitBashPath, setGitBashStatusCallback, ensurePython, setCachedPythonPath, setPythonStatusCallback, safeStringify, ensureClaudeDirectories } from "./libs/util.js";
import { login, whoami, logout } from "./libs/sso-auth.js";
import { startLocalProxy, stopLocalProxy } from "./libs/local-proxy.js";
import { ensureDefaultWorkspace, ensurePlaywrightBrowser } from "./libs/default-workspace.js";
import { installBuiltinSkillsAsync } from "./libs/skills-installer.js";
import "./libs/claude-settings.js";
import { initAutoUpdater, checkForUpdates, quitAndInstall } from "./libs/auto-updater.js";
import { initSkillsUpdater, checkForSkillsUpdates, applySkillsUpdates, stopSkillsUpdater } from "./libs/skills-updater.js";
import { listLocalSkills, listCloudSkills, deleteSkill, importSkill, validateImport, installOneSkill, getSkillMd, getSkillFiles, clearDeletedRecord, selectImportSource, } from "./libs/skills-manager.js";
import fs from "fs";
import path from "path";
import https from "https";
async function postTrackingBatch(payload) {
    const url = new URL("https://xiaomeiai.meituan.com/weiwei/tracking/track/batch");
    const data = JSON.stringify({ events: payload.events });
    return await new Promise((resolve) => {
        const req = https.request({
            method: "POST",
            hostname: url.hostname,
            path: url.pathname,
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data),
                "access-token": payload.accessToken,
            },
        }, (res) => {
            const status = res.statusCode ?? 0;
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ ok: status >= 200 && status < 300, status, body }));
        });
        req.on("error", (err) => resolve({ ok: false, status: 0, body: String(err) }));
        req.setTimeout(10000, () => {
            req.destroy(new Error("Request timeout"));
        });
        req.write(data);
        req.end();
    });
}
// 设置日志文件
const logDir = path.join(app.getPath("userData"), "logs");
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, `main-${new Date().toISOString().split('T')[0]}.log`);
const logStream = fs.createWriteStream(logFile, { flags: "a" });
// safeStringify 已从 ./libs/util.js 导入
// 重写 console.log 和 console.error
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
function formatArg(a) {
    if (typeof a === 'string')
        return a;
    if (a === null || a === undefined)
        return String(a);
    return safeStringify(a);
}
console.log = (...args) => {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [LOG] ${args.map(formatArg).join(' ')}\n`;
    logStream.write(message);
    try {
        originalLog.apply(console, args);
    }
    catch {
        // Ignore EPIPE errors when stdout is closed
    }
};
console.error = (...args) => {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [ERROR] ${args.map(formatArg).join(' ')}\n`;
    logStream.write(message);
    try {
        originalError.apply(console, args);
    }
    catch {
        // Ignore EPIPE errors when stderr is closed
    }
};
console.warn = (...args) => {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [WARN] ${args.map(formatArg).join(' ')}\n`;
    logStream.write(message);
    try {
        originalWarn.apply(console, args);
    }
    catch {
        // Ignore EPIPE errors when stdout is closed
    }
};
// 处理 stdout/stderr 的 EPIPE 错误（当管道关闭时）
process.stdout?.on?.('error', (err) => {
    if (err.code === 'EPIPE')
        return; // 忽略 EPIPE
    logStream.write(`[${new Date().toISOString()}] [ERROR] stdout error: ${err.message}\n`);
});
process.stderr?.on?.('error', (err) => {
    if (err.code === 'EPIPE')
        return; // 忽略 EPIPE
    logStream.write(`[${new Date().toISOString()}] [ERROR] stderr error: ${err.message}\n`);
});
console.log('[Main] Log file:', logFile);
// 检查 Node.js 版本
async function checkNodeVersion() {
    try {
        const version = execSync('node --version', { encoding: 'utf-8' }).trim();
        console.log('[Main] Node version:', version);
        // 解析版本号 (v18.0.0 -> 18)
        const match = version.match(/^v(\d+)/);
        if (match) {
            const major = parseInt(match[1], 10);
            if (major >= 18) {
                return { ok: true, version };
            }
            return { ok: false, version, error: `Node.js 版本过低 (${version})，需要 v18.0.0 或更高版本` };
        }
        return { ok: false, version, error: `无法解析 Node.js 版本: ${version}` };
    }
    catch (error) {
        console.error('[Main] Node check failed:', error);
        return { ok: false, error: '未找到 Node.js，请先安装 Node.js 18+ (推荐使用 nvm 或 https://nodejs.org)' };
    }
}
app.on("ready", async () => {
    // Windows: 设置 App User Model ID，用于系统通知和任务栏分组
    // 必须与 electron-builder.json 中的 appId 一致
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.meituan.xiaomei-cowork');
    }
    // Windows: 移除默认菜单栏（File, Edit, Window, Help）
    // macOS 菜单栏在屏幕顶部，不影响窗口
    if (process.platform === 'win32') {
        Menu.setApplicationMenu(null);
    }
    // 确保 Claude 配置目录存在（~/.claude 和 ~/.claude/skills）
    ensureClaudeDirectories();
    // 先创建窗口，让用户尽快看到 UI
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        webPreferences: {
            preload: getPreloadPath(),
        },
        icon: getIconPath(),
        titleBarStyle: "hiddenInset",
        backgroundColor: "#FAF9F6",
        trafficLightPosition: { x: 15, y: 18 }
    });
    // 配置 CSP，允许连接埋点服务器和加载图片
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        // 移除现有的 CSP 头，使用我们自定义的
        const responseHeaders = { ...details.responseHeaders };
        delete responseHeaders['content-security-policy'];
        delete responseHeaders['Content-Security-Policy'];
        callback({
            responseHeaders: {
                ...responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; " +
                        "img-src 'self' data: blob: https: http:; " +
                        "connect-src 'self' ws://localhost:* http://localhost:* https://xiaomeiai.meituan.com https:; " +
                        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
                        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
                        "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
                        "font-src 'self' https://fonts.gstatic.com;"
                ]
            }
        });
    });
    // 允许地理位置权限（由系统弹窗处理）
    mainWindow.webContents.session.setPermissionRequestHandler((_, permission, callback) => {
        if (permission === "geolocation") {
            callback(true);
            return;
        }
        callback(false);
    });
    mainWindow.webContents.session.setPermissionCheckHandler((_, permission) => {
        if (permission === "geolocation")
            return true;
        return false;
    });
    if (isDev())
        mainWindow.loadURL(`http://localhost:${DEV_PORT}`);
    else
        mainWindow.loadFile(getUIPath());
    // 拦截外部链接，用系统浏览器打开
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // 允许 devtools
        if (url.startsWith('devtools://')) {
            return { action: 'allow' };
        }
        // 外部链接用系统浏览器打开
        shell.openExternal(url);
        return { action: 'deny' };
    });
    // 拦截页面内导航（点击 <a> 标签）
    mainWindow.webContents.on('will-navigate', (event, url) => {
        // dev 环境放行 localhost/127.0.0.1
        if (isDev() && (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1'))) {
            return;
        }
        // 如果不是当前页面的导航（外部链接），用系统浏览器打开
        if (!url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1') && !url.startsWith('file://')) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });
    // 监听渲染进程崩溃
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('[Main] Renderer process crashed:', details);
        console.error('[Main] Crash reason:', details.reason);
        console.error('[Main] Exit code:', details.exitCode);
    });
    // 监听渲染进程无响应
    mainWindow.webContents.on('unresponsive', () => {
        console.error('[Main] Renderer process became unresponsive');
    });
    // 监听渲染进程恢复响应
    mainWindow.webContents.on('responsive', () => {
        console.log('[Main] Renderer process became responsive again');
    });
    // 监听渲染进程控制台消息（捕获前端错误）
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        // level: 0=verbose, 1=info, 2=warning, 3=error
        if (level >= 3) {
            console.error('[Renderer Console Error]', message, `at ${sourceId}:${line}`);
        }
    });
    pollResources(mainWindow);
    // 清理旧的 agent-browser 进程和 daemon（异步，不阻塞 UI）
    (async () => {
        try {
            if (process.platform === 'win32') {
                await execAsync('taskkill /F /IM "agent-browser*.exe" 2>nul || exit 0');
                await execAsync('wmic process where "commandline like \'%agent-browser%daemon.js%\'" delete 2>nul || exit 0');
            }
            else {
                await execAsync('pgrep -u $(whoami) -f "agent-browser" | xargs kill 2>/dev/null || true');
                await execAsync('pgrep -u $(whoami) -f "agent-browser.*daemon\\.js" | xargs kill 2>/dev/null || true');
            }
            console.log('[Main] Cleaned up old agent-browser processes and daemon');
        }
        catch {
            // 忽略错误
        }
    })();
    // 后台初始化任务（不阻塞 UI 显示）
    (async () => {
        // 检查 Node.js 版本（仅记录日志）
        const nodeCheck = await checkNodeVersion();
        if (!nodeCheck.ok) {
            console.warn('[Main] System Node.js not available or version too low, using bundled Node.js:', nodeCheck.error);
        }
        else {
            console.log('[Main] System Node.js check passed:', nodeCheck.version);
        }
        // 广播状态的辅助函数
        const broadcastEvent = (type, payload) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server-event', JSON.stringify({ type, payload }));
            }
        };
        // 自动隐藏进度条的辅助函数
        const autoClearStatus = (type, delay = 2000) => {
            setTimeout(() => broadcastEvent(type, null), delay);
        };
        // === 并行初始化：Git Bash + Python + Browser + 其他 ===
        // 1. Git Bash（Windows 专用）
        const gitBashTask = process.platform === 'win32' ? (async () => {
            setGitBashStatusCallback((status) => {
                console.log('[Main] Git Bash status:', status);
                broadcastEvent('gitbash.status', status);
                if (status.status === "ready")
                    autoClearStatus('gitbash.status');
            });
            try {
                console.log('[Main] Checking Git Bash availability...');
                const gitBashPath = await ensureGitBash();
                if (gitBashPath) {
                    setCachedGitBashPath(gitBashPath);
                    console.log('[Main] Git Bash available:', gitBashPath);
                }
                else {
                    console.error('[Main] Git Bash not available, Claude Agent SDK may not work correctly');
                }
            }
            catch (error) {
                console.error('[Main] Failed to ensure Git Bash:', error);
            }
        })() : Promise.resolve();
        // 2. Python 环境
        const pythonTask = (async () => {
            setPythonStatusCallback((status) => {
                console.log('[Main] Python status:', status);
                broadcastEvent('python.status', status);
                if (status.status === "ready")
                    autoClearStatus('python.status');
            });
            try {
                console.log('[Main] Checking Python availability...');
                const pythonPath = await ensurePython();
                if (pythonPath) {
                    setCachedPythonPath(pythonPath);
                    console.log('[Main] Python available:', pythonPath);
                }
                else {
                    console.warn('[Main] Python not available, some features may not work');
                }
            }
            catch (error) {
                console.error('[Main] Failed to ensure Python:', error);
            }
        })();
        // 3. 浏览器（Chromium + Headless Shell）
        const browserTask = (async () => {
            try {
                await ensurePlaywrightBrowser((status) => {
                    console.log('[Main] Browser status:', status);
                    broadcastEvent('browser.status', status);
                    if (status.status === "ready")
                        autoClearStatus('browser.status');
                });
            }
            catch (error) {
                console.error('[Main] Failed to ensure browser:', error);
                broadcastEvent('browser.status', { status: 'error', message: '浏览器安装失败，请重启重试' });
                autoClearStatus('browser.status', 5000);
            }
        })();
        // 4. 本地代理（独立启动）
        const proxyTask = (async () => {
            try {
                const proxy = await startLocalProxy();
                process.env.ANTHROPIC_BASE_URL = `http://${proxy.host}:${proxy.port}`;
                console.log('[Main] Using local proxy base url:', process.env.ANTHROPIC_BASE_URL);
            }
            catch (error) {
                console.error('[Main] Failed to start local proxy:', error);
            }
        })();
        // 5. 其他轻量任务
        const skillsTask = installBuiltinSkillsAsync().then((result) => {
            if (result.installed.length > 0)
                console.log('[Main] Installed builtin skills:', result.installed);
            if (result.updated.length > 0)
                console.log('[Main] Updated builtin skills:', result.updated);
            if (result.failed.length > 0)
                console.warn('[Main] Failed to install some skills:', result.failed);
        });
        const schedulerTask = Promise.resolve().then(() => {
            initializeScheduler();
            console.log('[Main] Scheduler initialized');
        });
        // 全部并行执行
        const parallelResults = await Promise.allSettled([
            gitBashTask,
            pythonTask,
            browserTask,
            proxyTask,
            skillsTask,
            schedulerTask
        ]);
        for (const result of parallelResults) {
            if (result.status === 'rejected') {
                console.error('[Main] Parallel init task failed:', result.reason);
            }
        }
    })();
    ipcMainHandle("getStaticData", () => {
        return getStaticData();
    });
    // Handle client events
    ipcMain.on("client-event", (_, event) => {
        handleClientEvent(event);
    });
    // Forward renderer logs to main process log file
    ipcMain.on("renderer-log", (_, level, args) => {
        const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        if (level === 'error')
            console.error(`[Renderer] ${msg}`);
        else if (level === 'warn')
            console.warn(`[Renderer] ${msg}`);
        else
            console.log(`[Renderer] ${msg}`);
    });
    // Handle session title generation
    ipcMainHandle("generate-session-title", async (_, userInput) => {
        return await generateSessionTitle(userInput);
    });
    // Handle recent cwds request
    ipcMainHandle("get-recent-cwds", (_, limit) => {
        const boundedLimit = limit ? Math.min(Math.max(limit, 1), 20) : 8;
        return sessions.listRecentCwds(boundedLimit);
    });
    // Handle directory selection
    ipcMainHandle("select-directory", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory']
        });
        if (result.canceled) {
            return null;
        }
        return result.filePaths[0];
    });
    // Handle file selection for attachments - returns file data directly
    ipcMainHandle("select-files", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'All Supported Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'json', 'py', 'js', 'ts', 'jsx', 'tsx', 'go', 'rs', 'java', 'c', 'cpp', 'h'] },
                { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
                { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md'] },
                { name: 'Code', extensions: ['py', 'js', 'ts', 'jsx', 'tsx', 'json', 'go', 'rs', 'java', 'c', 'cpp', 'h'] }
            ]
        });
        if (result.canceled) {
            return [];
        }
        // Read files and return their data
        const files = [];
        for (const filePath of result.filePaths) {
            try {
                const data = fs.readFileSync(filePath);
                const name = path.basename(filePath);
                files.push({
                    name,
                    data: data.toString('base64'),
                    size: data.length,
                    filePath
                });
            }
            catch (error) {
                console.error(`Failed to read file: ${filePath}`, error);
            }
        }
        return files;
    });
    // SSO handlers
    ipcMainHandle("sso-login", async () => {
        return await login();
    });
    ipcMainHandle("sso-whoami", async () => {
        return await whoami();
    });
    ipcMainHandle("sso-logout", async () => {
        await logout();
        return true;
    });
    ipcMainHandle("sso-get-token", async () => {
        const { getSsoid } = await import("./libs/sso-auth.js");
        return await getSsoid();
    });
    ipcMainHandle("get-default-workspace", () => {
        return ensureDefaultWorkspace();
    });
    // Updater handlers
    ipcMainHandle("updater-check", async () => {
        await checkForUpdates();
    });
    ipcMainHandle("updater-install", () => {
        quitAndInstall();
    });
    ipcMainHandle("tracking-batch", async (_, payload) => {
        if (!payload?.accessToken || !Array.isArray(payload?.events)) {
            return { ok: false, status: 400, body: "Invalid payload" };
        }
        return await postTrackingBatch(payload);
    });
    // 打开外部链接（只允许可信域名）
    ipcMainHandle("open-external", async (_, url) => {
        const allowedDomains = ['s3plus.sankuai.com', 's3plus.meituan.net', 'github.com', 'km.sankuai.com'];
        try {
            const urlObj = new URL(url);
            if (!allowedDomains.some(d => urlObj.hostname.endsWith(d))) {
                console.error('[Main] Blocked external URL:', url);
                return;
            }
            await shell.openExternal(url);
        }
        catch (error) {
            console.error('[Main] Invalid URL:', url, error);
        }
    });
    ipcMainHandle("copy-to-clipboard", (_, text) => {
        clipboard.writeText(text);
    });
    // Initialize auto-updater
    initAutoUpdater(mainWindow);
    // Check for updates 5 seconds after app launch
    setTimeout(() => {
        checkForUpdates();
    }, 5000);
    // Initialize skills updater
    initSkillsUpdater(mainWindow);
    // Skills updater handlers
    ipcMainHandle("skills-updater-check", async () => {
        return await checkForSkillsUpdates();
    });
    ipcMainHandle("skills-updater-apply", async (_, updates) => {
        await applySkillsUpdates(updates);
    });
    // Check for skills updates 10 seconds after app launch (after app update check)
    setTimeout(() => {
        checkForSkillsUpdates();
    }, 10000);
    // Skills Manager handlers
    ipcMainHandle("skills-list-local", async () => {
        return await listLocalSkills();
    });
    ipcMainHandle("skills-list-cloud", async () => {
        return await listCloudSkills();
    });
    ipcMainHandle("skills-delete", (_, name) => {
        return deleteSkill(name);
    });
    ipcMainHandle("skills-import", (_, sourcePath, mode) => {
        return importSkill(sourcePath, mode);
    });
    ipcMainHandle("skills-validate-import", (_, sourcePath) => {
        return validateImport(sourcePath);
    });
    ipcMainHandle("skills-install-one", async (_, name) => {
        await installOneSkill(name);
    });
    ipcMainHandle("skills-get-skill-md", (_, name) => {
        return getSkillMd(name);
    });
    ipcMainHandle("skills-get-files", (_, name) => {
        return getSkillFiles(name);
    });
    ipcMainHandle("skills-clear-deleted", (_, name) => {
        clearDeletedRecord(name);
    });
    ipcMainHandle("skills-select-import-source", async () => {
        return await selectImportSource(mainWindow);
    });
});
// 应用退出时停止本地代理、定时任务调度器，并关闭数据库
app.on("before-quit", () => {
    stopScheduler();
    stopSkillsUpdater();
    // 刷新消息缓冲区并关闭数据库（sessions 已在顶部静态导入）
    sessions.close();
    // stopLocalProxy 是异步的，但 before-quit 不等待异步操作
    stopLocalProxy().catch(console.error);
});
