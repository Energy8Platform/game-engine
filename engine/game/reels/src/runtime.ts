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
 * Deliberately **not** `inject: ['renderer']`/`['nodeTypes']`: the board's
 * construction needs no live renderer (measured headless — see
 * task-10-report.md), and reaching the screen at all is a `scenes`
 * document's decision, not this row's. So the board only ever registers a
 * `reels` node type (`@energy8engine/scenes`'s `NodeTypesService`) whose
 * `mount` hands out `board.view`; that registration is ordered through
 * `ctx.inject`, not a static dependency, so it runs whenever `nodeTypes`
 * appears (and again on a hot re-apply, since `apply` runs fresh with a
 * new `board`) and simply never runs when it does not. A board nobody can
 * see is still a board a headless play-through can drive.
 */
import type { Context } from 'cordis';
import Schema from 'schemastery';
import { Container } from 'pixi.js';
import { createReelsBoard, type ReelsBoard } from './index';
import type { CreateReelSystemOptions, SymbolResolver } from '@energy8platform/game-engine/slot';
import type {} from '@energy8engine/scenes/runtime';

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

/** `config` is `CreateReelSystemOptions` minus `resolve` — `{ config: { grid }, ... }` — see the module doc on where `resolve` comes from. */
export function apply(ctx: Context, config: Partial<CreateReelSystemOptions>): void {
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

  // The board reaches the screen only through a `reels` scene node
  // (`@energy8engine/scenes`): registered whenever `nodeTypes` is on the
  // context, again on a hot re-apply (a new board), taken back on dispose.
  ctx.inject(['nodeTypes'], (typesCtx) => {
    typesCtx.effect(
      () =>
        typesCtx.nodeTypes.register({
          type: 'reels',
          schema: Schema.object({
            row: Schema.string().default('reels1').description('the reels row this node shows'),
            origin: Schema.union(['cell', 'center'])
              .default('cell')
              .description("what x/y name: reel 0's cell centre (the board's own origin) or the board's centre"),
          }),
          mount: (props) => {
            board.view.parent?.removeChild(board.view);
            if (props.origin !== 'center') return board.view;
            const g = board.grid.geometry;
            board.view.position.set(-(g?.centerX ?? 0), -(g?.centerY ?? 0));
            const wrap = new Container();
            wrap.label = 'reels:center';
            wrap.addChild(board.view);
            return wrap;
          },
          unmount: (view) => {
            view.parent?.removeChild(view);
            if (view === board.view) return;
            board.view.position.set(0, 0);
            board.view.parent?.removeChild(board.view);
            view.destroy();
          },
        }),
      'reels:node-type',
    );
  });
}
