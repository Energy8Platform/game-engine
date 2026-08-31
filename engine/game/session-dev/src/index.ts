/**
 * The `session` seam, as a cordis plugin over Task 1's `startE8Server`.
 *
 * Task 1 built `startE8Server` as a bare library function: spawn the real
 * `e8-server` binary, wait for it to come up, hand back a handle to play
 * spins and stop it again. This file is what turns that into the thing a
 * game actually asks for a spin through — `ctx.session.play(params)` — and
 * it is the seam every later task's "how does the game get real math"
 * question routes through.
 *
 * The rule that shapes this file: **failures are data.** A missing or
 * unstartable binary must not reject `ctx.plugin(session, config)` and take
 * down whatever composed it — that is the difference between a game that
 * shows "the math engine did not start, here is the path it tried" and one
 * that shows a white rectangle. So `apply()` always resolves: a boot
 * failure is captured once, as a `Diagnostic`, and handed back from every
 * `play()` call from then on instead of a result. The same holds for a
 * `play()` call against a server that DID start but rejects this
 * particular request (e.g. an unknown `gameId`) — it also comes back as
 * `diagnostics`, never a rejected promise.
 *
 * Teardown is the mirror of startup: the spawned process is stopped inside
 * a `ctx.effect`, so unloading this plugin (or the app composing it)
 * reliably kills it — see `tests/plugin.test.ts`'s last test, which checks
 * this by the OS pid actually being gone, not by trusting that `stop()` was
 * called.
 */
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import { startE8Server } from './e8server';
import type { E8Handle, SpinRequest, SpinResult, StartE8ServerOptions } from './types';

export { startE8Server } from './e8server';
export type { E8Handle, SpinRequest, SpinResult, StartE8ServerOptions } from './types';

declare module 'cordis' {
  interface Context {
    session: SessionService;
  }
}

/** This plugin's config is exactly what `startE8Server` needs — the seam
 *  doesn't add anything of its own on top. */
export type SessionConfig = StartE8ServerOptions;

export interface SessionService {
  /**
   * Plays one spin. Never rejects: whether the server failed to start at
   * all, or this specific call failed against a server that did start,
   * the failure comes back as `diagnostics` with `result` left `undefined`.
   * A successful spin is the mirror — `result` set, `diagnostics` empty.
   */
  play(req: SpinRequest): Promise<{ result?: SpinResult; diagnostics: Diagnostic[] }>;
  /**
   * The OS pid of the backing e8-server process, or `null` if it never
   * started (see the diagnostic `play()` returns in that case). Exposed for
   * the same reason `E8Handle.port` is: so a caller — chiefly a test — can
   * confirm the process is actually there, or actually gone, instead of
   * trusting that a method was merely called.
   */
  readonly pid: number | null;
}

export const name = 'session';

export async function apply(ctx: Context, config: SessionConfig) {
  let handle: E8Handle | null = null;
  let startupDiagnostic: Diagnostic | null = null;

  try {
    handle = await startE8Server(config);
  } catch (error) {
    startupDiagnostic = diagnostic(
      'error',
      'session',
      'e8-server',
      `the math engine did not start: ${error instanceof Error ? error.message : String(error)}`,
      'check that an e8-server binary is reachable (binPath, E8_SERVER_BINARY, or PATH) and that gamesDir points directly at the folder holding the .spin file(s)',
    );
  }

  if (handle) {
    // Reversible: unloading this plugin (or the app composing it) stops the
    // real process. `started` (not `handle`) is captured so the teardown
    // closure keeps working even though `handle`'s outer binding is
    // reassignable — it isn't reassigned again after this point, but tying
    // the effect to a `const` avoids relying on that.
    const started = handle;
    ctx.effect(() => () => started.stop(), 'session:e8-server');
  }

  const service: SessionService = {
    pid: handle?.pid ?? null,
    async play(req) {
      if (!handle) return { diagnostics: [startupDiagnostic!] };
      try {
        const result = await handle.play(req);
        return { result, diagnostics: [] };
      } catch (error) {
        return {
          diagnostics: [
            diagnostic(
              'error',
              'session',
              'play',
              `spin failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          ],
        };
      }
    },
  };

  ctx.provide('session', service);
}
