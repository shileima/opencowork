import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getBuiltinNodePath } from '../../utils/NodePath';
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

        // 如果命令包含 'node'，替换为内置的 node 路径
        let command = args.command;
        const builtinNodePath = getBuiltinNodePath();
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

        try {
            // 获取 Playwright 环境变量
            const playwrightEnv = getPlaywrightEnvVars();
            const env = {
                ...process.env,
                ...playwrightEnv
            };
            
            console.log(`[FileSystemTools] Executing command: ${command} in ${workingDir}`);
            if (Object.keys(playwrightEnv).length > 0) {
                console.log(`[FileSystemTools] Playwright env vars: ${JSON.stringify(playwrightEnv)}`);
            }
            
            const { stdout, stderr } = await execAsync(command, {
                cwd: workingDir,
                env: env,
                timeout: timeout,
                maxBuffer: 1024 * 1024 * 10, // 10MB buffer
                encoding: 'utf-8',
                shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
            });

            let result = `Command executed in ${workingDir}:\n$ ${command}\n\n`;
            if (stdout) result += `STDOUT:\n${stdout}\n`;
            if (stderr) result += `STDERR:\n${stderr}\n`;
            return result || 'Command completed with no output.';
        } catch (error: unknown) {
            const err = error as { stdout?: string; stderr?: string; message?: string };
            let errorMsg = `Command failed in ${workingDir}:\n$ ${command}\n\n`;
            if (err.stdout) errorMsg += `STDOUT:\n${err.stdout}\n`;
            if (err.stderr) errorMsg += `STDERR:\n${err.stderr}\n`;
            errorMsg += `Error: ${err.message || String(error)}`;
            return errorMsg;
        }
    }
}
