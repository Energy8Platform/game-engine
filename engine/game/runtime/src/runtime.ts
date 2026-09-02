/**
 * Runtime half of `@energy8engine/game-runtime` — the `mechanics1` row in
 * `e8-base`. Not the whole package: `./index.ts`'s `createGame` is the
 * host-side orchestrator Task 9 is retiring; this file is only the ONE
 * piece of `createGame`'s current body that is genuinely its own
 * standalone capability — the per-stage mechanic registry
 * (`./plugins/mechanics.ts`) plus registering the two mechanics this
 * package always ships.
 *
 * See `@energy8engine/renderer-pixi`'s `src/runtime.ts` module doc: this
 * is a real TypeScript module served through `dev-game`'s own vite
 * instance, not a hand-written, import-free twin — `@energy8engine/
 * mechanic-classic`/`mechanic-cascade` and `@energy8engine/contracts` all
 * resolve through it.
 *
 * Reuses `./plugins/mechanics.ts` directly (a plain function call, not
 * `ctx.plugin()` — same trick `dev-game.ts` uses for `session-dev`, see
 * its module doc: a plain call lets `mechanics.apply()`'s own
 * `ctx.provide('mechanics', ...)` land on THIS scope, which this file can
 * then read straight back) rather than re-deriving the registry's logic a
 * second time.
 *
 * This row does not fail on a stage bound to a mechanic it does not ship.
 * It used to — it handed the registry a throwaway diagnostics array and
 * threw whatever landed there — and that made the composition's central
 * promise read as broken: a third-party row registering `acme`, plus a
 * patch binding `base_game` to it, WORKED (the binding resolves as soon
 * as the other row lands, in either order) while this row was reported
 * failed, so with a mount the failure screen painted over a game that was
 * running fine. See `./plugins/mechanics.ts`'s `bind` for where that
 * complaint moved to, and why bind time could never have answered it.
 */
import type { Context } from 'cordis';
import { mechanic as classicMechanic } from '@energy8engine/mechanic-classic';
import { mechanic as cascadeMechanic } from '@energy8engine/mechanic-cascade';
import * as mechanicsPlugin from './plugins/mechanics';

export const name = 'mechanics';

export interface MechanicsRowConfig {
  /** stage id → mechanic id, applied to the two mechanics this row always registers (`classic`, `cascade`). */
  stages?: Record<string, string>;
}

export function apply(ctx: Context, config: MechanicsRowConfig = {}): void {
  mechanicsPlugin.apply(ctx);

  ctx.mechanics.register(classicMechanic);
  ctx.mechanics.register(cascadeMechanic);
  for (const [stage, mechanicId] of Object.entries(config.stages ?? {})) {
    // Binding a stage to a mechanic THIS row does not ship is the whole
    // point of a per-stage registry: a third-party row registers `acme`
    // and a patch binds `base_game` to it, in either order. So this does
    // not fail when the id is not registered yet — it cannot know whether
    // some other row is about to. See `plugins/mechanics.ts`'s `bind`.
    ctx.mechanics.bind(stage, mechanicId);
  }
}
