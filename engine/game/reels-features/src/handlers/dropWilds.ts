/**
 * `dropWilds { cells, symbol, multiplier? }` — `symbol` drops into each cell from above, the cells
 * started `staggerMs` apart. Ported from the legacy `RandomWild` demo, minus its choice of cells.
 */
import { dropCell, type CellData } from '@energy8engine/reel-core';
import { Tween } from '@energy8platform/game-engine/animation';
import { cellData, type BoardCell } from '@energy8engine/contracts';
import type { StepHandler } from '@energy8engine/play-loop';
import { checkCells, createFeatureHandler, type Cell, type FeatureDeps } from '../shared';

export interface DropWildsStep {
  kind: 'dropWilds';
  cells: Cell[];
  symbol: number | string | BoardCell;
  /** Rides on each dropped cell's data (its badge). */
  multiplier?: number;
}

export interface DropWildsConfig {
  /** One cell's drop. */
  ms: number;
  /** Between one cell's drop starting and the next one's. */
  staggerMs: number;
}

export function createDropWildsHandler(deps: FeatureDeps<DropWildsConfig>): StepHandler {
  return createFeatureHandler<DropWildsStep, DropWildsConfig>('dropWilds', deps, {
    changes({ cells, symbol, multiplier }, grid) {
      checkCells('dropWilds', grid, cells);
      const data: CellData = {
        ...(cellData(symbol) as CellData),
        ...(multiplier !== undefined && { multiplier }),
      };
      return cells.map(({ col, row }) => ({ col, row, data }));
    },

    async animate(_step, changes, { kit, cell, pace }, cfg) {
      await Promise.all(
        changes.map(async ({ col, row, data }, i) => {
          if (i > 0) {
            await Tween.delay(pace.ms(cfg.staggerMs * i));
            if (pace.skipped) return;
          }
          const target = cell(col, row);
          target.setData(data);
          await dropCell(kit.grid, target, col, row, pace.ms(cfg.ms));
        }),
      );
    },
  });
}
