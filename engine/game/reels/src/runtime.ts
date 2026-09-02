/**
 * Runtime half of `reels` — the `reels1` row in `e8-base`.
 *
 * See `@energy8engine/renderer-pixi`'s `src/runtime.ts` module doc: this is
 * a real TypeScript module served through `dev-game`'s own vite instance,
 * not a hand-written, import-free twin — `createReelsBoard` (from `./index`)
 * pulls in `pixi.js` and `@energy8platform/game-engine/slot` transitively,
 * and vite resolves both.
 *
 * **`config.resolve` has no home in a bundle or patch row.** Every other
 * field this row needs (`config.grid`, ...) is plain YAML data; `resolve`
 * — the `SymbolResolver` that turns a symbol id into the actual pixi view
 * a player sees — is a JavaScript function, the one piece of a real game's
 * own art this framework cannot ask a `.yml` file to hold. See
 * task-8-report.md for the full finding; this only guards it at the seam.
 *
 * Deliberately **not** `inject: ['renderer']`/`['stage']` — mirrors
 * `engine/game/runtime/src/plugins/reels.ts`'s reasoning: the board's
 * construction needs no live renderer (measured headless), only mounting
 * its view into the stage does, and that half is ordered through
 * `ctx.inject`, not a static dependency.
 */
import type { Context } from 'cordis';
import { createReelsBoard, type ReelsBoard } from './index';
import type { CreateReelSystemOptions } from '@energy8platform/game-engine/slot';
import type { Stage } from '@energy8engine/stage';

declare module 'cordis' {
  interface Context {
    board: ReelsBoard;
    stage: Stage;
  }
}

export const name = 'reels';

/** `config` is `CreateReelSystemOptions` — `{ resolve, config: { grid }, ... }` — see the module doc on `resolve`. */
export function apply(ctx: Context, config: CreateReelSystemOptions): void {
  if (typeof config?.resolve !== 'function') {
    throw new Error(
      'reels1 requires config.resolve (a SymbolResolver) — no bundle/patch row can supply a function; see task-8-report.md',
    );
  }

  const board = createReelsBoard(config);
  ctx.effect(() => () => board.destroy(), 'reels:board');
  ctx.provide('board', board);

  ctx.inject(['stage'], (stageCtx) => {
    stageCtx.stage.container.addChild(board.view);
  });
}
