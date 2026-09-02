/**
 * Runtime half of `boot` — the `boot1` row in `e8-base`.
 *
 * This row provides a capability and decides nothing. The orchestration
 * `./index.ts` used to carry (a `start()` callback, a shared mutable
 * `diagnostics` array) is gone entirely: it belonged to the hand-wired
 * `createGame`, and neither of those things can travel in a bundle/patch
 * row's static YAML `config` anyway (see task-8-report.md's Finding 1).
 * What survives is the one piece of `boot`'s old job no OTHER row can do
 * — turning a diagnostics list into text a person can actually see.
 *
 * The one thing this row can never be handed through `config` either way
 * is the mount: a live DOM element, the same "no home in YAML" class as
 * `reels1`'s `resolve`. So **provide a service, let the caller supply the
 * mount.** `@energy8engine/game-runtime`'s `createGame` is that caller: it
 * holds `#mount` (a page-level concern, never composition data) and the
 * full diagnostics list `composeFromProject` returns, and calls
 * `ctx.boot.renderFailure(mount, diagnostics)` once composition finishes
 * and something has an `error` in it.
 *
 * Because this row can be REPLACED — a project shipping its own branded
 * failure screen is the point of it being a row — `createGame` calls it
 * inside a try/catch and falls back to importing `renderBootFailure`
 * directly. A failure screen that throws must not be able to blank the
 * page it was supposed to explain.
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
