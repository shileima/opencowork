import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve shell path from SHELL env var, ensuring it's an absolute path that exists.
 * Fallback order: $SHELL -> /bin/zsh -> /bin/bash -> /bin/sh
 */
export function resolveShellPath(): string {
  const shellRaw = process.env.SHELL || '/bin/zsh';
  let s = path.isAbsolute(shellRaw)
    ? shellRaw
    : path.join(process.env.HOME || '/', shellRaw.replace(/^~/, ''));
  if (!fs.existsSync(s)) {
    s = '/bin/zsh';
    if (!fs.existsSync(s)) s = '/bin/bash';
    if (!fs.existsSync(s)) s = '/bin/sh';
  }
  return s;
}

/**
 * Validate that a shell path exists, is a regular file, and is executable.
 */
export function validateShellPath(shellPath: string): { valid: boolean; error?: string } {
  if (!fs.existsSync(shellPath)) {
    return { valid: false, error: `Shell file does not exist: ${shellPath}` };
  }
  try {
    const stats = fs.statSync(shellPath);
    if (!stats.isFile()) {
      return { valid: false, error: `Shell path is not a file: ${shellPath}` };
    }
    if (process.platform !== 'win32') {
      const mode = stats.mode;
      const isExecutable = (mode & parseInt('111', 8)) !== 0;
      if (!isExecutable) {
        return { valid: false, error: `Shell file is not executable: ${shellPath}` };
      }
    }
  } catch (e) {
    return {
      valid: false,
      error: `Cannot access shell file: ${shellPath}, ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return { valid: true };
}

/**
 * Return a de-duplicated list of candidate shell paths that actually exist on disk.
 * Priority: $SHELL (if absolute & exists) -> /bin/zsh -> /bin/bash -> /bin/sh
 */
export function getShellCandidates(): string[] {
  const candidates: string[] = [];
  const shellRaw = process.env.SHELL;
  if (shellRaw && path.isAbsolute(shellRaw) && fs.existsSync(shellRaw)) {
    candidates.push(shellRaw);
  }
  candidates.push('/bin/zsh', '/bin/bash', '/bin/sh');
  return [...new Set(candidates)].filter((p) => fs.existsSync(p));
}

/**
 * Convenience helper used by run_command / spawn callers.
 * On Windows returns 'powershell.exe'; on macOS/Linux returns the first
 * validated shell candidate (or '/bin/sh' as last resort).
 *
 * Returns `null` only when absolutely no shell can be found (extremely unlikely).
 */
export function resolveShellForCommand(): string | null {
  if (process.platform === 'win32') {
    return 'powershell.exe';
  }

  const candidates = getShellCandidates();
  for (const candidate of candidates) {
    const result = validateShellPath(candidate);
    if (result.valid) {
      return candidate;
    }
  }

  const fallback = resolveShellPath();
  if (fs.existsSync(fallback)) {
    return fallback;
  }

  return null;
}
