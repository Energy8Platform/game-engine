/**
 * Runtime half of `diagnostics` — the `diagnostics1` row in `e8-base`.
 *
 * See `@energy8engine/spin-log`'s `src/runtime.ts` module doc: this is a
 * real TypeScript module served through `dev-game`'s own vite instance.
 *
 * All it does is put one `DiagnosticsService` on the context. The service
 * itself has no dependency on cordis (see `./index.ts`), which is what lets
 * a test, a simulation, or a future host-side collector use the same one
 * without composing anything.
 *
 * **First in `e8-base`, and that position is load-bearing.** Rows apply in
 * composition order, one at a time, and every OTHER row — `boot1` included,
 * which reports its own troubles the same as anything else — may want
 * `ctx.diagnostics` to already exist by the time IT applies. Putting this
 * row first is what makes that true; `engine/game/runtime/tests/
 * compose.test.ts` pins the position on the bundle file itself, not on this
 * comment.
 *
 * **Optional, and meant to be.** Nothing in the engine requires this row. A
 * composition without it is a game that keeps no live diagnostics list —
 * which is the whole of what changes: `@energy8engine/game-runtime`'s
 * `createGame` still returns `GameApp.diagnostics` (the array it always
 * collected), and every producer that writes to `ctx.diagnostics` directly
 * (see task-2-3-report.md) looks the service up per call and does nothing
 * when it isn't there. The row costs the panel, never the game.
 *
 * `config` is unused — the service has no settings.
 */
import type { Context } from 'cordis';
import { createDiagnostics, type DiagnosticsService } from './index';

declare module 'cordis' {
  interface Context {
    /** The live diagnostics list — see `@energy8engine/diagnostics`. Absent when no `diagnostics` row is composed. */
    diagnostics: DiagnosticsService;
  }
}

export const name = 'diagnostics';

export function apply(ctx: Context): void {
  ctx.provide('diagnostics', createDiagnostics());
}
