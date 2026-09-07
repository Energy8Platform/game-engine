import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The scaffold writes @energy8platform/* version ranges into a new game's package.json (cli.ts
 * PUBLISHED + the stake-math-tools devDep). They MUST track the published workspace versions, or a
 * fresh game installs stale libraries. This guard reads the real workspace package.json versions and
 * asserts cli.ts references each as a caret range — so a future version bump that forgets the
 * scaffold defaults fails here.
 */
const PKGS = ['platform-core', 'game-engine', 'stake-kit', 'stake-bridge', 'stake-math-tools', 'harness', 'artube-bridge', 'artube-server'] as const;

const versionOf = (pkg: string): string =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../${pkg}/package.json`, import.meta.url)), 'utf8')).version;

const cliSrc = readFileSync(fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'utf8');

/** Key may be quoted ('stake-kit') or a bare identifier (harness) — prettier drops quotes from keys
 *  that don't need them, and a bundler may re-add them, so match either form. */
const pinPattern = (pkg: string): RegExp =>
  new RegExp(`(?:["']${pkg}["']|${pkg}):\\s*["']\\^${versionOf(pkg).replace(/\./g, '\\.')}["']`);

describe('scaffold dependency versions track the workspace', () => {
  for (const p of PKGS) {
    it(`@energy8platform/${p} default matches the current workspace version`, () => {
      expect(cliSrc).toMatch(pinPattern(p));
    });
  }
});

/**
 * The source guard above is not enough on its own, and for a long time it hid the very drift it
 * was written to catch: a player runs `dist/cli.js`, and create-slot had no `prepublishOnly`, so
 * `npm publish` shipped whatever build happened to be sitting on disk. The published 0.7.4 pinned
 * game-engine ^0.35.0 — eight releases behind src/cli.ts — while this file stayed green.
 */
describe('the scaffold we PUBLISH is the scaffold we wrote', () => {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { scripts?: Record<string, string> };

  it('rebuilds on publish, so a stale dist can never be what ships', () => {
    expect(pkg.scripts?.prepublishOnly).toMatch(/\bbuild\b/);
  });

  const distPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const dist = existsSync(distPath) ? readFileSync(distPath, 'utf8') : null;

  for (const p of PKGS) {
    // Conditional because a clean checkout has no dist yet; `prepublishOnly` is what makes the
    // published artifact safe. This catches the other half — a stale dist on a machine that is
    // about to publish from it.
    it.skipIf(dist == null)(`built cli.js pins @energy8platform/${p} at the workspace version`, () => {
      expect(dist).toMatch(pinPattern(p));
    });
  }
});
