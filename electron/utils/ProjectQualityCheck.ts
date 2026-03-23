import * as path from 'path';
import * as fs from 'fs';
import { spawn as cpSpawn } from 'node:child_process';
import type { WebContents } from 'electron';
import { resolveDeployEnv } from './DeployEnvResolver';

export interface QualityCheckResult {
  success: boolean;
  summary: string;
  log: string;
}

function appendLog(sender: WebContents, lines: string[], chunk: string) {
  lines.push(chunk);
  if (!sender.isDestroyed()) {
    sender.send('project:quality:log', chunk);
  }
}

function runShellCommand(cmd: string, cwd: string, env: NodeJS.ProcessEnv, sender: WebContents, lines: string[]): Promise<number> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd' : 'sh';
    const shellArg = process.platform === 'win32' ? '/c' : '-c';
    const proc = cpSpawn(shell, [shellArg, cmd], { cwd, env });
    proc.stdout?.on('data', (d: Buffer) => appendLog(sender, lines, d.toString()));
    proc.stderr?.on('data', (d: Buffer) => appendLog(sender, lines, d.toString()));
    proc.on('close', (code) => resolve(code ?? 1));
    proc.on('error', (err) => {
      appendLog(sender, lines, `[spawn error] ${err.message}\n`);
      resolve(1);
    });
  });
}

function readPackageScripts(projectPath: string): { scripts: Record<string, string> } | null {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> };
    return { scripts: pkg.scripts || {} };
  } catch {
    return null;
  }
}

/**
 * 仅执行与线上一致的生产构建（pnpm/npm/yarn run build），不运行 ESLint、tsc。
 */
export async function runProjectQualityCheck(projectPath: string, sender: WebContents): Promise<QualityCheckResult> {
  const lines: string[] = [];

  const root = projectPath?.trim();
  if (!root || !fs.existsSync(root) || !fs.existsSync(path.join(root, 'package.json'))) {
    return { success: false, summary: '无效项目目录或缺少 package.json', log: '' };
  }

  const pkgInfo = readPackageScripts(root);
  if (!pkgInfo) {
    return { success: false, summary: '无法读取 package.json', log: '' };
  }

  const deployEnvResult = await resolveDeployEnv(root, true);
  const { env, packageManager } = deployEnvResult;

  appendLog(sender, lines, '══════════════════════════════════════\n');
  appendLog(sender, lines, ' 构建验证（仅 pnpm/npm/yarn run build）\n');
  appendLog(sender, lines, '══════════════════════════════════════\n');
  appendLog(sender, lines, '说明：不执行 ESLint；以构建命令退出码为准。\n\n');

  const hasBuildScript = typeof pkgInfo.scripts.build === 'string' && pkgInfo.scripts.build.length > 0;
  if (!hasBuildScript) {
    const summary = 'package.json 中无 build 脚本，无法验证构建';
    appendLog(sender, lines, `${summary}\n`);
    return { success: false, summary, log: lines.join('') };
  }

  const buildCmd =
    packageManager === 'yarn' ? 'yarn run build' : packageManager === 'npm' ? 'npm run build' : 'pnpm run build';
  appendLog(sender, lines, `── 执行：${buildCmd} ──\n`);
  const buildCode = await runShellCommand(buildCmd, root, env, sender, lines);
  const buildOk = buildCode === 0;

  if (buildOk) {
    appendLog(sender, lines, '\n✓ 构建成功\n');
  } else {
    appendLog(sender, lines, `\n✗ 构建失败（exit ${buildCode}）\n`);
  }

  const summary = buildOk
    ? '构建通过'
    : '构建未通过（完整命令输出见同次检查生成的对话记录）';

  appendLog(sender, lines, `\n──────────────────────────────────────\n${summary}\n`);

  return {
    success: buildOk,
    summary,
    log: lines.join(''),
  };
}
