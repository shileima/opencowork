/**
 * 整包更新（electron-updater）与 update-available 过滤使用的版本比较。
 * 与 latest.yml / app.getVersion() 常见格式兼容（可带 v 前缀）。
 */

export function normalizeSemverForCompare(v: string): string {
  return String(v ?? '')
    .trim()
    .replace(/^v/i, '')
}

/** 返回值：1 表示 v1 > v2，-1 表示 v1 < v2，0 表示相等（按段数值比较） */
export function compareAppSemver(v1: string, v2: string): number {
  const a = normalizeSemverForCompare(v1)
  const b = normalizeSemverForCompare(v2)
  const parts1 = a.split('.').map((x) => parseInt(x, 10))
  const parts2 = b.split('.').map((x) => parseInt(x, 10))

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i]
    const p2 = parts2[i]
    const n1 = Number.isFinite(p1) ? p1! : 0
    const n2 = Number.isFinite(p2) ? p2! : 0
    if (n1 > n2) return 1
    if (n1 < n2) return -1
  }
  return 0
}
