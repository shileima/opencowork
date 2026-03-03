#!/usr/bin/env node
import { cpSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'electron', 'playwright-maximize-wrapper');
const dest = join(root, 'dist-electron', 'playwright-maximize-wrapper');

if (!existsSync(src)) {
  console.warn('[copy-playwright-wrapper] Source not found:', src);
  process.exit(0);
}
cpSync(src, dest, { recursive: true });
console.log('[copy-playwright-wrapper] Copied to', dest);
