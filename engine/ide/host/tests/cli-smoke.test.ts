/**
 * Spawns the REAL `e8` binary (`engine/apps/cli/bin/e8.mjs`), the way a
 * developer's shell actually invokes it — `tsx/esm/api` registering a
 * genuine ESM loader, not vitest's own vite-node SSR transform.
 *
 * This exists because vite-node's SSR transform SHIMS `__dirname` for
 * ESM-authored source files. A plugin that accidentally used `__dirname`
 * (a CommonJS-only global) passed all 49 of this workspace's other tests
 * while being unable to boot for a real user — `ReferenceError: __dirname
 * is not defined in ES module scope`, thrown at module-evaluation time,
 * before `createIdeHost`'s own try/catch even exists. No test that goes
 * through vitest's module loader can catch that class of bug; only
 * spawning the production entry point in a real `node` process can.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI_BIN = resolve(__dirname, '../../../../engine/apps/cli/bin/e8.mjs');
const FIRST_SLOT = resolve(__dirname, '../../../examples/first-slot');
const FIRST_SLOT_GAME = join(FIRST_SLOT, 'game');
const STAGE_TYPO = resolve(__dirname, 'fixtures/project-stage-typo/game/script.spin');

let child: ReturnType<typeof spawn> | undefined;
afterEach(async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    child = undefined;
    return;
  }
  child.kill('SIGKILL'); // test failed before the graceful-shutdown assertion ran
  child = undefined;
});

/**
 * Spawns the binary with `args` in `cwd` and resolves once it prints
 * "listening on" (or rejects if it exits or stalls first).
 */
async function spawnUntilListening(args: string[], cwd: string) {
  child = spawn(process.execPath, [CLI_BIN, ...args], {
    cwd,
    env: { ...process.env, PORT: '0' }, // ephemeral port — nothing else can be holding it
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = { stdout: '', stderr: '' };
  child.stdout!.on('data', (chunk: Buffer) => {
    out.stdout += chunk.toString();
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    out.stderr += chunk.toString();
  });

  const exitedEarly = new Promise<never>((_, reject) => {
    child!.once('exit', (code, signal) => {
      reject(
        new Error(`process exited early (code=${code}, signal=${signal}); stderr:\n${out.stderr}`),
      );
    });
  });
  const listening = new Promise<void>((resolvePromise) => {
    const check = (): void => {
      if (out.stdout.includes('listening on')) resolvePromise();
    };
    child!.stdout!.on('data', check);
    check(); // in case it already arrived before this listener attached
  });
  await Promise.race([
    listening,
    exitedEarly,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`timed out waiting for "listening on"; stderr:\n${out.stderr}`)),
        15000,
      ),
    ),
  ]);
  return out;
}

/** SIGTERM → the CLI's own handler calls host.stop() then process.exit(0): a clean code, not a signal-killed one. */
async function expectCleanShutdown(): Promise<void> {
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolvePromise) => {
      child!.once('exit', (code, signal) => resolvePromise({ code, signal }));
    },
  );
  child!.kill('SIGTERM');
  const result = await Promise.race([
    exit,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('process did not exit within 5s of SIGTERM')), 5000),
    ),
  ]);
  expect(result.code).toBe(0);
  child = undefined; // exited cleanly — afterEach has nothing to kill
}

/** A first-run project: `e8.yml` and nothing else — the case most likely to exercise every diagnostic path. */
function projectFolder(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'e8-cli-smoke-'));
  writeFileSync(join(cwd, 'e8.yml'), '[]\n');
  return cwd;
}

describe('the real e8 binary', () => {
  it('boots under its actual ESM loader and shuts down on SIGTERM', async () => {
    const { stdout, stderr } = await spawnUntilListening(['ide'], projectFolder());
    expect(stdout).toContain('e8 ide listening on');
    expect(stderr).not.toContain('ReferenceError');
    await expectCleanShutdown();
  }, 20000);

  it('`e8` with no argument is `e8 ide`', async () => {
    const { stdout } = await spawnUntilListening([], projectFolder());
    expect(stdout).toContain('e8 ide listening on');
    await expectCleanShutdown();
  }, 20000);

  it('`e8 dev` in a folder that is not a project says so on stderr and keeps listening', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'e8-cli-smoke-ws-'));
    const { stdout, stderr } = await spawnUntilListening(['dev'], cwd);
    expect(stdout).toContain('e8 dev listening on');
    expect(stderr).toContain('is not a project (no e8.yml)');
    expect(stderr).toContain('listing 0 project(s)');
    await expectCleanShutdown();
  }, 20000);

  it('`e8 --help` (and a bad argument) prints the usage naming every environment knob', async () => {
    const usage = async (arg: string, code: number) => {
      const { out, exit } = await new Promise<{ out: string; exit: number | null }>((resolve) => {
        const c = spawn(process.execPath, [CLI_BIN, arg], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        c.stdout!.on('data', (d) => (out += d));
        c.stderr!.on('data', (d) => (out += d));
        c.once('exit', (exit) => resolve({ out, exit }));
      });
      expect(exit, arg).toBe(code);
      expect(out, arg).toContain('usage: e8 [ide|dev]');
      expect(out, arg).toContain('e8 check [file]');
      expect(out, arg).toContain('e8 spin [--n N]');
      expect(out, arg).toContain('e8 shot [--out p]');
      for (const env of ['PORT', 'PREVIEW_PORT', 'IDE_DIST', 'IDE_ORIGINS']) {
        expect(out, arg).toMatch(new RegExp(`^\\s*${env}\\b.*$`, 'm'));
      }
    };
    await usage('--help', 0);
    await usage('-h', 0);
    await usage('bogus', 1);
  }, 20000);

  /** Runs `e8 <args>` in `cwd` to completion — the one-shot commands, not the listening ones. */
  async function run(args: string[], cwd: string) {
    return new Promise<{ stdout: string; stderr: string; exit: number | null }>(
      (resolvePromise) => {
        const c = spawn(process.execPath, [CLI_BIN, ...args], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        c.stdout!.on('data', (d) => (stdout += d));
        c.stderr!.on('data', (d) => (stderr += d));
        c.once('exit', (exit) => resolvePromise({ stdout, stderr, exit }));
      },
    );
  }

  /** A copy of `first-slot`'s `game/` — the one folder `check` and `spin` read. */
  function gameProject(): string {
    const cwd = mkdtempSync(join(tmpdir(), 'e8-cli-smoke-game-'));
    cpSync(FIRST_SLOT_GAME, join(cwd, 'game'), { recursive: true });
    return cwd;
  }

  it('`e8 check` prints one JSON document and exits by its diagnostics', async () => {
    const cwd = gameProject();
    const ok = await run(['check'], cwd);
    expect(ok.exit).toBe(0);
    const okReport = JSON.parse(ok.stdout);
    expect(
      okReport.diagnostics.filter((d: { severity: string }) => d.severity === 'error'),
    ).toEqual([]);

    // A parse loss is a warning (exit 0), an undeclared stage an error
    // (exit 1) — the panel's verdict, see compute-check.test.ts.
    writeFileSync(join(cwd, 'game', 'broken.spin'), 'game "x" {\n');
    const broken = await run(['check', 'game/broken.spin'], cwd);
    expect(broken.exit).toBe(0);
    const brokenReport = JSON.parse(broken.stdout);
    expect(brokenReport.diagnostics.length).toBeGreaterThan(0);
    expect(
      brokenReport.diagnostics.every((d: { severity: string }) => d.severity === 'warning'),
    ).toBe(true);

    cpSync(STAGE_TYPO, join(cwd, 'game', 'typo.spin'));
    const typo = await run(['check', 'game/typo.spin'], cwd);
    expect(typo.exit).toBe(1);
    expect(JSON.parse(typo.stdout).diagnostics).toMatchObject([
      { severity: 'error', where: 'game/typo.spin' },
    ]);
  }, 20000);

  it('`e8 spin --n 5` plays five spins; `--n x` is a compute diagnostic and exit 1', async () => {
    const cwd = gameProject();
    const five = await run(['spin', '--n', '5', '--seed', 'abc'], cwd);
    expect(five.exit, five.stderr).toBe(0);
    expect(JSON.parse(five.stdout).spins).toBe(5);
    expect(five.stderr).toContain('5/5');

    const bad = await run(['spin', '--n', 'x', '--quiet'], cwd);
    expect(bad.exit).toBe(1);
    expect(bad.stderr).toBe('');
    expect(JSON.parse(bad.stdout).diagnostics).toMatchObject([{ plugin: 'compute' }]);

    const unknown = await run(['spin', '--bogus', '--n', '1'], cwd);
    expect(unknown.exit).toBe(1);
    expect(JSON.parse(unknown.stdout).diagnostics).toMatchObject([
      { plugin: 'compute', where: '--bogus' },
    ]);
  }, 30000);

  it('`e8 shot` writes a PNG of the real game and reports how long it took', async () => {
    // Beside the example, not in tmp — the project resolves its packages
    // from its own directory and vite serves them via `/@fs/` under the
    // repo root; see engine/apps/web/tests/e2e/project-fixture.ts.
    const cwd = mkdtempSync(join(resolve(FIRST_SLOT, '..'), 'e8-compose-shot-'));
    cpSync(FIRST_SLOT, cwd, { recursive: true, filter: (src) => !src.endsWith('/node_modules') });
    try {
      const out = join(cwd, 'shots', 'a.png');
      const r = await run(['shot', '--out', out, '--viewport', '320x200'], cwd);
      const report = JSON.parse(r.stdout);
      // The e2e suite uses Playwright's Chromium, so on a developer's
      // machine it is installed; a checkout without it gets the CLI's own
      // diagnostic, and this test says so instead of failing on the environment.
      if (report.diagnostics[0]?.fix === 'npx playwright install chromium') {
        console.warn(`skipping the real-browser shot: ${report.diagnostics[0].message}`);
        return;
      }
      expect(r.exit, r.stderr).toBe(0);
      expect(report.diagnostics).toEqual([]);
      expect(report.path).toBe(out);
      expect(report.width).toBe(320);
      expect(report.height).toBe(200);
      expect(typeof report.loadMs).toBe('number');
      expect(report.loadMs).toBeLessThanOrEqual(30000);
      expect(existsSync(out)).toBe(true);
      expect(readFileSync(out).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );

      // Refused flags: one JSON document, exit 1, no host booted (fast).
      for (const [args, where] of [
        [['--viewport', 'wide'], '--viewport'],
        [['--viewport', '0x0'], '--viewport'],
        [['--budget', 'abc'], '--budget'],
        [['--budget', '0'], '--budget'],
        [['--ide', '--spin'], '--spin'],
        [['--quiet'], '--quiet'],
      ] as const) {
        const bad = await run(['shot', ...args], cwd);
        expect(bad.exit, args.join(' ')).toBe(1);
        expect(JSON.parse(bad.stdout).diagnostics, args.join(' ')).toMatchObject([
          { plugin: 'compute', where },
        ]);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);
});
