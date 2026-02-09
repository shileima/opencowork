import * as path from 'path';

export interface DetectedError {
    type: 'missing_dependency' | 'import_error' | 'syntax_error' | 'css_error' | 'unknown';
    message: string;
    filePath?: string;
    line?: number;
    column?: number;
    packageName?: string;
    importPath?: string;
    fixable: boolean;
}

export class ErrorDetector {
    /**
     * 从开发服务器输出中检测错误
     */
    static detectFromOutput(output: string, cwd: string): DetectedError[] {
        const errors: DetectedError[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
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
                    fixable: false // 语法错误需要人工检查
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
            }
        }

        return errors;
    }

    /**
     * 从页面错误覆盖层中检测错误
     */
    static detectFromOverlay(overlayText: string, cwd: string): DetectedError[] {
        const errors: DetectedError[] = [];
        
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
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.resolve(cwd, filePath);
    }
}
