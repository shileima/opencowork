import { spawnSync } from 'node:child_process';

export type RpaPythonCli = { command: string; prefixArgs: string[] };

function isPython3VersionString(text: string): boolean {
  return /Python\s*3\./i.test(text);
}

/**
 * 检测可用于执行 RPA .py 脚本的 Python 3 解释器（与 rpa:execute-script 的 spawn 参数一致）。
 */
export function resolveRpaPythonCli(): RpaPythonCli | null {
  const candidates: RpaPythonCli[] =
    process.platform === 'win32'
      ? [
          { command: 'py', prefixArgs: ['-3'] },
          { command: 'python', prefixArgs: [] },
          { command: 'python3', prefixArgs: [] },
        ]
      : [
          { command: 'python3', prefixArgs: [] },
          { command: 'python', prefixArgs: [] },
        ];

  for (const { command, prefixArgs } of candidates) {
    const r = spawnSync(command, [...prefixArgs, '--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const combined = `${r.stdout || ''}\n${r.stderr || ''}`;
    if (r.status === 0 && isPython3VersionString(combined)) {
      return { command, prefixArgs };
    }
  }
  return null;
}

/** 返回给前端 / 执行面板的错误文案（简体中文） */
export function getPythonMissingErrorMessage(): string {
  if (process.platform === 'win32') {
    return (
      '未检测到 Python 3。请安装 Python 3 后再执行脚本。\n' +
      '可选方式：Microsoft Store 搜索「Python 3.12」、或从 https://www.python.org/downloads/ 下载安装（安装时勾选「Add python.exe to PATH」）。\n' +
      '若已安装「Python Launcher」，也可使用 py -3。'
    );
  }
  if (process.platform === 'darwin') {
    return (
      '未检测到 Python 3。请安装后再执行脚本。\n' +
      '推荐：在终端执行 brew install python3\n' +
      '或从 https://www.python.org/downloads/macos/ 下载安装。'
    );
  }
  return (
    '未检测到 Python 3。请安装后再执行脚本。\n' +
    '例如 Debian/Ubuntu：sudo apt update && sudo apt install python3\n' +
    '或从 https://www.python.org/downloads/ 获取安装包。'
  );
}
