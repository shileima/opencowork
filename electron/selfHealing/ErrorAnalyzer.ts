/**
 * 错误分析器 - 分析错误并判断是否可修复
 */

import { BuildError, ErrorAnalysis, ErrorType } from './types';
import path from 'node:path';

export class ErrorAnalyzer {
  /**
   * 分析错误
   */
  analyze(error: BuildError, projectPath: string): ErrorAnalysis {
    const errorType = error.type;
    const affectedFiles = this.extractAffectedFiles(error, projectPath);
    const isFixable = this.isFixableError(error);
    const confidence = this.calculateConfidence(error);
    const suggestion = this.generateSuggestion(error);
    const priority = this.determinePriority(error);

    return {
      isFixable,
      errorType,
      affectedFiles,
      suggestion,
      confidence,
      priority
    };
  }

  /**
   * 提取受影响的文件
   */
  private extractAffectedFiles(error: BuildError, projectPath: string): string[] {
    const files: string[] = [];

    if (error.file) {
      // 如果是相对路径,转换为绝对路径
      const absolutePath = path.isAbsolute(error.file)
        ? error.file
        : path.join(projectPath, error.file);
      files.push(absolutePath);
    }

    // 从错误消息中提取其他可能的文件
    const filePatterns = [
      // 匹配 import 语句中的文件
      /from\s+['"]([^'"]+)['"]/g,
      // 匹配文件路径
      /['"]([^'"]*\.(ts|tsx|js|jsx|json|css))['"]/g
    ];

    for (const pattern of filePatterns) {
      const matches = error.fullLog.matchAll(pattern);
      for (const match of matches) {
        const file = match[1];
        if (file && !file.startsWith('node_modules')) {
          const absolutePath = path.isAbsolute(file)
            ? file
            : path.join(projectPath, file);
          if (!files.includes(absolutePath)) {
            files.push(absolutePath);
          }
        }
      }
    }

    return files;
  }

  /**
   * 判断错误是否可自动修复
   */
  private isFixableError(error: BuildError): boolean {
    switch (error.type) {
      case ErrorType.SYNTAX_ERROR:
        // 简单的语法错误可以修复
        return true;

      case ErrorType.TYPE_ERROR:
        // TypeScript 类型错误通常可以修复
        return true;

      case ErrorType.MODULE_NOT_FOUND:
        // 如果是本地模块,可能是路径错误,可以修复
        // 如果是 npm 包,可以尝试安装
        return true;

      case ErrorType.DEPENDENCY_ERROR:
        // 依赖版本冲突可能需要手动处理
        return this.isDependencyFixable(error);

      case ErrorType.CONFIG_ERROR:
        // 简单的配置错误可以修复
        return this.isConfigFixable(error);

      case ErrorType.BUILD_ERROR:
        // 构建错误需要具体分析
        return this.isBuildErrorFixable(error);

      case ErrorType.RUNTIME_ERROR:
        // 运行时错误通常较难自动修复
        return false;

      case ErrorType.UNKNOWN:
        // 未知错误尝试修复
        return false;

      default:
        return false;
    }
  }

  /**
   * 判断依赖错误是否可修复
   */
  private isDependencyFixable(error: BuildError): boolean {
    const message = error.message.toLowerCase();

    // 缺少依赖可以修复(安装)
    if (message.includes('not found') ||
        message.includes('missing')) {
      return true;
    }

    // 版本冲突较难自动修复
    if (message.includes('peer dep') ||
        message.includes('conflict')) {
      return false;
    }

    return true;
  }

  /**
   * 判断配置错误是否可修复
   */
  private isConfigFixable(error: BuildError): boolean {
    const message = error.message.toLowerCase();

    // 简单的配置错误可以修复
    if (message.includes('invalid') ||
        message.includes('missing') ||
        message.includes('unexpected')) {
      return true;
    }

    return false;
  }

  /**
   * 判断构建错误是否可修复
   */
  private isBuildErrorFixable(error: BuildError): boolean {
    // 如果有文件位置信息,通常可以尝试修复
    if (error.file && error.line) {
      return true;
    }

    return false;
  }

  /**
   * 计算修复成功的置信度
   */
  private calculateConfidence(error: BuildError): number {
    let confidence = 0.5; // 基础置信度

    // 有明确文件和行号,置信度更高
    if (error.file && error.line) {
      confidence += 0.2;
    }

    // 错误类型影响置信度
    switch (error.type) {
      case ErrorType.SYNTAX_ERROR:
        confidence += 0.2; // 语法错误比较容易修复
        break;
      case ErrorType.TYPE_ERROR:
        confidence += 0.15; // 类型错误通常可以修复
        break;
      case ErrorType.MODULE_NOT_FOUND:
        confidence += 0.1; // 模块未找到可能需要安装
        break;
      case ErrorType.BUILD_ERROR:
        confidence += 0.05; // 构建错误视情况而定
        break;
      default:
        confidence -= 0.1; // 其他类型降低置信度
    }

    // 确保在 0-1 范围内
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * 生成修复建议
   */
  private generateSuggestion(error: BuildError): string {
    switch (error.type) {
      case ErrorType.SYNTAX_ERROR:
        return `检查 ${error.file || '代码'} 的语法错误,可能是缺少括号、逗号或分号`;

      case ErrorType.TYPE_ERROR:
        return `修复 TypeScript 类型错误,检查类型定义和类型注解`;

      case ErrorType.MODULE_NOT_FOUND:
        if (error.message.includes('Cannot find module')) {
          const moduleMatch = error.message.match(/Cannot find module ['"]([^'"]+)['"]/);
          if (moduleMatch) {
            const moduleName = moduleMatch[1];
            if (moduleName.startsWith('.')) {
              return `本地模块 '${moduleName}' 未找到,检查文件路径和文件名`;
            } else {
              return `npm 包 '${moduleName}' 未安装,尝试运行: npm install ${moduleName}`;
            }
          }
        }
        return '检查模块导入路径和依赖安装';

      case ErrorType.DEPENDENCY_ERROR:
        return '检查 package.json 中的依赖版本,可能需要更新或安装依赖';

      case ErrorType.CONFIG_ERROR:
        return '检查配置文件(vite.config.ts, tsconfig.json 等)的语法和配置项';

      case ErrorType.BUILD_ERROR:
        return '分析构建错误日志,修复代码中的问题';

      case ErrorType.RUNTIME_ERROR:
        return '检查运行时错误,可能是逻辑问题或环境问题';

      default:
        return '分析错误日志并尝试修复';
    }
  }

  /**
   * 确定错误优先级
   */
  private determinePriority(error: BuildError): 'high' | 'medium' | 'low' {
    // 语法错误和类型错误优先级高
    if (error.type === ErrorType.SYNTAX_ERROR ||
        error.type === ErrorType.TYPE_ERROR) {
      return 'high';
    }

    // 模块未找到和依赖错误优先级中等
    if (error.type === ErrorType.MODULE_NOT_FOUND ||
        error.type === ErrorType.DEPENDENCY_ERROR) {
      return 'medium';
    }

    // 其他错误优先级较低
    return 'low';
  }

  /**
   * 提取错误的代码上下文
   */
  extractCodeContext(
    error: BuildError,
    fileContent: string,
    contextLines: number = 5
  ): string | null {
    if (!error.line) {
      return null;
    }

    const lines = fileContent.split('\n');
    const errorLineIndex = error.line - 1; // 0-based index

    if (errorLineIndex < 0 || errorLineIndex >= lines.length) {
      return null;
    }

    // 提取上下文行
    const startLine = Math.max(0, errorLineIndex - contextLines);
    const endLine = Math.min(lines.length, errorLineIndex + contextLines + 1);

    const contextLines_arr = lines.slice(startLine, endLine);

    // 标记错误行
    const context = contextLines_arr.map((line, index) => {
      const lineNumber = startLine + index + 1;
      const isErrorLine = lineNumber === error.line;
      const marker = isErrorLine ? '>>>' : '   ';
      return `${marker} ${lineNumber.toString().padStart(4)} | ${line}`;
    }).join('\n');

    return context;
  }

  /**
   * 判断是否需要安装依赖
   */
  needsDependencyInstall(error: BuildError): boolean {
    if (error.type !== ErrorType.MODULE_NOT_FOUND) {
      return false;
    }

    const message = error.message;
    const moduleMatch = message.match(/Cannot find module ['"]([^'"]+)['"]/);

    if (moduleMatch) {
      const moduleName = moduleMatch[1];
      // 如果不是相对路径,可能是 npm 包
      return !moduleName.startsWith('.') && !moduleName.startsWith('/');
    }

    return false;
  }

  /**
   * 提取需要安装的包名
   */
  extractPackageName(error: BuildError): string | null {
    if (!this.needsDependencyInstall(error)) {
      return null;
    }

    const message = error.message;
    const moduleMatch = message.match(/Cannot find module ['"]([^'"]+)['"]/);

    if (moduleMatch) {
      let packageName = moduleMatch[1];

      // 处理作用域包 (如 @types/react)
      if (packageName.startsWith('@')) {
        const parts = packageName.split('/');
        if (parts.length >= 2) {
          packageName = parts.slice(0, 2).join('/');
        }
      } else {
        // 处理子路径 (如 lodash/debounce)
        packageName = packageName.split('/')[0];
      }

      return packageName;
    }

    return null;
  }
}
