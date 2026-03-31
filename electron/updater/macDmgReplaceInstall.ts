import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawn } from 'node:child_process'

/**
 * 当前运行中的 .app 包路径（仅 macOS 打包后有效）。
 */
export const getMacAppBundlePath = (): string | null => {
  if (process.platform !== 'darwin') return null
  try {
    const real = fs.realpathSync(process.execPath)
    let d = path.dirname(real)
    if (path.basename(d) !== 'MacOS') return null
    d = path.dirname(d)
    if (path.basename(d) !== 'Contents') return null
    const bundle = path.dirname(d)
    if (!bundle.endsWith('.app')) return null
    return bundle
  } catch {
    return null
  }
}

const findAppBundleInDirectory = (dir: string): string | null => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    if (e.isDirectory() && e.name.endsWith('.app')) {
      return path.join(dir, e.name)
    }
  }
  return null
}

const tryDetach = (mountPoint: string) => {
  try {
    execFileSync('/usr/bin/hdiutil', ['detach', mountPoint, '-quiet'], { stdio: 'ignore' })
  } catch {
    /* ignore */
  }
}

const tryRmDir = (p: string) => {
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

export type MacDmgInstallPrepareResult =
  | { ok: true; stagingAppPath: string; targetAppPath: string }
  | { ok: false; error: string }

/**
 * 挂载 DMG，将其中 .app 复制到临时目录后卸载。供退出后由 shell 脚本覆盖安装路径。
 */
export const prepareMacDmgInstallFromPath = (dmgPath: string): MacDmgInstallPrepareResult => {
  if (!fs.existsSync(dmgPath)) {
    return { ok: false, error: '安装包文件不存在，请重新下载。' }
  }

  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'qcw-dmg-mount-'))
  try {
    execFileSync('/usr/bin/hdiutil', ['attach', '-nobrowse', '-mountpoint', mountPoint, '-readonly', dmgPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e: unknown) {
    tryRmDir(mountPoint)
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `无法挂载安装包：${msg}` }
  }

  const sourceApp = findAppBundleInDirectory(mountPoint)
  if (!sourceApp) {
    tryDetach(mountPoint)
    tryRmDir(mountPoint)
    return { ok: false, error: '安装包内未找到应用程序（.app），请从 GitHub 重新下载。' }
  }

  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qcw-app-stage-'))
  const stagingAppPath = path.join(stagingRoot, path.basename(sourceApp))

  try {
    execFileSync('/usr/bin/ditto', ['-rsrc', sourceApp, stagingAppPath], { stdio: 'pipe' })
  } catch (e: unknown) {
    tryDetach(mountPoint)
    tryRmDir(mountPoint)
    tryRmDir(stagingRoot)
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `复制新版本失败：${msg}` }
  }

  tryDetach(mountPoint)
  tryRmDir(mountPoint)

  const targetAppPath = getMacAppBundlePath()
  if (!targetAppPath) {
    tryRmDir(stagingRoot)
    return { ok: false, error: '无法解析当前应用安装路径，请使用 DMG 手动安装。' }
  }

  return { ok: true, stagingAppPath, targetAppPath }
}

/**
 * 后台脚本：等待当前进程退出后 ditto 覆盖目标 .app，清理暂存目录并 open 启动新版本。
 */
export function spawnMacReplaceScript(opts: {
  oldPid: number
  stagingAppPath: string
  targetAppPath: string
}): void {
  const inner = `set -euo pipefail
OLD_PID="$QCW_OLD_PID"
STAGING_APP="$QCW_STAGING"
TARGET_APP="$QCW_TARGET"
for i in $(seq 1 1200); do
  if ! kill -0 "$OLD_PID" 2>/dev/null; then break; fi
  sleep 0.25
done
sleep 0.5
if [[ -d "$TARGET_APP" ]]; then rm -rf "$TARGET_APP"; fi
/usr/bin/ditto "$STAGING_APP" "$TARGET_APP"
STAGING_ROOT="$(dirname "$STAGING_APP")"
rm -rf "$STAGING_ROOT"
open "$TARGET_APP"
`
  const child = spawn('/bin/bash', ['-c', inner], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      QCW_OLD_PID: String(opts.oldPid),
      QCW_STAGING: opts.stagingAppPath,
      QCW_TARGET: opts.targetAppPath,
    },
  })
  child.unref()
}
