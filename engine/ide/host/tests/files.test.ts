import {
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
  const host = await createIdeHost({ cwd, port: 0 });
  hosts.push(host);
  return host.ctx;
}

/**
 * Boots a host for `cwd` and returns the whole `IdeHost` — `host.url` is
 * what the route tests below exercise, over real HTTP, unlike `hostFor`'s
 * direct `ctx.files` calls above.
 */
async function startHost(cwd: string): Promise<IdeHost> {
  const host = await createIdeHost({ cwd, port: 0 });
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
function rawGet(host: IdeHost, rawPath: string): Promise<{ status: number; text: string }> {
  const url = new URL(host.url);
  return new Promise((resolveRequest, reject) => {
    const req = httpRequest(
      { host: url.hostname, port: url.port, path: rawPath, method: 'GET' },
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
    // Проверка удержания при записи отличается от чтения: файла ещё нет,
    // поэтому `realpath` берётся у ближайшего существующего предка.
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

  it('refuses to remove a directory, naming what it is', async () => {
    // Удаление каталога — другое намерение с другой ценой ошибки.
    const dir = fixture('plain');
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.remove('game');
    expect(diagnostics[0].message).toMatch(/directory/i);
    expect(existsSync(join(dir, 'game'))).toBe(true);
  });

  it('refuses to remove outside the project', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.remove('../../../etc/hosts');
    expect(diagnostics[0].message).toMatch(/outside the project/i);
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
