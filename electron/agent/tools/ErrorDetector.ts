import * as path from 'path';

export interface DetectedError {
    type: 'missing_dependency' | 'import_error' | 'syntax_error' | 'css_error' | 'esbuild_jsx_in_ts' | 'cannot_find_name' | 'unknown';
    message: string;
    filePath?: string;
    line?: number;
    column?: number;
    packageName?: string;
    importPath?: string;
    /** 未定义变量名（用于 Cannot find name） */
    variableName?: string;
    fixable: boolean;
}

export class ErrorDetector {
    /**
     * 通用错误信号检测：判断输出文本中是否包含开发服务器/编译器错误。
     * 用一个宽泛的模式覆盖各种工具链格式（Vite、esbuild、TypeScript、ESLint、Babel、webpack 等），
     * 而不是为每种格式写一条正则。
     */
    static hasErrorSignal(text: string): boolean {
        if (!text || text.trim().length === 0) return false;
        // 排除已知误报
        if (/require is not defined/i.test(text) &&
            !/failed to resolve|cannot find module|cannot find name|\[typescript\]|transform failed|\[plugin:vite:/i.test(text)) {
            return false;
        }
        return this.ERROR_SIGNAL_RE.test(text);
    }

    /**
     * 宽泛的错误信号正则——任何编译/转换/运行时错误的常见关键词。
     * 新格式只需在此处增加一个分支即可全局生效。
     */
    private static ERROR_SIGNAL_RE = new RegExp([
        // 通用 ERROR 标记：ERROR(TypeScript)、ERROR(ESLint)、[ERROR]、error:
        String.raw`\bERROR\s*\(`,
        String.raw`\[ERROR\]`,
        // Vite 插件前缀
        String.raw`\[plugin:vite:[^\]]+\]`,
        // vite-plugin-checker 输出标记
        String.raw`\[TypeScript\]`,
        String.raw`\[ESLint\]`,
        // TypeScript / esbuild 常见错误
        String.raw`Cannot find name\b`,
        String.raw`Cannot find module\b`,
        String.raw`Module not found\b`,
        String.raw`Failed to resolve import\b`,
        String.raw`Transform failed\b`,
        String.raw`pre-transform error`,
        // 语法类
        String.raw`\bSyntaxError\b`,
        String.raw`Missing semicolon`,
        String.raw`Unexpected token`,
        String.raw`Unterminated\s+\w+`,
        String.raw`Parsing error`,
        String.raw`failed to parse source`,
        String.raw`'\}' expected`,
        // 服务器错误
        String.raw`Internal server error`,
    ].join('|'), 'i');

    /**
     * 通用文件路径 + 行号列号提取：支持多种格式
     *   - /absolute/path/file.tsx:11:8
     *   - FILE  /absolute/path/file.tsx:11:8
     *   - src/file.tsx(11:8)
     *   - at /path/file.tsx:11:8
     */
    static extractFileLoc(text: string, cwd: string): { filePath?: string; line?: number; column?: number } {
        // 去掉 "FILE" / "at" 等前缀后再提取路径
        const cleaned = text.replace(/^\s*(?:FILE|at)\s+/gmi, '');
        // 格式 1: /path/with spaces/file.tsx:11:8 — 允许路径含空格（用 .* 贪心匹配到最后一个 .ext:line:col）
        const colonMatch = cleaned.match(/((?:\/|[A-Za-z]:).*\.(tsx?|jsx?|vue|mjs|cjs)):(\d+):(\d+)/);
        if (colonMatch) {
            return {
                filePath: this.resolveFilePath(colonMatch[1].trim(), cwd),
                line: parseInt(colonMatch[3], 10),
                column: parseInt(colonMatch[4], 10)
            };
        }
        // 格式 2: path(line:col)
        const parenMatch = cleaned.match(/([\w/@\\.\s-]+\.(tsx?|jsx?))\s*\((\d+):(\d+)\)/);
        if (parenMatch) {
            return {
                filePath: this.resolveFilePath(parenMatch[1].trim(), cwd),
                line: parseInt(parenMatch[3], 10),
                column: parseInt(parenMatch[4], 10)
            };
        }
        // 格式 3: 仅路径（允许空格）
        const pathOnly = cleaned.match(/((?:\/|[A-Za-z]:).*\.(tsx?|jsx?|vue|mjs|cjs))/);
        if (pathOnly) {
            return { filePath: this.resolveFilePath(pathOnly[1].trim(), cwd) };
        }
        return {};
    }

    /**
     * 从开发服务器输出中检测错误
     */
    static detectFromOutput(output: string, cwd: string): DetectedError[] {
        const errors: DetectedError[] = [];
        const lines = output.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // 依赖缺失错误
            const missingDepMatch = line.match(/Failed to resolve import\s+["']([^"']+)["']/i) ||
                                   line.match(/Cannot find module\s+["']([^"']+)["']/i) ||
                                   line.match(/Module not found\s+["']([^"']+)["']/i);
            
            if (missingDepMatch) {
                const importPath = missingDepMatch[1];
                const packageName = this.extractPackageName(importPath);
                
                errors.push({
                    type: 'missing_dependency',
                    message: `Missing dependency: ${importPath}`,
                    packageName,
                    importPath,
                    fixable: true
                });
                continue;
            }

            // Vite 导入分析错误
            const viteImportMatch = line.match(/\[plugin:vite:import-analysis\].*from\s+["']([^"']+)["']/i);
            if (viteImportMatch) {
                const importPath = viteImportMatch[1];
                const fileMatch = line.match(/at\s+(.*?):(\d+):(\d+)/);
                
                errors.push({
                    type: 'import_error',
                    message: `Import error: ${importPath}`,
                    filePath: fileMatch ? this.resolveFilePath(fileMatch[1], cwd) : undefined,
                    line: fileMatch ? parseInt(fileMatch[2], 10) : undefined,
                    column: fileMatch ? parseInt(fileMatch[3], 10) : undefined,
                    importPath,
                    fixable: true
                });
                continue;
            }

            // 语法错误
            const syntaxMatch = line.match(/(SyntaxError|Unexpected token).*at\s+(.*?):(\d+):(\d+)/i);
            if (syntaxMatch) {
                errors.push({
                    type: 'syntax_error',
                    message: `Syntax error: ${syntaxMatch[1]}`,
                    filePath: this.resolveFilePath(syntaxMatch[2], cwd),
                    line: parseInt(syntaxMatch[3], 10),
                    column: parseInt(syntaxMatch[4], 10),
                    fixable: /missing semicolon/i.test(syntaxMatch[1]) // 仅对可确定场景自动修复
                });
                continue;
            }

            // Vite/Babel 语法报错（Missing semicolon, Unterminated regular expression 等）
            const viteSyntaxMatch = line.match(
                /Internal server error:\s+(.+?):\s*(Missing semicolon|Unexpected token|Unterminated\s+\w+(?:\s+\w+)?|Parsing error|SyntaxError)[^()]*\((\d+):(\d+)\)/i
            );
            if (viteSyntaxMatch) {
                const reason = viteSyntaxMatch[2];
                errors.push({
                    type: 'syntax_error',
                    message: `Syntax error: ${reason}`,
                    filePath: this.resolveFilePath(viteSyntaxMatch[1], cwd),
                    line: parseInt(viteSyntaxMatch[3], 10),
                    column: parseInt(viteSyntaxMatch[4], 10),
                    fixable: true
                });
                continue;
            }

            // CSS/资源文件错误
            const cssMatch = line.match(/Failed to resolve import\s+["']([^"']+\.(css|scss|sass|less|png|jpg|jpeg|gif|svg))["']/i);
            if (cssMatch) {
                const importPath = cssMatch[1];
                const fileMatch = line.match(/at\s+(.*?):(\d+):(\d+)/);
                
                errors.push({
                    type: 'css_error',
                    message: `CSS/Resource file not found: ${importPath}`,
                    filePath: fileMatch ? this.resolveFilePath(fileMatch[1], cwd) : undefined,
                    line: fileMatch ? parseInt(fileMatch[2], 10) : undefined,
                    column: fileMatch ? parseInt(fileMatch[3], 10) : undefined,
                    importPath,
                    fixable: true
                });
                continue;
            }

            // Cannot find name 'xxx' — 支持 [TypeScript]、ERROR(TypeScript) 等各种前缀格式
            const cannotFindMatch = line.match(/Cannot find name\s+['"]?(\w+)['"]?\.?\s*(?:\(\d+\))?/i);
            if (cannotFindMatch) {
                const varName = cannotFindMatch[1];
                const searchText = [lines[i - 1], line, lines[i + 1], lines[i + 2]].filter(Boolean).join('\n');
                const loc = ErrorDetector.extractFileLoc(searchText, cwd);
                errors.push({
                    type: 'cannot_find_name',
                    message: `Cannot find name: ${varName}`,
                    filePath: loc.filePath,
                    line: loc.line,
                    column: loc.column,
                    variableName: varName,
                    fixable: true
                });
                continue;
            }
        }

        // 构建/终端日志中的 esbuild 报错（多行）
        if (/plugin:vite:esbuild|Transform failed|Expected [`'"]>[`'"] but found/i.test(output)) {
            this.pushEsbuildJsxErrorsFromText(output, cwd, errors);
        }

        return this.dedupeDetectedErrors(errors);
    }

    private static pushEsbuildJsxErrorsFromText(text: string, cwd: string, out: DetectedError[]): void {
        for (const m of text.matchAll(/([\w/.@\\-]+)\.ts(?!x):(\d+):(\d+)/g)) {
            const rawPath = m[1].replace(/\\/g, '/');
            out.push({
                type: 'esbuild_jsx_in_ts',
                message: `esbuild/JSX in .ts file: ${rawPath}`,
                filePath: this.resolveFilePath(rawPath, cwd),
                line: parseInt(m[2], 10),
                column: parseInt(m[3], 10),
                fixable: true
            });
        }
    }

    /** 合并多路检测结果并去重 */
    static mergeDetectedErrors(groups: DetectedError[][]): DetectedError[] {
        return this.dedupeDetectedErrors(groups.flat());
    }

    private static dedupeDetectedErrors(errors: DetectedError[]): DetectedError[] {
        const seen = new Set<string>();
        const result: DetectedError[] = [];
        for (const e of errors) {
            const key = `${e.type}|${e.filePath ?? ''}|${e.packageName ?? ''}|${e.importPath ?? ''}|${e.message}`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(e);
        }
        return result;
    }

    /**
     * 从页面错误覆盖层中检测错误
     */
    static detectFromOverlay(overlayText: string, cwd: string): DetectedError[] {
        const errors: DetectedError[] = [];

        // Vite 全屏覆盖层：esbuild 在 .ts 中解析 JSX
        const fullText = overlayText;
        if (/plugin:vite:esbuild|Transform failed|Expected [`'"]>[`'"] but found/i.test(fullText)) {
            this.pushEsbuildJsxErrorsFromText(fullText, cwd, errors);
            if (errors.length > 0) {
                return this.dedupeDetectedErrors(errors);
            }
        }
        
        // 提取文件路径和行号
        const fileMatch = overlayText.match(/(.*?):(\d+):(\d+)/);
        const filePath = fileMatch ? this.resolveFilePath(fileMatch[1], cwd) : undefined;
        const line = fileMatch ? parseInt(fileMatch[2], 10) : undefined;
        const column = fileMatch ? parseInt(fileMatch[3], 10) : undefined;

        // 依赖缺失错误
        const missingDepMatch = overlayText.match(/Failed to resolve import\s+["']([^"']+)["']/i) ||
                                overlayText.match(/Cannot find module\s+["']([^"']+)["']/i);
        
        if (missingDepMatch) {
            const importPath = missingDepMatch[1];
            const packageName = this.extractPackageName(importPath);
            
            errors.push({
                type: 'missing_dependency',
                message: `Missing dependency: ${importPath}`,
                filePath,
                line,
                column,
                packageName,
                importPath,
                fixable: true
            });
            return errors;
        }

        // CSS/资源文件错误
        const cssMatch = overlayText.match(/Failed to resolve import\s+["']([^"']+\.(css|scss|sass|less|png|jpg|jpeg|gif|svg))["']/i);
        if (cssMatch) {
            errors.push({
                type: 'css_error',
                message: `CSS/Resource file not found: ${cssMatch[1]}`,
                filePath,
                line,
                column,
                importPath: cssMatch[1],
                fixable: true
            });
            return errors;
        }

        // 导入错误
        if (overlayText.includes('[plugin:vite:import-analysis]') || overlayText.includes('Failed to resolve')) {
            const importMatch = overlayText.match(/from\s+["']([^"']+)["']/i);
            errors.push({
                type: 'import_error',
                message: `Import error: ${importMatch ? importMatch[1] : 'unknown'}`,
                filePath,
                line,
                column,
                importPath: importMatch ? importMatch[1] : undefined,
                fixable: true
            });
            return errors;
        }

        // Vite 插件语法错误（例如 [plugin:vite:react-babel] ... Missing semicolon. (4:39)）
        const viteSyntaxOverlay = overlayText.match(
            /\[plugin:vite:[^\]]+\]\s+(.+?):\s*(Missing semicolon|Unexpected token|Unterminated\s+\w+(?:\s+\w+)?|Parsing error|SyntaxError)[^()]*\((\d+):(\d+)\)/i
        );
        if (viteSyntaxOverlay) {
            const reason = viteSyntaxOverlay[2];
            errors.push({
                type: 'syntax_error',
                message: `Syntax error: ${reason}`,
                filePath: this.resolveFilePath(viteSyntaxOverlay[1], cwd),
                line: parseInt(viteSyntaxOverlay[3], 10),
                column: parseInt(viteSyntaxOverlay[4], 10),
                fixable: true
            });
            return errors;
        }

        // [plugin:vite:react-babel] 'return' outside of function. (10:2) — 常见原因：function X() 后缺少 {
        const returnOutsideMatch = overlayText.match(
            /\[plugin:vite:[^\]]+\]\s+(.+?):\s*['"]?return['"]?\s+outside\s+of\s+function[^.]*\.?\s*\((\d+):(\d+)\)/i
        );
        if (returnOutsideMatch) {
            errors.push({
                type: 'syntax_error',
                message: "'return' outside of function",
                filePath: this.resolveFilePath(returnOutsideMatch[1].trim(), cwd),
                line: parseInt(returnOutsideMatch[2], 10),
                column: parseInt(returnOutsideMatch[3], 10),
                fixable: true
            });
            return errors;
        }

        // Cannot find name 'xxx' — 通用路径提取
        const cannotFindNameMatch = overlayText.match(/Cannot find name\s+['"]?(\w+)['"]?\.?\s*(?:\(\d+\))?/i);
        if (cannotFindNameMatch) {
            const varName = cannotFindNameMatch[1];
            const loc = ErrorDetector.extractFileLoc(overlayText, cwd);
            errors.push({
                type: 'cannot_find_name',
                message: `Cannot find name: ${varName}`,
                filePath: loc.filePath || filePath,
                line: loc.line || line,
                column: loc.column || column,
                variableName: varName,
                fixable: true
            });
            return errors;
        }

        return errors;
    }

    /**
     * 从控制台错误中检测错误
     */
    static detectFromConsole(consoleError: string, _cwd: string): DetectedError[] {
        const errors: DetectedError[] = [];
        
        // 依赖缺失错误
        const missingDepMatch = consoleError.match(/Failed to resolve import\s+["']([^"']+)["']/i) ||
                                consoleError.match(/Cannot find module\s+["']([^"']+)["']/i);
        
        if (missingDepMatch) {
            const importPath = missingDepMatch[1];
            const packageName = this.extractPackageName(importPath);
            
            errors.push({
                type: 'missing_dependency',
                message: `Missing dependency: ${importPath}`,
                packageName,
                importPath,
                fixable: true
            });
        }

        return errors;
    }

    /**
     * 提取包名（从导入路径中提取主包名）
     * 例如: "codemirror/theme/default.css" -> "codemirror"
     *       "@ant-design/icons" -> "@ant-design/icons"
     */
    private static extractPackageName(importPath: string): string {
        // 移除文件扩展名和路径部分
        const withoutExt = importPath.replace(/\.(css|scss|sass|less|js|ts|tsx|jsx|png|jpg|jpeg|gif|svg)$/, '');
        
        // 处理 scoped packages (@scope/package)
        if (withoutExt.startsWith('@')) {
            const parts = withoutExt.split('/');
            if (parts.length >= 2) {
                return `${parts[0]}/${parts[1]}`;
            }
            return parts[0];
        }
        
        // 处理普通包名
        const parts = withoutExt.split('/');
        return parts[0];
    }

    /**
     * 解析文件路径（相对路径转绝对路径）
     */
    private static resolveFilePath(filePath: string, cwd: string): string {
        const normalized = filePath.replace(/\\/g, '/').trim();
        // Vite 覆盖层常显示 /src/...，并非系统根目录下的绝对路径
        if (/^\/src\//i.test(normalized) || normalized.startsWith('/@/')) {
            return path.resolve(cwd, normalized.replace(/^\//, ''));
        }
        if (path.isAbsolute(normalized)) {
            return normalized;
        }
        return path.resolve(cwd, normalized);
    }
}
