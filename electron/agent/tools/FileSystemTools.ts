import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { getBuiltinNodePath, getBuiltinNpmPath, getBuiltinNpmCliJsPath, getNpmEnvVars } from '../../utils/NodePath';
import { getPlaywrightEnvVars } from '../../utils/PlaywrightPath';

const execAsync = promisify(exec);

export const ReadFileSchema = {
    name: "read_file",
    description: "Read the content of a file from the local filesystem. Use this to analyze code or documents.",
    input_schema: {
        type: "object" as const,
        properties: {
            path: { type: "string", description: "Absolute path to the file." }
        },
        required: ["path"]
    }
};

export const WriteFileSchema = {
    name: "write_file",
    description: "Write content to a file. Overwrites existing files. Create directories if needed.",
    input_schema: {
        type: "object" as const,
        properties: {
            path: { type: "string", description: "Absolute path to the file." },
            content: { type: "string", description: "The content to write." }
        },
        required: ["path", "content"]
    }
};

export const ListDirSchema = {
    name: "list_dir",
    description: "List contents of a directory.",
    input_schema: {
        type: "object" as const,
        properties: {
            path: { type: "string", description: "Absolute path to the directory." }
        },
        required: ["path"]
    }
};

export const RunCommandSchema = {
    name: "run_command",
    description: "Execute a shell command (bash, python, npm, etc.). Use for running scripts, installing dependencies, building projects. The command runs in the specified working directory.",
    input_schema: {
        type: "object" as const,
        properties: {
            command: { type: "string", description: "The command to execute (e.g., 'python script.py', 'npm install')." },
            cwd: { type: "string", description: "Working directory for the command. Defaults to first authorized folder." }
        },
        required: ["command"]
    }
};

export const OpenBrowserPreviewSchema = {
    name: "open_browser_preview",
    description: "Open the built-in browser preview tab and navigate to a URL. Use this AFTER starting a local dev server (e.g., npm run dev) to show the user the preview. Common URLs: http://localhost:3000, http://localhost:5173, http://localhost:8080. Check package.json scripts or the dev server output for the actual port.",
    input_schema: {
        type: "object" as const,
        properties: {
            url: { type: "string", description: "The URL to open in the browser preview tab (e.g., 'http://localhost:3000'). Will auto-add http:// if missing." }
        },
        required: ["url"]
    }
};

export class FileSystemTools {

    async readFile(args: { path: string }) {
        try {
            const content = await fs.readFile(args.path, 'utf-8');
            return `Successfully read file ${args.path}:\n${content}`;
        } catch (error: unknown) {
            return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    async writeFile(args: { path: string, content: string }) {
        try {
            await fs.mkdir(path.dirname(args.path), { recursive: true });
            await fs.writeFile(args.path, args.content, 'utf-8');
            return `Successfully wrote to ${args.path}`;
        } catch (error: unknown) {
            return `Error writing file: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    async listDir(args: { path: string }) {
        try {
            const items = await fs.readdir(args.path, { withFileTypes: true });
            const result = items.map(item =>
                `${item.isDirectory() ? '[DIR]' : '[FILE]'} ${item.name}`
            ).join('\n');
            return `Directory contents of ${args.path}:\n${result}`;
        } catch (error: unknown) {
            return `Error listing directory: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    async runCommand(args: { command: string, cwd?: string }, defaultCwd: string) {
        const workingDir = args.cwd || defaultCwd;
        const timeout = 60000; // 60 second timeout

        // 如果命令包含 'node' 或 'npm'，替换为内置的路径
        let command = args.command;
        const builtinNodePath = getBuiltinNodePath();
        const builtinNpmPath = getBuiltinNpmPath();
        
        if (builtinNodePath && builtinNodePath !== 'node') {
            // 使用正则表达式替换独立的 'node' 命令（避免替换其他单词中的 node）
            // 匹配：node 前后是空白字符、引号、行首或行尾
            const nodeRegex = /(^|\s|["'])\bnode\b(\s|$|["'])/g;
            const nodeCommand = builtinNodePath.includes(' ') ? `"${builtinNodePath}"` : builtinNodePath;
            command = command.replace(nodeRegex, (_match, before, after) => {
                // 保留前后的空白字符或引号
                return `${before}${nodeCommand}${after}`;
            });
        }
        
        if (builtinNpmPath && builtinNpmPath !== 'npm') {
            // npm 脚本会在 process.execPath 的目录下查找 node_modules/npm/bin/npm-cli.js
            // 我们已经创建了符号链接，所以 npm 脚本应该能工作
            // 但为了更可靠，优先使用 node 直接执行 npm-cli.js
            const npmCliJsPath = getBuiltinNpmCliJsPath();
            const builtinNodePathForNpm = getBuiltinNodePath();
            
            if (npmCliJsPath && builtinNodePathForNpm && builtinNodePathForNpm !== 'node') {
                // 使用 node 直接执行 npm-cli.js，避免 npm 脚本的路径问题
                const nodeCommand = builtinNodePathForNpm.includes(' ') ? `"${builtinNodePathForNpm}"` : builtinNodePathForNpm;
                const npmCliCommand = npmCliJsPath.includes(' ') ? `"${npmCliJsPath}"` : npmCliJsPath;
                
                // 替换 npm 命令为: node npm-cli.js [args]
                // 匹配: npm 后跟空格和参数（可能是 install、run 等）
                // 例如: "npm install" -> "node npm-cli.js install"
                //      'npm run build' -> 'node npm-cli.js run build'
                const npmRegex = /(^|\s|["'])\bnpm\b(\s+)(.*?)(?=\s*$|\s*["']|$)/g;
                command = command.replace(npmRegex, (_match, before, _space, args) => {
                    // 保留 npm 后的所有参数
                    const npmArgs = args.trim();
                    return `${before}${nodeCommand} ${npmCliCommand}${npmArgs ? ' ' + npmArgs : ''}`;
                });
            } else {
                // 回退到使用 npm 脚本（现在有符号链接应该能工作）
                const npmRegex = /(^|\s|["'])\bnpm\b(\s|$|["'])/g;
                const npmCommand = builtinNpmPath.includes(' ') ? `"${builtinNpmPath}"` : builtinNpmPath;
                command = command.replace(npmRegex, (_match, before, after) => {
                    // 保留前后的空白字符或引号
                    return `${before}${npmCommand}${after}`;
                });
            }
        }

        // 检测是否为自动化测试命令（可能启动 Chrome for Testing）
        const isAutomationTest = this.isAutomationTestCommand(command);

        // 检测是否为开发服务器命令 - 禁止打开外部 Chrome，使用内置浏览器 Tab 展示
        const isDevServerCommand = /run\s+(dev|start)\b|pnpm\s+(dev|start)\b|yarn\s+(dev|start)\b|npx\s+vite|vite\s|webpack.*serve/i.test(command);

        try {
            // 获取 Playwright 和 npm 环境变量
            const playwrightEnv = getPlaywrightEnvVars();
            const npmEnv = getNpmEnvVars();
            let env: NodeJS.ProcessEnv = {
                ...process.env,
                ...playwrightEnv,
                ...npmEnv,
                // CRA/Vite 等支持 BROWSER=none
                ...(isDevServerCommand ? { BROWSER: 'none' } : {}),
                // Project 模式约束：开发服务器统一使用端口 3000（CRA/Next 等认 PORT，Vite 需配合 --port）
                ...(isDevServerCommand ? { PORT: '3000', VITE_PORT: '3000' } : {})
            };

            // macOS/Linux：用假命令劫持 open/xdg-open，阻止 webpack-dev-server 等打开外部浏览器
            if (isDevServerCommand && (process.platform === 'darwin' || process.platform === 'linux')) {
                const noBrowserDir = this.ensureNoBrowserScriptDir();
                if (noBrowserDir) {
                    env = { ...env, PATH: `${noBrowserDir}:${env.PATH || process.env.PATH || ''}` };
                }
            }
            
            console.log(`[FileSystemTools] Executing command: ${command} in ${workingDir}`);

            // 开发服务器命令：后台运行，统一端口 3000，便于内置浏览器预览
            if (isDevServerCommand) {
                const PROJECT_DEV_PORT = 3000;
                const parsedPort = this.parseDevServerPort(command, workingDir);
                // Vite 默认 5173，需通过 CLI 指定端口；CRA/Next 等认 PORT 环境变量
                let runCommand = command;
                if (parsedPort === 5173 && !/--port\s+\d+|\b5173\b/.test(command)) {
                    const isRunScript = /(?:npm|pnpm|yarn)\s+(?:run\s+)?(dev|start)\b/i.test(command);
                    runCommand = isRunScript
                        ? command.trimEnd() + ' -- --port ' + PROJECT_DEV_PORT
                        : command.trimEnd() + ' --port ' + PROJECT_DEV_PORT;
                }
                await this.killProcessOnPort(PROJECT_DEV_PORT);
                const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
                const child = spawn(runCommand, [], {
                    cwd: workingDir,
                    env: env,
                    shell,
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();
                await new Promise(resolve => setTimeout(resolve, 4000));
                const url = `http://localhost:${PROJECT_DEV_PORT}`;
                return `[Dev server started in background]\n\nCommand: ${runCommand}\nWorking directory: ${workingDir}\n\nPreview URL: ${url}\n\nThe development server is running on port ${PROJECT_DEV_PORT}. Use open_browser_preview to display it in the built-in browser.`;
            }

            if (Object.keys(playwrightEnv).length > 0) {
                console.log(`[FileSystemTools] Playwright env vars: ${JSON.stringify(playwrightEnv)}`);
            }
            if (Object.keys(npmEnv).length > 0) {
                console.log(`[FileSystemTools] npm env vars: ${JSON.stringify(npmEnv)}`);
            }
            
            const { stdout, stderr } = await execAsync(command, {
                cwd: workingDir,
                env: env,
                timeout: timeout,
                maxBuffer: 1024 * 1024 * 10, // 10MB buffer
                encoding: 'utf-8',
                shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
            });

            // 如果是自动化测试命令，执行完成后清理 Chrome for Testing 进程
            if (isAutomationTest) {
                await this.cleanupChromeForTesting();
            }

            let result = `Command executed in ${workingDir}:\n$ ${command}\n\n`;
            if (stdout) result += `STDOUT:\n${stdout}\n`;
            if (stderr) result += `STDERR:\n${stderr}\n`;
            return result || 'Command completed with no output.';
        } catch (error: unknown) {
            // 即使命令失败，如果是自动化测试命令，也要清理 Chrome for Testing 进程
            if (isAutomationTest) {
                await this.cleanupChromeForTesting();
            }

            const err = error as { stdout?: string; stderr?: string; message?: string };
            let errorMsg = `Command failed in ${workingDir}:\n$ ${command}\n\n`;
            if (err.stdout) errorMsg += `STDOUT:\n${err.stdout}\n`;
            if (err.stderr) errorMsg += `STDERR:\n${err.stderr}\n`;
            errorMsg += `Error: ${err.message || String(error)}`;
            return errorMsg;
        }
    }

    /**
     * 确保存在“不打开浏览器”的假命令目录，用于劫持 open/xdg-open
     * macOS: 劫持 open；Linux: 劫持 xdg-open
     * 返回目录路径，失败时返回 null
     */
    private parseDevServerPort(command: string, cwd: string): number {
        const lower = command.toLowerCase();
        if (lower.includes('5173') || lower.includes('vite')) return 5173;
        if (lower.includes('8080')) return 8080;
        if (lower.includes('4173')) return 4173;
        try {
            const pkgPath = path.join(cwd, 'package.json');
            const content = fsSync.readFileSync(pkgPath, 'utf-8');
            const pkg = JSON.parse(content);
            const scripts = pkg.scripts || {};
            const devScript = (scripts.dev || scripts.start || '').toString();
            if (/5173|vite/.test(devScript)) return 5173;
            if (/8080/.test(devScript)) return 8080;
            if (fsSync.existsSync(path.join(cwd, 'vite.config.js'))) return 5173;
        } catch {
            /* ignore */
        }
        return 3000;
    }

    private ensureNoBrowserScriptDir(): string | null {
        try {
            const dir = path.join(os.tmpdir(), 'opencowork-no-browser');
            fsSync.mkdirSync(dir, { recursive: true });
            const scriptName = process.platform === 'darwin' ? 'open' : 'xdg-open';
            const scriptPath = path.join(dir, scriptName);
            const scriptContent = '#!/bin/sh\nexit 0\n';
            fsSync.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
            return dir;
        } catch (e) {
            console.warn('[FileSystemTools] Failed to create no-browser script:', e);
            return null;
        }
    }

    /**
     * 获取占用指定端口的进程 PID 列表（仅 LISTEN 状态）
     */
    private async getPidsOnPort(port: number): Promise<number[]> {
        try {
            if (process.platform === 'darwin' || process.platform === 'linux') {
                const { stdout } = await execAsync(`lsof -ti :${port}`, {
                    timeout: 3000,
                    maxBuffer: 4096,
                    encoding: 'utf-8'
                });
                const pids = stdout.trim().split(/\s+/).filter(Boolean).map((s) => parseInt(s, 10));
                return pids.filter((n) => !isNaN(n) && n > 0);
            }
            if (process.platform === 'win32') {
                const { stdout } = await execAsync(`netstat -ano | findstr ":${port}"`, {
                    timeout: 3000,
                    maxBuffer: 65536,
                    encoding: 'utf-8',
                    shell: 'cmd.exe'
                });
                const pids: number[] = [];
                const lines = stdout.trim().split(/\r?\n/).filter((line) => line.includes(`:${port}`) && line.includes('LISTENING'));
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    const last = parts[parts.length - 1];
                    const pid = parseInt(last, 10);
                    if (!isNaN(pid) && pid > 0) pids.push(pid);
                }
                return [...new Set(pids)];
            }
        } catch (e) {
            const err = e as { code?: number };
            if (err.code === 1) return [];
        }
        return [];
    }

    /**
     * 若指定端口被占用，则结束占用该端口的进程，以便开发服务器能正常启动
     */
    private async killProcessOnPort(port: number): Promise<void> {
        const pids = await this.getPidsOnPort(port);
        if (pids.length === 0) return;
        console.log(`[FileSystemTools] Port ${port} is in use by PIDs: ${pids.join(', ')}, killing before starting dev server.`);
        try {
            if (process.platform === 'darwin' || process.platform === 'linux') {
                for (const pid of pids) {
                    await execAsync(`kill -9 ${pid}`, { timeout: 3000 });
                }
                console.log(`[FileSystemTools] Killed process(es) on port ${port}.`);
            } else if (process.platform === 'win32') {
                for (const pid of pids) {
                    await execAsync(`taskkill /PID ${pid} /F`, {
                        timeout: 3000,
                        shell: 'cmd.exe'
                    });
                }
                console.log(`[FileSystemTools] Killed process(es) on port ${port}.`);
            }
        } catch (e) {
            console.warn(`[FileSystemTools] Failed to kill process on port ${port}:`, (e as Error).message);
        }
        await new Promise((r) => setTimeout(r, 500));
    }

    /**
     * 检测命令是否为自动化测试命令（可能启动 Chrome for Testing）
     */
    private isAutomationTestCommand(command: string): boolean {
        const cmdLower = command.toLowerCase();
        // 检测是否包含 playwright、chrome-agent、自动化测试相关关键词
        return cmdLower.includes('playwright') ||
               cmdLower.includes('chrome-agent') ||
               cmdLower.includes('chromium') ||
               (cmdLower.includes('node') && cmdLower.includes('.js') && cmdLower.includes('chrome'));
    }

    /**
     * 清理 Google Chrome for Testing 进程
     */
    private async cleanupChromeForTesting(): Promise<void> {
        try {
            console.log('[FileSystemTools] Cleaning up Google Chrome for Testing processes...');
            
            if (process.platform === 'darwin' || process.platform === 'linux') {
                // macOS 和 Linux 使用 pkill
                const cleanupCommand = 'pkill -9 -f "Google Chrome for Testing"';
                await execAsync(cleanupCommand, {
                    timeout: 5000,
                    maxBuffer: 1024 * 1024, // 1MB buffer
                    encoding: 'utf-8'
                });
                console.log('[FileSystemTools] Successfully cleaned up Google Chrome for Testing processes');
            } else if (process.platform === 'win32') {
                // Windows 使用 taskkill
                const cleanupCommand = 'taskkill /F /IM "Google Chrome for Testing.exe" /T';
                await execAsync(cleanupCommand, {
                    timeout: 5000,
                    maxBuffer: 1024 * 1024, // 1MB buffer
                    encoding: 'utf-8',
                    shell: 'powershell.exe'
                });
                console.log('[FileSystemTools] Successfully cleaned up Google Chrome for Testing processes');
            }
        } catch (error: unknown) {
            // 如果进程不存在或已退出，pkill 会返回错误，这是正常的
            const err = error as { code?: number; message?: string };
            if (err.code === 1) {
                // pkill 返回 1 表示没有找到匹配的进程，这是正常的
                console.log('[FileSystemTools] No Google Chrome for Testing processes found to clean up');
            } else {
                console.warn(`[FileSystemTools] Failed to cleanup Chrome for Testing: ${err.message || String(error)}`);
            }
        }
    }
}
