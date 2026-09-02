/**
 * Loads .env.local for CLI scripts.
 *
 * Next.js does this automatically for the app; tsx does not, and the scripts
 * need the same key. Existing environment variables always win, so CI can
 * override without editing files.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function loadEnv(root: string = process.cwd()): void {
  const path = join(root, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
