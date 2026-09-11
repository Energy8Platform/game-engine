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
import { StartFailure, startE8Server } from './e8server';
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
  /**
   * Kills the running `e8-server` and spawns a fresh one against the same
   * `--games-dir` — the only way this process ever picks up an edited
   * `.spin`. The gRPC contract this package speaks (`e8server.ts`'s
   * `ENGINE_PROTO`) has no reload RPC, so a respawn is not a workaround for
   * a missing feature, it is the actual mechanism a `--sessions memory`
   * dev host uses. Never rejects, same contract as `play()`: a respawn
   * that fails to come up is a `Diagnostic`, reachable both from this call
   * and from every `play()` call afterward, exactly like the first spawn's
   * failure already is.
   *
   * **Every round in flight is lost.** `--sessions memory` keeps round
   * state inside the killed process; there is no handoff, and nothing
   * here waits for an in-flight `play()` to finish first — a spin racing
   * a restart fails as data (see `play()`'s own `!handle` branch), the
   * same way a spin against a server that never started already does. That
   * is an acceptable cost for a dev host a person is actively editing math
   * against, and it would not be acceptable anywhere `--sessions memory`
   * isn't already the deliberate choice.
   *
   * A failure here is worded differently from a first-boot failure: the
   * binary and `--games-dir` did not change, only the `.spin` a person just
   * saved did, so the diagnostic names the exit and carries the compiler's
   * own error text instead of pointing at `binPath`/`gamesDir` — see
   * `boot()`'s own `reason` parameter.
   *
   * Every call is serialized onto one internal queue — see `chain`, in
   * `apply()` — so two overlapping calls (an ordinary "saved twice fast"
   * gesture) can never both read the same process as the one to stop.
   */
  restart(): Promise<{ diagnostics: Diagnostic[] }>;
}

export const name = 'session';

/**
 * `Diagnostic.code` on the answer `play()` gives while a restart is in
 * flight — for a caller that must tell a WAIT apart from a failure. The
 * `/api/spin` route hands the wait back to the page that asked and reports
 * nothing, because a list with no retract must not take in a state that
 * stops being true two seconds later.
 */
export const RESTARTING = 'restarting';

/**
 * What a `restart()` resolves to once the plugin is disposed — said as
 * what happened, not as "restarting", which is what a queued restart used
 * to answer after teardown had already stopped everything.
 */
const GONE: Diagnostic = diagnostic(
  'error',
  'session',
  'e8-server',
  'the math engine is gone: its session was disposed before this restart ran',
  'nothing will restart it — start the dev host again',
);

export async function apply(ctx: Context, config: SessionConfig) {
  let handle: E8Handle | null = null;
  let startupDiagnostic: Diagnostic | null = null;
  // Flips once teardown has committed to stopping whatever `handle` names
  // at that moment — see the `ctx.effect` below and `boot()`'s own check
  // of it. Without it, a restart whose `startE8Server` call is still in
  // flight when disposal runs finishes AFTER teardown has already run
  // (`chain` below makes teardown WAIT for it, which closes most of that
  // race — see the effect's own comment for the remaining sliver this flag
  // closes).
  let disposed = false;

  /**
   * `reason` only changes the DIAGNOSTIC a failure produces, never the
   * spawn itself — `'start'` is this plugin's own first boot, `'restart'`
   * is every call `restart()` (below) makes through it. The distinction
   * matters because a restart's failure is not the same FACT as a first
   * boot's: the binary and `gamesDir` are exactly what they were a moment
   * ago when the process WAS running, so blaming them (the original
   * message) would name a cause the code has no reason to believe. See
   * `restart()`'s own doc for the one difference the failure text carries.
   */
  async function boot(reason: 'start' | 'restart'): Promise<void> {
    if (disposed) {
      // A restart still queued on `chain` when the disposer ran. Spawning
      // here would only be to stop the result a moment later (the branch
      // below), and each queued restart paid that in full — measured at
      // one extra spawn per queued call, and with a hung binary one whole
      // readiness timeout each before a Ctrl-C returned.
      handle = null;
      startupDiagnostic = GONE;
      return;
    }
    try {
      const spawned = await startE8Server(config);
      if (disposed) {
        // Teardown already ran and stopped whatever `handle` named at that
        // moment — this process finished spawning too late to have been
        // it, so nothing else is coming to stop it. It stops itself rather
        // than outliving a plugin that has already been disposed. Awaited,
        // not fire-and-forget: the effect's disposer chains onto THIS
        // `boot()` call through `chain` (see below), and a caller awaiting
        // `ctx.fiber.dispose()` is owed an actually-dead process by the
        // time that resolves, the same guarantee the ordinary stop path
        // already gives.
        try {
          await spawned.stop();
        } catch {
          // Best-effort, same as `doRestart`'s own `dying.stop()` below.
        }
        handle = null;
        startupDiagnostic = GONE;
        return;
      }
      handle = spawned;
      startupDiagnostic = null;
    } catch (error) {
      handle = null;
      const message = error instanceof Error ? error.message : String(error);
      startupDiagnostic =
        reason === 'start'
          ? diagnostic(
              'error',
              'session',
              'e8-server',
              `the math engine did not start: ${message}`,
              'check that an e8-server binary is reachable (binPath, E8_SERVER_BINARY, or PATH) and that gamesDir points directly at the folder holding the .spin file(s)',
            )
          : diagnostic(
              'error',
              'session',
              'e8-server',
              `the math engine failed to restart: ${message}`,
              restartFix(error),
            );
    }
  }

  /**
   * What a restart failure says to do about it, by what actually happened.
   * Only an exit by the process's own code is the `.spin`'s doing — that
   * is the compiler refusing what was just saved. A signal came from
   * outside, and a timeout means the process is there and silent; telling
   * a person to fix the file for either would name a cause the code does
   * not know, the same mistake the message itself stopped making one fix
   * ago. A spawn that fails is the binary's path, exactly as on first boot.
   */
  function restartFix(error: unknown): string | undefined {
    const kind = error instanceof StartFailure ? error.kind : undefined;
    switch (kind) {
      case 'exit':
        return 'the binary and games-dir did not change — fix the error in the .spin file that was just saved and save again';
      case 'signal':
        return 'the process was stopped by a signal, not by the script — save again to spawn it afresh';
      case 'timeout':
        return 'the process started but never answered — save again to spawn it afresh';
      case 'spawn':
        return 'check that an e8-server binary is still reachable (binPath, E8_SERVER_BINARY, or PATH)';
      default:
        return undefined;
    }
  }

  await boot('start');

  async function doRestart(): Promise<{ diagnostics: Diagnostic[] }> {
    const dying = handle;
    handle = null;
    // Visible to a `play()` racing this restart for the whole window
    // between here and `boot()` settling — see `play()`'s `!handle`
    // branch and this method's own doc comment on why that is fine.
    startupDiagnostic = {
      ...diagnostic(
        'error',
        'session',
        'e8-server',
        'the math engine is restarting',
        'wait for the restart to finish and try again',
      ),
      code: RESTARTING,
    };
    if (dying) {
      try {
        await dying.stop();
      } catch {
        // Best-effort: a process that will not stop cleanly still gets
        // replaced below — `boot()` binds a fresh pid regardless, and a
        // dying-but-not-dead old process is no worse than what teardown
        // already tolerates (SIGKILL after a timeout, inside `stop()`
        // itself).
      }
    }
    await boot('restart');
    return { diagnostics: startupDiagnostic ? [startupDiagnostic] : [] };
  }

  /**
   * Serializes every `restart()` call onto one queue. Without this, two
   * overlapping calls both read the SAME `handle` as "the one to stop"
   * (the second sees `null`, because the first already nulled it, and
   * skips its own stop), both spawn, and whichever `boot()` settles last
   * silently wins `handle` while the other's process is never referenced
   * again — measured directly: two concurrent `restart()` calls left two
   * live processes, and three staggered 5ms apart left three live with two
   * orphaned. Two quick saves from the editor is an entirely ordinary
   * gesture, not a contrived race. Chaining onto `chain` (rather than
   * awaiting a mutex) makes every call's own promise resolve to ITS turn's
   * result, in order, once every earlier turn has fully settled.
   */
  let chain: Promise<{ diagnostics: Diagnostic[] }> = Promise.resolve({ diagnostics: [] });

  // Reversible: unloading this plugin (or the app composing it) stops
  // whichever process is CURRENTLY running. Awaits `chain` FIRST — reading
  // `handle` synchronously here (as this used to) finds it transiently
  // `null` mid-restart (see `doRestart`, above) and stops nothing, leaving
  // the respawn it was mid-flight of running past disposal. `disposed` is
  // the one interleaving awaiting `chain` alone does not close: a
  // `restart()` call that starts its OWN new link on `chain` after this
  // disposer has already read the (now-stale) reference into its own
  // `.then()` — `boot()`'s own check of the flag is what stops that
  // respawn, not this line.
  ctx.effect(() => {
    return () => {
      disposed = true;
      return chain.then(() => handle?.stop());
    };
  }, 'session:e8-server');

  const service: SessionService = {
    get pid() {
      return handle?.pid ?? null;
    },
    get startupDiagnostic() {
      return startupDiagnostic;
    },
    restart() {
      chain = chain.then(doRestart);
      return chain;
    },
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
