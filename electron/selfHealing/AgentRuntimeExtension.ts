/**
 * AgentRuntime 扩展 - 添加自愈相关方法
 *
 * 将此文件中的方法添加到 AgentRuntime 类中
 */

import Anthropic from '@anthropic-ai/sdk';
import { AgentRuntime } from '../agent/AgentRuntime';

/**
 * 为 AgentRuntime 添加自愈支持
 *
 * 使用方法:
 * 1. 在 AgentRuntime 类中添加这些方法
 * 2. 或者作为扩展方法使用
 */

declare module '../agent/AgentRuntime' {
  interface AgentRuntime {
    /**
     * 发送消息用于代码自愈
     * 这是一个简化版本,不触发UI更新
     */
    sendMessageForHealing(prompt: string): Promise<string>;

    /**
     * 静默执行代码修复
     * 不影响当前对话历史
     */
    fixCodeSilently(prompt: string, context: any): Promise<string>;
  }
}

/**
 * 为 AgentRuntime 添加自愈方法的实现
 */
export function extendAgentRuntimeForHealing(runtime: AgentRuntime): void {
  /**
   * 发送消息用于代码自愈
   */
  (runtime as any).sendMessageForHealing = async function(
    this: AgentRuntime,
    prompt: string
  ): Promise<string> {
    // 创建临时的消息上下文
    const tempHistory: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: prompt
      }
    ];

    try {
      // 调用 Claude API
      const response = await (this as any).anthropic.messages.create({
        model: (this as any).model,
        max_tokens: (this as any).maxTokens,
        messages: tempHistory,
        system: `你是一个代码修复专家。请分析错误并提供修复方案。

重要要求:
1. 只修复错误,不添加额外功能
2. 保持代码风格一致
3. 生成完整的修复后代码
4. 按照要求的格式回复`
      });

      // 提取响应文本
      let responseText = '';
      for (const block of response.content) {
        if (block.type === 'text') {
          responseText += block.text;
        }
      }

      return responseText;
    } catch (err) {
      console.error('[AgentRuntime] Healing request failed:', err);
      throw err;
    }
  };

  /**
   * 静默执行代码修复
   */
  (runtime as any).fixCodeSilently = async function(
    this: AgentRuntime,
    prompt: string,
    context: any
  ): Promise<string> {
    // 构建增强的提示词
    const enhancedPrompt = `${prompt}

**上下文信息**:
项目路径: ${context.projectPath || '未知'}
错误类型: ${context.errorType || '未知'}
受影响文件: ${context.affectedFiles?.join(', ') || '未知'}

请提供具体的修复方案。`;

    return await (runtime as any).sendMessageForHealing.call(this, enhancedPrompt);
  };
}

/**
 * 使用示例
 */
export function example() {
  // 在 AgentRuntime 初始化后调用:
  // const runtime = new AgentRuntime(...);
  // extendAgentRuntimeForHealing(runtime);
  //
  // 然后就可以使用:
  // const fixResponse = await runtime.sendMessageForHealing(prompt);
}
