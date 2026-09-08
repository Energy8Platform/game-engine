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
 * `play()` call from then on instead of a result — AND exposed eagerly, on
 * the service itself, as `startupDiagnostic`, for a caller that needs the
 * specific reason before ever calling `play()` at all (a composer deciding
 * whether to proceed to the canvas-dependent rest of boot has exactly this
 * need; re-deriving a vaguer diagnostic from `pid === null` instead of
 * reading this one is the mistake to avoid). The same holds for a
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
import { reportAll, type DiagnosticsService } from '@energy8engine/diagnostics';
// Type-only and fully erased — declares `ctx.diagnostics` on cordis's
// `Context` without importing the row itself. See `@energy8engine/spin-log`'s
// `src/runtime.ts` module doc for the same device.
import type {} from '@energy8engine/diagnostics/runtime';
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
  /**
   * The specific reason startup failed, or `null` on a healthy start.
   * Identical to what a `play()` call against this same service returns
   * when `handle` never came up — exposed here too so a caller that needs
   * to know *before* ever calling `play()` (e.g. `createGame`, which must
   * not attempt a canvas after a dead session) gets the real reason
   * (naming the binary, `binPath`/`E8_SERVER_BINARY`/`gamesDir`) instead of
   * having to re-derive a vaguer one from `pid === null` alone.
   */
  readonly startupDiagnostic: Diagnostic | null;
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
    startupDiagnostic,
    async play(req) {
      // `startupDiagnostic` is NOT written to the diagnostics service here,
      // deliberately — it is the SAME object on every call this branch
      // takes, and `@energy8engine/game-runtime`'s `createGame` already
      // reads it eagerly, once, at compose time (for the `config.session`
      // path), which per task 2 is already mirrored into the service.
      // Writing it again per call would leave two copies of one startup
      // failure for two `play()` calls against a dead session. See
      // task-2-3-report.md and `tests/plugin.test.ts`'s "does not
      // accumulate" test.
      if (!handle) return { diagnostics: [startupDiagnostic!] };
      try {
        const result = await handle.play(req);
        return { result, diagnostics: [] };
      } catch (error) {
        // THIS diagnostic, by contrast, is genuinely new every call — a
        // fact about THIS request, not about how the session started —
        // and nothing else in a composition could have written it. This
        // row's `apply(ctx)` already holds `ctx` (the same position
        // `mechanics1`'s registry writes from), so it writes directly
        // rather than leaving every composer to notice and relay it.
        //
        // **And in this repo, today, that write reaches nobody. Said
        // plainly rather than left to be discovered.** This package is
        // node-only (it spawns a real e8-server), it is not a row in
        // `e8-base`, and its ONE production caller is `dev-game.ts`'s
        // host-side `/api/spin` route — whose `ctx` is the IDE HOST's,
        // which composes no `diagnostics1`. So `reflect.get` returns
        // `undefined` and this line does nothing, every time. The host
        // reaches the editor by a different road entirely (`rpc.ts`'s
        // `reportGameDiagnostics`), and `first-slot` never passes
        // `createGame({ session })`.
        //
        // It is kept, not deleted, and the condition that would make it
        // fire is exact: a caller of `createGame` that passes
        // `config.session` — the in-process path `GameConfig.session`
        // exists for, a node-side test or simulation rather than a
        // browser — over a composition that also has a `diagnostics1` row.
        // `createGame` composes this plugin into that same `ctx`, and this
        // lookup is done per call rather than at apply time, so the
        // service is there by the time anything plays. Nothing in this
        // repo is that caller yet. Deleting the line would mean the first
        // one to appear silently loses its per-spin failures — the exact
        // gap task 3 closed — for the sake of one `reflect.get` on a
        // failed spin.
        const failure = [
          diagnostic(
            'error',
            'session',
            'play',
            `spin failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ];
        reportAll(ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined, failure);
        return { diagnostics: failure };
      }
    },
  };

  ctx.provide('session', service);
}
