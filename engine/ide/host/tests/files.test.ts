import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Context } from 'cordis';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

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
  const host = await createIdeHost({ root: cwd, port: 0 });
  hosts.push(host);
  return host.ctx;
}

/**
 * Boots a host for `cwd` and returns the whole `IdeHost` — `host.url` is
 * what the route tests below exercise, over real HTTP, unlike `hostFor`'s
 * direct `ctx.files` calls above.
 */
async function startHost(cwd: string): Promise<IdeHost> {
  const host = await createIdeHost({ root: cwd, port: 0 });
  hosts.push(host);
  return host;
}

/**
 * Sends a GET with `rawPath` as the literal request-target, bypassing
 * `fetch()`'s own URL parsing entirely — `node:http`'s `path` option goes
 * straight onto the request line unparsed.
 *
 * This exists because `fetch()` cannot deliver a `..` segment at all: it
 * parses its input as a WHATWG URL first, and URL parsing collapses
 * dot-segments before a request is ever made (measured directly: `new
 * URL('http://h/a/../../etc/passwd').pathname` is already `/etc/passwd`,
 * and a raw `http.createServer` fed that same string via `fetch()` sees
 * `req.url === '/etc/passwd'` — the "../.." is gone before the first byte
 * left this process). A well-behaved editor's own `fetch()` calls could
 * never reach the containment check this way at all, which is exactly why
 * it still matters: a hand-built request — `curl`, a raw socket, anything
 * that isn't routing the path through a URL parser first — sends the
 * literal bytes, unresolved, same as this helper does.
 */
function rawGet(
  host: IdeHost,
  rawPath: string,
  method = 'GET',
): Promise<{ status: number; text: string }> {
  const url = new URL(host.url);
  return new Promise((resolveRequest, reject) => {
    const req = httpRequest(
      { host: url.hostname, port: url.port, path: rawPath, method },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolveRequest({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on('error', reject);
    req.end();
  });
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
    // Otherwise the project tree is an npm tree, and the screen is useless.
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
  it('does not list git’s bookkeeping under a name that is only cased differently', async () => {
    // macOS APFS, this repo's own platform, is case-insensitive by
    // default: `.GIT` and `.git` are ONE directory on disk and two
    // different strings. An exact-case skip list showed the whole of it.
    const dir = fixture('plain');
    mkdirSync(join(dir, '.GIT', 'hooks'), { recursive: true });
    writeFileSync(join(dir, '.GIT', 'hooks', 'pre-commit'), '#!/bin/sh\n');
    const ctx = await hostFor(dir);
    const { entries } = await ctx.files.tree();
    expect(entries.filter((e) => /^\.git/i.test(e.path))).toEqual([]);
  });

  it('one entry it cannot stat costs that entry and a warning, not the whole tree', async () => {
    // `readdirSync` was wrapped in a try that degrades to a warning; the
    // `statSync` beside it was not, so one unreadable entry took the
    // whole tree out through a signature that says it never throws. A
    // directory with the read bit but not the execute bit is exactly
    // that: its names list fine, its children cannot be stat'd.
    const dir = fixture('plain');
    mkdirSync(join(dir, 'locked'));
    writeFileSync(join(dir, 'locked', 'a.txt'), 'a');
    chmodSync(join(dir, 'locked'), 0o444);
    try {
      const ctx = await hostFor(dir);
      const { entries, diagnostics } = await ctx.files.tree();
      expect(entries.map((e) => e.path)).toContain('game/script.spin');
      expect(entries.map((e) => e.path)).not.toContain('locked/a.txt');
      expect(diagnostics.some((d) => d.where === 'locked/a.txt')).toBe(true);
    } finally {
      chmodSync(join(dir, 'locked'), 0o755);
    }
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
    // The same escape `dev-game` already catches: the path looks like it
    // belongs, but leads out. Both sides are compared by real path.
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
    // Otherwise "no such file" and "not allowed here" collapse into one,
    // and the reader goes to fix permissions where they should fix a typo.
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.read('game/nope.json');
    expect(diagnostics[0].message).not.toMatch(/outside the project/i);
  });

  it('refuses a symlink at the leaf, the same as write and remove do', async () => {
    // Containment was never in doubt here — the target is an ordinary
    // project file. What was wrong is that a read handed back bytes under
    // a name `tree()` does not list at all, while a write to the same name
    // was refused, so the file's own rule was true of two callers out of
    // three.
    const dir = fixture('plain');
    writeFileSync(join(dir, 'ok.txt'), 'OK');
    symlinkSync(join(dir, 'ok.txt'), join(dir, 'alias.txt'));
    const ctx = await hostFor(dir);
    const { bytes: read, diagnostics } = await ctx.files.read('alias.txt');
    expect(read).toBeUndefined();
    expect(diagnostics[0].code).toBe('is-symlink');
  });

  it('refuses to read out of .git, which can hold a credential', async () => {
    const dir = fixture('plain');
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'config'), '[remote "origin"]\n  url = https://t0ken@h/r\n');
    const ctx = await hostFor(dir);
    const { bytes: read, diagnostics } = await ctx.files.read('.git/config');
    expect(read).toBeUndefined();
    expect(diagnostics[0].code).toBe('protected-path');
  });

  it('a directory read is a diagnostic naming what it is', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { bytes, diagnostics } = await ctx.files.read('game');
    expect(bytes).toBeUndefined();
    expect(diagnostics[0].message).toMatch(/directory/i);
  });
});

describe('files service — write', () => {
  it('writes a new file, and reads back what it wrote', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.write('art/logo.txt', bytes('hello'));
    expect(diagnostics).toEqual([]);
    const back = await ctx.files.read('art/logo.txt');
    expect(new TextDecoder().decode(back.bytes!)).toBe('hello');
  });

  it('creates the directories a new path needs', async () => {
    const ctx = await hostFor(fixture('plain'));
    await ctx.files.write('deep/er/still/x.txt', bytes('x'));
    const { entries } = await ctx.files.tree();
    expect(entries.map((e) => e.path)).toContain('deep/er/still/x.txt');
  });

  it('replaces an existing file whole', async () => {
    const ctx = await hostFor(fixture('plain'));
    await ctx.files.write('a.txt', bytes('first'));
    await ctx.files.write('a.txt', bytes('second'));
    const back = await ctx.files.read('a.txt');
    expect(new TextDecoder().decode(back.bytes!)).toBe('second');
  });

  it('refuses to write outside the project, and writes nothing', async () => {
    // Containment on the write side differs from the read side: the file
    // is not there yet, so the realpath comes from the nearest existing
    // ancestor instead of the target itself.
    const dir = fixture('plain');
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.write('../escaped.txt', bytes('x'));
    expect(diagnostics[0].message).toMatch(/outside the project/i);
    expect(existsSync(join(dir, '..', 'escaped.txt'))).toBe(false);
  });

  it('refuses to write THROUGH a symlink that leads out', async () => {
    const dir = fixture('plain');
    mkdirSync(join(dir, 'sub'));
    symlinkSync(tmpdir(), join(dir, 'sub', 'out'));
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.write('sub/out/escaped.txt', bytes('x'));
    expect(diagnostics[0].message).toMatch(/outside the project/i);
    expect(existsSync(join(tmpdir(), 'escaped.txt'))).toBe(false);
  });

  it('refuses to write through a DANGLING symlink whose target is a file outside the project', async () => {
    // The shape nobody built. Every other escape here is caught by the
    // ancestor walk, which uses `existsSync` — and `existsSync` follows
    // symlinks, so a link pointing at something that does not exist is
    // invisible to it: the walk steps past the leaf to the parent, the
    // parent is inside the project, and `writeFileSync` then follows the
    // link and creates the file outside. Measured before the fix: no
    // diagnostics at all and `OWNED` sitting outside the project.
    const dir = fixture('plain');
    const outside = mkdtempSync(join('/tmp', 'ide-host-files-outside-'));
    symlinkSync(join(outside, 'pwned.txt'), join(dir, 'link.txt'));
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.write('link.txt', bytes('OWNED'));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/symlink/i);
    expect(existsSync(join(outside, 'pwned.txt'))).toBe(false);
  });

  it('refuses to write through a LIVE symlink even when its target is inside the project', async () => {
    // Containment is not the only reason to refuse: `tree()` lists no
    // symlinks, so writing through one changes a file no screen shows as
    // the one being changed. The refusal has to be about the link itself,
    // not about where it happens to lead, or the dangling case above
    // passes for the wrong reason on a lucky day.
    const dir = fixture('plain');
    symlinkSync(join(dir, 'game', 'spec.json'), join(dir, 'alias.json'));
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.write('alias.json', bytes('OWNED'));
    expect(diagnostics[0].message).toMatch(/symlink/i);
    expect(readFileSync(join(dir, 'game', 'spec.json'), 'utf8')).not.toContain('OWNED');
  });

  it('refuses to write anywhere under .git, where the next commit would run it', async () => {
    // Not hygiene like node_modules: a pre-commit hook written from the
    // browser is code the developer's own shell runs at their next
    // commit, and `SKIPPED_DIRS` then keeps it out of the tree, so
    // nothing on any screen would ever show it again.
    const dir = fixture('plain');
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.write('.git/hooks/pre-commit', bytes('#!/bin/sh\n'));
    expect(diagnostics[0].message).toMatch(/\.git/);
    expect(existsSync(join(dir, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  it('refuses .git under any casing, since the filesystem does not care about the difference', async () => {
    // Measured before this: `PUT /api/files/.GIT/hooks/pre-commit`
    // answered 200 and put the hook exactly where git runs it, while
    // `.git` spelled in lower case was refused. Same directory on disk.
    const dir = fixture('plain');
    const ctx = await hostFor(dir);
    for (const spelling of ['.GIT', '.Git', '.gIt']) {
      const { diagnostics } = await ctx.files.write(
        `${spelling}/hooks/pre-commit`,
        bytes('#!/bin/sh\n'),
      );
      expect(diagnostics[0].code).toBe('protected-path');
    }
    expect(existsSync(join(dir, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  it('refuses a path that only REACHES .git through a symlinked directory', async () => {
    // Every segment the request spells is innocent; only the realpath is
    // not. The leaf check cannot see this — the symlink is the ancestor,
    // not the leaf — and the containment walk asks only whether the
    // ancestor is inside the project, which .git is. Measured going
    // through with no diagnostics at all.
    const dir = fixture('plain');
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
    symlinkSync(join(dir, '.git', 'hooks'), join(dir, 'hooksdir'));
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.write('hooksdir/post-commit', bytes('#!/bin/sh\n'));
    expect(diagnostics[0].code).toBe('protected-path');
    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit'))).toBe(false);
  });

  it('a write that fails leaves behind none of the directories it made for it', async () => {
    // `mkdir -p` runs before the write can fail, and `remove()` refuses
    // directories — so what the browser created, the browser could not
    // clean up. A 400-character name is the shortest honest way to make
    // the write itself fail after the directories exist.
    const dir = fixture('plain');
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.write(`deep/dir/${'x'.repeat(400)}.txt`, bytes('x'));
    expect(diagnostics).toHaveLength(1);
    expect(existsSync(join(dir, 'deep'))).toBe(false);
  });

  it('keeps the directories a FAILING write did not create', async () => {
    // The undo removes what this call made, not what was already there —
    // a write into an existing directory that fails must not take the
    // directory (or its neighbours) with it.
    const dir = fixture('plain');
    const ctx = await hostFor(dir);
    await ctx.files.write(`game/${'x'.repeat(400)}.txt`, bytes('x'));
    expect(existsSync(join(dir, 'game', 'spec.json'))).toBe(true);
  });

  it('refuses to write into a sibling directory whose name merely starts with the project directory name', async () => {
    // Same string-prefix trap `read()` already guards against (see
    // `files.test.ts`'s read describe block): "/project-evil" is not
    // inside "/project" just because it starts with the same characters.
    const dir = fixture('plain');
    const sibling = `${dir}-evil`;
    mkdirSync(sibling);
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.write(`../${basename(sibling)}/secret.txt`, bytes('x'));
    expect(diagnostics[0].message).toMatch(/outside the project/i);
    expect(existsSync(join(sibling, 'secret.txt'))).toBe(false);
  });
});

/**
 * This service does not know `game/script.spin` is special, and per
 * `schema.ts`'s own brief it should stay that way — the knowledge that a
 * write to THAT path means "the math changed" belongs with whoever serves
 * the math (`dev-game.ts`), not here. What this file owes is only the
 * signal: a plain cordis event, naming the path, fired once a write has
 * actually landed on disk — and nothing narrower, so any future listener
 * (not only `dev-game`) can decide for itself which paths it cares about.
 */
describe('files service — the files/written event', () => {
  it('fires with the path once a write actually lands on disk', async () => {
    const ctx = await hostFor(fixture('plain'));
    const seen: { path: string }[] = [];
    ctx.on('files/written', (payload) => seen.push(payload));

    await ctx.files.write('game/script.spin', bytes('game "first-slot" {\n}\n'));

    expect(seen).toEqual([{ path: 'game/script.spin' }]);
  });

  it('stays quiet when the write was refused', async () => {
    const ctx = await hostFor(fixture('plain'));
    const seen: { path: string }[] = [];
    ctx.on('files/written', (payload) => seen.push(payload));

    const { diagnostics } = await ctx.files.write('../escaped.txt', bytes('x'));
    expect(diagnostics.length).toBeGreaterThan(0);

    expect(seen).toEqual([]);
  });

  it('fires once per write, one event per path, not shared across different files', async () => {
    const ctx = await hostFor(fixture('plain'));
    const seen: string[] = [];
    ctx.on('files/written', ({ path }) => seen.push(path));

    await ctx.files.write('art/logo.txt', bytes('a'));
    await ctx.files.write('game/script.spin', bytes('game "first-slot" {\n}\n'));

    expect(seen).toEqual(['art/logo.txt', 'game/script.spin']);
  });
});

describe('files service — remove', () => {
  it('removes a file', async () => {
    const ctx = await hostFor(fixture('plain'));
    await ctx.files.write('gone.txt', bytes('x'));
    const { diagnostics } = await ctx.files.remove('gone.txt');
    expect(diagnostics).toEqual([]);
    const { entries } = await ctx.files.tree();
    expect(entries.map((e) => e.path)).not.toContain('gone.txt');
  });

  it('removing what is not there says so instead of pretending it worked', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.remove('never-existed.txt');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('never-existed.txt');
  });

  it('removes a directory, not only a file', async () => {
    // `remove` used to refuse a directory, naming what it is; it now takes
    // it, recursively — see "files service — remove, now directories too"
    // below for the fuller coverage (protected dirs, everything under it).
    const dir = fixture('plain');
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.remove('game');
    expect(diagnostics).toEqual([]);
    expect(existsSync(join(dir, 'game'))).toBe(false);
  });

  it('refuses to remove outside the project', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.remove('../../../etc/hosts');
    expect(diagnostics[0].message).toMatch(/outside the project/i);
  });

  it('a dangling symlink is refused as the symlink it is, not reported as absent', async () => {
    // `statSync` follows the link, so this used to answer "was not found"
    // about a name that is right there on disk. Write refuses a symlink;
    // remove has to agree, or the two disagree about what one is.
    const dir = fixture('plain');
    symlinkSync(join(dir, 'never-existed.txt'), join(dir, 'link.txt'));
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.remove('link.txt');
    expect(diagnostics[0].message).toMatch(/symlink/i);
    expect(diagnostics[0].message).not.toMatch(/was not found/i);
  });

  it('refuses to remove anything under .git', async () => {
    const dir = fixture('plain');
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.remove('.git/HEAD');
    expect(diagnostics[0].message).toMatch(/\.git/);
    expect(existsSync(join(dir, '.git', 'HEAD'))).toBe(true);
  });

  it('refuses to remove from .git under any casing', async () => {
    const dir = fixture('plain');
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.remove('.GIT/HEAD');
    expect(diagnostics[0].code).toBe('protected-path');
    expect(existsSync(join(dir, '.git', 'HEAD'))).toBe(true);
  });

  it('refuses to remove from a sibling directory whose name merely starts with the project directory name', async () => {
    const dir = fixture('plain');
    const sibling = `${dir}-evil`;
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'secret.txt'), 'SIBLING_ESCAPE');
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.remove(`../${basename(sibling)}/secret.txt`);
    expect(diagnostics[0].message).toMatch(/outside the project/i);
    expect(existsSync(join(sibling, 'secret.txt'))).toBe(true);
  });
});

describe('files routes', () => {
  it('GET /api/files returns the tree', async () => {
    const host = await startHost(fixture('plain'));
    const body = await (await fetch(`${host.url}/api/files`)).json();
    expect(body.entries.map((e: { path: string }) => e.path)).toContain('game/script.spin');
  });

  it('GET /api/files/* returns the bytes', async () => {
    const host = await startHost(fixture('plain'));
    const res = await fetch(`${host.url}/api/files/game/spec.json`);
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text()).id).toBe('first-slot');
  });

  it('a refused path answers with a diagnostic body, not an empty 500', async () => {
    // An empty 500 already cost this branch one slice: a healthy row lost
    // its data along with the guilty one. A refusal is data.
    //
    // `fetch()` — see `rawGet`'s doc comment — cannot actually deliver this
    // literal ".." to the server; it gets resolved away before the request
    // is ever sent, which would make this test exercise the router's
    // unrelated "no route matched" 404 instead of the containment check it
    // means to prove. `rawGet` sends the same string unparsed.
    const host = await startHost(fixture('plain'));
    const res = await rawGet(host, '/api/files/../../../etc/passwd');
    expect(res.status).toBe(400);
    const body = JSON.parse(res.text);
    expect(body.diagnostics[0].message).toMatch(/outside the project/i);
  });

  it('PUT writes what it was given', async () => {
    const dir = fixture('plain');
    const host = await startHost(dir);
    const res = await fetch(`${host.url}/api/files/art/x.txt`, {
      method: 'PUT',
      body: JSON.stringify({ base64: btoa('hello') }),
    });
    expect((await res.json()).diagnostics).toEqual([]);
    expect(readFileSync(join(dir, 'art/x.txt'), 'utf8')).toBe('hello');
  });

  it('a PUT with a body that is not base64 says so and writes nothing', async () => {
    const dir = fixture('plain');
    const host = await startHost(dir);
    const res = await fetch(`${host.url}/api/files/art/x.txt`, {
      method: 'PUT',
      body: JSON.stringify({ base64: 'not really base64!!!' }),
    });
    expect((await res.json()).diagnostics).toHaveLength(1);
    expect(existsSync(join(dir, 'art/x.txt'))).toBe(false);
  });

  it('a PUT with no body at all is a diagnostic, not a crash', async () => {
    const host = await startHost(fixture('plain'));
    const res = await fetch(`${host.url}/api/files/art/x.txt`, { method: 'PUT' });
    expect(res.status).toBe(400);
    expect((await res.json()).diagnostics).toHaveLength(1);
  });

  it('DELETE removes it', async () => {
    const dir = fixture('plain');
    const host = await startHost(dir);
    writeFileSync(join(dir, 'bye.txt'), 'x');
    const res = await fetch(`${host.url}/api/files/bye.txt`, { method: 'DELETE' });
    expect((await res.json()).diagnostics).toEqual([]);
    expect(existsSync(join(dir, 'bye.txt'))).toBe(false);
  });

  it('serves an image with an image content type, so the screen can show it', async () => {
    const host = await startHost(fixture('with-png'));
    const res = await fetch(`${host.url}/api/files/art/logo.png`);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('reads a name with a space, a plus, and a percent sign back as the byte-for-byte name the editor meant', async () => {
    // `+` is meaningful only in a query string; a real `+` in a path
    // segment survives a correct client's `encodeURIComponent` as `%2B`.
    // A route that decoded the path a second time (redundant, since the
    // router already decodes it once) would either corrupt this — `+`
    // would read back as a space, the query-string reading — or throw
    // outright: the already-decoded name contains a literal `%` not
    // followed by a hex pair, which `decodeURIComponent` refuses outright.
    const dir = fixture('plain');
    const name = 'a b+c%d.txt';
    writeFileSync(join(dir, name), 'special');
    const host = await startHost(dir);
    const res = await fetch(`${host.url}/api/files/${encodeURIComponent(name)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('special');
  });

  it('a literal, unencoded plus in the URL reads as a space, not the plus a raw filename has', async () => {
    // The caveat the test above's comment already leans on, made explicit:
    // `@cordisjs/plugin-server`'s router decodes a path segment with
    // `decodeURIComponent(capture.replace(/\+/g, ' '))` — the query-string
    // reading of `+`, applied here to a path segment too, UNCONDITIONALLY.
    // A `+` that arrived correctly encoded as `%2B` (the test above) comes
    // through untouched; a literal `+` typed straight into the URL does
    // not. `tree()` hands back raw filesystem names, `+` and all, so a
    // client that turns one into a URL by concatenation instead of
    // encoding each segment lands here — on the wrong file, 404, not the
    // one it meant. Nothing in this route can rescue that: the router has
    // already rewritten the byte before this handler ever sees `req.path`.
    const dir = fixture('plain');
    writeFileSync(join(dir, 'a+b.txt'), 'plus');
    const host = await startHost(dir);
    const res = await fetch(`${host.url}/api/files/a+b.txt`);
    expect(res.status).toBe(404);
  });

  it('refuses a ".." segment that arrives percent-encoded, exactly like the plain one', async () => {
    const host = await startHost(fixture('plain'));
    const escaped = ['..', '..', '..', 'etc', 'passwd'].map(encodeURIComponent).join('%2f');
    const res = await fetch(`${host.url}/api/files/${escaped}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.diagnostics[0].message).toMatch(/outside the project/i);
  });

  it('a malformed percent-escape answers 400 with a diagnostic, not an empty 500', async () => {
    // `@cordisjs/plugin-server` decodes every path segment while MATCHING
    // a route, before any handler — this one included — ever runs. `%zz`
    // isn't a valid escape, so `decodeURIComponent` throws a `URIError`
    // one layer out from anything a route's own `try` could catch; without
    // the `ctx.server.use()` boundary in `index.ts`, that throw reaches the
    // library's own top-level catch, which answers 500 with no body at
    // all — the same empty-500 shape as the refused-path test above, just
    // reached through the router instead of through this route's own code.
    const host = await startHost(fixture('plain'));
    const res = await fetch(`${host.url}/api/files/%zz`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.diagnostics[0].message).toContain('/api/files/%zz');
  });
});

describe('files service — mkdir and create', () => {
  it('mkdir makes a directory the tree then lists', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.mkdir('assets');
    expect(diagnostics).toEqual([]);
    const { entries } = await ctx.files.tree();
    expect(entries).toContainEqual({ path: 'assets', kind: 'dir' });
  });

  it('mkdir refuses a path that is already there, file or directory', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.mkdir('game')).diagnostics[0]).toMatchObject({ code: 'exists' });
    expect((await ctx.files.mkdir('e8.yml')).diagnostics[0]).toMatchObject({ code: 'exists' });
  });

  it('mkdir does not create parents', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.mkdir('a/b/c');
    expect(diagnostics[0]).toMatchObject({ code: 'not-found' });
    expect((await ctx.files.tree()).entries.some((e) => e.path === 'a')).toBe(false);
  });

  it('create makes an empty file and refuses to make it twice', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.create('game/notes.txt')).diagnostics).toEqual([]);
    const { bytes: read } = await ctx.files.read('game/notes.txt');
    expect(read).toEqual(new Uint8Array());
    expect((await ctx.files.create('game/notes.txt')).diagnostics[0]).toMatchObject({
      code: 'exists',
    });
  });

  it('create does not create parents either', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.create('nope/x.txt')).diagnostics[0]).toMatchObject({
      code: 'not-found',
    });
  });

  it('both refuse to climb out, and both refuse the protected directories', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.mkdir('../out')).diagnostics[0]).toMatchObject({
      code: 'outside-project',
    });
    for (const p of ['.git/x', 'node_modules/x', '.e8/x']) {
      expect((await ctx.files.mkdir(p)).diagnostics[0], p).toMatchObject({
        code: 'protected-path',
      });
      expect((await ctx.files.create(p)).diagnostics[0], p).toMatchObject({
        code: 'protected-path',
      });
    }
  });
});

describe('files service — remove, now directories too', () => {
  it('removes a directory and everything under it', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.remove('game');
    expect(diagnostics).toEqual([]);
    const { entries } = await ctx.files.tree();
    expect(entries.some((e) => e.path.startsWith('game'))).toBe(false);
  });

  it('still refuses node_modules and .e8, like .git', async () => {
    const dir = fixture('plain');
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    mkdirSync(join(dir, '.e8'), { recursive: true });
    const ctx = await hostFor(dir);
    expect((await ctx.files.remove('node_modules/x')).diagnostics[0]).toMatchObject({
      code: 'protected-path',
    });
    expect((await ctx.files.remove('.e8')).diagnostics[0]).toMatchObject({
      code: 'protected-path',
    });
    expect(
      (await ctx.files.write('node_modules/x/y.txt', bytes('a'))).diagnostics[0],
    ).toMatchObject({ code: 'protected-path' });
  });

  it('refuses the project directory itself, however it is spelled', async () => {
    // Measured before this existed: `DELETE /api/files/.` answered 200 and
    // `rmSync`-ed the whole project. `.` and `game/..` both resolve to
    // `cwd`, which is inside itself and inside no protected directory —
    // so every earlier check passed it. Only the writing verbs are
    // asserted; `read('.')` meets the same guard and answers `protected-path`.
    const dir = fixture('plain');
    const ctx = await hostFor(dir);
    const protectedPath = { code: 'protected-path' };
    expect((await ctx.files.remove('.')).diagnostics[0]).toMatchObject(protectedPath);
    expect((await ctx.files.remove('game/..')).diagnostics[0]).toMatchObject(protectedPath);
    expect((await ctx.files.move('.', 'x')).diagnostics[0]).toMatchObject(protectedPath);
    expect((await ctx.files.mkdir('.')).diagnostics[0]).toMatchObject(protectedPath);
    expect((await ctx.files.create('.')).diagnostics[0]).toMatchObject(protectedPath);
    expect(existsSync(join(dir, 'e8.yml'))).toBe(true);
  });

  it('DELETE /api/files/game/.. over raw HTTP is a 400 and the project is still there', async () => {
    const dir = fixture('plain');
    const host = await startHost(dir);
    const res = await rawGet(host, '/api/files/game/..', 'DELETE');
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text).diagnostics[0].code).toBe('protected-path');
    expect(existsSync(join(dir, 'e8.yml'))).toBe(true);
  });
});

describe('files routes — POST', () => {
  it('POST {kind:"dir"} makes a directory, {kind:"file"} an empty file', async () => {
    const host = await startHost(fixture('plain'));
    const post = (path: string, body: unknown) =>
      fetch(`${host.url}/api/files/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post('assets', { kind: 'dir' })).status).toBe(200);
    expect((await post('assets/readme.txt', { kind: 'file' })).status).toBe(200);
    const tree = (await (await fetch(`${host.url}/api/files`)).json()) as {
      entries: { path: string; kind: string }[];
    };
    expect(tree.entries).toContainEqual({ path: 'assets', kind: 'dir' });
    expect(tree.entries).toContainEqual({ path: 'assets/readme.txt', kind: 'file', size: 0 });
  });

  it('POST without a usable body is a 400 malformed-request; an existing path is a 400 exists', async () => {
    const host = await startHost(fixture('plain'));
    const bad = await fetch(`${host.url}/api/files/x`, { method: 'POST', body: 'nope' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { diagnostics: { code: string }[] }).diagnostics[0].code).toBe(
      'malformed-request',
    );
    const dup = await fetch(`${host.url}/api/files/game`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'dir' }),
    });
    expect(dup.status).toBe(400);
  });

  it('serves video with a video mime', async () => {
    const dir = fixture('plain');
    writeFileSync(join(dir, 'clip.mp4'), bytes('not really'));
    const host = await startHost(dir);
    const res = await fetch(`${host.url}/api/files/clip.mp4`);
    expect(res.headers.get('content-type')).toBe('video/mp4');
  });
});

describe('files service — move', () => {
  it('moves a file, and the tree and the disk agree', async () => {
    const dir = fixture('plain');
    mkdirSync(join(dir, 'assets'));
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.move('game/spec.json', 'assets/spec.json');
    expect(diagnostics).toEqual([]);
    expect(existsSync(join(dir, 'assets', 'spec.json'))).toBe(true);
    expect(existsSync(join(dir, 'game', 'spec.json'))).toBe(false);
  });

  it('renames within the same directory', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.move('game/spec.json', 'game/spec2.json')).diagnostics).toEqual([]);
    const { entries } = await ctx.files.tree();
    expect(entries.map((e) => e.path)).toContain('game/spec2.json');
    expect(entries.map((e) => e.path)).not.toContain('game/spec.json');
  });

  it('moves a directory with its contents', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.move('game', 'maths')).diagnostics).toEqual([]);
    const { entries } = await ctx.files.tree();
    expect(entries.map((e) => e.path)).toEqual(
      expect.arrayContaining(['maths', 'maths/spec.json', 'maths/script.spin']),
    );
  });

  it('never overwrites: an occupied destination is exists', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.move('game/spec.json', 'e8.yml');
    expect(diagnostics[0]).toMatchObject({ code: 'exists' });
    expect((await ctx.files.read('e8.yml')).bytes?.length).toBeGreaterThan(0);
  });

  it('a directory cannot move into itself', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.move('game', 'game/inner')).diagnostics[0]).toMatchObject({
      code: 'into-self',
    });
    expect((await ctx.files.move('game', 'game')).diagnostics[0]).toMatchObject({
      code: 'into-self',
    });
  });

  it('a missing source is not-found; a missing destination directory is not-found', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.move('game/nope.json', 'x.json')).diagnostics[0]).toMatchObject({
      code: 'not-found',
    });
    expect(
      (await ctx.files.move('game/spec.json', 'nowhere/spec.json')).diagnostics[0],
    ).toMatchObject({ code: 'not-found' });
  });

  it('both ends are contained and protected', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.move('game/spec.json', '../spec.json')).diagnostics[0]).toMatchObject({
      code: 'outside-project',
    });
    expect(
      (await ctx.files.move('game/spec.json', 'node_modules/spec.json')).diagnostics[0],
    ).toMatchObject({ code: 'protected-path' });
    expect((await ctx.files.move('.git', 'git')).diagnostics[0]).toMatchObject({
      code: 'protected-path',
    });
  });

  it('refuses a symlink at the source leaf', async () => {
    const dir = fixture('plain');
    symlinkSync(join(dir, 'e8.yml'), join(dir, 'alias.yml'));
    const ctx = await hostFor(dir);
    expect((await ctx.files.move('alias.yml', 'other.yml')).diagnostics[0]).toMatchObject({
      code: 'is-symlink',
    });
  });

  it('emits files/removed for the old path and files/written for the new one, in that order', async () => {
    const ctx = await hostFor(fixture('plain'));
    const seen: string[] = [];
    ctx.on('files/removed', ({ path }) => seen.push(`removed:${path}`));
    ctx.on('files/written', ({ path }) => seen.push(`written:${path}`));
    await ctx.files.move('game/script.spin', 'game/main.spin');
    expect(seen).toEqual(['removed:game/script.spin', 'written:game/main.spin']);
  });

  it('remove emits files/removed too, and a refused move emits nothing', async () => {
    const ctx = await hostFor(fixture('plain'));
    const seen: string[] = [];
    ctx.on('files/removed', ({ path }) => seen.push(path));
    await ctx.files.remove('game/spec.json');
    await ctx.files.move('game/script.spin', 'e8.yml');
    expect(seen).toEqual(['game/spec.json']);
  });
});

describe('files routes — PATCH', () => {
  it('PATCH {to} moves; a body without to is malformed-request', async () => {
    const host = await startHost(fixture('plain'));
    const ok = await fetch(`${host.url}/api/files/game/spec.json`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'game/spec2.json' }),
    });
    expect(ok.status).toBe(200);
    const bad = await fetch(`${host.url}/api/files/game/spec2.json`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${host.url}/api/files/game/nope.json`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'x.json' }),
    });
    expect(missing.status).toBe(404);
  });
});
