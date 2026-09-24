import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import * as yaml from 'js-yaml';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createIdeHost } from '../src/index';

const FIRST_SLOT_PATCH = join(__dirname, '../../../examples/first-slot/e8.patch.yml');

function fixture(name: string): string {
  return join(__dirname, 'fixtures', name);
}

/**
 * Copies a checked-in fixture into a fresh temp directory and returns its
 * path. Any test that writes into a project's files must run against this,
 * never against the fixture itself — see the ownership rule on Task 4's
 * brief (and Slice 0 ruling 6/8): vitest runs test files in parallel, and
 * `@cordisjs/plugin-include`'s own config write is an untracked
 * `setTimeout(0)`, so a shared, mutated fixture races itself.
 */
function copyFixtureToTemp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ide-host-${name}-`));
  cpSync(fixture(name), dir, { recursive: true });
  return dir;
}

describe('project plugin', () => {
  it('resolves a profile that stacks one bundle', async () => {
    const host = await createIdeHost({ root: fixture('project-simple'), port: 0 });
    expect(host.ctx.project.composition.rows.map((r) => r.id)).toEqual(['boot1', 'reels1']);
    await host.stop();
  });

  it('applies e8.patch.yml on top of the bundles', async () => {
    const host = await createIdeHost({ root: fixture('project-patched'), port: 0 });
    const reels = host.ctx.project.composition.rows.find((r) => r.id === 'reels1')!;
    expect(reels.config).toEqual({ grid: { cols: 5, rows: 3 } });
    expect(reels.from).toBe('patch');
    await host.stop();
  });

  it('a missing e8.profile.yml is a diagnostic and the host still starts', async () => {
    const host = await createIdeHost({ root: fixture('project-none'), port: 0 });
    expect(host.ctx.project.composition.rows).toEqual([]);
    expect(host.ctx.project.diagnostics.some((d) => d.message.includes('e8.profile.yml'))).toBe(
      true,
    );
    expect(host.url).toBeTruthy(); // it started anyway
    await host.stop();
  });

  it('malformed YAML is a diagnostic naming the file, not a throw', async () => {
    const host = await createIdeHost({ root: fixture('project-broken-yaml'), port: 0 });
    expect(host.ctx.project.diagnostics.some((d) => d.where.includes('e8.profile.yml'))).toBe(true);
    await host.stop();
  });

  it('a profile that is not an object with a bundles array is a diagnostic', async () => {
    const host = await createIdeHost({ root: fixture('project-wrong-shape'), port: 0 });
    expect(host.ctx.project.diagnostics.some((d) => d.message.includes('bundles'))).toBe(true);
    await host.stop();
  });

  it('reload() picks up an edited patch without restarting the host', async () => {
    const dir = copyFixtureToTemp('project-patched');
    const host = await createIdeHost({ root: dir, port: 0 });
    writeFileSync(join(dir, 'e8.patch.yml'), 'rows:\n  - id: reels1\n    config: { grid: 9 }\n');
    await host.ctx.project.reload();
    expect(host.ctx.project.composition.rows.find((r) => r.id === 'reels1')!.config).toEqual({
      grid: 9,
    });
    await host.stop();
  });

  // `<cwd>/bundles/<name>` (the two fixtures above) is the self-contained,
  // no-install-needed path; a real user's project resolves its OWN
  // dependencies from node_modules, so that branch needs its own coverage
  // — built at runtime rather than checked in, so this proves the branch
  // actually works instead of asserting it by construction.
  it('resolves a bundle installed under <cwd>/node_modules, not just <cwd>/bundles', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ide-host-project-node-modules-'));
    writeFileSync(join(dir, 'e8.yml'), '[]\n');
    writeFileSync(join(dir, 'e8.profile.yml'), 'bundles:\n  - e8-nm\n');
    mkdirSync(join(dir, 'node_modules', 'e8-nm'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules', 'e8-nm', 'e8.bundle.yml'),
      "name: e8-nm\nrows:\n  - id: nm1\n    name: '@energy8engine/boot'\n",
    );

    const host = await createIdeHost({ root: dir, port: 0 });
    expect(host.ctx.project.composition.rows.map((r) => r.id)).toEqual(['nm1']);
    await host.stop();
  });

  it('warns when game-runtime’s tumble is on but no reels-cascade row is composed — rows found by package name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ide-host-project-tumble-'));
    writeFileSync(join(dir, 'e8.yml'), '[]\n');
    writeFileSync(join(dir, 'e8.profile.yml'), 'bundles:\n  - e8-t\n');
    mkdirSync(join(dir, 'bundles', 'e8-t'), { recursive: true });
    writeFileSync(
      join(dir, 'bundles', 'e8-t', 'e8.bundle.yml'),
      [
        'name: e8-t',
        'rows:',
        '  - id: r1',
        "    name: '@energy8engine/reels'",
        '  - id: m1',
        "    name: '@energy8engine/game-runtime'",
        '    config: { tumble: true }',
        '',
      ].join('\n'),
    );
    const host = await createIdeHost({ root: dir, port: 0 });
    expect(host.ctx.project.diagnostics).toEqual([
      {
        severity: 'warning',
        plugin: 'composition',
        where: 'r1',
        message:
          'm1.config.tumble is on but no @energy8engine/reels-cascade row is composed — every tumble step fails',
        fix: 'compose the @energy8engine/reels-cascade row (e8-base names it cascade1)',
      },
    ]);
    // The pair agrees once a cascade row is composed — the row is the switch.
    writeFileSync(
      join(dir, 'e8.patch.yml'),
      "rows:\n  - id: c1\n    name: '@energy8engine/reels-cascade'\n",
    );
    await host.ctx.project.reload();
    expect(host.ctx.project.diagnostics).toEqual([]);
    await host.stop();
  });

  it('a bundle that fails to parse reports only that, not a false "not found" too', async () => {
    const host = await createIdeHost({ root: fixture('project-broken-bundle'), port: 0 });
    const messages = host.ctx.project.diagnostics.map((d) => d.message);
    expect(messages.some((m) => m.includes('e8-broken') && m.includes('not valid YAML'))).toBe(
      true,
    );
    // The false positive this test exists to catch: resolveComposition
    // reporting "not found" for a bundle that WAS found, just broken.
    expect(messages.some((m) => m.includes('was not found'))).toBe(false);
    await host.stop();
  });
});

/**
 * `writePatchRow` is the ONE writer of `e8.patch.yml` (spec §2 "Запись"):
 * the IDE's composition screen edits a game row through it. Wholesale
 * replace, insert at the end when absent, never a throw — a failure is a
 * diagnostic and the file on disk is whatever it was.
 */
describe('project.writePatchRow', () => {
  const patchOf = (dir: string) => yaml.load(readFileSync(join(dir, 'e8.patch.yml'), 'utf8'));

  it('replaces an existing row config wholesale and the next reload sees it', async () => {
    const dir = copyFixtureToTemp('project-patched');
    const host = await createIdeHost({ root: dir, port: 0 });
    expect(await host.ctx.project.writePatchRow('reels1', { grid: 9 })).toEqual([]);
    // `grid: { cols, rows }` is GONE, not merged under — a patch row
    // replaces its target's config, and the file says exactly that.
    expect(patchOf(dir)).toEqual({ rows: [{ id: 'reels1', config: { grid: 9 } }] });
    await host.ctx.project.reload();
    expect(host.ctx.project.composition.rows.find((r) => r.id === 'reels1')!.config).toEqual({
      grid: 9,
    });
    await host.stop();
  });

  it('inserts a row the patch did not have, after the existing ones', async () => {
    const dir = copyFixtureToTemp('project-patched');
    const host = await createIdeHost({ root: dir, port: 0 });
    expect(await host.ctx.project.writePatchRow('boot1', { verbose: true })).toEqual([]);
    expect(patchOf(dir)).toEqual({
      rows: [
        { id: 'reels1', config: { grid: { cols: 5, rows: 3 } } },
        { id: 'boot1', config: { verbose: true } },
      ],
    });
    await host.stop();
  });

  it('creates the file when there is none', async () => {
    const dir = copyFixtureToTemp('project-simple');
    expect(existsSync(join(dir, 'e8.patch.yml'))).toBe(false);
    const host = await createIdeHost({ root: dir, port: 0 });
    expect(await host.ctx.project.writePatchRow('reels1', { grid: 1 })).toEqual([]);
    expect(patchOf(dir)).toEqual({ rows: [{ id: 'reels1', config: { grid: 1 } }] });
    await host.stop();
  });

  it('leaves an unparsable patch byte-for-byte alone and says so', async () => {
    const dir = copyFixtureToTemp('project-patched');
    const broken = 'rows: [\n  - id: reels1\n';
    writeFileSync(join(dir, 'e8.patch.yml'), broken);
    const host = await createIdeHost({ root: dir, port: 0 });
    const diagnostics = await host.ctx.project.writePatchRow('reels1', { grid: 9 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'patch' });
    expect(readFileSync(join(dir, 'e8.patch.yml'), 'utf8')).toBe(broken);
    expect(existsSync(join(dir, 'e8.patch.yml.tmp'))).toBe(false);
    await host.stop();
  });

  it('refuses a document that is not { rows: [...] }, byte-for-byte untouched', async () => {
    for (const wrong of ['rows: "x"\n', '- id: reels1\n']) {
      const dir = copyFixtureToTemp('project-patched');
      writeFileSync(join(dir, 'e8.patch.yml'), wrong);
      const host = await createIdeHost({ root: dir, port: 0 });
      const diagnostics = await host.ctx.project.writePatchRow('reels1', { grid: 9 });
      expect(diagnostics, wrong).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'patch' });
      expect(diagnostics[0].message).toContain('"rows" array');
      expect(readFileSync(join(dir, 'e8.patch.yml'), 'utf8')).toBe(wrong);
      expect(existsSync(join(dir, 'e8.patch.yml.tmp'))).toBe(false);
      await host.stop();
    }
  });

  it('an empty file is a patch with no rows and gets the row', async () => {
    for (const empty of ['', '# only a comment\n', 'null\n']) {
      const dir = copyFixtureToTemp('project-patched');
      writeFileSync(join(dir, 'e8.patch.yml'), empty);
      const host = await createIdeHost({ root: dir, port: 0 });
      expect(await host.ctx.project.writePatchRow('reels1', { grid: 1 }), empty).toEqual([]);
      expect(patchOf(dir)).toEqual({ rows: [{ id: 'reels1', config: { grid: 1 } }] });
      await host.stop();
    }
  });

  it('never leaves a .tmp behind when the rename fails', async () => {
    // A DIRECTORY where the patch file should be: reading it fails like a
    // missing file (an empty patch), the temp file writes fine, and the
    // `rename` over a non-empty directory is what fails.
    const dir = copyFixtureToTemp('project-simple');
    mkdirSync(join(dir, 'e8.patch.yml', 'occupied'), { recursive: true });
    const host = await createIdeHost({ root: dir, port: 0 });
    const diagnostics = await host.ctx.project.writePatchRow('reels1', { grid: 1 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'patch' });
    expect(existsSync(join(dir, 'e8.patch.yml.tmp'))).toBe(false);
    await host.stop();
  });

  it.skipIf(process.getuid?.() === 0)(
    'replaces the file whole by rename — a read-only patch is still replaced, never half-written',
    async () => {
      // The property atomicity buys: the new bytes land as one rename over
      // the old file, so the old file's own permissions (or a crash mid-way)
      // cannot leave a truncated patch behind. An in-place write would fail
      // here with EACCES — that is the mutation this pins.
      const dir = copyFixtureToTemp('project-patched');
      chmodSync(join(dir, 'e8.patch.yml'), 0o444);
      const host = await createIdeHost({ root: dir, port: 0 });
      expect(await host.ctx.project.writePatchRow('reels1', { grid: 2 })).toEqual([]);
      expect(patchOf(dir)).toEqual({ rows: [{ id: 'reels1', config: { grid: 2 } }] });
      expect(existsSync(join(dir, 'e8.patch.yml.tmp'))).toBe(false);
      await host.stop();
    },
  );

  it("slot-basic's template patch still resolves to the same rows after its comments moved to README.md", () => {
    expect(
      yaml.load(
        readFileSync(join(__dirname, '../../../templates/slot-basic/e8.patch.yml'), 'utf8'),
      ),
    ).toEqual({
      rows: [
        // No `width`/`height`: the canvas follows `#mount` (the whole
        // window — `index.html`); `portrait` is the design the scenes fit
        // when the safe rect is taller than wide (slice 27).
        { id: 'renderer1', config: { background: '#10121a' } },
        {
          id: 'scenes1',
          config: { design: { width: 480, height: 288 }, portrait: { width: 288, height: 480 } },
        },
        { id: 'reels1', config: { grid: { cols: 5, rows: 3 } } },
        { id: 'mechanics1', config: { stages: { base_game: 'classic' } } },
        { id: 'playloop1', config: { skipEvents: ['ui.skip', 'ui.tap'] } },
        {
          id: 'shell1',
          config: { features: { turbo: 1, autoplay: {}, buyBonus: false }, gameInfo: { sections: [] } },
        },
      ],
    });
  });

  it("first-slot's reference patch still resolves to the same rows after its comments moved to README.md", () => {
    // The IDE rewrites this file without comments (the writer above), so
    // the header's prose moved out. The DATA must not have moved with it.
    expect(yaml.load(readFileSync(FIRST_SLOT_PATCH, 'utf8'))).toEqual({
      rows: [
        // No `width`/`height`: the canvas follows `#mount` (the whole
        // window — `index.html`); `portrait` is the design the scenes fit
        // when the safe rect is taller than wide (slice 27).
        { id: 'renderer1', config: { background: '#10121a' } },
        {
          id: 'scenes1',
          config: { design: { width: 480, height: 288 }, portrait: { width: 288, height: 480 } },
        },
        { id: 'reels1', config: { grid: { cols: 5, rows: 3 } } },
        { id: 'mechanics1', config: { stages: { base_game: 'reel-step' } } },
        { id: 'playloop1', config: { skipEvents: ['ui.skip', 'ui.tap'] } },
        {
          id: 'shell1',
          config: { features: { turbo: 1, autoplay: {}, buyBonus: false }, gameInfo: { sections: [] } },
        },
        { id: 'reelstep1', name: 'reel-step', config: {} },
      ],
    });
  });
});
