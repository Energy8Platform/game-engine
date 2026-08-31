import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Context } from 'cordis';
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
