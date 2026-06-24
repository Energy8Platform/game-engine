import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The scaffold writes @energy8platform/* version ranges into a new game's package.json (cli.ts
 * PUBLISHED + the stake-math-tools devDep). They MUST track the published workspace versions, or a
 * fresh game installs stale libraries. This guard reads the real workspace package.json versions and
 * asserts cli.ts references each as a caret range — so a future version bump that forgets the
 * scaffold defaults fails here.
 */
const PKGS = ['platform-core', 'game-engine', 'stake-kit', 'stake-bridge', 'stake-math-tools'] as const;

const versionOf = (pkg: string): string =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../${pkg}/package.json`, import.meta.url)), 'utf8')).version;

const cliSrc = readFileSync(fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'utf8');

describe('scaffold dependency versions track the workspace', () => {
  for (const p of PKGS) {
    it(`@energy8platform/${p} default matches the current workspace version`, () => {
      expect(cliSrc).toContain(`'${p}': '^${versionOf(p)}'`);
    });
  }
});
