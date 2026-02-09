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
                                    message: `Replaced ${importPath} with ${newImportPath}`
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
                            message: `Removed import for missing file: ${importPath}`
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
}
