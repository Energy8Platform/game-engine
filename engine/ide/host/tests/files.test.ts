import { cpSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Context } from 'cordis';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

/**
 * Copies a checked-in fixture into a fresh temp directory and returns its
 * path — a fresh copy per call, never the checked-in tree itself. Several
 * tests below write into what `fixture()` returns (a symlink that escapes
 * the project), and vitest runs test files in parallel, so a shared,
 * mutated fixture would race itself the same way `project.test.ts`'s
 * `copyFixtureToTemp` exists to avoid.
 *
 * Rooted at the literal `/tmp`, not `node:os`'s `tmpdir()` — measured
 * directly: on macOS `tmpdir()` answers through a deeply-nested per-user
 * path (`/var/folders/xx/xxxxxxxxxxxxxxxxxxxxxxxxxxxx/T/`), which puts a
 * fixture more than three directories below the real filesystem root. The
 * escape test below climbs exactly three `..` segments expecting to land
 * at root and find the real `/etc/passwd` there — the fact this whole test
 * exists to require. A deeper temp root doesn't make the escape any less
 * real, it just makes THIS fixture's `..` count fall short of reaching it,
 * which would make the test measure the wrong thing. `/tmp` keeps every
 * fixture exactly two segments deep on both macOS and Linux CI.
 *
 * Realpath'd before it's returned, for a second, independent reason:
 * `/tmp` itself is a symlink to `/private/tmp` on macOS. `files.ts`
 * realpaths `cwd` on every call, so an un-realpath'd `cwd` here would make
 * a perfectly ordinary in-project path lexically disagree with its own
 * realpath'd root — the exact false containment failure `client-assets.ts`
 * already warns about, and the reason `dev-game.test.ts`'s own fixtures
 * realpath their temp dirs too.
 */
function fixture(name: string): string {
  const dir = realpathSync(mkdtempSync(join('/tmp', `ide-host-files-${name}-`)));
  cpSync(join(__dirname, 'fixtures', 'files', name), dir, { recursive: true });
  return dir;
}

const hosts: IdeHost[] = [];

/** Boots a host for `cwd` and returns its `ctx` — `ctx.files` is what these tests exercise. */
async function hostFor(cwd: string): Promise<Context> {
  const host = await createIdeHost({ cwd, port: 0 });
  hosts.push(host);
  return host.ctx;
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
});

describe('files service — tree', () => {
  it('lists the project tree, files and directories alike', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { entries, diagnostics } = await ctx.files.tree();
    expect(diagnostics).toEqual([]);
    expect(entries.map((e) => e.path)).toContain('game/script.spin');
    expect(entries.find((e) => e.path === 'game')?.kind).toBe('dir');
  });

  it('reports a file size, and no size for a directory', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { entries } = await ctx.files.tree();
    expect(entries.find((e) => e.path === 'game/script.spin')!.size).toBeGreaterThan(0);
    expect(entries.find((e) => e.path === 'game')!.size).toBeUndefined();
  });

  it('never lists node_modules, which is not the project', async () => {
    // Иначе дерево проекта — это дерево npm, и экран бесполезен.
    //
    // Built at runtime, not checked in — the repo's own `.gitignore` has a
    // blanket `node_modules/` rule, so a fixture with a checked-in
    // `node_modules` directory would silently lose those files on commit
    // (measured directly, on this very fixture, before this comment
    // existed) and the test would then pass on a fresh checkout for the
    // wrong reason: no `node_modules` at all to filter out. Same rationale
    // `project.test.ts`'s own node_modules-bundle test already gives for
    // building at runtime instead of asserting by construction.
    const dir = fixture('plain');
    mkdirSync(join(dir, 'node_modules', 'some-pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'some-pkg', 'index.js'), 'module.exports = {};\n');
    const ctx = await hostFor(dir);
    const { entries } = await ctx.files.tree();
    expect(entries.filter((e) => e.path.startsWith('node_modules'))).toEqual([]);
  });
});

describe('files service — read', () => {
  it('reads a file back byte for byte', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { bytes, diagnostics } = await ctx.files.read('game/spec.json');
    expect(diagnostics).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode(bytes!)).id).toBe('first-slot');
  });

  it('a path that is not there is a diagnostic, not a throw and not a lie', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { bytes, diagnostics } = await ctx.files.read('game/nope.json');
    expect(bytes).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('game/nope.json');
  });

  it('refuses a path that climbs out of the project', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { bytes, diagnostics } = await ctx.files.read('../../../etc/passwd');
    expect(bytes).toBeUndefined();
    expect(diagnostics[0].message).toMatch(/outside the project/i);
  });

  it('refuses a symlink INSIDE the project whose target is outside it', async () => {
    // Тот же побег, который `dev-game` уже ловит: путь выглядит своим,
    // а ведёт наружу. Сравниваются реальные пути обеих сторон.
    const dir = fixture('plain');
    symlinkSync('/etc', join(dir, 'escape'));
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.read('escape/passwd');
    expect(diagnostics[0].message).toMatch(/outside the project/i);
  });

  it('refuses a sibling directory whose name merely starts with the project directory name', async () => {
    // A containment check written as `realTarget.startsWith(realRoot)`
    // instead of `realTarget.startsWith(realRoot + sep)` treats
    // "/project-evil" as inside "/project" — no directory boundary, just a
    // string prefix. Only a `..` that lands on a genuine sibling whose
    // name happens to extend the project's own name can tell the two
    // checks apart, so that's the escape built here.
    const dir = fixture('plain');
    const sibling = `${dir}-evil`;
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'secret.txt'), 'SIBLING_ESCAPE');
    const ctx = await hostFor(dir);
    const { bytes, diagnostics } = await ctx.files.read(`../${basename(sibling)}/secret.txt`);
    expect(bytes).toBeUndefined();
    expect(diagnostics[0].message).toMatch(/outside the project/i);
  });

  it('an absent file is not reported as an access refusal', async () => {
    // Иначе «нет такого файла» и «сюда нельзя» сливаются, и читатель
    // идёт чинить права там, где надо исправить опечатку.
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.read('game/nope.json');
    expect(diagnostics[0].message).not.toMatch(/outside the project/i);
  });

  it('a directory read is a diagnostic naming what it is', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { bytes, diagnostics } = await ctx.files.read('game');
    expect(bytes).toBeUndefined();
    expect(diagnostics[0].message).toMatch(/directory/i);
  });
});
