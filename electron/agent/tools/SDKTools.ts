import fs from 'fs/promises';
import { glob } from 'glob';

// ============================================================
// EDIT TOOL - 字符串替换工具
// ============================================================

export const EditSchema = {
    name: "edit_file",
    description: "Make simple edits to a file by replacing specific text with new text. Use this for small, targeted changes. For large changes, use write_file instead.",
    input_schema: {
        type: "object" as const,
        properties: {
            path: { type: "string", description: "Absolute path to the file." },
            old_str: { type: "string", description: "The exact text to search for and replace." },
            new_str: { type: "string", description: "The new text to replace with." },
            replace_all: {
                type: "boolean",
                description: "Replace all occurrences (true) or only the first occurrence (false). Default is false.",
                default: false
            }
        },
        required: ["path", "old_str", "new_str"]
    }
};

// ============================================================
// GLOB TOOL - 文件模式匹配工具
// ============================================================

export const GlobSchema = {
    name: "glob",
    description: "Find files matching a pattern. Supports glob patterns like **/*.ts, src/**/*.jsx, etc.",
    input_schema: {
        type: "object" as const,
        properties: {
            pattern: { type: "string", description: "Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.jsx')." },
            cwd: {
                type: "string",
                description: "Working directory for the search. Defaults to the first authorized folder."
            },
            includePattern: {
                type: "string",
                description: "Optional: only include files matching this regex pattern."
            }
        },
        required: ["pattern"]
    }
};

// ============================================================
// GREP TOOL - 内容搜索工具
// ============================================================

export const GrepSchema = {
    name: "grep",
    description: "Search for text patterns in files. Supports regex patterns. Much faster than manually reading files.",
    input_schema: {
        type: "object" as const,
        properties: {
            pattern: { type: "string", description: "Search pattern (supports regex)." },
            path: {
                type: "string",
                description: "Path to file or directory to search. If directory, searches all files in it recursively."
            },
            glob: {
                type: "string",
                description: "Optional glob pattern to filter files (e.g., '*.ts', '**/*.js')."
            },
            caseInsensitive: {
                type: "boolean",
                description: "Perform case-insensitive search. Default is false.",
                default: false
            },
            outputMode: {
                type: "string",
                description: "Output format: 'content' shows matching lines, 'files_with_matches' shows only file paths, 'count' shows match counts.",
                enum: ["content", "files_with_matches", "count"],
                default: "content"
            }
        },
        required: ["pattern", "path"]
    }
};

// ============================================================
// WEB FETCH TOOL - 网页获取工具
// ============================================================

export const WebFetchSchema = {
    name: "web_fetch",
    description: "Fetch and read content from a URL. Supports extracting text from web pages, PDFs, and other documents.",
    input_schema: {
        type: "object" as const,
        properties: {
            url: { type: "string", description: "The URL to fetch content from." },
            timeout: {
                type: "number",
                description: "Request timeout in seconds. Default is 20.",
                default: 20
            }
        },
        required: ["url"]
    }
};

// ============================================================
// WEB SEARCH TOOL - 网络搜索工具
// ============================================================

export const WebSearchSchema = {
    name: "web_search",
    description: "Search the web for current information. Use this when you need up-to-date facts or information beyond your training data.",
    input_schema: {
        type: "object" as const,
        properties: {
            query: { type: "string", description: "The search query." },
            numResults: {
                type: "number",
                description: "Number of results to return. Default is 10.",
                default: 10,
                minimum: 1,
                maximum: 50
            }
        },
        required: ["query"]
    }
};

// ============================================================
// TODO WRITE TOOL - 任务管理工具
// ============================================================

export const TodoWriteSchema = {
    name: "todo_write",
    description: "Create and manage a structured task list. Use this to track complex tasks with multiple steps.",
    input_schema: {
        type: "object" as const,
        properties: {
            todos: {
                type: "array",
                description: "Array of todo items.",
                items: {
                    type: "object",
                    properties: {
                        activeForm: { type: "string", description: "Present continuous form (e.g., 'Fixing authentication bug')" },
                        content: { type: "string", description: "Imperative form (e.g., 'Fix authentication bug')" },
                        status: { type: "string", enum: ["pending", "in_progress", "completed"] }
                    },
                    required: ["activeForm", "content", "status"]
                }
            }
        },
        required: ["todos"]
    }
};

// ============================================================
// ASK USER QUESTION TOOL - 用户交互工具
// ============================================================

export const AskUserQuestionSchema = {
    name: "ask_user_question",
    description: "Ask the user questions to clarify requirements, gather information, or make decisions during execution.",
    input_schema: {
        type: "object" as const,
        properties: {
            questions: {
                type: "array",
                description: "Array of questions to ask the user.",
                items: {
                    type: "object",
                    properties: {
                        question: { type: "string", description: "The question text. Should end with a question mark." },
                        header: { type: "string", description: "Short label for the question category (max 12 chars)." },
                        multiSelect: {
                            type: "boolean",
                            description: "Allow multiple options to be selected. Default is false."
                        },
                        options: {
                            type: "array",
                            description: "Available options for the user to choose from.",
                            items: {
                                type: "object",
                                properties: {
                                    label: { type: "string", description: "Display text for the option (1-5 words)." },
                                    description: { type: "string", description: "Explanation of what this option means." }
                                },
                                required: ["label", "description"]
                            },
                            minItems: 2,
                            maxItems: 4
                        }
                    },
                    required: ["question", "header", "options", "multiSelect"]
                },
                minItems: 1,
                maxItems: 4
            }
        },
        required: ["questions"]
    }
};

// ============================================================
// TOOL IMPLEMENTATIONS
// ============================================================

export class SDKTools {
    private permissionManager: any;
    private runtime: any;

    constructor(permissionManager: any, runtime?: any) {
        this.permissionManager = permissionManager;
        this.runtime = runtime;
    }

    // ========== EDIT TOOL ==========
    async editFile(args: {
        path: string;
        old_str: string;
        new_str: string;
        replace_all?: boolean;
    }): Promise<string> {
        try {
            // Check if path is authorized
            if (!this.permissionManager.isPathAuthorized(args.path)) {
                return `Error: Path ${args.path} is not authorized.`;
            }

            const content = await fs.readFile(args.path, 'utf-8');
            let newContent: string;
            let replaceCount: number;

            if (args.replace_all) {
                const matches = content.split(args.old_str);
                replaceCount = matches.length - 1;
                newContent = matches.join(args.new_str);
            } else {
                const index = content.indexOf(args.old_str);
                if (index === -1) {
                    return `Error: The specified text was not found in the file.`;
                }
                replaceCount = 1;
                newContent = content.substring(0, index) + args.new_str + content.substring(index + args.old_str.length);
            }

            await fs.writeFile(args.path, newContent, 'utf-8');
            return `Successfully edited ${args.path}. Replaced ${replaceCount} occurrence(s).`;
        } catch (error: unknown) {
            return `Error editing file: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    // ========== GLOB TOOL ==========
    async globFiles(args: {
        pattern: string;
        cwd?: string;
        includePattern?: string;
    }, defaultCwd: string): Promise<string> {
        try {
            const workingDir = args.cwd || defaultCwd;

            // Check if directory is authorized
            if (!this.permissionManager.isPathAuthorized(workingDir)) {
                return `Error: Directory ${workingDir} is not authorized.`;
            }

            const files = await glob(args.pattern, {
                cwd: workingDir,
                windowsPathsNoEscape: true,
                absolute: true
            });

            let result = files;

            // Apply include pattern filter if provided
            if (args.includePattern) {
                const regex = new RegExp(args.includePattern);
                result = result.filter(f => regex.test(f));
            }

            return `Found ${result.length} file(s) matching pattern "${args.pattern}":\n${result.join('\n')}`;
        } catch (error: unknown) {
            return `Error searching files: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    // ========== GREP TOOL ==========
    async grepContent(args: {
        pattern: string;
        path: string;
        glob?: string;
        caseInsensitive?: boolean;
        outputMode?: 'content' | 'files_with_matches' | 'count';
    }): Promise<string> {
        try {
            // Check if path is authorized
            if (!this.permissionManager.isPathAuthorized(args.path)) {
                return `Error: Path ${args.path} is not authorized.`;
            }

            const stat = await fs.stat(args.path).catch(() => null);
            const files: string[] = [];

            if (stat?.isDirectory()) {
                // Search in directory
                const globPattern = args.glob || '**/*';
                const allFiles = await glob(globPattern, {
                    cwd: args.path,
                    windowsPathsNoEscape: true,
                    absolute: true
                });
                files.push(...allFiles.filter(f => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx') || f.endsWith('.json') || f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.py') || f.endsWith('.go') || f.endsWith('.rs')));
            } else if (stat?.isFile()) {
                files.push(args.path);
            } else {
                return `Error: Path ${args.path} does not exist.`;
            }

            const regex = new RegExp(args.pattern, args.caseInsensitive ? 'i' : '');
            const results: { file: string; matches: string[]; count: number }[] = [];

            for (const file of files) {
                try {
                    const content = await fs.readFile(file, 'utf-8');
                    const lines = content.split('\n');
                    const matches: string[] = [];
                    let count = 0;

                    lines.forEach((line, index) => {
                        if (regex.test(line)) {
                            matches.push(`  ${index + 1}:${line.trim()}`);
                            count++;
                        }
                    });

                    if (count > 0) {
                        results.push({ file, matches, count });
                    }
                } catch {
                    // Skip files that can't be read
                }
            }

            if (results.length === 0) {
                return `No matches found for pattern "${args.pattern}"`;
            }

            // Format output based on mode
            if (args.outputMode === 'files_with_matches') {
                return results.map(r => r.file).join('\n');
            }

            if (args.outputMode === 'count') {
                return results.map(r => `${r.file}: ${r.count}`).join('\n');
            }

            // Default: content mode
            return results.map(r => `${r.file}:\n${r.matches.slice(0, 20).join('\n')}${r.matches.length > 20 ? `\n  ... and ${r.matches.length - 20} more matches` : ''}`).join('\n\n');
        } catch (error: unknown) {
            return `Error searching content: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    // ========== WEB FETCH TOOL ==========
    async webFetch(args: { url: string; timeout?: number }): Promise<string> {
        try {
            // Check network access permission
            if (!this.permissionManager.getNetworkAccess()) {
                return `Error: Network access is not enabled.`;
            }

            const response = await fetch(args.url, {
                signal: AbortSignal.timeout((args.timeout || 20) * 1000)
            });

            if (!response.ok) {
                return `Error: HTTP ${response.status} ${response.statusText}`;
            }

            const contentType = response.headers.get('content-type') || '';
            let content: string;

            if (contentType.includes('application/json')) {
                const data = await response.json();
                content = JSON.stringify(data, null, 2);
            } else {
                content = await response.text();
            }

            return `Successfully fetched ${args.url}:\n\n${content}`;
        } catch (error: unknown) {
            return `Error fetching URL: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    // ========== WEB SEARCH TOOL ==========
    async webSearch(args: { query: string; numResults?: number }): Promise<string> {
        try {
            // Check network access permission
            if (!this.permissionManager.getNetworkAccess()) {
                return `Error: Network access is not enabled.`;
            }

            // For now, return a message that this requires a search API
            // In production, integrate with DuckDuckGo, Bing, or Google Custom Search API
            return `Web search is not yet configured. To enable web search, configure a search API provider (DuckDuckGo, Bing, or Google Custom Search).\n\nQuery: ${args.query}\n\nFor now, the AI can use its training data to answer questions.`;
        } catch (error: unknown) {
            return `Error performing web search: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    // ========== TODO WRITE TOOL ==========
    async todoWrite(args: { todos: Array<{ content: string; activeForm: string; status: string }> }): Promise<string> {
        try {
            const total = args.todos.length;
            const completed = args.todos.filter(t => t.status === 'completed').length;
            const inProgress = args.todos.filter(t => t.status === 'in_progress').length;
            const pending = args.todos.filter(t => t.status === 'pending').length;

            let result = `Task list updated (${total} total):\n`;
            result += `  ✅ Completed: ${completed}\n`;
            result += `  🔄 In Progress: ${inProgress}\n`;
            result += `  📋 Pending: ${pending}\n\n`;

            args.todos.forEach((todo, index) => {
                const icon = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '📋';
                result += `${index + 1}. ${icon} ${todo.content}\n`;
            });

            return result;
        } catch (error: unknown) {
            return `Error updating todo list: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    // ========== ASK USER QUESTION TOOL ==========
    async askUserQuestion(args: { questions: Array<any> }): Promise<string> {
        try {
            if (!this.runtime) {
                return `Error: Runtime not available for user questions.`;
            }

            // 通过 runtime 的 pendingQuestions 机制请求用户回答
            const requestId = `question_${Date.now()}_${Math.random().toString(36).substring(2)}`;

            // 发送问题到渲染进程
            this.runtime.broadcast('agent:ask-user-question', {
                requestId,
                questions: args.questions
            });

            // 等待用户回答（通过 pendingQuestions 机制）
            return new Promise((resolve) => {
                this.runtime.addPendingQuestion(requestId, resolve);
            });
        } catch (error: unknown) {
            return `Error asking user question: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    // 添加待处理问题
    addPendingQuestion(requestId: string, resolve: (answers: string[]) => void) {
        if (this.runtime) {
            this.runtime.addPendingQuestion(requestId, resolve);
        }
    }
}

// Export all schemas as an array for easy registration
export const AllSDKTools = [
    EditSchema,
    GlobSchema,
    GrepSchema,
    WebFetchSchema,
    WebSearchSchema,
    TodoWriteSchema,
    AskUserQuestionSchema
];
