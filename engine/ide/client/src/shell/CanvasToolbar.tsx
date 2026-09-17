/**
 * The canvas' toolbar — a port of `feat/slot-ide-ir`'s `ViewportBar`
 * (`apps/ide/src/viewport.ts`) reduced to what a fixed-size renderer
 * needs: zoom −/+/Fit with the percentage, plus the grid toggle and
 * step, plus the tree pane's collapse. The device presets and rotate
 * went with the responsive frame they sized — the canvas' intrinsic
 * size is the design size now (see `SceneDocument`).
 *
 * Stateless: the zoom shown is the one given (the fit needs the stage's
 * box, which `SceneDocument` owns); `onZoom(null)` asks for the fit,
 * as the old bar's `zoom = null` did.
 */

export type GridStep = 8 | 16 | 32;
export interface GridState {
  on: boolean;
  step: GridStep;
}

const STEPS: GridStep[] = [8, 16, 32];
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_FACTOR = 1.25;

export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

export interface CanvasToolbarProps {
  zoom: number;
  /** `null` = fit to the stage. */
  onZoom(zoom: number | null): void;
  grid: GridState;
  onGrid(grid: GridState): void;
  treeOpen: boolean;
  onTreeToggle(): void;
}

export function CanvasToolbar({
  zoom,
  onZoom,
  grid,
  onGrid,
  treeOpen,
  onTreeToggle,
}: CanvasToolbarProps) {
  return (
    <div className="e8-canvas-toolbar" data-testid="canvas-toolbar">
      <button
        type="button"
        className="e8-explorer-action"
        data-testid="canvas-tree-toggle"
        aria-pressed={treeOpen}
        aria-label="node tree"
        title="node tree"
        onClick={onTreeToggle}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M3 4h10M5 8h8M7 12h6" />
        </svg>
      </button>
      <span className="e8-canvas-toolbar-group">
        <button
          type="button"
          data-testid="canvas-zoom-out"
          title="zoom out"
          onClick={() => onZoom(clampZoom(zoom / ZOOM_FACTOR))}
        >
          −
        </button>
        <span className="e8-canvas-zoom" data-testid="canvas-zoom">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          data-testid="canvas-zoom-in"
          title="zoom in"
          onClick={() => onZoom(clampZoom(zoom * ZOOM_FACTOR))}
        >
          +
        </button>
        <button
          type="button"
          data-testid="canvas-fit"
          title="scale the frame to fit the panel"
          onClick={() => onZoom(null)}
        >
          Fit
        </button>
      </span>
      <label className="e8-canvas-toolbar-group">
        <input
          type="checkbox"
          data-testid="canvas-grid"
          checked={grid.on}
          onChange={(e) => onGrid({ ...grid, on: e.target.checked })}
        />
        grid
      </label>
      <select
        data-testid="canvas-grid-step"
        aria-label="grid step"
        value={grid.step}
        onChange={(e) => onGrid({ ...grid, step: Number(e.target.value) as GridStep })}
      >
        {STEPS.map((step) => (
          <option key={step} value={step}>
            {step}
          </option>
        ))}
      </select>
    </div>
  );
}
