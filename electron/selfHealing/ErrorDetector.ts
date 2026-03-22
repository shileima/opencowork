/**
 * 错误检测器 - 从构建输出中检测和解析错误
 */

import { BuildError, ErrorType, ParsedError } from './types';

export class ErrorDetector {
  /**
   * 检测构建输出中的错误
   */
  detectError(output: string, exitCode: number): BuildError | null {
    // 如果退出码为 0,认为没有错误
    if (exitCode === 0) {
      return null;
    }

    // 尝试解析各种类型的错误
    const parsedError = this.parseErrorMessage(output);
    const errorType = this.categorizeError(output);

    return {
      type: errorType,
      message: parsedError.message,
      file: parsedError.file,
      line: parsedError.line,
      column: parsedError.column,
      fullLog: output,
      timestamp: Date.now(),
      rawError: parsedError
    };
  }

  /**
   * 解析错误消息,提取关键信息
   */
  parseErrorMessage(output: string): ParsedError {
    const lines = output.split('\n');

    // TypeScript 错误格式: src/App.tsx(45,10): error TS2339: Property...
    const tsErrorPattern = /^(.+?)\((\d+),(\d+)\):\s*error\s+TS(\d+):\s*(.+)$/;

    // ESLint/Vite 错误格式: src/App.tsx:45:10: error: ...
    const eslintPattern = /^(.+?):(\d+):(\d+):\s*error:\s*(.+)$/;

    // 通用错误格式: Error: ... at file:line:column
    const genericPattern = /Error:\s*(.+?)\s+at\s+(.+?):(\d+):(\d+)/;

    // Node 模块错误: Cannot find module '...' from '...'
    const modulePattern = /Cannot find module\s+'([^']+)'\s+from\s+'([^']+)'/;

    // Syntax error: Unexpected token
    const syntaxPattern = /SyntaxError:\s*(.+)/;

    for (const line of lines) {
      // TypeScript 错误
      const tsMatch = line.match(tsErrorPattern);
      if (tsMatch) {
        return {
          message: tsMatch[5],
          file: tsMatch[1],
          line: parseInt(tsMatch[2]),
          column: parseInt(tsMatch[3]),
          code: `TS${tsMatch[4]}`
        };
      }

      // ESLint/Vite 错误
      const eslintMatch = line.match(eslintPattern);
      if (eslintMatch) {
        return {
          message: eslintMatch[4],
          file: eslintMatch[1],
          line: parseInt(eslintMatch[2]),
          column: parseInt(eslintMatch[3])
        };
      }

      // 通用错误
      const genericMatch = line.match(genericPattern);
      if (genericMatch) {
        return {
          message: genericMatch[1],
          file: genericMatch[2],
          line: parseInt(genericMatch[3]),
          column: parseInt(genericMatch[4])
        };
      }

      // 模块未找到错误
      const moduleMatch = line.match(modulePattern);
      if (moduleMatch) {
        return {
          message: `Cannot find module '${moduleMatch[1]}'`,
          file: moduleMatch[2]
        };
      }

      // 语法错误
      const syntaxMatch = line.match(syntaxPattern);
      if (syntaxMatch) {
        return {
          message: syntaxMatch[1]
        };
      }
    }

    // 如果没有匹配到特定格式,返回完整输出的前500字符
    return {
      message: this.extractErrorMessage(output)
    };
  }

  /**
   * 分类错误类型
   */
  private categorizeError(output: string): ErrorType {
    const lowercaseOutput = output.toLowerCase();

    // 语法错误
    if (lowercaseOutput.includes('syntaxerror') ||
        lowercaseOutput.includes('unexpected token') ||
        lowercaseOutput.includes('unexpected identifier')) {
      return ErrorType.SYNTAX_ERROR;
    }

    // 类型错误
    if (lowercaseOutput.includes('ts2') ||
        lowercaseOutput.includes('type error') ||
        lowercaseOutput.includes('property') && lowercaseOutput.includes('does not exist')) {
      return ErrorType.TYPE_ERROR;
    }

    // 模块未找到
    if (lowercaseOutput.includes('cannot find module') ||
        lowercaseOutput.includes('module not found') ||
        lowercaseOutput.includes('cannot resolve')) {
      return ErrorType.MODULE_NOT_FOUND;
    }

    // 依赖错误
    if (lowercaseOutput.includes('peer dep') ||
        lowercaseOutput.includes('npm err') ||
        lowercaseOutput.includes('pnpm err') ||
        lowercaseOutput.includes('dependency') && lowercaseOutput.includes('not found')) {
      return ErrorType.DEPENDENCY_ERROR;
    }

    // 配置错误
    if (lowercaseOutput.includes('vite.config') ||
        lowercaseOutput.includes('tsconfig') ||
        lowercaseOutput.includes('package.json') && lowercaseOutput.includes('invalid')) {
      return ErrorType.CONFIG_ERROR;
    }

    // 构建错误
    if (lowercaseOutput.includes('build failed') ||
        lowercaseOutput.includes('compilation error')) {
      return ErrorType.BUILD_ERROR;
    }

    // 运行时错误
    if (lowercaseOutput.includes('runtime error') ||
        lowercaseOutput.includes('referenceerror') ||
        lowercaseOutput.includes('typeerror')) {
      return ErrorType.RUNTIME_ERROR;
    }

    return ErrorType.UNKNOWN;
  }

  /**
   * 从输出中提取错误消息
   */
  private extractErrorMessage(output: string): string {
    const lines = output.split('\n');

    // 查找包含 "error" 或 "Error" 的行
    for (const line of lines) {
      if (line.toLowerCase().includes('error') && line.trim().length > 0) {
        return line.trim();
      }
    }

    // 如果没找到,返回最后几行非空行
    const nonEmptyLines = lines.filter(l => l.trim().length > 0);
    return nonEmptyLines.slice(-5).join('\n');
  }

  /**
   * 检查输出是否包含警告(而非错误)
   */
  isWarningOnly(output: string): boolean {
    const lowercaseOutput = output.toLowerCase();

    // 如果只有警告,没有错误
    if (lowercaseOutput.includes('warning') &&
        !lowercaseOutput.includes('error') &&
        !lowercaseOutput.includes('failed')) {
      return true;
    }

    return false;
  }

  /**
   * 提取多个错误(有些构建可能有多个错误)
   */
  detectMultipleErrors(output: string, exitCode: number): BuildError[] {
    if (exitCode === 0) {
      return [];
    }

    const errors: BuildError[] = [];
    const lines = output.split('\n');

    // TypeScript 错误格式
    const tsErrorPattern = /^(.+?)\((\d+),(\d+)\):\s*error\s+TS(\d+):\s*(.+)$/;

    for (const line of lines) {
      const match = line.match(tsErrorPattern);
      if (match) {
        errors.push({
          type: ErrorType.TYPE_ERROR,
          message: match[5],
          file: match[1],
          line: parseInt(match[2]),
          column: parseInt(match[3]),
          fullLog: line,
          timestamp: Date.now(),
          rawError: { code: `TS${match[4]}` }
        });
      }
    }

    // 如果没有找到多个错误,返回单个错误
    if (errors.length === 0) {
      const singleError = this.detectError(output, exitCode);
      if (singleError) {
        errors.push(singleError);
      }
    }

    return errors;
  }
}
