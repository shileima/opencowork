import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DetectedError } from './ErrorDetector';

const execAsync = promisify(exec);

export interface FixResult {
    success: boolean;
    action: 'installed' | 'fixed_import' | 'removed_import' | 'fixed_syntax' | 'skipped';
    message: string;
    /** 实际被修改/创建的文件路径列表，用于通知编辑器刷新 */
    changedFiles?: string[];
}

export class ErrorFixer {
    /**
     * 修复错误
     */
    static async fixError(error: DetectedError, cwd: string): Promise<FixResult> {
        if (!error.fixable) {
            return {
                success: false,
                action: 'skipped',
                message: `Error type "${error.type}" is not automatically fixable`
            };
        }

        switch (error.type) {
            case 'missing_dependency':
                return await this.fixMissingDependency(error, cwd);
            
            case 'esbuild_jsx_in_ts':
                return await this.fixEsbuildJsxInTsFile(error, cwd);

            case 'syntax_error':
                return await this.fixSyntaxError(error, cwd);
            
            case 'cannot_find_name':
                return await this.fixCannotFindName(error, cwd);
            
            case 'import_error':
            case 'css_error':
                return await this.fixImportError(error, cwd);
            
            default:
                return {
                    success: false,
                    action: 'skipped',
                    message: `Unknown error type: ${error.type}`
                };
        }
    }

    /**
     * 将含 JSX 的 .ts 重命名为 .tsx（修复 [plugin:vite:esbuild] Expected ">" ...）
     */
    private static async fixEsbuildJsxInTsFile(error: DetectedError, cwd: string): Promise<FixResult> {
        const filePath = error.filePath;
        if (!filePath || !filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
            return {
                success: false,
                action: 'skipped',
                message: 'Invalid or missing .ts path for esbuild JSX fix'
            };
        }

        const candidates = [filePath, path.join(cwd, path.basename(filePath))];
        let resolved: string | null = null;
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                resolved = p;
                break;
            }
        }
        if (!resolved) {
            const rel = filePath.includes(cwd) ? path.relative(cwd, filePath) : filePath;
            const underSrc = path.join(cwd, rel.replace(/^\//, ''));
            if (fs.existsSync(underSrc)) {
                resolved = underSrc;
            }
        }
        if (!resolved) {
            return {
                success: false,
                action: 'skipped',
                message: `Source file not found: ${filePath}`
            };
        }

        const newPath = `${resolved.slice(0, -3)}.tsx`;
        if (fs.existsSync(newPath)) {
            return {
                success: false,
                action: 'skipped',
                message: `Target already exists: ${newPath}`
            };
        }

        try {
            fs.renameSync(resolved, newPath);
            const updatedFiles = this.updateImportsAfterTsToTsx(cwd, path.basename(resolved), path.basename(newPath));
            return {
                success: true,
                action: 'fixed_syntax',
                message: `Renamed ${resolved} → ${newPath} (JSX requires .tsx)`,
                changedFiles: [newPath, ...updatedFiles]
            };
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
                success: false,
                action: 'skipped',
                message: `Rename failed: ${msg}`
            };
        }
    }

    /**
     * 更新显式带 .ts 扩展名的 import（省略扩展名时 bundler 会自动解析 .tsx）
     */
    private static updateImportsAfterTsToTsx(cwd: string, oldBase: string, newBase: string): string[] {
        const changed: string[] = [];
        if (oldBase === newBase) return changed;
        const pairs: [string, string][] = [
            [`'./${oldBase}'`, `'./${newBase}'`],
            [`"./${oldBase}"`, `"./${newBase}"`],
            [`\`./${oldBase}\``, `\`./${newBase}\``],
            [`'../${oldBase}'`, `'../${newBase}'`],
            [`"../${oldBase}"`, `"../${newBase}"`],
        ];
        const walk = (dir: string, depth: number) => {
            if (depth > 20 || !fs.existsSync(dir)) return;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const ent of entries) {
                const full = path.join(dir, ent.name);
                if (ent.isDirectory()) {
                    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '.git') continue;
                    walk(full, depth + 1);
                } else if (/\.(tsx?|jsx?|vue|mjs|cjs)$/.test(ent.name)) {
                    let content: string;
                    try {
                        content = fs.readFileSync(full, 'utf-8');
                    } catch {
                        continue;
                    }
                    let next = content;
                    for (const [a, b] of pairs) {
                        if (next.includes(a)) next = next.split(a).join(b);
                    }
                    if (next !== content) {
                        try {
                            fs.writeFileSync(full, next, 'utf-8');
                            changed.push(full);
                        } catch {
                            /* ignore */
                        }
                    }
                }
            }
        };
        const srcDir = path.join(cwd, 'src');
        if (fs.existsSync(srcDir)) walk(srcDir, 0);
        return changed;
    }

    /**
     * 修复缺失依赖
     */
    private static async fixMissingDependency(error: DetectedError, cwd: string): Promise<FixResult> {
        const packageName = error.packageName;
        if (!packageName) {
            return {
                success: false,
                action: 'skipped',
                message: 'Package name not found in error'
            };
        }

        try {
            // 检查是否已经安装
            const packageJsonPath = path.join(cwd, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
                const allDeps = {
                    ...packageJson.dependencies,
                    ...packageJson.devDependencies,
                    ...packageJson.peerDependencies
                };
                
                // 检查包是否已安装（支持 scoped packages）
                if (packageName.startsWith('@')) {
                    const scopeMatch = Object.keys(allDeps).find(dep => dep.startsWith(packageName.split('/')[0]));
                    if (scopeMatch && allDeps[scopeMatch]) {
                        return {
                            success: true,
                            action: 'skipped',
                            message: `Package ${packageName} is already installed`
                        };
                    }
                } else {
                    const mainPackage = packageName.split('/')[0];
                    if (allDeps[mainPackage]) {
                        return {
                            success: true,
                            action: 'skipped',
                            message: `Package ${packageName} is already installed`
                        };
                    }
                }
            }

            // 安装依赖
            console.log(`[ErrorFixer] Installing package: ${packageName}`);
            const installCommand = `pnpm add ${packageName}`;
            
            try {
                const { stderr } = await execAsync(installCommand, {
                    cwd,
                    timeout: 120000, // 2 分钟超时
                    maxBuffer: 1024 * 1024 * 10, // 10MB
                    encoding: 'utf-8'
                } as any);

                if (stderr && !stderr.includes('WARN')) {
                    // 如果有错误（非警告），返回失败
                    return {
                        success: false,
                        action: 'installed',
                        message: `Failed to install ${packageName}: ${stderr}`
                    };
                }

                return {
                    success: true,
                    action: 'installed',
                    message: `Successfully installed ${packageName}`
                };
            } catch (installError: unknown) {
                const errorMsg = installError instanceof Error ? installError.message : String(installError);
                return {
                    success: false,
                    action: 'installed',
                    message: `Failed to install ${packageName}: ${errorMsg}`
                };
            }
        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                action: 'skipped',
                message: `Error fixing missing dependency: ${errorMsg}`
            };
        }
    }

    /**
     * 修复导入错误（包括 CSS/资源文件错误）
     */
    private static async fixImportError(error: DetectedError, _cwd: string): Promise<FixResult> {
        if (!error.filePath || !error.importPath) {
            return {
                success: false,
                action: 'skipped',
                message: 'File path or import path not found in error'
            };
        }

        try {
            // 检查文件是否存在
            if (!fs.existsSync(error.filePath)) {
                return {
                    success: false,
                    action: 'skipped',
                    message: `Source file not found: ${error.filePath}`
                };
            }

            // 读取文件内容
            let content = fs.readFileSync(error.filePath, 'utf-8');
            const lines = content.split('\n');
            
            if (error.line === undefined || error.line < 1 || error.line > lines.length) {
                return {
                    success: false,
                    action: 'skipped',
                    message: `Invalid line number: ${error.line}`
                };
            }

            const targetLine = lines[error.line - 1];
            
            // 检查是否是 CSS/资源文件错误
            if (error.type === 'css_error') {
                // 尝试找到替代文件或移除导入
                const importPath = error.importPath;
                const basePath = path.dirname(error.filePath);
                const resolvedPath = path.resolve(basePath, importPath);
                
                // 如果文件不存在，尝试查找替代文件
                if (!fs.existsSync(resolvedPath)) {
                    // 对于 CSS 文件，尝试查找同目录下的其他主题文件
                    if (importPath.includes('/theme/')) {
                        const themeDir = path.dirname(resolvedPath);
                        if (fs.existsSync(themeDir)) {
                            const themeFiles = fs.readdirSync(themeDir).filter(f => f.endsWith('.css'));
                            if (themeFiles.length > 0) {
                                // 使用第一个找到的主题文件
                                const alternativeFile = themeFiles[0];
                                const newImportPath = importPath.replace(/[^/]+\.css$/, alternativeFile);
                                const newLine = targetLine.replace(importPath, newImportPath);
                                lines[error.line - 1] = newLine;
                                
                                content = lines.join('\n');
                                fs.writeFileSync(error.filePath, content, 'utf-8');
                                
                                return {
                                    success: true,
                                    action: 'fixed_import',
                                    message: `Replaced ${importPath} with ${newImportPath}`,
                                    changedFiles: [error.filePath!]
                                };
                            }
                        }
                    }
                    
                    // 如果找不到替代文件，移除导入
                    if (targetLine.includes('import') && targetLine.includes(importPath)) {
                        lines.splice(error.line - 1, 1);
                        content = lines.join('\n');
                        fs.writeFileSync(error.filePath, content, 'utf-8');
                        
                        return {
                            success: true,
                            action: 'removed_import',
                            message: `Removed import for missing file: ${importPath}`,
                            changedFiles: [error.filePath!]
                        };
                    }
                }
            } else {
                // 普通导入错误，尝试修复路径
                // 这里可以添加更智能的路径修复逻辑
                // 目前先返回需要手动修复
                return {
                    success: false,
                    action: 'skipped',
                    message: `Import path error requires manual fix: ${error.importPath}`
                };
            }

            return {
                success: false,
                action: 'skipped',
                message: 'Could not automatically fix import error'
            };
        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                action: 'skipped',
                message: `Error fixing import: ${errorMsg}`
            };
        }
    }

    /**
     * 修复可确定的语法错误（当前支持：Missing semicolon）
     */
    private static async fixSyntaxError(error: DetectedError, _cwd: string): Promise<FixResult> {
        if (!error.filePath || !error.line) {
            return {
                success: false,
                action: 'skipped',
                message: 'Syntax fix requires filePath and line'
            };
        }
        if (!fs.existsSync(error.filePath)) {
            return {
                success: false,
                action: 'skipped',
                message: `Source file not found: ${error.filePath}`
            };
        }
        try {
            const content = fs.readFileSync(error.filePath, 'utf-8');
            const lines = content.split('\n');

            // 'return' outside of function — 常见原因：function X() 后缺少 {
            if (/return\s+outside\s+of\s+function/i.test(error.message)) {
                const returnLineIdx = Math.max(0, error.line - 1);
                for (let i = returnLineIdx - 1; i >= 0; i--) {
                    const line = lines[i];
                    const trimmed = line.trim();
                    // function App() 或 function App() 后无 {
                    if (/^\s*function\s+\w+\s*\([^)]*\)\s*$/.test(trimmed) && !trimmed.endsWith('{')) {
                        lines[i] = line.replace(/\s*$/, ' {');
                        fs.writeFileSync(error.filePath, lines.join('\n'), 'utf-8');
                        return {
                            success: true,
                            action: 'fixed_syntax',
                            message: `Added missing { after function declaration at ${path.basename(error.filePath)}:${i + 1}`,
                            changedFiles: [error.filePath!]
                        };
                    }
                }
                return {
                    success: false,
                    action: 'skipped',
                    message: 'Could not find function declaration missing {'
                };
            }

            // Missing semicolon
            if (/missing semicolon/i.test(error.message)) {
                const lineIdx = Math.max(0, Math.min(lines.length - 1, error.line - 1));
                const original = lines[lineIdx];
                const trimmed = original.trim();

                let nextLine = original;
                if (/^\s*import\b/.test(original) && /,\s*$/.test(original)) {
                    nextLine = original.replace(/,\s*$/, ';');
                } else if (!/[;{}]\s*$/.test(trimmed) && /^\s*(import|export|const|let|var|return)\b/.test(trimmed)) {
                    nextLine = `${original};`;
                }

                if (nextLine !== original) {
                    lines[lineIdx] = nextLine;
                    fs.writeFileSync(error.filePath, lines.join('\n'), 'utf-8');
                    return {
                        success: true,
                        action: 'fixed_syntax',
                        message: `Fixed missing semicolon at ${error.filePath}:${error.line}`,
                        changedFiles: [error.filePath!]
                    };
                }
            }

            // '}' expected — 常见原因：JSX 中的正则或表达式未正确闭合
            // Unterminated regular expression — JSX 中 /> 被解析为正则
            // 通用回退：无法确定性修复，标记为需要 AI 修复
            return {
                success: false,
                action: 'skipped',
                message: `Syntax error at ${path.basename(error.filePath)}:${error.line} — "${error.message}" (needs AI fix or manual intervention)`
            };
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
                success: false,
                action: 'skipped',
                message: `Syntax fix failed: ${msg}`
            };
        }
    }

    /**
     * 修复 "Cannot find name"：取消注释被注释掉的 import（如 import 被注释导致变量未定义）
     */
    private static async fixCannotFindName(error: DetectedError, cwd: string): Promise<FixResult> {
        const varName = error.variableName;
        if (!varName) {
            return {
                success: false,
                action: 'skipped',
                message: 'Variable name not found in error'
            };
        }

        const filePath = error.filePath;
        if (!filePath) {
            return {
                success: false,
                action: 'skipped',
                message: 'File path not found in error'
            };
        }

        // 解析可能为相对路径的 filePath
        const candidates = [
            filePath,
            path.join(cwd, filePath.replace(/^\//, '')),
            path.join(cwd, 'src', path.basename(filePath))
        ];
        let resolved: string | null = null;
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                resolved = p;
                break;
            }
        }
        if (!resolved) {
            return {
                success: false,
                action: 'skipped',
                message: `Source file not found: ${filePath}`
            };
        }

        try {
            const content = fs.readFileSync(resolved, 'utf-8');
            const lines = content.split('\n');

            // 查找被注释的 import，且导入的变量名与报错变量一致
            // 匹配: // import X from '...' 或 // import { X } from '...' 或 /* import X from ... */
            const importVarRegex = new RegExp(
                `import\\s+(?:\\{[^}]*\\b${varName}\\b[^}]*\\}|${varName})\\s+from\\s+['"\`][^'"\`]+['"\`]`,
                'i'
            );

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                // 单行注释
                if (trimmed.startsWith('//')) {
                    const uncommented = trimmed.slice(2).trim();
                    if (importVarRegex.test(uncommented)) {
                        lines[i] = line.replace(/^\s*\/\//, '').trimStart();
                        fs.writeFileSync(resolved, lines.join('\n'), 'utf-8');
                        return {
                            success: true,
                            action: 'fixed_import',
                            message: `Uncommented import for ${varName} in ${path.basename(resolved)}`,
                            changedFiles: [resolved]
                        };
                    }
                }

                // 块注释（整行）
                const blockMatch = trimmed.match(/^\/\*\s*(.*)\s*\*\/\s*$/);
                if (blockMatch) {
                    const inner = blockMatch[1].trim();
                    if (importVarRegex.test(inner)) {
                        lines[i] = inner;
                        fs.writeFileSync(resolved, lines.join('\n'), 'utf-8');
                        return {
                            success: true,
                            action: 'fixed_import',
                            message: `Uncommented import for ${varName} in ${path.basename(resolved)}`,
                            changedFiles: [resolved]
                        };
                    }
                }
            }

            // 无注释 import 时：尝试在项目中查找同名模块/组件并自动添加 import
            const fileDir = path.dirname(resolved);

            // 1) 图片/资源类变量（heroImg、reactLogo 等）→ 搜索 assets 目录
            const imgLikeSuffix = /Img|Logo|Icon|Png|Svg|Jpg|Gif|Webp$/i;
            if (imgLikeSuffix.test(varName)) {
                const baseName = varName.replace(/Img|Logo|Icon$/i, '').replace(/([A-Z])/g, (_, c: string) => c.toLowerCase());
                const searchDirs = [
                    path.join(fileDir, 'assets'),
                    path.join(path.dirname(fileDir), 'assets'),
                    path.join(cwd, 'src', 'assets'),
                    path.join(cwd, 'assets'),
                    fileDir
                ];
                const imgExts = ['.png', '.svg', '.jpg', '.jpeg', '.gif', '.webp'];
                const baseCandidates = [...new Set([baseName, varName.replace(/Img|Logo|Icon$/i, '')])];
                for (const dir of searchDirs) {
                    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
                    for (const base of baseCandidates) {
                        for (const ext of imgExts) {
                            const full = path.join(dir, base + ext);
                            if (fs.existsSync(full)) {
                                const relPath = path.relative(fileDir, full).replace(/\\/g, '/');
                                const importPath = relPath.startsWith('.') ? relPath : `./${relPath}`;
                                const importLine = `import ${varName} from '${importPath}';`;
                                const insertAt = this.findImportInsertPosition(lines);
                                lines.splice(insertAt, 0, importLine);
                                fs.writeFileSync(resolved, lines.join('\n'), 'utf-8');
                                return {
                                    success: true,
                                    action: 'fixed_import',
                                    message: `Added missing import for ${varName} from ${importPath}`,
                                    changedFiles: [resolved]
                                };
                            }
                        }
                    }
                }
            }

            // 2) 通用组件/模块（App、Header、utils 等）→ 搜索同目录及子目录下同名 .tsx/.ts/.jsx/.js 文件
            const moduleExts = ['.tsx', '.ts', '.jsx', '.js'];
            const searchDirs = [
                fileDir,
                path.join(fileDir, 'components'),
                path.join(fileDir, 'pages'),
                path.join(fileDir, 'views'),
                path.join(cwd, 'src'),
                path.join(cwd, 'src', 'components'),
                path.join(cwd, 'src', 'pages'),
                path.join(cwd, 'src', 'views'),
                path.join(cwd, 'src', 'utils'),
                path.join(cwd, 'src', 'hooks'),
                path.join(cwd, 'src', 'lib'),
            ];
            for (const dir of searchDirs) {
                if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
                for (const ext of moduleExts) {
                    const full = path.join(dir, varName + ext);
                    if (fs.existsSync(full) && full !== resolved) {
                        let relPath = path.relative(fileDir, full).replace(/\\/g, '/');
                        relPath = relPath.replace(/\.(tsx?|jsx?)$/, '');
                        const importPath = relPath.startsWith('.') ? relPath : `./${relPath}`;
                        const importLine = `import ${varName} from '${importPath}';`;
                        const insertAt = this.findImportInsertPosition(lines);
                        lines.splice(insertAt, 0, importLine);
                        fs.writeFileSync(resolved, lines.join('\n'), 'utf-8');
                        return {
                            success: true,
                            action: 'fixed_import',
                            message: `Added missing import for ${varName} from ${importPath}`,
                            changedFiles: [resolved]
                        };
                    }
                }
            }

            // 3) 查找 index 文件中的命名导出（如 src/utils/index.ts 导出了 varName）
            for (const dir of searchDirs) {
                for (const ext of moduleExts) {
                    const indexFile = path.join(dir, `index${ext}`);
                    if (!fs.existsSync(indexFile)) continue;
                    try {
                        const indexContent = fs.readFileSync(indexFile, 'utf-8');
                        const exportPattern = new RegExp(`export\\s+(?:(?:default\\s+)?(?:function|class|const|let|var)\\s+${varName}\\b|\\{[^}]*\\b${varName}\\b[^}]*\\})`, 'i');
                        if (exportPattern.test(indexContent)) {
                            const relPath = path.relative(fileDir, dir).replace(/\\/g, '/');
                            const importPath = relPath.startsWith('.') ? relPath : `./${relPath}`;
                            const isDefault = new RegExp(`export\\s+default\\s+(?:function|class|const|let|var)?\\s*${varName}\\b`, 'i').test(indexContent);
                            const importLine = isDefault
                                ? `import ${varName} from '${importPath}';`
                                : `import { ${varName} } from '${importPath}';`;
                            const insertAt = this.findImportInsertPosition(lines);
                            lines.splice(insertAt, 0, importLine);
                            fs.writeFileSync(resolved, lines.join('\n'), 'utf-8');
                            return {
                                success: true,
                                action: 'fixed_import',
                                message: `Added missing import for ${varName} from ${importPath}`,
                                changedFiles: [resolved]
                            };
                        }
                    } catch { /* ignore */ }
                }
            }

            return {
                success: false,
                action: 'skipped',
                message: `No commented import or matching module for ${varName} found in ${path.basename(resolved)}`
            };
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
                success: false,
                action: 'skipped',
                message: `Fix failed: ${msg}`
            };
        }
    }

    /** 找到最后一条 import 语句的下一行位置，用于插入新 import */
    private static findImportInsertPosition(lines: string[]): number {
        let lastImportLine = -1;
        for (let i = 0; i < lines.length && i < 50; i++) {
            if (/^\s*import\s+/.test(lines[i])) {
                lastImportLine = i;
            }
        }
        return lastImportLine >= 0 ? lastImportLine + 1 : 0;
    }
}
