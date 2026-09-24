/**
 * `giant { col, row, width, height, symbol }` — one view of `symbol` spanning the `width×height`
 * cells from `(col, row)`, scaling in over them while they hide. It lives on the row's overlay
 * layer until the next spin starts (the row calls `layer.clearGiants()` then) OR a
 * `giant { clear: true }` step names it explicitly — the form a mechanic plays before a
 * `tumble`/`reelStep`/`refill` touches the giant's area in the same plan, so the screen never
 * disagrees with the board mid-plan. A second area giant before either replaces the first. The
 * board takes `symbol` on every covered cell; `clear` changes no cell. Ported from the legacy
 * `GiantSymbol` demo (its footprint: `cellSize × width/height`, gaps ignored), minus its choice of
 * area and symbol and its hold-then-vanish.
 */
import { Container } from 'pixi.js';
import { easingByName, type CellData, type EasingName } from '@energy8engine/reel-core';
import { Tween } from '@energy8platform/game-engine/animation';
import { cellData, type BoardCell } from '@energy8engine/contracts';
import type { StepHandler } from '@energy8engine/play-loop';
import { createFeatureHandler, needLayer, type Change, type FeatureDeps } from '../shared';

export interface GiantStep {
  kind: 'giant';
  /** Clears every giant on the row's layer and re-shows the cells it hid; carries no area field. */
  clear?: true;
  /** The area's top-left cell. */
  col?: number;
  row?: number;
  /** In cells. */
  width?: number;
  height?: number;
  symbol?: number | string | BoardCell;
}

/** `GiantStep`'s area fields, once `changes` below has confirmed every one of them is there and fits. */
type GiantArea = Required<Pick<GiantStep, 'col' | 'row' | 'width' | 'height' | 'symbol'>>;

export interface GiantConfig {
  /** The scale-in. */
  ms: number;
  easing: EasingName;
}

export function createGiantHandler(deps: FeatureDeps<GiantConfig>): StepHandler {
  return createFeatureHandler<GiantStep, GiantConfig>('giant', deps, {
    changes({ clear, col, row, width, height, symbol }, grid) {
      needLayer('giant', deps);
      if (clear === true) {
        if ([col, row, width, height, symbol].some((v) => v !== undefined)) {
          throw new Error('giant: clear takes no area');
        }
        // no cell changes — nothing to re-seat; a no-op if no giant is up
        return [];
      }
      // `every(Number.isInteger)` short-circuits the rest when any of the four is undefined —
      // the `!`s below only assert what that guard already guarantees by the time they run.
      const fits =
        [col, row, width, height].every(Number.isInteger) &&
        col! >= 0 &&
        row! >= 0 &&
        width! >= 1 &&
        height! >= 1 &&
        col! + width! <= grid.cols &&
        // every covered reel tall enough (a ragged grid's short reel ends early)
        Array.from({ length: width! }, (_, i) => col! + i).every(
          (c) => row! + height! <= grid.rowsOf(c),
        );
      if (!fits) {
        throw new Error(
          `giant: the ${width}×${height} area at (${col}, ${row}) does not fit the grid`,
        );
      }
      // `fits` confirmed every field above is an integer in range — the area form proper
      const area = { col, row, width, height, symbol } as GiantArea;
      const data = cellData(area.symbol) as CellData;
      const changes: Change[] = [];
      for (let c = area.col; c < area.col + area.width; c++)
        for (let r = area.row; r < area.row + area.height; r++)
          changes.push({ col: c, row: r, data });
      return changes;
    },

    async animate(step, changes, { kit, pace, track }, cfg) {
      const layer = needLayer('giant', deps);
      if (step.clear === true) {
        layer.clearGiants();
        return;
      }
      // `changes` above already confirmed this is the area form
      const { col, row, width, height } = step as GiantArea;
      const { symbol } = changes[0].data;
      const view = symbol == null ? null : kit.resolve(symbol);
      // no art for it: no overlay, the covered cells just show `symbol` once re-seated
      if (!view) return;

      const cell = kit.grid.cellSize(col);
      view.resize?.({ width: cell.width * width, height: cell.height * height });
      const giant = new Container();
      giant.addChild(view);
      // the area's centre: midway between its first and last cells' centres
      const first = kit.grid.cellPosition(col, row);
      const last = kit.grid.cellPosition(col + width - 1, row + height - 1);
      giant.position.set((first.x + last.x) / 2, (first.y + last.y) / 2);
      giant.scale.set(0.2);
      giant.alpha = 0;

      layer.showGiant(giant);
      // after showGiant: it re-shows the previous giant's cells
      layer.hideForGiant(changes.map(({ col: c, row: r }) => kit.grid.getCell(c, r)));
      track(giant, () => {
        if (giant.destroyed) return;
        giant.scale.set(1);
        giant.alpha = 1;
      });
      await Tween.to(
        giant,
        { 'scale.x': 1, 'scale.y': 1, alpha: 1 },
        pace.ms(cfg.ms),
        easingByName(cfg.easing),
      );
    },
  });
}
