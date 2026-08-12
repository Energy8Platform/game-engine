/**
 * The build half: `BUILD_TARGET=artube vite build` must produce a backend a
 * studio can deploy without touching it.
 *
 * The assertion that carries the whole feature is the `.spin` one. Everything
 * else here is contract detail; the reason this code exists is that the
 * game's math lived in the client repo and reached the backend image only by
 * someone remembering to copy it. So the test is on the *bytes*, not on the
 * fact that a file with that name appeared.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  artubePlugin,
  artubeBuildPlugin,
  emitServerArtifact,
  renderPackageJson,
  resolvePackageFile,
  resolveServerSpec,
  sanitizePackageName,
  readGameName,
  ARTIFACT_SPIN_NAME,
  DEFAULT_SERVER_OUT_DIR,
} from '../src/vite/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SPIN = 'game "moon" {\n  reels = [1, 2, 3]\n}\n';

/** A game repo: a package.json, and math where `create-slot` puts it. */
function gameRoot(spin = SPIN): string {
  const root = mkdtempSync(join(tmpdir(), 'artube-build-'));
  dirs.push(root);
  mkdirSync(join(root, 'src', 'game'), { recursive: true });
  writeFileSync(join(root, 'src', 'game', 'script.spin'), spin);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'moon-spice-market' }));
  return root;
}

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Drive the plugin the way Vite does: resolve the config, then close the bundle. */
function runBuild(plugin: ReturnType<typeof artubeBuildPlugin>, root: string): void {
  (plugin.configResolved as any)?.call({}, { root });
  (plugin.closeBundle as any).call({});
}

describe('the emitted artifact', () => {
  it("ships the game's math byte-for-byte — the reason the plugin does this at all", () => {
    const root = gameRoot();
    runBuild(artubeBuildPlugin(), root);

    const source = join(root, 'src', 'game', 'script.spin');
    const shipped = join(root, DEFAULT_SERVER_OUT_DIR, ARTIFACT_SPIN_NAME);
    expect(existsSync(shipped)).toBe(true);
    expect(sha(shipped)).toBe(sha(source));
  });

  it('is self-contained: Dockerfile, entry point, manifest, math, and a README', () => {
    const root = gameRoot();
    runBuild(artubeBuildPlugin(), root);
    const out = join(root, DEFAULT_SERVER_OUT_DIR);
    for (const f of ['Dockerfile', 'index.js', 'package.json', ARTIFACT_SPIN_NAME, 'README.md']) {
      expect(existsSync(join(out, f)), `${f} must be emitted`).toBe(true);
    }
  });

  it('emits the package\'s own Dockerfile.template verbatim, so the two cannot drift', () => {
    const root = gameRoot();
    runBuild(artubeBuildPlugin(), root);
    expect(sha(join(root, DEFAULT_SERVER_OUT_DIR, 'Dockerfile'))).toBe(
      sha(resolvePackageFile('Dockerfile.template')),
    );
  });

  it('needs no TypeScript in the image: a JS entry, one stage, no build step', () => {
    const root = gameRoot();
    runBuild(artubeBuildPlugin(), root);
    const out = join(root, DEFAULT_SERVER_OUT_DIR);

    const dockerfile = readFileSync(join(out, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('CMD ["node", "index.js"]');
    // The `rootDir`/`outDir` trap only exists because the image compiled the
    // entry point. No compile, no trap — and no `AS build` stage to have one in.
    expect(dockerfile).not.toMatch(/AS build/i);
    expect(dockerfile).not.toMatch(/^RUN npm run build/m);
    expect(dockerfile).not.toContain('COPY --from=');

    const entry = readFileSync(join(out, 'index.js'), 'utf8');
    expect(entry).toContain("from '@energy8platform/artube-server'");
    expect(entry).toContain('loadConfigFromEnv()');
    // Nothing about a particular environment is baked in — the same image is
    // promoted across environments with different GameId/GamesApiUrl/key.
    expect(entry).not.toMatch(/GameId\s*[:=]/);
    expect(entry).not.toContain('wss://');
  });

  it("keeps the build-time engine-binary check, so a networkless build fails loudly", () => {
    const root = gameRoot();
    runBuild(artubeBuildPlugin(), root);
    const dockerfile = readFileSync(join(root, DEFAULT_SERVER_OUT_DIR, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('no usable e8-server binary found');
    expect(dockerfile).toContain('E8_SERVER_BINARY');
    expect(dockerfile).toContain('process.exit(1)');
  });

  it('declares exactly one dependency, pinned to the version that emitted it', () => {
    const root = gameRoot();
    runBuild(artubeBuildPlugin(), root);
    const pkg = JSON.parse(readFileSync(join(root, DEFAULT_SERVER_OUT_DIR, 'package.json'), 'utf8'));

    const own = JSON.parse(readFileSync(resolvePackageFile('package.json'), 'utf8')) as {
      version: string;
    };
    expect(pkg.dependencies).toEqual({ '@energy8platform/artube-server': `^${own.version}` });
    // Nothing is compiled in the image, so there is nothing to devDepend on.
    expect(pkg.devDependencies).toBeUndefined();
    expect(pkg.type).toBe('module');
    expect(pkg.name).toBe('moon-spice-market-artube-server');
  });

  it('lets a studio point the pin at a private registry, git ref, or tarball', () => {
    const spec = 'file:./vendor/energy8platform-artube-server-0.1.0.tgz';
    expect(resolveServerSpec(spec)).toBe(spec);
    const pkg = JSON.parse(renderPackageJson({ gameName: 'g', serverSpec: spec }));
    expect(pkg.dependencies['@energy8platform/artube-server']).toBe(spec);
  });

  it('wipes the directory first — a stale .spin surviving a rebuild is the whole failure', () => {
    const root = gameRoot();
    const out = join(root, DEFAULT_SERVER_OUT_DIR);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'stale.spin'), 'game "yesterday" {}');
    runBuild(artubeBuildPlugin(), root);
    expect(existsSync(join(out, 'stale.spin'))).toBe(false);
  });

  it('copies a directory of .spin files as a directory', () => {
    const root = gameRoot();
    const spinDir = join(root, 'math');
    mkdirSync(spinDir, { recursive: true });
    writeFileSync(join(spinDir, 'base.spin'), SPIN);
    writeFileSync(join(spinDir, 'bonus.spin'), 'game "bonus" {}\n');
    runBuild(artubeBuildPlugin({ spinPath: './math' }), root);
    const out = join(root, DEFAULT_SERVER_OUT_DIR, ARTIFACT_SPIN_NAME);
    expect(sha(join(out, 'base.spin'))).toBe(sha(join(spinDir, 'base.spin')));
    expect(sha(join(out, 'bonus.spin'))).toBe(sha(join(spinDir, 'bonus.spin')));
  });

  it('honours a custom out dir', () => {
    const root = gameRoot();
    runBuild(artubeBuildPlugin({ serverOutDir: 'server-out' }), root);
    expect(existsSync(join(root, 'server-out', 'index.js'))).toBe(true);
    expect(existsSync(join(root, DEFAULT_SERVER_OUT_DIR))).toBe(false);
  });

  it('can be turned off entirely', () => {
    const root = gameRoot();
    runBuild(artubeBuildPlugin({ emitServer: false }), root);
    expect(existsSync(join(root, DEFAULT_SERVER_OUT_DIR))).toBe(false);
  });

  it('fails the build when the math is missing, naming the path it looked for', () => {
    const root = gameRoot();
    rmSync(join(root, 'src', 'game', 'script.spin'));
    expect(() => runBuild(artubeBuildPlugin(), root)).toThrow(
      /spin math not found[\s\S]*script\.spin/,
    );
  });
});

describe('naming', () => {
  it('borrows the game\'s package name and makes it npm-legal', () => {
    expect(sanitizePackageName('@studio/Moon Spice!')).toBe('moon-spice');
    expect(sanitizePackageName('!!!')).toBe('artube-game');
  });

  it('falls back when the build root has no package.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'artube-noname-'));
    dirs.push(root);
    expect(readGameName(root)).toBe('artube-game');
  });
});

describe('emitServerArtifact — used directly', () => {
  it('reports what it wrote', () => {
    const root = gameRoot();
    const out = join(root, 'out');
    const result = emitServerArtifact({
      root,
      spinPath: join(root, 'src', 'game', 'script.spin'),
      outDir: out,
    });
    expect(result.outDir).toBe(out);
    expect(result.files).toContain(ARTIFACT_SPIN_NAME);
    expect(result.serverSpec).toMatch(/^\^\d+\./);
  });
});

describe('the build half never leaks into a dev server', () => {
  it('is apply: build, and its sibling is apply: serve', () => {
    expect(artubeBuildPlugin().apply).toBe('build');
    expect(artubePlugin().find((p) => p.name === 'artube:server-artifact')?.apply).toBe('build');
  });
});
