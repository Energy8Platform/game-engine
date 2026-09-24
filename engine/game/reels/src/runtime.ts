/**
 * Runtime half of `reels` — the `reels1` row in `e8-base`.
 *
 * See `@energy8engine/renderer-pixi`'s `src/runtime.ts` module doc: this is
 * a real TypeScript module served through `dev-game`'s own vite instance,
 * not a hand-written, import-free twin — `createReelsBoard` (from `./index`)
 * pulls in `pixi.js` and `@energy8engine/reel-core` transitively, and vite
 * resolves both.
 *
 * **The row provides two services.** `board` (`ReelsBoard`, the `BoardApi`
 * play-loop drives) and `reels` — the `ReelSystem` underneath, which the
 * motion, anticipation and cascade rows `ctx.inject(['reels'], …)` to
 * register into. A hot re-apply builds a NEW reel system and provides it;
 * an `inject` callback runs again against it, so whatever those rows
 * register inside its `effect` lands on the new one. With no motion row,
 * a spin snaps to the result and the reel system's `report` says so — as
 * a `warning` from `reels` at `reels1` on the composition's `diagnostics`.
 *
 * **`config.resolve` has no home in a bundle or patch row.** Every other
 * field this row needs (`grid`, `win`, `board`) is plain YAML data; `resolve`
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
import { diagnostic } from '@energy8engine/contracts';
import type { DiagnosticsService } from '@energy8engine/diagnostics';
import { createReelsBoard, type ReelsBoard } from './index';
import type {
  CellData,
  DeepPartial,
  GridConfig,
  ReelSystem,
  SymbolResolver,
  WinConfig,
} from '@energy8engine/reel-core';
import type {} from '@energy8engine/scenes/runtime';

/** What this row needs from whoever supplies the game's art. */
export interface AssetsService {
  /** Turns a symbol id into the pixi view a player actually sees. */
  resolve: SymbolResolver;
}

declare module 'cordis' {
  interface Context {
    board: ReelsBoard;
    reels: ReelSystem;
    assets: AssetsService;
  }
}

/** The `reels1` row's config — `./schema.ts`'s `Config`. `resolve` may ride here too, from code; see the module doc. */
export interface ReelsRowConfig {
  grid?: DeepPartial<GridConfig>;
  win?: DeepPartial<WinConfig>;
  /** Initial board, board[col][row]; empty cells by default. */
  board?: CellData[][];
  resolve?: SymbolResolver;
}

export const name = 'reels';

/** `config` is flat — `{ grid, win, board }` — see the module doc on where `resolve` comes from. */
export function apply(ctx: Context, config: ReelsRowConfig): void {
  const assets = ctx.reflect.get('assets', false) as AssetsService | undefined;
  const resolve = config?.resolve ?? assets?.resolve;
  if (typeof resolve !== 'function') {
    throw new Error(
      'reels1 needs a symbol resolver: provide an `assets` service with resolve(symbolId), ' +
        'since no bundle/patch row can carry a function; see task-8-report.md',
    );
  }

  const board = createReelsBoard({
    resolve,
    grid: config?.grid,
    win: config?.win,
    board: config?.board,
    // Read per report, not captured: a `diagnostics` row may come and go around this one.
    report: (severity, message) =>
      (ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.report(
        diagnostic(severity, 'reels', 'reels1', message),
      ),
  });
  ctx.effect(() => () => board.destroy(), 'reels:board');
  ctx.provide('board', board);
  ctx.provide('reels', board.system);

  // `origin: 'center'` positions `board.view` at the grid's own
  // centre (`ReelGrid.geometry`) instead of reel 0's cell centre; `'cell'`
  // (the default) is the identity placement, `(0, 0)`.
  const place = (props: { origin?: 'cell' | 'center' }) => {
    const g = props.origin === 'center' ? board.grid.geometry : undefined;
    // `g ? -g.centerX : 0`, not `-(g?.centerX ?? 0)` — the latter negates the
    // `?? 0` fallback itself and hands back `-0`, which fails a strict
    // `toBe(0)` (Object.is) even though it moves the view nowhere.
    board.view.position.set(g ? -g.centerX : 0, g ? -g.centerY : 0);
  };

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
          // `board.view` is one persistent singleton — it cannot sit in two
          // mounted entries at once. `remountNode`/`setProps` (scenes.ts)
          // mount the FRESH entry before unmounting the old one whenever a
          // type has no `update`; for this type that ordering would tear
          // `board.view` back out of whichever wrapper just took it in (or,
          // going the other way, rip it out of the scene entirely). So both
          // origins get a wrapper (never a bare `board.view` mount), and an
          // origin toggle goes through `update` on the SAME wrapper instead
          // of a remount — the scenes runtime calls `update` in place of
          // mount+unmount for a type that declares one (`setProps`/
          // `applyVariant`, same file).
          mount: (props) => {
            board.view.parent?.removeChild(board.view);
            const wrap = new Container();
            wrap.addChild(board.view);
            place(props);
            return wrap;
          },
          update: (_view, props) => place(props),
          unmount: (view) => {
            view.parent?.removeChild(view);
            // Only touch `board.view` while it is still THIS wrapper's
            // child — a stale `unmount` (remount hazard above, or any
            // other type without `update` mounted fresh ahead of this
            // call landing) must not reach into a wrapper it no longer owns.
            if (board.view.parent === view) {
              view.removeChild(board.view);
              board.view.position.set(0, 0);
            }
            view.destroy();
          },
        }),
      'reels:node-type',
    );
  });
}
