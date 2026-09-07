/**
 * `reel-step` — a mechanic that arrives as a PROJECT plugin, bringing the
 * step it needs with it.
 *
 * This directory is not installed, not published, and not a workspace. It is
 * `<project>/plugins/reel-step`, a folder placed by hand, which the host
 * resolves ahead of `node_modules` (see `readProjectPlugin` in the IDE
 * host's `resolvePackage.ts`). One row in `first-slot`'s `e8.patch.yml`
 * names it and one line binds `base_game` to it. Nothing in `engine/game/`
 * or `engine/core/` knows this exists.
 *
 * **Both halves are here, and that is the whole point.** `classic` and
 * `cascade` ship in the engine because they fit the six step kinds the board
 * already performs. `reel-step` does not fit them (see `./mechanic.ts`), so
 * it brings:
 *
 *  1. the **mechanic** — `{ id, requires, present }`, registered with
 *     `ctx.mechanics`, emitting steps of kind `reelStep`;
 *  2. the **step handler** — a `StepHandler` registered in a
 *     `BoardStepRegistry`, which knows how to run `reelStep` on a real reel
 *     board (`./step.ts`).
 *
 * **Where the registry comes from, and the one thing that is not settled.**
 * `executePlan(plan, board, registry?)` consults a registry only for kinds
 * the board has no method for — but no row in `e8-base` composes a registry,
 * and `@energy8engine/play-loop`'s runtime half provides only
 * `ctx.play.execute`. So the registry has to come from somewhere, and the
 * only two places it can are this plugin and the game's own page. This
 * plugin creates one and provides it as the `steps` service — reusing an
 * existing one if some other plugin got there first, so a second
 * step-bringing plugin does not collide on the service name — and
 * `first-slot`'s `main.ts` reads `steps` off the context and passes it to
 * `execute`. That handshake is a PROJECT convention, not an engine one:
 * nothing in the engine defines the name `steps` or requires anyone to pass
 * a registry at all. See task-8-9-report.md.
 *
 * **Reversibility (§5.4).** Both registrations go through `ctx.effect`, so a
 * row that leaves the composition takes its mechanic and its step handler
 * with it. `BoardStepRegistry.register` returns a plain disposer for exactly
 * this — it does no teardown of its own (its own doc says so), which is why
 * the wrapping is here and not there.
 *
 * **Nothing throws out of `apply`.** A missing service is reported from the
 * step that needed it (see `./step.ts`), not by refusing to compose: the
 * mechanic is pure and can register regardless, and a row that fails to
 * apply would leave `base_game` bound to an id nobody registered — a second,
 * less useful complaint about the same missing piece.
 */
import type { Context } from 'cordis';
// Type-only and fully erased — the same device `first-slot`'s `main.ts`
// uses. This is the module that DECLARES `ctx.mechanics` on cordis's
// `Context`; importing its types is not importing it, and nothing about
// this line pulls `game-runtime` into the browser bundle.
import type {} from '@energy8engine/game-runtime';
import { createBoardStepRegistry, type BoardStepRegistry } from '@energy8engine/play-loop';
import type { SymbolResolver } from '@energy8platform/game-engine/slot';
import { mechanic } from './mechanic';
import { createReelStepHandler, type CascadeOverride } from './step';

export { expects, mechanic, plan } from './mechanic';
export type { ReelStepRound, ReelStepStageData, ReelStepStep } from './mechanic';
export { createReelStepHandler } from './step';

export const name = 'reel-step';

export interface ReelStepRowConfig {
  /**
   * Overrides on the scroll's own timings and easings — the legacy
   * `CascadeConfig`, which drives `reelStep` as well as `cascade`. Shallow:
   * a row replaces a whole sub-object (`timings`, `easings`, `multiplier`),
   * not one leaf of it.
   */
  cascade?: CascadeOverride;
}

/** The name this plugin's `BoardStepRegistry` is provided under. A project convention — see the module doc. */
export const STEPS_SERVICE = 'steps';

/**
 * The registry every step-bringing plugin in this composition shares: the
 * one already on the context if there is one, a fresh one otherwise.
 *
 * `ctx.reflect.get(name, false)` rather than a property read, for the reason
 * `@energy8engine/reels` gives for the same call: cordis throws on a plain
 * read of a registered service a plugin did not `inject`, and "nobody
 * provided one" is the answer wanted here, not an exception.
 */
function sharedRegistry(ctx: Context): BoardStepRegistry {
  const existing = ctx.reflect.get(STEPS_SERVICE, false) as BoardStepRegistry | undefined;
  if (existing) return existing;
  const registry = createBoardStepRegistry();
  ctx.provide(STEPS_SERVICE, registry);
  return registry;
}

export function apply(ctx: Context, config: ReelStepRowConfig = {}): void {
  // Half one: the mechanic. Through `ctx.inject` rather than a static
  // `inject: ['mechanics']`, so this row composes whether or not a mechanics
  // registry is in the composition — and registers the moment one appears,
  // in either row order. `MechanicsService.bind` is written for exactly this
  // (its doc says binding a stage to an unregistered id is not a failure),
  // which is what lets `e8.patch.yml` bind `base_game` to `reel-step` from a
  // row that applies before this one.
  ctx.inject(['mechanics'], (mechanicsCtx) => {
    mechanicsCtx.effect(() => mechanicsCtx.mechanics.register(mechanic), 'reel-step:mechanic');
  });

  // Half two: the step. `resolve` is read per run, not captured here — see
  // `createReelStepHandler`.
  const registry = sharedRegistry(ctx);
  const handler = createReelStepHandler({
    resolve: () =>
      (ctx.reflect.get('assets', false) as { resolve?: SymbolResolver } | undefined)?.resolve,
    cascade: config.cascade,
  });
  ctx.effect(() => registry.register(handler), 'reel-step:step');
}
