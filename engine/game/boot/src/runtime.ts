/**
 * Runtime half of `boot` — the `boot1` row in `e8-base`.
 *
 * `./index.ts`'s `apply(ctx, config)` is a different module for a
 * different job: it is the ORCHESTRATOR the old, hand-wired `createGame`
 * (`@energy8engine/game-runtime`'s `src/index.ts`) still composes today —
 * it needs a live `config.start()` callback and a shared, mutable
 * `config.diagnostics` array, neither of which a bundle/patch row's
 * static YAML `config` can ever supply (see task-8-report.md's Finding 1).
 * Pointing `e8.runtime.entry` at that module was this task's first
 * mistake: `boot1`'s row config is `{}`, so `config.diagnostics` is
 * `undefined`, and `apply`'s first line (`hasError(config.diagnostics)` →
 * `config.diagnostics.some(...)`) throws a `TypeError` immediately, on
 * every single load, with no diagnostic to show for it (compounded by the
 * loader not awaiting `apply` at the time — see `engine/game/loader/src/
 * index.ts`, fixed alongside this file).
 *
 * `./index.ts` stays exactly as it is — `game-runtime/src/index.ts`
 * still imports and composes it via `ctx.plugin(boot, {...})` for the old
 * `createGame` path, which Task 9 is the one that retires. Nothing here
 * touches it.
 *
 * This row's actual job, once the loader (not `createGame`) is the thing
 * applying rows: the orchestration `./index.ts` was written for no
 * longer exists on this path — the loader just walks the row list and
 * calls each `apply()` in order; nothing here calls a `start()`. What
 * survives is the one piece of `boot`'s old job that cannot be done by
 * any OTHER row — turning a diagnostics list into text a person can
 * actually see — and the one thing this row can never be handed through
 * `config` either way: the mount is a live DOM element, the same "no home
 * in YAML" class as `reels1`'s `resolve` (see task-8-report.md again).
 *
 * So: **provide a service, let the caller supply the mount.** Task 9 —
 * whatever replaces `main.ts`'s current boot-time wiring — is that
 * caller: it already knows `#mount` (a page-level concern, never
 * composition data) and already collects the full diagnostics list
 * `composeFromProject` returns; this service is the one missing piece
 * between those two facts.
 */
import type { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import { renderBootFailure } from './index';

export interface BootService {
  /**
   * Renders `diagnostics` into `root` as plain readable text — replacing
   * whatever `root` held before. Exactly `./index.ts`'s
   * `renderBootFailure`, re-exposed here rather than reimplemented: now
   * that a runtime half is real TypeScript served through `dev-game`'s
   * vite instance (not a hand-written, import-free twin — see
   * task-8-report.md's appended finding), importing the real function
   * costs nothing and cannot drift out of sync with it.
   */
  renderFailure(root: HTMLElement, diagnostics: Diagnostic[]): void;
}

declare module 'cordis' {
  interface Context {
    boot: BootService;
  }
}

export const name = 'boot';

/** `config` is unused — this row has no settings, only a capability. */
export function apply(ctx: Context): void {
  ctx.provide('boot', { renderFailure: renderBootFailure });
}
