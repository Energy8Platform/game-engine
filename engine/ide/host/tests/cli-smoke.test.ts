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

describe('the real e8 binary', () => {
  it('boots under its actual ESM loader and shuts down on SIGTERM', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'e8-cli-smoke-'));
    // Deliberately minimal — no e8.profile.yml, no bundles. The point of
    // this test is "does the process reach 'listening' at all", which is
    // exactly what a first-run project (the single most likely case to
    // exercise every diagnostic path in plugins/project.ts) looks like.
    writeFileSync(join(cwd, 'e8.yml'), '[]\n');

    child = spawn(process.execPath, [CLI_BIN, 'ide'], {
      cwd,
      env: { ...process.env, PORT: '0' }, // ephemeral port — nothing else can be holding it
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const exitedEarly = new Promise<never>((_, reject) => {
      child!.once('exit', (code, signal) => {
        reject(new Error(`process exited early (code=${code}, signal=${signal}); stderr:\n${stderr}`));
      });
    });

    const listening = new Promise<void>((resolvePromise) => {
      const check = (): void => {
        if (stdout.includes('listening on')) resolvePromise();
      };
      child!.stdout!.on('data', check);
      check(); // in case it already arrived before this listener attached
    });

    await Promise.race([
      listening,
      exitedEarly,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out waiting for "listening on"; stderr:\n${stderr}`)), 15000),
      ),
    ]);

    expect(stdout).toContain('e8 ide listening on');
    expect(stderr).not.toContain('ReferenceError');

    // Graceful shutdown: the CLI's own SIGTERM handler calls host.stop()
    // then process.exit(0) — a clean exit code, not a signal-killed one.
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise) => {
      child!.once('exit', (code, signal) => resolvePromise({ code, signal }));
    });
    child.kill('SIGTERM');
    const result = await Promise.race([
      exit,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('process did not exit within 5s of SIGTERM')), 5000),
      ),
    ]);
    expect(result.code).toBe(0);

    child = undefined; // exited cleanly — afterEach has nothing to kill
  }, 20000);
});
