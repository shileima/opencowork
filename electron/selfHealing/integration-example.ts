/**
 * 自愈系统集成示例
 * 展示如何在预览/部署流程中使用自愈功能
 */

import { SelfHealingCoordinator } from './SelfHealingCoordinator';
import { HealingOptions } from './types';
import { AgentRuntime } from '../agent/AgentRuntime';

/**
 * 示例: 集成到部署流程
 */
export async function deployWithHealing(
  projectPath: string,
  sender: Electron.WebContents,
  agentRuntime: AgentRuntime
): Promise<{ success: boolean; url?: string; error?: string }> {
  const coordinator = new SelfHealingCoordinator();

  // 定义部署操作
  const deployOperation = async () => {
    // 这里是原有的部署逻辑
    // 返回格式: { success: boolean, exitCode: number, output: string }

    try {
      // 执行构建
      const buildResult = await runBuild(projectPath);

      if (buildResult.exitCode !== 0) {
        return {
          success: false,
          exitCode: buildResult.exitCode,
          output: buildResult.output
        };
      }

      // 执行上传
      const uploadResult = await runUpload(projectPath);

      return {
        success: uploadResult.exitCode === 0,
        exitCode: uploadResult.exitCode,
        output: uploadResult.output
      };
    } catch (err) {
      return {
        success: false,
        exitCode: 1,
        output: err instanceof Error ? err.message : String(err)
      };
    }
  };

  // Agent 回调函数
  const agentCallback = async (prompt: string): Promise<string> => {
    // 调用 Agent 获取修复方案
    return await agentRuntime.sendMessageForHealing(prompt);
  };

  // 配置自愈选项
  const options: HealingOptions = {
    operation: 'deploy',
    projectPath,
    maxRetries: 3,
    autoMode: true, // 自动修复,不询问用户
    onProgress: (message, phase) => {
      // 发送进度到前端
      sender.send('deploy:healing:progress', { message, phase });

      // 同时记录到日志
      sender.send('deploy:log', `[自愈] ${message}\n`);
    }
  };

  try {
    // 执行带自愈功能的部署
    const result = await coordinator.executeWithHealing(
      deployOperation,
      options,
      agentCallback
    );

    if (result.success) {
      // 部署成功
      sender.send('deploy:log', `\n✅ 部署成功! ${result.finalMessage}\n`);

      // 如果有修复记录,报告修复情况
      if (result.fixes.length > 0) {
        sender.send('deploy:log', `\n📝 修复记录:\n`);
        result.fixes.forEach((fix, index) => {
          sender.send('deploy:log', `  ${index + 1}. ${fix.message}\n`);
        });
      }

      return {
        success: true,
        url: 'https://example.com' // 实际的部署 URL
      };
    } else {
      // 部署失败
      sender.send('deploy:error', result.finalMessage);

      return {
        success: false,
        error: result.finalMessage
      };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : '未知错误';
    sender.send('deploy:error', `自愈系统错误: ${errorMessage}`);

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * 示例: 集成到预览流程
 */
export async function previewWithHealing(
  projectPath: string,
  _sender: Electron.WebContents,
  agentRuntime: AgentRuntime
): Promise<{ success: boolean; port?: number; error?: string }> {
  const coordinator = new SelfHealingCoordinator();

  // 定义预览操作
  const previewOperation = async () => {
    try {
      // 启动开发服务器
      const result = await startDevServer(projectPath);

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        output: result.output
      };
    } catch (err) {
      return {
        success: false,
        exitCode: 1,
        output: err instanceof Error ? err.message : String(err)
      };
    }
  };

  // Agent 回调
  const agentCallback = async (prompt: string): Promise<string> => {
    return await agentRuntime.sendMessageForHealing(prompt);
  };

  // 配置选项
  const options: HealingOptions = {
    operation: 'preview',
    projectPath,
    maxRetries: 3,
    autoMode: true,
    onProgress: (message, phase) => {
      // 发送进度消息
      console.log(`[Preview Healing] ${phase}: ${message}`);
    }
  };

  try {
    const result = await coordinator.executeWithHealing(
      previewOperation,
      options,
      agentCallback
    );

    if (result.success) {
      return {
        success: true,
        port: 5173 // 实际的端口号
      };
    } else {
      return {
        success: false,
        error: result.finalMessage
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '未知错误'
    };
  }
}

// ===== 辅助函数 (需要实现) =====

async function runBuild(_projectPath: string): Promise<{
  exitCode: number;
  output: string;
}> {
  // TODO: 实现构建逻辑
  return { exitCode: 0, output: '' };
}

async function runUpload(_projectPath: string): Promise<{
  exitCode: number;
  output: string;
}> {
  // TODO: 实现上传逻辑
  return { exitCode: 0, output: '' };
}

async function startDevServer(_projectPath: string): Promise<{
  exitCode: number;
  output: string;
}> {
  // TODO: 实现开发服务器启动逻辑
  return { exitCode: 0, output: '' };
}
