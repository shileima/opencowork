#!/usr/bin/env bash
set -e
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_DIR"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
LOG="${REPO_DIR}/.release.log"
echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] Starting scheduled release" >> "$LOG"
pnpm release patch >> "$LOG" 2>&1 || echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] Release failed" >> "$LOG"
