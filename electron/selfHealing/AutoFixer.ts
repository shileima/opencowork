/**
 * 自动修复器 - 调用 Agent 修复代码
 */

import { BuildError, ErrorAnalysis, FixResult, FixContext, FileChange } from './types';
import { ErrorAnalyzer } from './ErrorAnalyzer';
import fs from 'node:fs';
import path from 'node:path';

export class AutoFixer {
  private analyzer: ErrorAnalyzer;

  constructor() {
    this.analyzer = new ErrorAnalyzer();
  }

  /**
   * 修复错误
   */
  async fix(
    error: BuildError,
    analysis: ErrorAnalysis,
    projectPath: string,
    agentCallback: (prompt: string) => Promise<string>
  ): Promise<FixResult> {
    try {
      // 构建修复上下文
      const context = await this.buildFixContext(error, analysis, projectPath);

      // 生成修复提示词
      const prompt = this.generateFixPrompt(context);

      // 调用 Agent 获取修复方案
      const agentResponse = await agentCallback(prompt);

      // 解析 Agent 响应
      const changes = this.parseAgentResponse(agentResponse, context);

      if (changes.length === 0) {
        return {
          success: false,
          changes: [],
          message: 'Agent 未能生成有效的修复方案'
        };
      }

      // 备份文件
      await this.backupFiles(changes);

      // 应用修复
      const applied = await this.applyFix(projectPath, changes);

      if (!applied) {
        // 如果应用失败,恢复备份
        await this.restoreBackups(changes);
        return {
          success: false,
          changes: [],
          message: '应用修复失败'
        };
      }

      // 检查是否需要安装依赖
      const needsDependencyInstall = this.analyzer.needsDependencyInstall(error);
      const packageName = needsDependencyInstall
        ? this.analyzer.extractPackageName(error)
        : null;

      return {
        success: true,
        changes,
        message: `成功修复 ${changes.length} 个文件`,
        needsDependencyInstall,
        dependencies: packageName ? [packageName] : undefined
      };
    } catch (err) {
      console.error('[AutoFixer] Fix failed:', err);
      return {
        success: false,
        changes: [],
        message: err instanceof Error ? err.message : '修复过程出错'
      };
    }
  }

  /**
   * 构建修复上下文
   */
  private async buildFixContext(
    error: BuildError,
    analysis: ErrorAnalysis,
    projectPath: string
  ): Promise<FixContext> {
    const context: FixContext = {
      projectPath,
      error,
      analysis
    };

    // 读取错误文件内容
    if (error.file && fs.existsSync(error.file)) {
      try {
        context.fileContent = fs.readFileSync(error.file, 'utf-8');

        // 提取代码上下文
        if (error.line) {
          context.codeContext = this.analyzer.extractCodeContext(
            error,
            context.fileContent,
            10 // 上下10行
          );
        }
      } catch (err) {
        console.error('[AutoFixer] Failed to read file:', err);
      }
    }

    // 读取受影响的其他文件
    for (const file of analysis.affectedFiles) {
      if (file !== error.file && fs.existsSync(file)) {
        try {
          // 可以添加更多文件内容到上下文
          // 这里暂时只处理主错误文件
        } catch (err) {
          console.error('[AutoFixer] Failed to read affected file:', file, err);
        }
      }
    }

    return context;
  }

  /**
   * 生成修复提示词
   */
  private generateFixPrompt(context: FixContext): string {
    const { error, analysis, fileContent, codeContext } = context;

    const fileName = error.file ? path.basename(error.file) : '未知文件';
    const fileExt = error.file ? path.extname(error.file).slice(1) : 'typescript';
    const language = ['ts', 'tsx'].includes(fileExt) ? 'typescript' : fileExt;

    let prompt = `你是一个代码修复专家。项目在构建过程中遇到错误,请分析并提供修复方案。

**错误信息**:
\`\`\`
${error.message}
\`\`\`

**错误类型**: ${error.type}
**文件**: ${fileName}`;

    if (error.line) {
      prompt += `\n**位置**: 第 ${error.line} 行`;
      if (error.column) {
        prompt += `, 第 ${error.column} 列`;
      }
    }

    if (analysis.suggestion) {
      prompt += `\n\n**修复建议**: ${analysis.suggestion}`;
    }

    if (codeContext) {
      prompt += `\n\n**相关代码**:
\`\`\`${language}
${codeContext}
\`\`\``;
    } else if (fileContent) {
      // 如果没有上下文但有完整文件,截取相关部分
      const lines = fileContent.split('\n');
      const snippet = lines.slice(0, Math.min(50, lines.length)).join('\n');
      prompt += `\n\n**文件内容(前50行)**:
\`\`\`${language}
${snippet}
\`\`\``;
    }

    prompt += `\n\n**任务**:
1. 分析错误的根本原因
2. 提供具体的修复方案
3. 生成修复后的代码

**要求**:
- 只修复错误,不要添加额外功能
- 保持代码风格一致
- 确保修复后代码可以正常编译
- 如果需要安装依赖,在"额外步骤"中说明

请按以下格式回复:

## 问题分析
[简要分析错误原因]

## 修复方案
[说明如何修复,1-2句话]

## 修复代码
\`\`\`${language}
[修复后的完整代码]
\`\`\`

## 额外步骤
[如果需要安装依赖或其他操作,在此说明;如果不需要,写"无"]
`;

    return prompt;
  }

  /**
   * 解析 Agent 响应
   */
  private parseAgentResponse(response: string, context: FixContext): FileChange[] {
    const changes: FileChange[] = [];

    // 从响应中提取代码块
    const codeBlockPattern = /```(?:typescript|javascript|ts|tsx|js|jsx)?\n([\s\S]*?)```/g;
    const matches = [...response.matchAll(codeBlockPattern)];

    if (matches.length === 0) {
      console.error('[AutoFixer] No code blocks found in agent response');
      return changes;
    }

    // 使用第一个代码块作为修复后的代码
    const fixedCode = matches[0][1].trim();

    if (!context.error.file) {
      console.error('[AutoFixer] No file specified in error');
      return changes;
    }

    changes.push({
      file: context.error.file,
      before: context.fileContent || '',
      after: fixedCode,
      description: this.extractDescription(response)
    });

    return changes;
  }

  /**
   * 从响应中提取描述
   */
  private extractDescription(response: string): string {
    // 尝试提取"修复方案"部分
    const solutionMatch = response.match(/##\s*修复方案\s*\n([\s\S]*?)(?=\n##|$)/);
    if (solutionMatch) {
      return solutionMatch[1].trim();
    }

    // 尝试提取"问题分析"部分
    const analysisMatch = response.match(/##\s*问题分析\s*\n([\s\S]*?)(?=\n##|$)/);
    if (analysisMatch) {
      return analysisMatch[1].trim();
    }

    return '自动修复';
  }

  /**
   * 备份文件
   */
  private async backupFiles(changes: FileChange[]): Promise<void> {
    for (const change of changes) {
      const backupPath = `${change.file}.backup`;
      try {
        if (fs.existsSync(change.file)) {
          fs.copyFileSync(change.file, backupPath);
        }
      } catch (err) {
        console.error('[AutoFixer] Failed to backup file:', change.file, err);
        throw err;
      }
    }
  }

  /**
   * 应用修复
   */
  private async applyFix(projectPath: string, changes: FileChange[]): Promise<boolean> {
    try {
      for (const change of changes) {
        const filePath = path.isAbsolute(change.file)
          ? change.file
          : path.join(projectPath, change.file);

        // 确保目录存在
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // 写入修复后的代码
        fs.writeFileSync(filePath, change.after, 'utf-8');
      }

      return true;
    } catch (err) {
      console.error('[AutoFixer] Failed to apply fix:', err);
      return false;
    }
  }

  /**
   * 恢复备份
   */
  private async restoreBackups(changes: FileChange[]): Promise<void> {
    for (const change of changes) {
      const backupPath = `${change.file}.backup`;
      try {
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, change.file);
          fs.unlinkSync(backupPath);
        }
      } catch (err) {
        console.error('[AutoFixer] Failed to restore backup:', change.file, err);
      }
    }
  }

  /**
   * 清理备份文件
   */
  async cleanupBackups(changes: FileChange[]): Promise<void> {
    for (const change of changes) {
      const backupPath = `${change.file}.backup`;
      try {
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
      } catch (err) {
        console.error('[AutoFixer] Failed to cleanup backup:', backupPath, err);
      }
    }
  }

  /**
   * 安装依赖
   */
  async installDependencies(
    projectPath: string,
    dependencies: string[]
  ): Promise<boolean> {
    if (dependencies.length === 0) {
      return true;
    }

    // 这里需要集成包管理器安装逻辑
    // 暂时返回 true,实际实现需要调用 npm/pnpm/yarn
    console.log('[AutoFixer] Would install dependencies:', dependencies);

    // TODO: 实现实际的依赖安装逻辑
    // const { spawn } = require('node:child_process');
    // return new Promise((resolve) => {
    //   const proc = spawn('npm', ['install', ...dependencies], {
    //     cwd: projectPath
    //   });
    //   proc.on('close', (code) => resolve(code === 0));
    // });

    return true;
  }
}
