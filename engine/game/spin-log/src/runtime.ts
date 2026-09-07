/**
 * Runtime half of `spin-log` — the `spinlog1` row in `e8-base`.
 *
 * See `@energy8engine/renderer-pixi`'s `src/runtime.ts` module doc: this is
 * a real TypeScript module served through `dev-game`'s own vite instance.
 *
 * All it does is put one `SpinLog` on the context. The log itself has no
 * dependency on cordis (see `./index.ts`), which is what lets a
 * simulation, a test, or a future host-side recorder use the same one
 * without composing anything.
 *
 * **Optional, and meant to be.** Nothing in the engine requires this row.
 * A composition without it is a game that keeps no record — which is the
 * whole of what changes: `@energy8engine/play-loop`'s `record()` looks the
 * service up per call and does nothing when it isn't there, so no caller
 * has to ask whether the log exists.
 *
 * `config` is unused — the log has no settings.
 */
import type { Context } from 'cordis';
import { createSpinLog, type SpinLog } from './index';

declare module 'cordis' {
  interface Context {
    /** The durable record of spins — see `@energy8engine/spin-log`. Absent when no `spin-log` row is composed. */
    spinLog: SpinLog;
  }
}

export const name = 'spin-log';

export function apply(ctx: Context): void {
  ctx.provide('spinLog', createSpinLog());
}
