import { afterEach, describe, expect, it } from 'vitest';
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
