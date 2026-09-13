/**
 * Builds the IDE shell once per suite run, so `workspace.spec.ts`'s
 * host-served test (spec §12, case 6) has a `dist` to serve. Always, not
 * only when `dist` looks stale: `ide-client`'s `src` is an input too, and
 * a freshness check over two trees is more code than the ~20 s it saves.
 * The time is printed so a slow build is visible rather than felt.
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function globalSetup(): void {
  const started = Date.now();
  execSync('npx vite build', {
    cwd: join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
    stdio: 'inherit',
  });
  console.log(`[global-setup] vite build took ${Date.now() - started} ms`);
}
