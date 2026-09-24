/**
 * `walkWild { path, symbol }` — `symbol` morphs in at `path[0]`, then walks cell to cell along the
 * path, a glow ring on the cell it is entering; each cell it leaves is emptied. Ported from the
 * legacy `WalkingWild` demo, minus its choice of start, direction and stride — the path is the
 * mechanic's.
 */
import { moveCell, morphSymbol, type CellData, type EasingName } from '@energy8engine/reel-core';
import { cellData, type BoardCell } from '@energy8engine/contracts';
import type { StepHandler } from '@energy8engine/play-loop';
import { checkCells, createFeatureHandler, type Cell, type FeatureDeps } from '../shared';

export interface WalkWildStep {
  kind: 'walkWild';
  /** Where the symbol appears, then every cell it steps onto; at least 2. */
  path: Cell[];
  symbol: number | string | BoardCell;
}

export interface WalkWildConfig {
  /** The symbol's morph in at `path[0]`. */
  morphMs: number;
  /** One step, cell to cell. */
  stepMs: number;
  easing: EasingName;
  ringColor: number;
}

const EMPTY: CellData = { symbol: null };

export function createWalkWildHandler(deps: FeatureDeps<WalkWildConfig>): StepHandler {
  return createFeatureHandler<WalkWildStep, WalkWildConfig>('walkWild', deps, {
    changes({ path, symbol }, grid) {
      if (!Array.isArray(path) || path.length < 2) {
        throw new Error('walkWild: path needs at least 2 cells');
      }
      checkCells('walkWild', grid, path, 'path');
      const data = cellData(symbol) as CellData;
      // the last cell written last: a path that crosses itself still ends on the symbol
      return path.map(({ col, row }, i) => ({
        col,
        row,
        data: i === path.length - 1 ? data : EMPTY,
      }));
    },

    async animate({ path }, changes, { kit, cell, ring, pace }, cfg) {
      const { data } = changes[changes.length - 1];
      await morphSymbol(cell(path[0].col, path[0].row), data, pace.ms(cfg.morphMs));
      for (let i = 1; i < path.length; i++) {
        if (pace.skipped) return;
        const from = path[i - 1];
        const to = path[i];
        cell(from.col, from.row).setData(EMPTY);
        // the next cell takes the symbol and slides in from the one just left
        const walker = cell(to.col, to.row);
        walker.setData(data);
        const off = ring(to.col, to.row, cfg.ringColor);
        await moveCell(kit.grid, walker, from, to, pace.ms(cfg.stepMs), cfg.easing);
        off();
      }
    },
  });
}
