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
 * task-8-report.md for the full finding.
 *
 * So it arrives the other way a value can reach a row: off `ctx`, from an
 * `assets` service somebody provided before this row applied. Today that
 * somebody is the caller (`createGame({ provide: { assets: { resolve } } })`
 * — the game's own page holds its art the same way it holds its `mount`);
 * tomorrow it can be an `assets` ROW, with no change here, which is
 * exactly the "art-supplying service `reels1` reads off `ctx`" that
 * `engine/examples/first-slot/e8.patch.yml` already names as the way out.
 * A `resolve` in the row's own config still wins, so a project that has
 * some other channel to a function keeps working.
 *
 * The read goes through `ctx.reflect.get('assets', false)`, not
 * `ctx.assets`: cordis throws on a plain property read of a registered
 * service this plugin did not `inject`, and a static `inject: ['assets']`
 * is worse than that — it would make a game with no art supplier hang
 * silently on a board that never builds instead of saying so.
 *
 * Deliberately **not** `inject: ['renderer']`/`['stage']`: the board's
 * construction needs no live renderer (measured headless — see
 * task-10-report.md), only mounting its view into the stage does, and
 * that half is ordered through `ctx.inject`, not a static dependency, so
 * it runs whenever `stage` appears and simply never runs when it does
 * not. A board nobody can see is still a board a headless play-through
 * can drive.
 */
import type { Context } from 'cordis';
import { createReelsBoard, type ReelsBoard } from './index';
import type { CreateReelSystemOptions, SymbolResolver } from '@energy8platform/game-engine/slot';

/** What this row needs from whoever supplies the game's art. */
export interface AssetsService {
  /** Turns a symbol id into the pixi view a player actually sees. */
  resolve: SymbolResolver;
}

declare module 'cordis' {
  interface Context {
    board: ReelsBoard;
    assets: AssetsService;
  }
}

export const name = 'reels';

/** `config` is `CreateReelSystemOptions` minus `resolve` — `{ config: { grid }, ... }` — see the module doc on where `resolve` comes from. `layer` names the stage layer to mount the board into; `'reels'` when absent. */
export function apply(
  ctx: Context,
  config: Partial<CreateReelSystemOptions> & { layer?: string },
): void {
  const assets = ctx.reflect.get('assets', false) as AssetsService | undefined;
  const resolve = config?.resolve ?? assets?.resolve;
  if (typeof resolve !== 'function') {
    throw new Error(
      'reels1 needs a symbol resolver: provide an `assets` service with resolve(symbolId), ' +
        'since no bundle/patch row can carry a function; see task-8-report.md',
    );
  }

  const board = createReelsBoard({ ...config, resolve } as CreateReelSystemOptions);
  ctx.effect(() => () => board.destroy(), 'reels:board');
  ctx.provide('board', board);
}
