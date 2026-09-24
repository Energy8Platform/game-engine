/**
 * `giant { col, row, width, height, symbol }` — one view of `symbol` spanning the `width×height`
 * cells from `(col, row)`, scaling in over them while they hide. It lives on the row's overlay
 * layer until the next spin starts (the row calls `layer.clearGiants()` then); a second giant
 * before that replaces it. The board takes `symbol` on every covered cell. Ported from the legacy
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
  /** The area's top-left cell. */
  col: number;
  row: number;
  /** In cells. */
  width: number;
  height: number;
  symbol: number | string | BoardCell;
}

export interface GiantConfig {
  /** The scale-in. */
  ms: number;
  easing: EasingName;
}

export function createGiantHandler(deps: FeatureDeps<GiantConfig>): StepHandler {
  return createFeatureHandler<GiantStep, GiantConfig>('giant', deps, {
    changes({ col, row, width, height, symbol }, grid) {
      needLayer('giant', deps);
      const fits =
        [col, row, width, height].every(Number.isInteger) &&
        col >= 0 &&
        row >= 0 &&
        width >= 1 &&
        height >= 1 &&
        col + width <= grid.cols &&
        // every covered reel tall enough (a ragged grid's short reel ends early)
        Array.from({ length: width }, (_, i) => col + i).every(
          (c) => row + height <= grid.rowsOf(c),
        );
      if (!fits) {
        throw new Error(
          `giant: the ${width}×${height} area at (${col}, ${row}) does not fit the grid`,
        );
      }
      const data = cellData(symbol) as CellData;
      const changes: Change[] = [];
      for (let c = col; c < col + width; c++)
        for (let r = row; r < row + height; r++) changes.push({ col: c, row: r, data });
      return changes;
    },

    async animate({ col, row, width, height }, changes, { kit, pace, track }, cfg) {
      const layer = needLayer('giant', deps);
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
