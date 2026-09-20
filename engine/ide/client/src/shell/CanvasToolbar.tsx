/**
 * The canvas' toolbar — a port of `feat/slot-ide-ir`'s `ViewportBar`
 * (`apps/ide/src/viewport.ts`): zoom −/+/Fit with the percentage, the
 * grid toggle and step, the tree pane's collapse, and the VIEWPORT
 * preset (spec §7) — what the canvas iframe is sized to: `design` (the
 * design box, scale 1), a 16:9 landscape, a phone either way, or a free
 * `W×H`. The iframe fits the scenes into that box the way a device would.
 *
 * Stateless but for the custom field's draft (and whether `custom…` is
 * the chosen option before a size has been typed): the zoom shown is the
 * one given (the fit needs the stage's box, which `SceneDocument` owns);
 * `onZoom(null)` asks for the fit; `onViewport(null)` is the design box.
 * A `W×H` that does not parse keeps the last viewport.
 */
import { useState, type KeyboardEvent } from 'react';

export type GridStep = 8 | 16 | 32;
export interface GridState {
  on: boolean;
  step: GridStep;
}

/** A viewport the canvas is sized to, in CSS px; `null` = the design box. */
export interface Viewport {
  width: number;
  height: number;
}

export const VIEWPORT_PRESETS: { id: string; label: string; size: Viewport | null }[] = [
  { id: 'design', label: 'design', size: null },
  { id: 'landscape', label: 'landscape 1280×720', size: { width: 1280, height: 720 } },
  { id: 'phone-portrait', label: 'phone portrait 390×844', size: { width: 390, height: 844 } },
  { id: 'phone-landscape', label: 'phone landscape 844×390', size: { width: 844, height: 390 } },
];

const same = (a: Viewport | null, b: Viewport | null) =>
  a === b || (!!a && !!b && a.width === b.width && a.height === b.height);

/** `1280×720`, `1280x720`, `1280 * 720` — whole positive px, or `null`. */
export function parseViewport(text: string): Viewport | null {
  const m = /^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/i.exec(text);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : null;
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
  viewport: Viewport | null;
  onViewport(viewport: Viewport | null): void;
}

export function CanvasToolbar({
  zoom,
  onZoom,
  grid,
  onGrid,
  treeOpen,
  onTreeToggle,
  viewport,
  onViewport,
}: CanvasToolbarProps) {
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState('');
  const preset = VIEWPORT_PRESETS.find((p) => same(p.size, viewport));
  const chosen = custom || !preset ? 'custom' : preset.id;
  const commitCustom = () => {
    const size = parseViewport(draft);
    if (size) onViewport(size);
    else setDraft(viewport ? `${viewport.width}×${viewport.height}` : '');
  };
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
      <span className="e8-canvas-toolbar-group">
        <select
          data-testid="canvas-viewport"
          aria-label="viewport"
          title="the viewport the canvas is sized to"
          value={chosen}
          onChange={(e) => {
            const id = e.target.value;
            if (id === 'custom') {
              setCustom(true);
              setDraft(viewport ? `${viewport.width}×${viewport.height}` : '1280×720');
              return;
            }
            setCustom(false);
            onViewport(VIEWPORT_PRESETS.find((p) => p.id === id)?.size ?? null);
          }}
        >
          {VIEWPORT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">custom…</option>
        </select>
        {chosen === 'custom' ? (
          <input
            className="e8-canvas-viewport-size"
            data-testid="canvas-viewport-size"
            aria-label="viewport size"
            placeholder="W×H"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitCustom}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && commitCustom()}
          />
        ) : null}
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
