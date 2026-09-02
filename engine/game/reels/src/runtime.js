/**
 * Runtime half of `reels` — the cordis wiring around `./index.ts`'s
 * `createReelsBoard`/`boardFromReelSystem`, browser-loadable.
 *
 * See `@energy8engine/boot`'s `src/runtime.js` module doc for why this
 * file's bare imports do not actually resolve yet over
 * `GET /plugin-runtime/:id`.
 *
 * **`config.resolve` has no home in a bundle or patch row.** Every other
 * field this row needs (`config.grid`, ...) is plain YAML data; `resolve`
 * — the `SymbolResolver` that turns a symbol id into the actual pixi view
 * a player sees — is a JavaScript function, the one piece of a real
 * game's own art this framework cannot ask a `.yml` file to hold. Today
 * (`engine/examples/first-slot/src/main.ts`) it is supplied by hand,
 * straight into `createGame`'s JS object, alongside the DOM `mount`. This
 * row's `apply()` still accepts `config.resolve` for shape-parity with
 * `./index.ts`'s options, but nothing in the bundle/patch format can ever
 * populate it — see task-8-report.md, which flags this for Task 9. The
 * design doc's own `plugins/<name>/` ("local plugins, written by hand")
 * reads like the intended home for a project's real symbol art, but no
 * mechanism wires a local plugin's output into another row's `config` yet
 * — that plumbing does not exist today either.
 *
 * Deliberately **not** `inject: ['renderer']`/`['stage']` — mirrors
 * `engine/game/runtime/src/plugins/reels.ts`'s reasoning: the board's
 * *construction* needs no live renderer (measured headless, see that
 * file's module doc), only mounting its view into the stage does, and
 * that half is ordered through `ctx.inject`, not a static dependency.
 */
import { MultiplierAccumulator, createReelSystem } from '@energy8platform/game-engine/slot';

export const name = 'reels';

function toCellBoard(board) {
  return board.map((col) => col.map((symbolId) => ({ symbol: String(symbolId) })));
}

function boardFromReelSystem(reelSystem, multiplier) {
  return {
    async spinTo(step) {
      await reelSystem.spin(toCellBoard(step.board));
    },
    async revealWins(step) {
      const cells = step.lines.flatMap((line) => line.positions);
      await Promise.all(
        cells.map(({ col, row }) => {
          const cell = reelSystem.grid.getCell(col, row);
          cell.setState({ winning: true });
          return cell.playWin();
        }),
      );
    },
    async remove(step) {
      if (step.cells.length === 0) return;
      for (const { col, row } of step.cells) {
        const cell = reelSystem.grid.getCell(col, row);
        cell.setState({ removed: true });
        cell.setData({ symbol: null });
      }
      const snapshot = reelSystem.board.map((col) => col.map((cell) => ({ ...cell })));
      for (const { col, row } of step.cells) {
        if (snapshot[col]?.[row]) snapshot[col][row] = { symbol: null };
      }
      reelSystem.setBoard(snapshot);
    },
    async refill(step) {
      reelSystem.setBoard(toCellBoard(step.board));
    },
    async setMultiplier(step) {
      multiplier.set(step.value);
    },
    async wait(step) {
      await new Promise((resolve) => setTimeout(resolve, step.ms));
    },
  };
}

/** `config` is `CreateReelSystemOptions` — `{ resolve, config: { grid }, ... }` — see the module doc on `resolve`. */
export function apply(ctx, config) {
  if (typeof config?.resolve !== 'function') {
    throw new Error(
      'reels1 requires config.resolve (a SymbolResolver) — no bundle/patch row can supply a function; see task-8-report.md',
    );
  }

  const reelSystem = createReelSystem(config);
  const acc = new MultiplierAccumulator({ policy: 'spin' });
  const api = boardFromReelSystem(reelSystem, acc);

  const board = {
    ...api,
    view: reelSystem.view,
    grid: reelSystem.grid,
    get multiplier() {
      return acc.value;
    },
    destroy() {
      reelSystem.destroy();
    },
  };

  ctx.effect(() => () => board.destroy(), 'reels:board');
  ctx.provide('board', board);

  ctx.inject(['stage'], (stageCtx) => {
    stageCtx.stage.container.addChild(board.view);
  });
}
