/**
 * `sticky { cells, on }` — `on: true` puts a persistent ring on each cell (on the row's overlay
 * layer, so it survives skips and spins), `on: false` takes those rings off. The board does not
 * change: the cells' symbols are the mechanic's to keep in place. Ported from the legacy
 * `StickySymbols` demo's ring, minus its pick of cells and its spin counter (a flow concern).
 */
import type { StepHandler } from '@energy8engine/play-loop';
import {
  checkCells,
  createFeatureHandler,
  needLayer,
  type Cell,
  type FeatureDeps,
} from '../shared';

export interface StickyStep {
  kind: 'sticky';
  cells: Cell[];
  on: boolean;
}

export interface StickyConfig {
  ringColor: number;
}

export function createStickyHandler(deps: FeatureDeps<StickyConfig>): StepHandler {
  return createFeatureHandler<StickyStep, StickyConfig>('sticky', deps, {
    changes({ cells, on }, grid) {
      needLayer('sticky', deps);
      checkCells('sticky', grid, cells);
      if (typeof on !== 'boolean') throw new Error('sticky: on must be true or false');
      // no cell changes — no re-seat
      return [];
    },

    async animate({ cells, on }, _changes, _run, cfg) {
      const layer = needLayer('sticky', deps);
      for (const cell of cells) {
        if (on) layer.ringOn(cell, cfg.ringColor);
        else layer.ringOff(cell);
      }
    },
  });
}
