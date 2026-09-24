/**
 * `transform { cells, to }` — each cell morphs to `to`, then pulses. Ported from the legacy
 * `SymbolTransform` demo, minus its pick of which symbol converts.
 */
import { morphSymbol, pulseCell, type CellData } from '@energy8engine/reel-core';
import { cellData, type BoardCell } from '@energy8engine/contracts';
import type { StepHandler } from '@energy8engine/play-loop';
import { checkCells, createFeatureHandler, type Cell, type FeatureDeps } from '../shared';

export interface TransformStep {
  kind: 'transform';
  cells: Cell[];
  to: number | string | BoardCell;
}

export interface TransformConfig {
  /** The morph. */
  ms: number;
  /** The pulse's peak scale. */
  pulseScale: number;
  /** The pulse, up and back. */
  pulseMs: number;
}

export function createTransformHandler(deps: FeatureDeps<TransformConfig>): StepHandler {
  return createFeatureHandler<TransformStep, TransformConfig>('transform', deps, {
    changes({ cells, to }, grid) {
      checkCells('transform', grid, cells);
      const data = cellData(to) as CellData;
      return cells.map(({ col, row }) => ({ col, row, data }));
    },

    async animate(_step, changes, { cell, pace }, cfg) {
      await Promise.all(
        changes.map(async ({ col, row, data }) => {
          const target = cell(col, row);
          await morphSymbol(target, data, pace.ms(cfg.ms));
          if (pace.skipped) return;
          await pulseCell(target, cfg.pulseScale, pace.ms(cfg.pulseMs));
        }),
      );
    },
  });
}
