/**
 * `sticky { cells, on }` — `on: true` puts a persistent ring on each cell (on the row's overlay
 * layer, so it survives skips and spins), `on: false` takes those rings off. The board does not
 * change: the cells' symbols are the mechanic's to keep in place. `sticky { clear: true }` — no
 * `cells`/`on` — takes every ring off the layer at once, the form a mechanic plays at the top of a
 * segment without remembering which cells it locked. Ported from the legacy `StickySymbols` demo's
 * ring, minus its pick of cells and its spin counter (a flow concern).
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
  /** Clears every ring on the layer; carries no cells/on. */
  clear?: true;
  cells?: Cell[];
  on?: boolean;
}

export interface StickyConfig {
  ringColor: number;
}

export function createStickyHandler(deps: FeatureDeps<StickyConfig>): StepHandler {
  return createFeatureHandler<StickyStep, StickyConfig>('sticky', deps, {
    changes({ clear, cells, on }, grid) {
      needLayer('sticky', deps);
      if (clear === true) {
        if (cells !== undefined || on !== undefined) {
          throw new Error('sticky: clear takes no cells');
        }
        // no cell changes — nothing to re-seat; a no-op if no ring is up
        return [];
      }
      checkCells('sticky', grid, cells!);
      if (typeof on !== 'boolean') throw new Error('sticky: on must be true or false');
      // no cell changes — no re-seat
      return [];
    },

    async animate(step, _changes, _run, cfg) {
      const layer = needLayer('sticky', deps);
      if (step.clear === true) {
        layer.clearRings();
        return;
      }
      // `changes` above already confirmed this is the cells form
      const { cells, on } = step as Required<Pick<StickyStep, 'cells' | 'on'>>;
      for (const cell of cells) {
        if (on) layer.ringOn(cell, cfg.ringColor);
        else layer.ringOff(cell);
      }
    },
  });
}
