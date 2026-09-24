/**
 * `expandWild { reel, symbol, rows? }` — the reel (or just `rows` of it) turns into `symbol`, top
 * to bottom: each cell morphs, then gets a glow ring; the rings hold for `holdMs` and go. Ported
 * from the legacy `ExpandingWild` demo, minus its choice of reel — the mechanic makes that one.
 */
import { morphSymbol, type CellData } from '@energy8engine/reel-core';
import { Tween } from '@energy8platform/game-engine/animation';
import { cellData, type BoardCell } from '@energy8engine/contracts';
import type { StepHandler } from '@energy8engine/play-loop';
import { checkCells, createFeatureHandler, type FeatureDeps } from '../shared';

export interface ExpandWildStep {
  kind: 'expandWild';
  reel: number;
  /** A symbol id, a name, or a record — `cellData()` takes it, extras and all. */
  symbol: number | string | BoardCell;
  /** Which rows of the reel; the whole reel when absent. */
  rows?: number[];
}

export interface ExpandWildConfig {
  /** One row's morph. */
  ms: number;
  /** How long the rings stay once the last row has turned. */
  holdMs: number;
  ringColor: number;
}

export function createExpandWildHandler(deps: FeatureDeps<ExpandWildConfig>): StepHandler {
  return createFeatureHandler<ExpandWildStep, ExpandWildConfig>('expandWild', deps, {
    changes({ reel, symbol, rows }, grid) {
      if (!Number.isInteger(reel) || reel < 0 || reel >= grid.cols) {
        throw new Error(`expandWild: reel ${reel} is outside the grid`);
      }
      const cells = (rows ?? Array.from({ length: grid.rowsOf(reel) }, (_, row) => row)).map(
        (row) => ({ col: reel, row }),
      );
      checkCells('expandWild', grid, cells, 'rows');
      const data = cellData(symbol) as CellData;
      return cells.sort((a, b) => a.row - b.row).map((cell) => ({ ...cell, data }));
    },

    async animate(_step, changes, { cell, ring, pace }, cfg) {
      for (const { col, row, data } of changes) {
        await morphSymbol(cell(col, row), data, pace.ms(cfg.ms));
        if (pace.skipped) return;
        ring(col, row, cfg.ringColor);
      }
      await Tween.delay(pace.ms(cfg.holdMs));
    },
  });
}
