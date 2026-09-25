/**
 * The row's own overlay layer, for what must outlive a run: `sticky` rings (until a `sticky` step
 * turns them off) and the `giant` view (until the next spin starts). Not reel-core's `fx`: that
 * layer is swept on the first skip of every run (`ReelSystem.skip`), which is right for a run's
 * transient rings and labels and wrong for these.
 *
 * It sits on `kit.grid` — the grid's own coordinates, the ones `cellPosition` answers in — added
 * after the cell layer and `fx`, so above both. A hot `reels1` re-apply destroys the grid and this
 * view with it; `destroy()` is safe after that.
 */
import { Container } from 'pixi.js';
import { Tween } from '@energy8engine/tween';
import { glowRing, type ReelKit, type SymbolCell } from '@energy8engine/reel-core';
import type { Cell } from './shared';

export interface OverlayLayer {
  /** Added to kit.grid above the cells and fx; label 'reels-features'. */
  readonly view: Container;
  /** Idempotent per cell; child label 'sticky'. */
  ringOn(cell: Cell, color: number): void;
  ringOff(cell: Cell): void;
  /** Replaces any current giant (clearing it, so call this BEFORE `hideForGiant`); label 'giant'. */
  showGiant(view: Container): void;
  /** Destroys giants, re-shows the cells they hid. */
  clearGiants(): void;
  hideForGiant(cells: SymbolCell[]): void;
  destroy(): void;
}

export function createOverlayLayer(kit: ReelKit): OverlayLayer {
  const view = new Container({ label: 'reels-features' });
  kit.grid.addChild(view);

  const rings = new Map<string, () => void>();
  let giant: Container | null = null;
  let hidden: SymbolCell[] = [];

  const clearGiants = () => {
    if (giant) {
      Tween.killTweensOf(giant);
      giant.destroy({ children: true });
      giant = null;
    }
    for (const cell of hidden) if (!cell.destroyed) cell.visible = true;
    hidden = [];
  };

  return {
    view,

    ringOn({ col, row }, color) {
      const key = `${col},${row}`;
      if (view.destroyed || rings.has(key)) return;
      rings.set(key, glowRing(view, kit.grid, col, row, color));
      // glowRing's Graphics — the child it just added
      view.children[view.children.length - 1].label = 'sticky';
    },

    ringOff({ col, row }) {
      const key = `${col},${row}`;
      rings.get(key)?.();
      rings.delete(key);
    },

    showGiant(next) {
      clearGiants();
      if (view.destroyed) return;
      next.label = 'giant';
      view.addChild(next);
      giant = next;
    },

    clearGiants,

    hideForGiant(cells) {
      for (const cell of cells) {
        cell.visible = false;
        hidden.push(cell);
      }
    },

    destroy() {
      clearGiants();
      rings.clear();
      view.destroy({ children: true });
    },
  };
}
