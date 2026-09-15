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
  delete (globalThis as { document?: unknown }).document;
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
  /** What `#status` read each time a wait resolved. */
  resolvedOn: string[];
}

/**
 * Records every call. `goto` really fetches (so a 503 from the host is
 * real). `waitForFunction` really runs the page function — against a
 * `document` stub whose `#status` steps through `statuses` on each
 * false answer — so the predicate `shot` sends to the browser is the
 * thing under test; out of statuses (or `hang`), it never resolves.
 */
function fake(options: { hang?: boolean; statuses?: string[] } = {}): Fake {
  const f: Fake = { calls: [], gotos: [], shots: [], resolvedOn: [], launch };
  const statuses = [...(options.statuses ?? ['ready'])];
  let status = statuses.shift() ?? '';
  (globalThis as { document?: unknown }).document = {
    querySelector: () => ({ textContent: status }),
  };
  async function launch(): Promise<BrowserLike> {
    f.calls.push('launch');
    const page: PageLike = {
      async goto(url) {
        f.gotos.push(url);
        const res = await fetch(url);
        return { status: () => res.status };
      },
      locator(selector) {
        return {
          async textContent() {
            f.calls.push(`text ${selector}`);
            return status;
          },
          async click() {
            f.calls.push(`click ${selector}`);
          },
        };
      },
      waitForFunction(fn, arg) {
        f.calls.push('wait');
        if (options.hang) return new Promise(() => {});
        for (;;) {
          if (fn(arg)) {
            f.resolvedOn.push(status);
            return Promise.resolve(true);
          }
          if (!statuses.length) return new Promise(() => {});
          status = statuses.shift()!;
        }
      },
      async screenshot({ path }) {
        f.shots.push(path);
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
    expect(existsSync(r.path!)).toBe(true);
    expect(f.calls.slice(-2)).toEqual(['page.close', 'browser.close']);
    expect(e8Servers()).toBe(before);
    expect(await portFree(f.gotos[0])).toBe(true);
  }, 30_000);

  it('`out` and `viewport` are honoured; `spin` clicks #spin and waits until #status settles', async () => {
    const f = fake({ statuses: ['ready', 'spinning…', 'done'] });
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
      'text #status',
      'click #spin',
      'wait',
      'text #status',
      'screenshot',
      'page.close',
      'browser.close',
    ]);
    // Readiness resolved on `ready`; the spin wait only once past `spinning…`.
    expect(f.resolvedOn).toEqual(['ready', 'done']);
  }, 30_000);

  it('a spin that settles on a failure text is a warning carrying that text; the shot is still taken', async () => {
    const f = fake({ statuses: ['ready', 'spinning…', 'error — see log'] });
    const r = await shot({ cwd, out: 'custom/b.png', spin: true, launch: f.launch });
    expect(f.resolvedOn).toEqual(['ready', 'error — see log']);
    expect(r.path).toBe(join(cwd, 'custom', 'b.png'));
    expect(f.shots).toHaveLength(1);
    expect(r.diagnostics).toEqual([
      { severity: 'warning', plugin: 'compute', where: '#status', message: 'error — see log' },
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
