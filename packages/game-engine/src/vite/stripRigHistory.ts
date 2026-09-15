import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const HISTORY = '.rig-history';

/** Every `.rig-history` directory under `dir`, deepest last (a rig's history never nests another). */
export function findRigHistory(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(dir, e.name);
    if (e.name === HISTORY) out.push(p);
    else out.push(...findRigHistory(p));
  }
  return out;
}

/**
 * The golem editor keeps undo snapshots in `.rig-history/` beside each `rig.json`. Rigs live under
 * `public/`, which vite copies into the build wholesale — this drops those directories from `outDir`
 * after the copy. Nothing to do for a game without rigs.
 */
export function stripRigHistory(): Plugin {
  let outDir = 'dist';
  return {
    name: 'e8:strip-rig-history',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      let dirs: string[];
      try {
        dirs = findRigHistory(outDir);
      } catch {
        return; // no outDir (e.g. `write: false`)
      }
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    },
  };
}
