import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * 返回常见的 pnpm/包管理器可执行路径目录，仅包含当前平台存在且可用的目录。
 * 用于在 run_command 或 deploy 的 PATH 中插入这些路径，使从 Dock/Finder 启动时子进程也能找到 pnpm。
 */
export function getCommonPackageManagerPaths(): string[] {
  const platform = process.platform;
  const home = os.homedir();

  const candidates: string[] = [];
  if (platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'pnpm'),
      path.join(home, '.local', 'share', 'pnpm'),
      '/opt/homebrew/bin',
      '/usr/local/bin'
    );
  } else if (platform === 'linux') {
    candidates.push(
      path.join(home, '.local', 'share', 'pnpm'),
      '/usr/local/bin'
    );
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    candidates.push(
      path.join(appData, 'pnpm'),
      path.join(localAppData, 'pnpm')
    );
  }

  return candidates.filter((dir) => {
    try {
      return fs.existsSync(dir);
    } catch {
      return false;
    }
  });
}

export type PackageManager = 'pnpm' | 'npm' | 'yarn';

/**
 * 检测项目使用的包管理器
 * 优先级：package.json packageManager > lockfile 存在性 > 默认 pnpm
 */
export function detectPackageManager(projectPath: string): PackageManager {
  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const pm = pkg.packageManager;
      if (typeof pm === 'string') {
        if (pm.startsWith('pnpm')) return 'pnpm';
        if (pm.startsWith('npm')) return 'npm';
        if (pm.startsWith('yarn')) return 'yarn';
      }
    } catch {
      // ignore parse errors
    }
  }

  if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(projectPath, 'package-lock.json'))) return 'npm';
  if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) return 'yarn';

  return 'pnpm';
}
