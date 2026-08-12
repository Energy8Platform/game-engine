import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/generate';
import { applyDefaults } from '../src/answers';

/**
 * The Artube target is the structural half of the free-play guard: a bundle built for Artube must
 * carry no DevBridge, and must land in the folder Artube's CI actually deploys (`dist`). These
 * assertions are on the FILES a real scaffold writes, not on a re-description of them.
 */

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const versions = {
  'platform-core': '*', 'game-engine': '*', 'stake-kit': '*', 'stake-bridge': '*',
  'stake-math-tools': '*', harness: '*', 'artube-bridge': '^0.1.0',
};

async function scaffold(artube: boolean): Promise<string> {
  dir = mkdtempSync(join(tmpdir(), 'cs-artube-'));
  await generate(applyDefaults({ id: 'moon-spice', mechanic: 'cluster', artube }), dir, versions);
  return dir;
}

const read = (d: string, f: string): string => readFileSync(join(d, f), 'utf8');

describe('the Artube target (--artube)', () => {
  it('turns the DevBridge OFF for the artube build target', async () => {
    const d = await scaffold(true);
    const vite = read(d, 'vite.config.ts');
    expect(vite).toContain("const isArtube = target === 'artube'");
    // The whole point: no DevBridge in an Artube bundle → nothing for a session-less launch to
    // fall through to.
    expect(vite).toMatch(/devBridge:\s*!isStake\s*&&\s*!isHarness\s*&&\s*!isArtube/);
  });

  it('builds into dist/ — Artube CI deploys that folder — and wipes it first', async () => {
    const d = await scaffold(true);
    const scripts = JSON.parse(read(d, 'package.json')).scripts;
    expect(scripts['build:artube']).toBe('rm -rf dist && BUILD_TARGET=artube vite build');
    expect(scripts['dev:artube']).toBe('BUILD_TARGET=artube vite');
    expect(scripts['bundle:artube']).toContain('build:artube');
    // No dist-artube anywhere: a folder the platform pipeline never looks at would silently deploy
    // whatever `dist` happened to hold.
    expect(read(d, 'vite.config.ts')).not.toMatch(/outDir:\s*'dist-artube'/);
    expect(JSON.stringify(scripts)).not.toContain('dist-artube');
    // The Stake target keeps its own out dir — the two builds must not share a folder.
    expect(read(d, 'vite.config.ts')).toContain("outDir: 'dist-stake'");
  });

  it('proxies /api to the separately-run backend so dev is same-origin like production', async () => {
    const vite = read(await scaffold(true), 'vite.config.ts');
    expect(vite).toContain("proxy: { '/api': { target: artubeBackend, ws: true, changeOrigin: true } }");
    expect(vite).toContain('artube-server --spin ./game.spin --sandbox --port 8080');
  });

  it('opts the game in via createSlotGame({ artube: {} }) and depends on the bridge', async () => {
    const d = await scaffold(true);
    expect(read(d, 'src/main.ts')).toContain('artube: {},');
    // The host imports the bridge dynamically, but the bundler still must resolve it.
    expect(JSON.parse(read(d, 'package.json')).dependencies['@energy8platform/artube-bridge']).toBe(
      '^0.1.0',
    );
  });

  it('documents the pairing with the backend process in README + CLAUDE.md', async () => {
    const d = await scaffold(true);
    for (const f of ['README.md', 'CLAUDE.md']) {
      const text = read(d, f);
      expect(text, `${f} must document dev:artube`).toContain('npm run dev:artube');
      // A dev script that silently needs a second process is a trap — name it.
      expect(text, `${f} must name the backend process`).toContain('artube-server');
    }
    expect(read(d, 'CLAUDE.md')).toContain('BUILD_TARGET=artube');
  });

  it('leaves a non-Artube scaffold exactly as it was', async () => {
    const d = await scaffold(false);
    const pkg = JSON.parse(read(d, 'package.json'));
    expect(pkg.scripts['dev:artube']).toBeUndefined();
    expect(pkg.scripts['build:artube']).toBeUndefined();
    expect(pkg.dependencies['@energy8platform/artube-bridge']).toBeUndefined();
    expect(read(d, 'src/main.ts')).not.toContain('artube');
    expect(read(d, 'CLAUDE.md')).not.toContain('Artube');
    expect(read(d, 'README.md')).not.toContain('Artube');
    // The placeholder must be substituted away, not left in the shipped README.
    expect(read(d, 'README.md')).not.toContain('${artube}');
  });
});
