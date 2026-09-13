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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI_BIN = resolve(__dirname, '../../../../engine/apps/cli/bin/e8.mjs');

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
      reject(new Error(`process exited early (code=${code}, signal=${signal}); stderr:\n${out.stderr}`));
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
      setTimeout(() => reject(new Error(`timed out waiting for "listening on"; stderr:\n${out.stderr}`)), 15000),
    ),
  ]);
  return out;
}

/** SIGTERM → the CLI's own handler calls host.stop() then process.exit(0): a clean code, not a signal-killed one. */
async function expectCleanShutdown(): Promise<void> {
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise) => {
    child!.once('exit', (code, signal) => resolvePromise({ code, signal }));
  });
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
});
