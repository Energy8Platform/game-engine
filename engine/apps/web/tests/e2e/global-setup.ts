/**
 * Builds the IDE shell once per suite run, so `workspace.spec.ts`'s
 * host-served test (spec §12, case 6) has a `dist` to serve — unless the
 * one already there is at least as new as every input (`apps/web`'s and
 * `ide/client`'s `src`, plus this app's `index.html` and `vite.config.ts`),
 * in which case the ~20 s are skipped. Which happened is printed either way.
 */
import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The newest mtime under `path` (a file, or a directory walked in full); `Infinity` when nothing is there. */
function newest(path: string): number {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return Infinity; // a missing input is never "older than dist"
  }
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(-Infinity, ...readdirSync(path).map((name) => newest(join(path, name))));
}

/** Is a `dist/index.html` stamped `distIndexMtimeMs` at least as new as every file under `roots`? */
export function isFresh(distIndexMtimeMs: number, roots: string[]): boolean {
  return roots.every((root) => newest(root) <= distIndexMtimeMs);
}

export default function globalSetup(): void {
  const inputs = [
    join(WEB, 'src'),
    join(WEB, 'index.html'),
    join(WEB, 'vite.config.ts'),
    join(WEB, '..', '..', 'ide', 'client', 'src'),
  ];
  let distMtime = -Infinity;
  try {
    distMtime = statSync(join(WEB, 'dist', 'index.html')).mtimeMs;
  } catch {
    // no dist yet: built below
  }
  if (isFresh(distMtime, inputs)) {
    console.log('[global-setup] dist/index.html is newer than every input — vite build skipped');
    return;
  }
  const started = Date.now();
  execSync('npx vite build', { cwd: WEB, stdio: 'inherit' });
  console.log(`[global-setup] vite build took ${Date.now() - started} ms`);
}
