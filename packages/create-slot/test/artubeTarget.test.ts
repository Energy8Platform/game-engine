import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/generate';
import { applyDefaults } from '../src/answers';

/**
 * The Artube target's job: develop against the real backend (no dev bridge, `/api` proxied) and
 * build BOTH deployables — the frontend into its own folder (`dist-artube`, like `dist-stake`) and
 * the backend into `dist-artube-server`. It is NOT a build-time security control — the DevBridge
 * bootstrapper comes from a `apply: 'serve'` plugin, so no build carries one and the Artube bundle
 * is byte-equivalent to a plain one; the launch gate in createSlotGame is what protects a
 * session-less launch. These assertions are on the FILES a real scaffold writes, not on a
 * re-description of them.
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

  it('gives every target its own out dir, and wipes the Artube ones first', async () => {
    const d = await scaffold(true);
    const scripts = JSON.parse(read(d, 'package.json')).scripts;
    expect(scripts['build:artube']).toBe(
      'rm -rf dist-artube dist-artube-server && BUILD_TARGET=artube vite build',
    );
    expect(scripts['dev:artube']).toBe('BUILD_TARGET=artube vite');
    expect(scripts['bundle:artube']).toContain('build:artube');
    // Never `dist`: two targets sharing a folder is how a build silently ships another target's
    // bytes. Stake already had its own; Artube now does too.
    const vite = read(d, 'vite.config.ts');
    expect(vite).toContain("outDir: 'dist-stake'");
    expect(vite).toContain("outDir: 'dist-artube'");
    expect(scripts['bundle:artube']).toContain('cd dist-artube');
    // Both generated folders are output, not source.
    const ignore = read(d, '.gitignore');
    expect(ignore).toContain('dist-artube');
    expect(ignore).toContain('dist-artube-server');
  });

  it('states the pipeline consequence of dist-artube wherever a studio will read it', async () => {
    // Artube's CI deploys the repo's `dist` folder, so a game on `dist-artube` needs its pipeline
    // pointed there. Documenting it is the whole reason the choice is safe to make.
    const d = await scaffold(true);
    for (const f of ['README.md', 'CLAUDE.md']) {
      expect(read(d, f), `${f} must name the folder the pipeline has to point at`).toContain(
        'dist-artube',
      );
      expect(read(d, f)).toMatch(/pipeline/i);
    }
  });

  it("emits the deployable backend from the same plugin — with the game's own math", async () => {
    // The seam this closes: the `.spin` lives in the client repo and the backend image needs it.
    // A human copying it between repos is how a frontend goes live against last week's math.
    const d = await scaffold(true);
    for (const f of ['README.md', 'CLAUDE.md']) {
      expect(read(d, f), `${f} must document the backend artifact`).toContain('dist-artube-server');
    }
    expect(read(d, 'vite.config.ts')).toContain('dist-artube-server');
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
    expect(vite).toMatch(/isArtube\s*\n?\s*\?\s*await import/);
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

  it("injects Artube's own loading screen from the Artube branch, dynamically", async () => {
    const vite = read(await scaffold(true), 'vite.config.ts');
    // Injected into index.html by the plugin, which is the whole point: the loader is painted
    // before the game bundle is fetched, which no JS-mounted preloader can be. It comes from OUR
    // package — Artube's plugin is vendored there, so there is nothing of Artube's to install.
    expect(vite).toContain('artubePartnerLoader()');
    expect(vite).toContain("await import('@energy8platform/artube-server/vite')");
    // Still dynamic and branch-local: `artube-server` is a devDependency, and a static import
    // would make an Energy8/Stake-only build have to resolve it.
    expect(vite).not.toMatch(/^import .*artube-server/m);
    expect(vite).toMatch(/isArtube\s*\n?\s*\?\s*await import/);
  });

  it("hands the engine Artube's controller, from OUR package", async () => {
    const d = await scaffold(true);
    const main = read(d, 'src/main.ts');
    // The engine names no Artube type: `externalOverlay` is a structural
    // `{ showLoader, updateProgress, hideLoader }`, and the GAME supplies the instance. The
    // instance now comes from the vendored copy in artube-bridge, at its own leaf entry so a
    // non-Artube build of this same game does not pull the bridge in with it.
    expect(main).toContain(
      "import { createArtubeLoader } from '@energy8platform/artube-bridge/loader';",
    );
    expect(main).toContain('const artubeLoader = createArtubeLoader();');
    expect(main).toContain('loading: { externalOverlay: artubeLoader }');
    // Guarded, because the markup only exists in an Artube build — a plain `npm run dev` of this
    // same game must still get the Energy8 preloader from its first frame.
    expect(main).toMatch(/\.\.\.\(artubeLoader\s*\?/);
  });

  it('passes NOTHING but the overlay — loading behaves the same on every target', async () => {
    // The overlay covers the pre-first-frame gap and then hands over. Pinning tapToStart or
    // minDisplayTime inside the Artube branch (as an earlier version did) would give the Artube
    // build a different loading screen from the game's other targets, silently.
    const main = read(await scaffold(true), 'src/main.ts');
    expect(main).not.toContain('tapToStart');
    expect(main).not.toContain('minDisplayTime');
  });

  it('needs no private registry, no .npmrc and no token — anywhere', async () => {
    // The reason the loader was vendored: a token-gated dependency made `npm install` fail for the
    // WHOLE project unless every studio had an account on Artube's GitLab.
    const d = await scaffold(true);
    const pkg = JSON.parse(read(d, 'package.json'));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      expect(dep.startsWith('@artube/'), `${dep} must not come from Artube's registry`).toBe(false);
    }
    expect(read(d, 'src/main.ts')).not.toContain('@artube/');
    expect(read(d, 'vite.config.ts')).not.toContain('@artube/');
    for (const f of ['README.md', 'CLAUDE.md']) {
      const text = read(d, f);
      // Saying "no .npmrc is needed" is fine and wanted; telling a studio how to write one is not.
      expect(text, `${f} must not still ask for a token`).not.toContain('GITLAB_TOKEN');
      expect(text, `${f} must not still describe an auth line`).not.toContain('_authToken');
      expect(text, `${f} must not name the private registry`).not.toContain('gitlab.com/api/v4');
      expect(text, `${f} must say a plain install is enough`).toMatch(/no token|no .npmrc/i);
    }
  });

  it('describes the hand-over, so nobody re-reads it as "Artube replaces our loader"', async () => {
    const d = await scaffold(true);
    for (const f of ['README.md', 'CLAUDE.md']) {
      const text = read(d, f);
      expect(text, `${f} must say where Artube's screen stops`).toMatch(/first frame/i);
      expect(text, `${f} must say the game's own loading screen follows`).toMatch(
        /every other target|same on every target|exactly as on every other target/i,
      );
    }
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
    // No loader wiring at all in a game that never opted into Artube.
    expect(pkg.dependencies['@artube/loader']).toBeUndefined();
    expect(read(d, 'src/main.ts')).not.toContain('createArtubeLoader');
    expect(read(d, 'src/main.ts')).not.toContain('externalOverlay');
    expect(read(d, 'src/main.ts')).not.toContain('artube');
    expect(read(d, 'CLAUDE.md')).not.toContain('Artube');
    expect(read(d, 'README.md')).not.toContain('Artube');
    // The placeholder must be substituted away, not left in the shipped README.
    expect(read(d, 'README.md')).not.toContain('${artube}');
  });
});
