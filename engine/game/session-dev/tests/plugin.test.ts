import { afterEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from 'cordis';
import * as diagnosticsRuntime from '@energy8engine/diagnostics/runtime';
import * as session from '../src/index';

// Same fixture and the same `--games-dir` gotcha as spin.test.ts: e8-server's
// --games-dir is not recursive, it must point at the folder holding the
// .spin file itself, not an ancestor of it.
const GAME = join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game');

// Every test below builds its own `Context` and is responsible for disposing
// it — there is no shared `beforeAll` server the way spin.test.ts has one,
// because this suite's whole point is to exercise the plugin's own
// boot/teardown path (including the boot-failure one), not to reuse a
// running handle.
let ctx: Context | undefined;
afterEach(async () => {
  await ctx?.fiber.dispose();
  ctx = undefined;
});

/** Signal 0 sends nothing — it only asks the OS "does this pid exist" and
 *  throws ESRCH if not. Used instead of trusting that `stop()` was merely
 *  called, per the brief's ruling on this exact test. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === 'ESRCH') return false;
    // Anything else (e.g. EPERM) means the pid exists but we can't signal
    // it — that is not "the process is gone" and must not be reported as
    // such.
    throw error;
  }
}

describe('the session plugin', () => {
  it('provides ctx.session only once the plugin is registered', async () => {
    ctx = new Context();
    expect(ctx.session).toBeUndefined();

    await ctx.plugin(session, { gamesDir: GAME, port: 0 });

    expect(typeof ctx.session.play).toBe('function');
    expect(ctx.session.startupDiagnostic).toBeNull();
  });

  it('plays a real spin through e8-server and returns the measured SpinResult shape, no diagnostics', async () => {
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: GAME, port: 0 });

    const { result, diagnostics } = await ctx.session.play({
      gameId: 'first-slot',
      action: 'spin',
      betLevel: 1.0,
    });

    expect(diagnostics).toEqual([]);
    expect(result).toBeDefined();
    expect(result!.stage).toBe('base_game');
    expect(result!.data.grid).toHaveLength(5);
    expect(result!.data.grid[0]).toHaveLength(3);
    expect(typeof result!.win).toBe('number');
    expect(typeof result!.roundId).toBe('string');
  });

  it('an unstartable e8-server binary yields a diagnostic from play(), not a rejected registration', async () => {
    ctx = new Context();

    // `ctx.plugin()` itself must not reject — a missing binary is data, not
    // an exception that escapes plugin boot. `binPath` names a path that
    // cannot exist; `readyTimeoutMs` is generous but the spawn 'error'
    // (ENOENT) event fires and is detected within one poll interval, well
    // under it, so this doesn't actually wait out the full timeout. If
    // `apply()` let the rejection through instead of turning it into a
    // diagnostic, this `await` would itself throw and fail the test right
    // here — that failure mode is exercised directly in the report's
    // mutation check, not left to be merely "probably true".
    await ctx.plugin(session, {
      gamesDir: GAME,
      port: 0,
      binPath: '/nonexistent/e8-server-binary',
      readyTimeoutMs: 5_000,
    });

    expect(ctx.session.pid).toBeNull();

    const { result, diagnostics } = await ctx.session.play({
      gameId: 'first-slot',
      action: 'spin',
      betLevel: 1.0,
    });

    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].message).toContain('e8-server');

    // The same specific diagnostic is available eagerly, on the service
    // itself, for a caller that needs to know *before* ever calling
    // play() — a composer deciding whether to bring up a canvas is
    // exactly this caller (see @energy8engine/game-runtime's createGame).
    // It is the exact object play() returned above, not a re-derived one.
    expect(ctx.session.startupDiagnostic).toBe(diagnostics[0]);
    expect(ctx.session.startupDiagnostic!.message).toContain('/nonexistent/e8-server-binary');
    // And the REASON survives: a spawn that never happened also fires
    // `'close'` with code -2 after `'error'`, and that second event used to
    // overwrite the ENOENT text with "exit code=-2", which tells nobody
    // anything.
    expect(ctx.session.startupDiagnostic!.message).toContain('ENOENT');
  });

  it('a play() call the running server rejects yields a diagnostic, not a rejected promise', async () => {
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: GAME, port: 0 });

    // The server started fine (unlike the previous test) and `first-slot`
    // is really loaded — `action` is the wrong lever here, not `gameId`:
    // an unknown action against a game that IS loaded is what proves this
    // is the "server started but rejected THIS call" path, not a repeat of
    // the startup-failure path above. Confirmed by hand against a real
    // e8-server before writing this assertion: StartRound resolves (no
    // gRPC-level throw) with `error: 'unknown action "no-such-action"'` in
    // the body, which `e8server.ts`'s `play()` turns into a rejected
    // promise — exactly the shape `ctx.session.play()` must catch.
    const { result, diagnostics } = await ctx.session.play({
      gameId: 'first-slot',
      action: 'no-such-action',
      betLevel: 1.0,
    });

    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].message).toContain('no-such-action');

    // The server itself is still up — this is a bad-request diagnostic, not
    // a crash — so a follow-up call with a valid action still succeeds.
    const second = await ctx.session.play({
      gameId: 'first-slot',
      action: 'spin',
      betLevel: 1.0,
    });
    expect(second.diagnostics).toEqual([]);
    expect(second.result).toBeDefined();
  });

  it('unloading the plugin kills the real e8-server process — checked by pid, not by spying on stop()', async () => {
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: GAME, port: 0 });

    const pid = ctx.session.pid;
    expect(typeof pid).toBe('number');
    expect(isProcessAlive(pid!)).toBe(true);

    await ctx.fiber.dispose();
    ctx = undefined; // already disposed — afterEach's dispose would be a harmless no-op, but skip it explicitly

    expect(isProcessAlive(pid!)).toBe(false);
  });
});

/**
 * `restart()`: the one way to get new math into an already-running
 * `e8-server` — the proto this file's sibling `e8server.ts` speaks has no
 * reload RPC, so "kill it and spawn a fresh one against the same
 * `--games-dir`" is not a workaround, it is the whole mechanism. `dev-game`
 * (the only production caller) triggers this off a `game/script.spin`
 * write; these tests exercise the service directly, the same way the
 * startup path above does.
 */
describe('the session plugin: restart', () => {
  it('kills the old process, spawns a new one, and a spin afterward succeeds', async () => {
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: GAME, port: 0 });

    const firstPid = ctx.session.pid;
    expect(typeof firstPid).toBe('number');

    const { diagnostics } = await ctx.session.restart();
    expect(diagnostics).toEqual([]);

    const secondPid = ctx.session.pid;
    expect(typeof secondPid).toBe('number');
    expect(secondPid).not.toBe(firstPid);
    // Not just "a method resolved" — the OLD pid is actually gone and the
    // NEW one is actually alive, the same standard the teardown test above
    // holds itself to.
    expect(isProcessAlive(firstPid!)).toBe(false);
    expect(isProcessAlive(secondPid!)).toBe(true);

    const spin = await ctx.session.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    expect(spin.diagnostics).toEqual([]);
    expect(spin.result).toBeDefined();
  });

  it('a restart against an unstartable binary never throws — the next play() reports it as data', async () => {
    ctx = new Context();
    await ctx.plugin(session, {
      gamesDir: GAME,
      port: 0,
      binPath: '/nonexistent/e8-server-binary',
      readyTimeoutMs: 5_000,
    });
    expect(ctx.session.pid).toBeNull();

    const { diagnostics } = await ctx.session.restart();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('error');
    expect(ctx.session.startupDiagnostic).toBe(diagnostics[0]);

    const { result, diagnostics: playDiagnostics } = await ctx.session.play({
      gameId: 'first-slot',
      action: 'spin',
      betLevel: 1.0,
    });
    expect(result).toBeUndefined();
    expect(playDiagnostics).toHaveLength(1);
  });

  it('disposing after a restart kills the NEW process, not a stale reference to the old one', async () => {
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: GAME, port: 0 });
    await ctx.session.restart();

    const pid = ctx.session.pid!;
    expect(isProcessAlive(pid)).toBe(true);

    await ctx.fiber.dispose();
    ctx = undefined;

    expect(isProcessAlive(pid)).toBe(false);
  });

  /**
   * The failure text the review corrected: after a restart, `binPath` and
   * `gamesDir` are exactly what they were a moment ago when the process
   * WAS running — only the `.spin` a person just saved moved. The old
   * message ("check that an e8-server binary is reachable…") named a
   * cause the code has no reason to believe. This uses a genuinely
   * BROKEN `.spin` (a real syntax error, appended after a clean boot) so
   * the restart fails for the reason a person editing math by mouse
   * actually hits, not for a missing binary.
   *
   * This also exercises the `'exit'` → `'close'` fix in `e8server.ts`:
   * the compiler prints its error and exits within milliseconds, and the
   * review found the error text captured only sometimes when the
   * readiness loop broke on `'exit'` before the stderr `'data'` event had
   * necessarily fired.
   */
  it('a restart failure names the exit and the compiler, not the binary or games-dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-dev-restart-broken-spin-'));
    cpSync(GAME, dir, { recursive: true });
    try {
      ctx = new Context();
      await ctx.plugin(session, { gamesDir: dir, port: 0 });
      expect(ctx.session.pid).not.toBeNull(); // boots clean before the edit

      appendFileSync(join(dir, 'script.spin'), '\nthis is not valid spin syntax @@@\n');

      const { diagnostics } = await ctx.session.restart();
      expect(diagnostics).toHaveLength(1);
      const message = diagnostics[0].message;

      // Names the exit and carries the compiler's own error text.
      expect(message).toMatch(/exit code=/);
      expect(message).toContain('script.spin');

      // Does NOT repeat the first-boot guidance, which would blame
      // something that did not change.
      expect(diagnostics[0].fix).not.toMatch(/binPath|E8_SERVER_BINARY/);
      expect(message).not.toMatch(/binPath|E8_SERVER_BINARY/);

      // The exit happened in milliseconds, well under `readyTimeoutMs` —
      // asserting only the absence of `binPath`/`E8_SERVER_BINARY` (as
      // this test used to) passes even if the message ALSO claims a
      // timeout that never happened, since neither of those two words
      // appears in that claim either. This is the fact the review found
      // the earlier assertion didn't reach: an exit is not a timeout.
      expect(message).not.toMatch(/did not become ready/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Concurrency the review found: `restart()` reading and stopping `handle`
 * without serializing left two overlapping calls both seeing the same
 * process as "the one to stop" — the second sees `null` (the first already
 * nulled it), skips its own stop, and whichever spawn settles last
 * silently wins the service's `handle` while the other's process is never
 * referenced again. Two quick saves from the editor is exactly this shape,
 * not a contrived race.
 *
 * Each test below uses its OWN private copy of `GAME`, in a unique temp
 * directory, so `countLive` — matching the OS process list against that
 * directory's literal path (it appears verbatim in `--games-dir`, per
 * `e8server.ts`'s `args`) — counts only processes THIS test spawned, not
 * whatever `spin.test.ts` or the `restart` block above happens to have running
 * against the shared `GAME` fixture in a parallel worker.
 */
/** Counts OS processes whose command line contains `marker` — `pgrep -f` exits 1 (throws) when nothing matches, which is zero, not an error. */
function countLive(marker: string): number {
  try {
    return execSync(`pgrep -f ${JSON.stringify(marker)}`, { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

describe('the session plugin: restart does not orphan a process', () => {
  function privateGame(): string {
    const dir = mkdtempSync(join(tmpdir(), 'session-dev-restart-race-'));
    cpSync(GAME, dir, { recursive: true });
    return dir;
  }

  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('two overlapping restart() calls leave exactly one process alive', async () => {
    dir = privateGame();
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: dir, port: 0 });
    expect(countLive(dir)).toBe(1);

    const [a, b] = await Promise.all([ctx.session.restart(), ctx.session.restart()]);
    expect(a.diagnostics).toEqual([]);
    expect(b.diagnostics).toEqual([]);

    expect(countLive(dir)).toBe(1);
    expect(isProcessAlive(ctx.session.pid!)).toBe(true);
  });

  it('three restart() calls staggered 5ms apart leave exactly one process alive', async () => {
    dir = privateGame();
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: dir, port: 0 });

    const calls = [ctx.session.restart()];
    await new Promise((resolve) => setTimeout(resolve, 5));
    calls.push(ctx.session.restart());
    await new Promise((resolve) => setTimeout(resolve, 5));
    calls.push(ctx.session.restart());
    await Promise.all(calls);

    expect(countLive(dir)).toBe(1);
    expect(isProcessAlive(ctx.session.pid!)).toBe(true);
  });

  it('disposing mid-restart does not leave the in-flight respawn alive', async () => {
    dir = privateGame();
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: dir, port: 0 });

    const restarting = ctx.session.restart();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await ctx.fiber.dispose();
    ctx = undefined;
    await restarting; // let the restart's own promise settle before asserting

    expect(countLive(dir)).toBe(0);
  });

  /**
   * The `disposed` flag's OWN case, as opposed to the test above (which
   * the `chain` await alone already covers — removing `disposed` and
   * leaving only the `chain`-based teardown still passes it, every dispose
   * timing tried). The gap `disposed` closes is narrower: a `restart()`
   * call issued AFTER the disposer has already run and captured its OWN
   * `chain` reference into `chain.then(() => handle?.stop())` — at that
   * point the disposer is committed to whichever process THAT snapshot
   * resolves to, and a brand new chain link started afterward is invisible
   * to it.
   *
   * `svc` is captured BEFORE calling `dispose()`, not read as `ctx.session`
   * afterward — measured directly that `ctx.session` reads back `undefined`
   * within single-digit milliseconds of `dispose()` starting (cordis tears
   * the accessor down close to immediately), which is faster than this
   * race needs to matter and would make the call throw before ever
   * reaching `restart()`. The captured object is the exact same closure
   * `ctx.session` would have handed back a moment earlier — the real
   * `dev-game.ts` caller reads `ctx.session.restart()` fresh, but the
   * SERVICE OBJECT itself is what carries the race, not how a caller
   * happens to have obtained a reference to it.
   */
  it('a restart() issued after the disposer has already captured its chain snapshot is still caught by the disposed flag', async () => {
    dir = privateGame();
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: dir, port: 0 });
    const svc = ctx.session;

    const disposing = ctx.fiber.dispose();
    ctx = undefined;
    await new Promise((resolve) => setTimeout(resolve, 10));
    const late = svc.restart();

    await Promise.all([disposing, late]);

    expect(countLive(dir)).toBe(0);
  });
});

/**
 * The composition of the lifecycle fixes, attacked from the side the
 * earlier tests do not reach: a dispose that lands BEHIND queued
 * restarts. Every earlier attack settled with zero orphans, and these keep
 * that; what they add is the cost and the wording of the restarts that
 * were still queued when the plugin went away.
 *
 * The binary is wrapped in a shell script that appends one line to a log
 * per spawn before exec-ing the real thing — the one way to count spawns
 * from outside `startE8Server` without spying on it. `binPath` is used
 * verbatim by `resolveServerBinary`, so the wrapper is what gets spawned.
 */
/** The real binary, resolved the same way `e8server.ts` does with no `binPath` — platform-core's postinstall copy. Wrapped by the tests below in a shell script that decides, per spawn, whether to exec it. */
function realBinary(): string {
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  return join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'packages',
    'platform-core',
    'bin',
    `e8-server-${process.platform}-${arch}`,
  );
}

describe('the session plugin: restarts queued behind a dispose', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function countingWrapper(root: string): { binPath: string; spawns(): number } {
    const log = join(root, 'spawns.log');
    const binPath = join(root, 'e8-server-counting.sh');
    writeFileSync(
      binPath,
      `#!/bin/sh\necho spawn >> ${JSON.stringify(log)}\nexec ${JSON.stringify(realBinary())} "$@"\n`,
      { mode: 0o755 },
    );
    return {
      binPath,
      spawns: () =>
        existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0,
    };
  }

  it('a dispose behind three queued restarts spawns nothing more, and each restart says the engine is gone', async () => {
    dir = mkdtempSync(join(tmpdir(), 'session-dev-dispose-behind-queue-'));
    cpSync(GAME, join(dir, 'game'), { recursive: true });
    const wrapper = countingWrapper(dir);
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: join(dir, 'game'), port: 0, binPath: wrapper.binPath });
    expect(wrapper.spawns()).toBe(1);
    const svc = ctx.session;

    const queued = [svc.restart(), svc.restart(), svc.restart()];
    const disposing = ctx.fiber.dispose();
    ctx = undefined;
    const results = await Promise.all(queued);
    await disposing;

    // Without the early return, each queued restart still paid a full
    // boot after the plugin was gone — three more spawns here, and with a
    // hung binary three readiness timeouts before Ctrl-C returned.
    expect(wrapper.spawns()).toBe(1);
    for (const { diagnostics } of results) {
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).not.toMatch(/restarting/);
      expect(diagnostics[0].message).toMatch(/gone|shut down|disposed/);
    }
    expect(countLive(join(dir, 'game'))).toBe(0);
  });
});

/**
 * The `fix` line the restart failure carries, split the way its message
 * already is: an exit with compiler output is the `.spin`'s fault; a
 * signal or a timeout is not, and saying "fix the error in the .spin file"
 * for a process something else killed asserts a cause the code does not
 * know.
 */
describe('the session plugin: what a restart failure says to fix', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('an exit with compiler output points at the .spin file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'session-dev-fix-exit-'));
    cpSync(GAME, dir, { recursive: true });
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: dir, port: 0 });
    appendFileSync(join(dir, 'script.spin'), '\nthis is not valid spin syntax @@@\n');
    const { diagnostics } = await ctx.session.restart();
    expect(diagnostics[0].fix).toMatch(/\.spin/);
  });

  it('a timeout does not blame the .spin file', async () => {
    // The wrapper boots the real binary once, then hangs on every later
    // spawn: the readiness poll runs out, the process is still there, and
    // nothing about the script was ever read.
    dir = mkdtempSync(join(tmpdir(), 'session-dev-fix-timeout-'));
    cpSync(GAME, dir, { recursive: true });
    const flag = join(dir, 'hang-from-now-on');
    const wrapper = join(dir, 'hang-after-first.sh');
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ -e ${JSON.stringify(flag)} ]; then sleep 60; fi\nexec ${JSON.stringify(realBinary())} "$@"\n`,
      { mode: 0o755 },
    );
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: dir, port: 0, binPath: wrapper, readyTimeoutMs: 5000 });
    expect(ctx.session.pid).not.toBeNull();
    writeFileSync(flag, '');
    const { diagnostics } = await ctx.session.restart();
    expect(diagnostics[0].message).toMatch(/did not become ready/);
    expect(diagnostics[0].fix).not.toMatch(/\.spin/);
  });

  it('a signal does not blame the .spin file', async () => {
    // The wrapper kills itself after the first boot, before it ever
    // listens — the exit carries a signal and no compiler output.
    dir = mkdtempSync(join(tmpdir(), 'session-dev-fix-signal-'));
    cpSync(GAME, dir, { recursive: true });
    const flag = join(dir, 'die-from-now-on');
    const wrapper = join(dir, 'die-after-first.sh');
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ -e ${JSON.stringify(flag)} ]; then kill -KILL $$; fi\nexec ${JSON.stringify(realBinary())} "$@"\n`,
      { mode: 0o755 },
    );
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: dir, port: 0, binPath: wrapper });
    expect(ctx.session.pid).not.toBeNull();
    writeFileSync(flag, '');
    const { diagnostics } = await ctx.session.restart();
    expect(diagnostics[0].message).toMatch(/signal=SIGKILL/);
    expect(diagnostics[0].fix).not.toMatch(/\.spin/);
  });
});

/**
 * `play()`'s PER-CALL diagnostics, reaching the composition's shared
 * `diagnostics` service — this row's `apply(ctx)` already holds `ctx` (the
 * same way `mechanics1`'s does), so it is positioned to write directly, for
 * whichever composition actually shares a `ctx` with a `diagnostics1` row.
 *
 * **No composition in this repo is that one, and this block says so rather
 * than implying otherwise.** The only production caller is `dev-game.ts`'s
 * host-side `/api/spin` route, whose `ctx` is the IDE host's and composes
 * no `diagnostics1`; the host reaches the editor by a different road
 * (`rpc.ts`'s `reportGameDiagnostics`), and `first-slot` never passes
 * `createGame({ session })`. What the arrangement below IS, exactly, is
 * what `createGame({ session })` produces over a composition that includes
 * `diagnostics1` — the in-process node path `GameConfig.session` exists for
 * — so these tests pin a reachable path with no caller yet, not an
 * impossible one. See the long comment at the write itself in `../src/
 * index.ts` for why it is kept rather than deleted.
 *
 * **Deliberately NOT covered here: the startup failure `!handle` returns.**
 * `startupDiagnostic` is read EAGERLY, at compose time, by
 * `@energy8engine/game-runtime`'s `createGame` (for the `config.session`
 * path) — and, per task 2, whatever `createGame` collects is ALREADY
 * mirrored into the service once composition settles. `play()` handing back
 * that SAME diagnostic object on every subsequent call is a convenience for
 * a caller that never checked eagerly, not a new event — writing it again
 * here would double-count the one createGame already recorded. See the
 * "does not accumulate" test below, which pins exactly that.
 */
describe('the session plugin: reporting to the diagnostics service', () => {
  it('a play() failure that is both returned and recorded appears once', async () => {
    // The server started (unlike the startup-failure tests) and rejected
    // THIS call — genuinely new information nothing else could have
    // written, unlike `startupDiagnostic` (see the module doc above).
    ctx = new Context();
    await ctx.plugin(diagnosticsRuntime);
    await ctx.plugin(session, { gamesDir: GAME, port: 0 });

    const { diagnostics } = await ctx.session.play({
      gameId: 'first-slot',
      action: 'no-such-action',
      betLevel: 1.0,
    });

    expect(diagnostics).toHaveLength(1);
    expect(ctx.diagnostics.list()).toHaveLength(1);
    expect(ctx.diagnostics.list()[0].message).toBe(diagnostics[0].message);
  });

  it('a clean play() reports nothing', async () => {
    ctx = new Context();
    await ctx.plugin(diagnosticsRuntime);
    await ctx.plugin(session, { gamesDir: GAME, port: 0 });

    const { diagnostics } = await ctx.session.play({
      gameId: 'first-slot',
      action: 'spin',
      betLevel: 1.0,
    });

    expect(diagnostics).toEqual([]);
    expect(ctx.diagnostics.list()).toEqual([]);
  });

  it('does nothing, quietly, when no diagnostics row is composed', async () => {
    // The row is optional. `play()` must still return what it always did.
    ctx = new Context();
    await ctx.plugin(session, { gamesDir: GAME, port: 0 });

    const { diagnostics } = await ctx.session.play({
      gameId: 'first-slot',
      action: 'no-such-action',
      betLevel: 1.0,
    });

    expect(diagnostics).toHaveLength(1);
  });

  it('a startup failure returned by repeated play() calls does not accumulate in the service', async () => {
    // `startupDiagnostic` is the SAME object every `play()` call against a
    // dead session hands back. `createGame` (task 2) is its one writer,
    // once, at compose time — this row must not ALSO write it per call, or
    // two calls would leave two copies of one failure in the service.
    ctx = new Context();
    await ctx.plugin(diagnosticsRuntime);
    await ctx.plugin(session, {
      gamesDir: GAME,
      port: 0,
      binPath: '/nonexistent/e8-server-binary',
      readyTimeoutMs: 5_000,
    });

    await ctx.session.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    await ctx.session.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });

    expect(ctx.diagnostics.list()).toEqual([]);
  });
});
