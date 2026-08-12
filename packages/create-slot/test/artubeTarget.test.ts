import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/generate';
import { applyDefaults } from '../src/answers';

/**
 * The Artube target's job: develop against the real backend (no dev bridge, `/api` proxied) and
 * build into the folder Artube's CI actually deploys (`dist`). It is NOT a build-time security
 * control — the DevBridge bootstrapper comes from a `apply: 'serve'` plugin, so no build carries
 * one and the Artube bundle is byte-equivalent to a plain one; the launch gate in createSlotGame is
 * what protects a session-less launch. These assertions are on the FILES a real scaffold writes,
 * not on a re-description of them.
 */

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const versions = {
  'platform-core': '*', 'game-engine': '*', 'stake-kit': '*', 'stake-bridge': '*',
  'stake-math-tools': '*', harness: '*', 'artube-bridge': '^0.1.0', 'artube-server': '^0.1.0',
};

async function scaffold(artube: boolean): Promise<string> {
  dir = mkdtempSync(join(tmpdir(), 'cs-artube-'));
  await generate(applyDefaults({ id: 'moon-spice', mechanic: 'cluster', artube }), dir, versions);
  return dir;
}

const read = (d: string, f: string): string => readFileSync(join(d, f), 'utf8');

describe('the Artube target (--artube)', () => {
  it('turns the DevBridge OFF for the artube target', async () => {
    const d = await scaffold(true);
    const vite = read(d, 'vite.config.ts');
    expect(vite).toContain("const isArtube = target === 'artube'");
    // Where this bites is `dev:artube`: development answers spins from the backend, like production,
    // instead of from local offline math.
    expect(vite).toMatch(/devBridge:\s*!isStake\s*&&\s*!isHarness\s*&&\s*!isArtube/);
  });

  it('builds into dist/ — Artube CI deploys that folder — and wipes it first', async () => {
    const d = await scaffold(true);
    const scripts = JSON.parse(read(d, 'package.json')).scripts;
    expect(scripts['build:artube']).toBe('rm -rf dist && BUILD_TARGET=artube vite build');
    expect(scripts['dev:artube']).toBe('BUILD_TARGET=artube vite');
    expect(scripts['bundle:artube']).toContain('build:artube');
    // No dist-artube anywhere: the platform pipeline only ever deploys `dist`, so an artifact left
    // in a folder it never looks at would silently ship whatever `dist` happened to hold.
    expect(read(d, 'vite.config.ts')).not.toMatch(/outDir:\s*'dist-artube'/);
    expect(JSON.stringify(scripts)).not.toContain('dist-artube');
    // The Stake target keeps its own out dir — the two builds must not share a folder.
    expect(read(d, 'vite.config.ts')).toContain("outDir: 'dist-stake'");
  });

  it('starts the backend itself — `dev:artube` is ONE command', async () => {
    const d = await scaffold(true);
    const vite = read(d, 'vite.config.ts');
    // The plugin owns the backend AND the port, and configures the /api proxy from it. A hardcoded
    // proxy target would be back to "start it yourself in a second terminal" — the failure that
    // showed up in the browser as a bare `ArtubeBackendError: ws error`.
    expect(vite).toContain("artubePlugin({");
    expect(vite).toContain("spinPath: './src/game/script.spin'");
    expect(vite).not.toMatch(/proxy:\s*\{\s*'\/api'/);
    // The plugin is a DEV dependency, never a runtime one: it is Node-side and only vite.config.ts
    // touches it.
    const pkg = JSON.parse(read(d, 'package.json'));
    expect(pkg.devDependencies['@energy8platform/artube-server']).toBe('^0.1.0');
    expect(pkg.dependencies['@energy8platform/artube-server']).toBeUndefined();
  });

  it('imports the backend plugin dynamically, inside the Artube branch only', async () => {
    // A static import would make an uninstalled `artube-server` break EVERY build of the game,
    // including the Energy8/Stake ones that have nothing to do with Artube — the same trap the
    // host's bridge import was earlier on this branch.
    const vite = read(await scaffold(true), 'vite.config.ts');
    expect(vite).not.toMatch(/^import .*artube-server/m);
    expect(vite).toContain("await import('@energy8platform/artube-server/vite')");
    expect(vite).toMatch(/isArtube\s*\n?\s*\?\s*\[/);
  });

  it('keeps an escape hatch for a backend the developer runs themselves', async () => {
    // Someone debugging the server in an IDE must be able to point dev at it.
    for (const f of ['vite.config.ts', 'CLAUDE.md']) {
      expect(read(await scaffold(true), f)).toContain('ARTUBE_BACKEND');
    }
  });

  it('opts in with a caller-supplied loader and depends on the bridge', async () => {
    const d = await scaffold(true);
    // The GAME passes the import, so the specifier lives in the game's bundle — never in
    // game-engine's own, where it would have to resolve for games that never installed the package.
    expect(read(d, 'src/main.ts')).toContain(
      "artube: { load: () => import('@energy8platform/artube-bridge') },",
    );
    // Dynamically imported, but the bundler still must resolve it here.
    expect(JSON.parse(read(d, 'package.json')).dependencies['@energy8platform/artube-bridge']).toBe(
      '^0.1.0',
    );
  });

  it('documents ONE command, not two, in README + CLAUDE.md', async () => {
    const d = await scaffold(true);
    for (const f of ['README.md', 'CLAUDE.md']) {
      const text = read(d, f);
      expect(text, `${f} must document dev:artube`).toContain('npm run dev:artube');
      expect(text, `${f} must name the backend package`).toContain('artube-server');
      // The old two-terminal instruction must not survive anywhere: docs that tell a developer to
      // start a second process are exactly what made a missing backend look like a game bug.
      expect(text, `${f} must not tell anyone to run the backend by hand`).not.toMatch(
        /second terminal|SECOND process|second process/,
      );
      expect(text).not.toContain('artube-server --spin');
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
