/**
 * `shot` with a fake browser: what the real host is asked to serve, what
 * the page is asked to do, and that nothing survives the call. The real
 * Chromium run lives in cli-smoke.test.ts.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { shot, type BrowserLike, type PageLike } from '../src/compute';

const FIRST_SLOT = join(__dirname, '..', '..', '..', 'examples', 'first-slot');

// A copy in tmp: the page never really loads under the fake, so the copy
// need not resolve its packages — only boot the host and a preview.
const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'e8-shot-')));
cpSync(FIRST_SLOT, cwd, {
  recursive: true,
  filter: (src) => !src.includes('node_modules') && !src.endsWith('tsconfig.json'),
});
afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
  delete (globalThis as { window?: unknown }).window;
});

/** Live `e8-server` processes serving this copy's `game/` — 0 when none. */
function e8Servers(): number {
  try {
    return execSync(`pgrep -f 'e8-server.*--games-dir ${join(cwd, 'game')}'`)
      .toString()
      .split('\n')
      .filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** `true` when nothing accepts a TCP connection on `url`'s port. */
function portFree(url: string): Promise<boolean> {
  const { port } = new URL(url);
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(port) });
    socket.once('connect', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(true));
  });
}

interface Fake {
  launch(): Promise<BrowserLike>;
  calls: string[];
  gotos: string[];
  shots: string[];
  /** The `fullPage` option of every screenshot, in order. */
  fullPages: boolean[];
  /** The predicate (and its `arg`) the last `waitForFunction` call was handed — so a test can re-run it directly against a `window` of its own. */
  readinessFn?: (arg: string) => unknown;
  readinessArg?: string;
}

/**
 * Records every call. `goto` really fetches (so a 503 from the host is
 * real). Both `waitForFunction` and `evaluate` really run the function
 * they're handed — against a real `globalThis.window` this function sets
 * up, `__e8` included, so the predicate and the `__e8.spin()` call `shot`
 * sends to the browser are the thing under test, not a stand-in for them.
 * `waitForFunction` also records what it was handed on `readinessFn`/
 * `readinessArg`, so a test can re-run the predicate under a `window` it
 * controls itself, `__e8` present or not.
 */
function fake(
  options: {
    hang?: boolean;
    gotoThrows?: string;
    /** What `window.__e8.spin()` resolves to; an `Error` makes it reject instead. */
    spinResult?: { out: string } | Error;
  } = {},
): Fake {
  const f: Fake = { calls: [], gotos: [], shots: [], fullPages: [], launch };
  (globalThis as { window?: unknown }).window = {
    __e8: {
      spin: () =>
        options.spinResult instanceof Error
          ? Promise.reject(options.spinResult)
          : Promise.resolve(options.spinResult ?? { out: 'next' }),
    },
  };
  async function launch(): Promise<BrowserLike> {
    f.calls.push('launch');
    const page: PageLike = {
      async goto(url) {
        f.gotos.push(url);
        if (options.gotoThrows) throw new Error(options.gotoThrows);
        const res = await fetch(url);
        return { status: () => res.status };
      },
      waitForFunction(fn, arg) {
        f.calls.push('wait');
        f.readinessFn = fn;
        f.readinessArg = arg;
        if (options.hang) return new Promise(() => {});
        return Promise.resolve(fn(arg));
      },
      async evaluate(fn) {
        f.calls.push('evaluate');
        return fn();
      },
      async screenshot({ path, fullPage }) {
        f.shots.push(path);
        f.fullPages.push(fullPage);
        f.calls.push('screenshot');
        // A real file, so the caller's `existsSync` means what it says.
        await import('node:fs/promises').then((fs) => fs.writeFile(path, 'png'));
      },
      async close() {
        f.calls.push('page.close');
      },
    };
    return {
      async newPage() {
        f.calls.push('newPage');
        return page;
      },
      async close() {
        f.calls.push('browser.close');
      },
    };
  }
  return f;
}

describe('shot over a real host, with a fake browser', () => {
  it('opens the previewUrl, reports loadMs, writes the default path, and closes everything', async () => {
    const f = fake();
    const before = e8Servers();
    const r = await shot({ cwd, launch: f.launch });
    expect(r.diagnostics).toEqual([]);
    expect(f.gotos).toHaveLength(1);
    expect(f.gotos[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(typeof r.loadMs).toBe('number');
    expect(r.width).toBe(480);
    expect(r.height).toBe(288);
    expect(r.path).toMatch(new RegExp(`^${join(cwd, '.e8', 'shots')}/.+\\.png$`));
    expect(f.shots).toEqual([r.path]);
    // The whole page, not the viewport: a game taller than 288px is not cropped.
    expect(f.fullPages).toEqual([true]);
    expect(existsSync(r.path!)).toBe(true);
    expect(f.calls.slice(-2)).toEqual(['page.close', 'browser.close']);
    expect(e8Servers()).toBe(before);
    expect(await portFree(f.gotos[0])).toBe(true);
  }, 30_000);

  it('readiness resolves once `window.__e8` is defined (and not before)', async () => {
    const f = fake();
    await shot({ cwd, launch: f.launch });
    const fn = f.readinessFn!;
    const arg = f.readinessArg!;
    (globalThis as { window?: unknown }).window = {};
    expect(fn(arg)).toBeFalsy();
    (globalThis as { window?: unknown }).window = { __e8: {} };
    expect(fn(arg)).toBeTruthy();
  });

  it('`out` and `viewport` are honoured; `spin: true` calls `__e8.spin()` through `evaluate`, no `addStyleTag`', async () => {
    const f = fake({ spinResult: { out: 'next' } });
    const out = join(cwd, 'custom', 'a.png');
    const r = await shot({
      cwd,
      out: 'custom/a.png',
      viewport: { width: 320, height: 200 },
      spin: true,
      launch: f.launch,
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.path).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(r.width).toBe(320);
    expect(f.calls).toEqual([
      'launch',
      'newPage',
      'wait',
      'evaluate',
      'screenshot',
      'page.close',
      'browser.close',
    ]);
  }, 30_000);

  it('`{ out: "failed" }` from `__e8.spin()` is a warning naming the port; the shot is still taken', async () => {
    const f = fake({ spinResult: { out: 'failed' } });
    const r = await shot({ cwd, out: 'custom/b.png', spin: true, launch: f.launch });
    expect(r.path).toBe(join(cwd, 'custom', 'b.png'));
    expect(f.shots).toHaveLength(1);
    expect(r.diagnostics).toEqual([
      {
        severity: 'warning',
        plugin: 'compute',
        where: '__e8.spin',
        message: 'the spin left by "failed"',
      },
    ]);
  }, 30_000);

  it('a rejected `__e8.spin()` is a warning carrying the error message; the shot is still taken', async () => {
    const f = fake({ spinResult: new Error('flow is broken') });
    const r = await shot({ cwd, out: 'custom/c.png', spin: true, launch: f.launch });
    expect(r.path).toBe(join(cwd, 'custom', 'c.png'));
    expect(f.shots).toHaveLength(1);
    expect(r.diagnostics).toEqual([
      {
        severity: 'warning',
        plugin: 'compute',
        where: '__e8.spin',
        message: 'spin failed: flow is broken',
      },
    ]);
  }, 30_000);

  it('a screenshot that cannot be written is a diagnostic, not a throw', async () => {
    const f = fake();
    // `index.html` is a file, so its "subdirectory" cannot be made.
    const r = await shot({ cwd, out: 'index.html/a.png', launch: f.launch });
    expect(r.path).toBeNull();
    expect(typeof r.loadMs).toBe('number');
    expect(f.shots).toEqual([]);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        plugin: 'compute',
        where: join(cwd, 'index.html', 'a.png'),
      }),
    ]);
    expect(await portFree(f.gotos[0])).toBe(true);
  }, 30_000);

  it('`ide` opens the host root; without a dist that is a 503 and no screenshot', async () => {
    const f = fake();
    // This repo's own `dist` may well be built; point `ide-static` at nothing.
    process.env.IDE_DIST = join(cwd, 'no-such-dist');
    let r;
    try {
      r = await shot({ cwd, ide: true, launch: f.launch });
    } finally {
      delete process.env.IDE_DIST;
    }
    expect(f.gotos).toHaveLength(1);
    expect(f.gotos[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(r.path).toBeNull();
    expect(f.shots).toEqual([]);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'error',
      plugin: 'compute',
      message: expect.stringContaining('not built'),
      fix: expect.stringContaining('npm run build'),
    });
    expect(await portFree(f.gotos[0])).toBe(true);
  }, 30_000);

  it('a page that cannot be opened is a diagnostic naming the url, and everything is closed', async () => {
    const f = fake({ gotoThrows: 'net::ERR_CONNECTION_REFUSED' });
    const r = await shot({ cwd, launch: f.launch });
    expect(r.path).toBeNull();
    expect(r.loadMs).toBeNull();
    expect(f.shots).toEqual([]);
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        plugin: 'compute',
        where: f.gotos[0],
        message: `cannot open ${f.gotos[0]}: net::ERR_CONNECTION_REFUSED`,
      },
    ]);
    expect(f.calls.slice(-2)).toEqual(['page.close', 'browser.close']);
    expect(await portFree(f.gotos[0])).toBe(true);
  }, 30_000);

  it('`ide` with `spin` is refused as data, before any host or browser', async () => {
    const f = fake();
    const before = e8Servers();
    const r = await shot({ cwd, ide: true, spin: true, launch: f.launch });
    expect(r.path).toBeNull();
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        plugin: 'compute',
        where: '--spin',
        message: '--spin has no meaning with --ide',
      },
    ]);
    expect(f.calls).toEqual([]);
    expect(e8Servers()).toBe(before);
  });

  it('no browser is a compute diagnostic naming the install, and the host is gone', async () => {
    const before = e8Servers();
    const r = await shot({
      cwd,
      async launch() {
        throw new Error("Cannot find module 'playwright'");
      },
    });
    expect(r.path).toBeNull();
    expect(r.loadMs).toBeNull();
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'error',
      plugin: 'compute',
      message: expect.stringContaining("Cannot find module 'playwright'"),
      fix: 'npx playwright install chromium',
    });
    expect(e8Servers()).toBe(before);
  }, 30_000);

  it('readiness past the budget: the shot is still taken, loadMs null, one warning', async () => {
    const f = fake({ hang: true });
    const r = await shot({ cwd, budgetMs: 50, launch: f.launch });
    expect(r.path).not.toBeNull();
    expect(f.shots).toHaveLength(1);
    expect(r.loadMs).toBeNull();
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'warning', plugin: 'compute' });
    expect(await portFree(f.gotos[0])).toBe(true);
  }, 30_000);

  it('a folder that is not a project, or one without a game, is a diagnostic before any browser', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'e8-shot-empty-'));
    const f = fake();
    try {
      const r = await shot({ cwd: empty, launch: f.launch });
      expect(r.path).toBeNull();
      expect(r.diagnostics).toEqual([
        expect.objectContaining({
          plugin: 'compute',
          message: expect.stringContaining('no e8.yml'),
        }),
      ]);
      expect(f.calls).toEqual([]);

      // With an e8.yml the folder IS a project: the scope opens (measured in
      // project-scope.test.ts: no project-shaped failure makes it reject,
      // so `did not start` cannot be staged from disk) but brings no game.
      writeFileSync(join(empty, 'e8.yml'), '[]\n');
      const gameless = await shot({ cwd: empty, launch: f.launch });
      expect(gameless.path).toBeNull();
      expect(gameless.diagnostics).toEqual([
        expect.objectContaining({
          plugin: 'compute',
          message: expect.stringContaining('no running game'),
        }),
      ]);
      expect(f.calls).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, 30_000);
});
