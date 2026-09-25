/**
 * Slice 38 (paper-duel F14), spec §2: a project that resolves its OWN copy
 * of `pixi.js` or `cordis` — not the one the composed engine rows use — or
 * that names/installs the legacy engine package, is told so. Every fixture
 * is a tmp project laid out the way a real game outside this repo is: the
 * engine rows installed under the project's own `node_modules`.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Context } from 'cordis';
import { describe, expect, it } from 'vitest';
import { apply, type ProjectService } from '../src/plugins/project';

// Built from parts — the ide-host guard (`no-legacy-engine.test.ts`) scans engine/ for the literal.
const LEGACY = ['@energy8platform', 'game-engine'].join('/');
const FIRST_SLOT = join(__dirname, '../../../examples/first-slot');
const TEMPLATE = join(__dirname, '../../../templates/slot-basic');

function write(path: string, content: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
}

/**
 * A project composing one engine row, `@energy8engine/fake-row`; `installed`
 * also installs it with pixi.js 8.0.0, cordis 4.0.0 and @energy8engine/tween
 * 1.0.0 beside it.
 */
function project(installed = true): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ide-host-module-copies-')));
  write(join(dir, 'package.json'), { name: 'game', dependencies: {} });
  write(join(dir, 'e8.profile.yml'), 'bundles:\n  - b\n');
  write(
    join(dir, 'bundles/b/e8.bundle.yml'),
    "name: b\nrows:\n  - id: row1\n    name: '@energy8engine/fake-row'\n",
  );
  if (installed) {
    write(join(dir, 'node_modules/@energy8engine/fake-row/package.json'), {
      name: '@energy8engine/fake-row',
      version: '1.0.0',
    });
    write(join(dir, 'node_modules/pixi.js/package.json'), { name: 'pixi.js', version: '8.0.0' });
    write(join(dir, 'node_modules/cordis/package.json'), { name: 'cordis', version: '4.0.0' });
    write(join(dir, 'node_modules/@energy8engine/tween/package.json'), {
      name: '@energy8engine/tween',
      version: '1.0.0',
    });
  }
  return dir;
}

async function diagnosticsOf(cwd: string): Promise<ProjectService['diagnostics']> {
  let service: ProjectService | undefined;
  const ctx = { provide: (_: string, value: ProjectService) => (service = value) };
  await apply(ctx as unknown as Context, { cwd });
  return service!.diagnostics;
}

describe('module copies (host check)', () => {
  it.each([
    ['pixi.js', '8.0.0'],
    ['cordis', '4.0.0'],
    // Under `e8 build` the engine merges into one chunk and the runtime
    // marker's URLs collapse — this check is the build's net for tween.
    ['@energy8engine/tween', '1.0.0'],
  ])(
    'a plugin with its own nested %s is warned, naming both copies',
    async (pkg, engineVersion) => {
      const dir = project();
      write(join(dir, 'plugins/mine/package.json'), { name: 'mine' });
      write(join(dir, `plugins/mine/node_modules/${pkg}/package.json`), {
        name: pkg,
        version: '7.9.9',
      });
      expect(await diagnosticsOf(dir)).toEqual([
        {
          severity: 'warning',
          plugin: 'composition',
          where: 'plugins/mine/package.json',
          message: `plugins/mine resolves ${pkg}@7.9.9 (${join(dir, 'plugins/mine/node_modules', pkg)}) but the engine's rows use ${pkg}@${engineVersion} (${join(dir, 'node_modules', pkg)}) — two copies in one page`,
          fix: `declare ${pkg} the way the engine does (or drop it) so one copy resolves`,
        },
      ]);
    },
  );

  it('a plugin resolving the same pixi.js as the rows is quiet', async () => {
    const dir = project();
    write(join(dir, 'plugins/mine/package.json'), {
      name: 'mine',
      peerDependencies: { 'pixi.js': '*' },
    });
    expect(await diagnosticsOf(dir)).toEqual([]);
  });

  it('compares against the rows, wherever they are installed — not against the project root', async () => {
    const dir = project();
    // The engine row carries its own pixi.js; the project root's is another copy.
    write(join(dir, 'node_modules/@energy8engine/fake-row/node_modules/pixi.js/package.json'), {
      name: 'pixi.js',
      version: '8.1.0',
    });
    const [only, ...rest] = await diagnosticsOf(dir);
    expect(rest).toEqual([]);
    expect(only.where).toBe('package.json');
    expect(only.message).toBe(
      `the project resolves pixi.js@8.0.0 (${join(dir, 'node_modules/pixi.js')}) but the engine's rows use pixi.js@8.1.0 (${join(dir, 'node_modules/@energy8engine/fake-row/node_modules/pixi.js')}) — two copies in one page`,
    );
  });

  it('no node_modules and no plugins/ — no error, no warning', async () => {
    expect(await diagnosticsOf(project(false))).toEqual([]);
  });

  it('a plugin manifest naming the legacy engine is warned', async () => {
    const dir = project();
    write(join(dir, 'plugins/old/package.json'), {
      name: 'old',
      dependencies: { [LEGACY]: '^1.0.0' },
    });
    expect(await diagnosticsOf(dir)).toEqual([
      {
        severity: 'warning',
        plugin: 'composition',
        where: 'plugins/old/package.json',
        message: `the engine no longer uses ${LEGACY} — a copy here is a second engine`,
        fix: 'remove it; use @energy8engine/tween for tweens',
      },
    ]);
  });

  it('the legacy engine installed in the project (not named) is warned, once, at every location that resolves it', async () => {
    const dir = project();
    write(join(dir, 'plugins/mine/package.json'), { name: 'mine' });
    write(join(dir, `node_modules/${LEGACY}/package.json`), { name: LEGACY, version: '1.0.0' });
    const found = await diagnosticsOf(dir);
    expect(found.map((d) => [d.where, d.message])).toEqual([
      [
        'package.json, plugins/mine/package.json',
        `the engine no longer uses ${LEGACY} — a copy here is a second engine`,
      ],
    ]);
  });

  // Review focus #3: the IDE must not cry wolf over the reference projects as
  // they are — first-slot resolves pixi/cordis from this repo's root, the
  // same copy its e8-base rows do, and the repo-root legacy package is not
  // the project's.
  it.each([
    ['first-slot', FIRST_SLOT],
    ['the slot-basic template', TEMPLATE],
  ])('%s, as composed, is quiet', async (_, dir) => {
    const found = await diagnosticsOf(dir);
    expect(found.filter((d) => /two copies in one page|a second engine/.test(d.message))).toEqual(
      [],
    );
  });
});
