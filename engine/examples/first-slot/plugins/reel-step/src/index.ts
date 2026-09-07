/**
 * `reel-step` — a mechanic that arrives as a PROJECT plugin, bringing the
 * step it needs with it.
 *
 * This directory is not installed, not published, and not a workspace. It is
 * `<project>/plugins/reel-step`, a folder placed by hand, which the host
 * resolves ahead of `node_modules`. One row in `first-slot`'s
 * `e8.patch.yml` names it and one line binds `base_game` to it. Nothing in
 * `engine/game/` or `engine/core/` knows this exists.
 *
 * The convention in full — where the directory goes, why its name must
 * match the row's, what `e8.runtime.entry` may point at, and what a patch
 * row needs — is written down on `@energy8engine/contracts`' `manifest.ts`,
 * which is the file you read to write the `package.json` next to this one.
 * (`readProjectPlugin` in the IDE host's `resolvePackage.ts` is what
 * implements it, but a project does not depend on that package.)
 *
 * **Not a workspace, and still gated.** The root workspace glob reaches
 * `first-slot` and stops there — it matches two levels under `engine/`, and
 * this is three — so this directory's own tests and typecheck ran only by
 * hand for a while. `first-slot`'s `package.json` now delegates both to it
 * (`npm --prefix plugins/reel-step ...`), so the artifact that proves this
 * slice's claim is checked by the same command that checks the project
 * around it — without becoming an installed package and quietly weakening
 * the "resolves with no install" half of that claim.
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
 * **Where the registry comes from.** `ctx.steps`, composed by the
 * `playloop1` row (`@energy8engine/play-loop`'s runtime half) — the same
 * registry `ctx.play.execute` consults by default. So this plugin registers
 * a handler and the game's page keeps calling
 * `ctx.play.execute(plan, board)` with two arguments, exactly as it did
 * before any of this existed. Nothing about the wiring is this project's to
 * arrange: no service to create, no name to agree on, no argument to
 * thread through the page. (It was, briefly — see task-8-9-report.md for
 * the round in which the registry was composed by nobody and this plugin
 * had to invent the handshake.)
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
// The module that DECLARES `ctx.steps` and `ctx.play` on cordis's
// `Context`. Type-only and erased, same as the `game-runtime` line above —
// this plugin reaches the registry off the composed context, it does not
// import the play loop.
import type {} from '@energy8engine/play-loop/runtime';
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

  // Half two: the step, into the registry `playloop1` composed. Same
  // `ctx.inject` shape and the same reason as the mechanic above — the row
  // order between this plugin and the play loop is not this plugin's to
  // assume. `resolve` is read per run, not captured here; see
  // `createReelStepHandler`.
  const handler = createReelStepHandler({
    resolve: () =>
      (ctx.reflect.get('assets', false) as { resolve?: SymbolResolver } | undefined)?.resolve,
    cascade: config.cascade,
  });
  ctx.inject(['steps'], (stepsCtx) => {
    stepsCtx.effect(() => stepsCtx.steps.register(handler), 'reel-step:step');
  });
}
