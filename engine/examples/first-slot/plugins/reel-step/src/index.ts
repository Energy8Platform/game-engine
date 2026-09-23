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
 * `cascade` ship in the engine because they fit the four step kinds the
 * board already performs. `reel-step` does not fit them (see `./mechanic.ts`), so
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
 * **Reversibility (§5.4).** All three registrations go through `ctx.effect`,
 * so a row that leaves the composition takes its mechanic, its step handler
 * and its claim on the art with it. `BoardStepRegistry.register` returns a
 * plain disposer for exactly this — it does no teardown of its own (its own
 * doc says so), which is why the wrapping is here and not there.
 *
 * **Nothing throws out of `apply`.** A missing service is reported from the
 * step that needed it (see `./step.ts`), not by refusing to compose: the
 * mechanic is pure and can register regardless, and a row that fails to
 * apply would leave `base_game` bound to an id nobody registered — a second,
 * less useful complaint about the same missing piece.
 *
 * **`e8.runtime.requires: ["mechanics", "steps"]`** (this package's own
 * `package.json`), alongside the two `ctx.inject(…)` calls below and not
 * instead of them. The two do different jobs: `inject` is what keeps this
 * row from throwing when `mechanics1` or `playloop1` composes in either
 * order, or not at all — its callback simply never runs. `requires` is
 * what says so, once, to a person: an `inject` callback that silently
 * never fires looks identical to one doing its job quietly, and
 * `@energy8engine/game-runtime`'s `createGame` is what turns that silence
 * into a diagnostic — checked once, after the whole composition has
 * applied, never as a reason to reorder anything.
 *
 * Both halves, because the argument above is the same word for word for
 * each of them. It listed only `mechanics` for a while, on the reasoning
 * that a missing `steps` is really `playloop1`'s absence and so somebody
 * else's story to tell. Nobody else tells it: no row declares what it
 * PROVIDES, so nothing derives "the step registry is gone" from
 * `playloop1` being gone, and a game's page can only ever speak for the
 * services IT reads — `first-slot`'s page happens to read `ctx.play`, but
 * a game that never calls `execute` itself would leave this row's silence
 * the only evidence there was. Measured with `playloop1` removed: the
 * screen now carries `the "reelstep1" row requires "steps"` alongside the
 * page's own complaint, so the row that cannot do its job is named by
 * itself rather than inferred from a neighbour.
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

  // And the art. A row that draws with a path NO document names has to say
  // so, or the batch never asks for it and the texture draws as nothing —
  // the silent failure `scenes.require` exists for (and the one the loader's
  // own `nothing loaded "…"` warning names when a row forgets).
  //
  // `assets/coin.png` is this project's spritesheet image. `assets/coin.json`
  // names it internally, but the scenes loader never sees that: pixi's
  // spritesheet parser pulls the image through its Loader rather than
  // `Assets.load`, so nothing ever puts that path in the Assets cache.
  // Which makes it exactly the shape of path this call is for — a real
  // file in the project that no scene, symbol or flow document mentions.
  // This mechanic scrolls with the symbol art `symbols1` already loads and
  // has nothing else of its own to claim, so the claim here stands in for
  // that art; a mechanic that really did blit a coin over a scrolling reel
  // would write the same line for the same reason.
  //
  // Through `ctx.effect`, so the claim dies with the row: the disposer
  // `require` returns drops the holder, and the next unload sweep lets the
  // path go. And `reflect.get('scenes', false)`, like every other lenient
  // read on this page — a composition with no `scenes` row composes this
  // one unchanged, it simply has nothing to tell.
  ctx.effect(
    () =>
      (ctx.reflect.get('scenes', false) as RequiresAssets | undefined)?.require([
        'assets/coin.png',
      ]) ?? (() => {}),
    'reel-step:assets',
  );
}

/**
 * As much of `@energy8engine/scenes`' `ScenesService` as this row uses —
 * structural, so this plugin depends on that package no more than
 * `first-slot`'s own `main.ts` does (which reads `scenes` the same way).
 */
interface RequiresAssets {
  require(paths: string[]): () => void;
}
