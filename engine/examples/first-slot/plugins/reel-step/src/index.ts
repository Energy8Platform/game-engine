/**
 * `reel-step` — a mechanic that arrives as a PROJECT plugin; the step it
 * emits is performed by the engine's `cascade1` row.
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
 * **Only the mechanic is here now.** `classic` and `cascade` ship in the
 * engine because they fit the four step kinds the board already performs.
 * `reel-step` does not fit them (see `./mechanic.ts`), so it emits its own
 * step kind, `reelStep`, registered with `ctx.mechanics` as
 * `{ id, requires, present }`. The code that PERFORMS a `reelStep` used to
 * live here too (`./step.ts`, driving the legacy `ReelStepController`); it
 * is the engine's `cascade1` row now (`@energy8engine/reels-cascade`,
 * which registers the `reelStep` handler into play-loop's `ctx.steps` and
 * reads its timings from that row's config). So this plugin brings the part
 * the engine cannot know — which cells paid and how far each reel scrolls —
 * and the engine brings the part every scrolling mechanic shares.
 *
 * **Reversibility (§5.4).** Both registrations go through `ctx.effect`, so a
 * row that leaves the composition takes its mechanic and its claim on the
 * art with it.
 *
 * **Nothing throws out of `apply`.** The mechanic is pure and registers
 * regardless; a row that failed to apply would leave `base_game` bound to
 * an id nobody registered.
 *
 * **`e8.runtime.requires: ["mechanics"]`** (this package's own
 * `package.json`), alongside the `ctx.inject(['mechanics'], …)` below and
 * not instead of it. The two do different jobs: `inject` is what keeps this
 * row from throwing when `mechanics1` composes in either order, or not at
 * all — its callback simply never runs. `requires` is what says so, once,
 * to a person: an `inject` callback that silently never fires looks
 * identical to one doing its job quietly, and `@energy8engine/game-runtime`'s
 * `createGame` is what turns that silence into a diagnostic. (It listed
 * `steps` too while the step handler lived here; a missing `steps` is now
 * `cascade1`'s to report.)
 */
import type { Context } from 'cordis';
// Type-only and fully erased — the same device `first-slot`'s `main.ts`
// uses. This is the module that DECLARES `ctx.mechanics` on cordis's
// `Context`; importing its types is not importing it, and nothing about
// this line pulls `game-runtime` into the browser bundle.
import type {} from '@energy8engine/game-runtime';
import { mechanic } from './mechanic';

export { expects, mechanic, plan } from './mechanic';
export type { ReelStepRound, ReelStepStageData, ReelStepStep } from './mechanic';

export const name = 'reel-step';

export function apply(ctx: Context): void {
  // The mechanic. Through `ctx.inject` rather than a static
  // `inject: ['mechanics']`, so this row composes whether or not a mechanics
  // registry is in the composition — and registers the moment one appears,
  // in either row order. `MechanicsService.bind` is written for exactly this
  // (its doc says binding a stage to an unregistered id is not a failure),
  // which is what lets `e8.patch.yml` bind `base_game` to `reel-step` from a
  // row that applies before this one.
  ctx.inject(['mechanics'], (mechanicsCtx) => {
    mechanicsCtx.effect(() => mechanicsCtx.mechanics.register(mechanic), 'reel-step:mechanic');
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
