/**
 * `reveal { cells, symbol }` — every cell morphs to `symbol` at once (mystery symbols). Ported
 * from the legacy `MysterySymbols` demo, minus its pick of the revealed symbol.
 */
import { morphSymbol, type CellData } from '@energy8engine/reel-core';
import { cellData, type BoardCell } from '@energy8engine/contracts';
import type { StepHandler } from '@energy8engine/play-loop';
import { checkCells, createFeatureHandler, type Cell, type FeatureDeps } from '../shared';

export interface RevealStep {
  kind: 'reveal';
  cells: Cell[];
  symbol: number | string | BoardCell;
}

export interface RevealConfig {
  /** The morph, every cell together. */
  ms: number;
}

export function createRevealHandler(deps: FeatureDeps<RevealConfig>): StepHandler {
  return createFeatureHandler<RevealStep, RevealConfig>('reveal', deps, {
    changes({ cells, symbol }, grid) {
      checkCells('reveal', grid, cells);
      const data = cellData(symbol) as CellData;
      return cells.map(({ col, row }) => ({ col, row, data }));
    },

    async animate(_step, changes, { cell, pace }, cfg) {
      await Promise.all(
        changes.map(({ col, row, data }) => morphSymbol(cell(col, row), data, pace.ms(cfg.ms))),
      );
    },
  });
}
