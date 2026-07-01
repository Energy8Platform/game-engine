// packages/game-engine/src/slot/grid/geometry.ts
//
// Pure geometry resolver for the reel grid. Turns the (backward-compatible) grid config
// — a square `cellSize` + single `gap`, optionally overridden by rectangular / per-strip
// dimensions and per-strip gaps — into a fully-resolved, per-reel layout.
//
// Coordinate convention (unchanged from the original square grid):
//   - `cellPosition` returns CELL-CENTRE coordinates.
//   - Cell (0,0)'s centre sits at local x = 0. Reels extend to the right.
//   - Variable-height reels are vertically CENTRED about a shared centre line, so the
//     tallest reel's row 0 sits at y = 0 (matching the old Megaways behaviour).
//
// See docs/reels-analysis-and-design.md §6.

/** Per-strip cell size override: a square scalar, or an explicit width/height. */
export type CellSizeSpec = number | { width: number; height: number };

/** Structural input any grid config (GridConfig / ReelGridConfig) satisfies. */
export interface GeometryInput {
  cols: number;
  /** Uniform row count. Ignored when `rowsPerReel` is set (and length matches `cols`). */
  rows: number;
  rowsPerReel?: number[];
  /** Square cell size (shorthand: same width & height, all reels). */
  cellSize: number;
  /** Rectangular cells, uniform across reels. Override `cellSize`. */
  cellWidth?: number;
  cellHeight?: number;
  /** Per-strip cell size (square scalar or {width,height}). Overrides the above for that reel. */
  cellSizePerReel?: CellSizeSpec[];
  /** Uniform gap (shorthand for both axes). */
  gap?: number;
  /** Horizontal gap between adjacent reels. Scalar, or per-boundary (length cols-1). */
  colGap?: number | number[];
  /** Vertical gap between rows. Scalar, or per-reel (length cols). */
  rowGap?: number | number[];
}

export interface ResolvedGeometry {
  cols: number;
  rowsPerReel: number[];
  maxRows: number;
  /** Per-reel cell width / height (px). */
  cellW: number[];
  cellH: number[];
  /** Per-reel vertical gap between rows (px). */
  rowGap: number[];
  /** Horizontal gap between reel i and i+1 (px), length cols-1. */
  colGap: number[];
  /** Cell-centre X of each reel (px). */
  colX: number[];
  /** Row-0 cell-centre Y of each reel (px) — centring offset baked in. */
  yOff: number[];
  /** Total grid bounding size (px). */
  gridW: number;
  gridH: number;
  /** Grid bounding-box centre in local coords (px). */
  centerX: number;
  centerY: number;
  /** Top-left corner of the grid bounding box in local coords (px). */
  leftX: number;
  topY: number;
}

const perReelSize = (spec: CellSizeSpec | undefined, w: number, h: number): [number, number] => {
  if (typeof spec === 'number') return [spec, spec];
  if (spec && typeof spec === 'object') return [spec.width, spec.height];
  return [w, h];
};

const gapAt = (g: number | number[] | undefined, i: number, base: number): number =>
  Array.isArray(g) ? (g[i] ?? base) : (g ?? base);

/** Resolve a grid config into a fully-populated per-reel geometry. */
export function resolveGeometry(g: GeometryInput): ResolvedGeometry {
  const cols = Math.max(0, g.cols);
  const rowsPerReel =
    g.rowsPerReel && g.rowsPerReel.length === cols
      ? g.rowsPerReel.slice()
      : Array.from({ length: cols }, () => g.rows);
  const maxRows = cols ? Math.max(1, ...rowsPerReel) : 0;

  const baseW = g.cellWidth ?? g.cellSize;
  const baseH = g.cellHeight ?? g.cellSize;
  const baseGap = g.gap ?? 0;

  const cellW: number[] = [];
  const cellH: number[] = [];
  const rowGap: number[] = [];
  for (let c = 0; c < cols; c++) {
    const [w, h] = perReelSize(g.cellSizePerReel?.[c], baseW, baseH);
    cellW[c] = w;
    cellH[c] = h;
    rowGap[c] = gapAt(g.rowGap, c, baseGap);
  }
  const colGap: number[] = [];
  for (let i = 0; i < Math.max(0, cols - 1); i++) colGap[i] = gapAt(g.colGap, i, baseGap);

  // Horizontal: reel 0 centre at x = 0, then accumulate half-widths + between-reel gaps.
  const colX: number[] = [];
  if (cols) colX[0] = 0;
  for (let c = 1; c < cols; c++)
    colX[c] = colX[c - 1] + cellW[c - 1] / 2 + colGap[c - 1] + cellW[c] / 2;

  // Vertical: each reel's rows span (rows-1)*step; centre every reel about a shared line so
  // the tallest reel's row 0 stays at y = 0 (parity with the old uniform Megaways layout).
  const span: number[] = rowsPerReel.map((rr, c) => Math.max(0, rr - 1) * (cellH[c] + rowGap[c]));
  const halfMaxSpan = cols ? Math.max(...span) / 2 : 0;
  const yOff: number[] = span.map((s) => halfMaxSpan - s / 2);

  // Bounding box.
  let leftX = 0;
  let rightX = 0;
  let topY = 0;
  let bottomY = 0;
  for (let c = 0; c < cols; c++) {
    leftX = Math.min(leftX, colX[c] - cellW[c] / 2);
    rightX = Math.max(rightX, colX[c] + cellW[c] / 2);
    const reelTop = yOff[c] - cellH[c] / 2;
    topY = Math.min(topY, reelTop);
    bottomY = Math.max(bottomY, reelTop + rowsPerReel[c] * cellH[c] + Math.max(0, rowsPerReel[c] - 1) * rowGap[c]);
  }
  const gridW = rightX - leftX;
  const gridH = bottomY - topY;

  return {
    cols,
    rowsPerReel,
    maxRows,
    cellW,
    cellH,
    rowGap,
    colGap,
    colX,
    yOff,
    gridW,
    gridH,
    centerX: (leftX + rightX) / 2,
    centerY: (topY + bottomY) / 2,
    leftX,
    topY,
  };
}

/** Cell-centre position from a resolved geometry. */
export function cellPositionOf(
  geom: ResolvedGeometry,
  col: number,
  row: number,
): { x: number; y: number } {
  return {
    x: geom.colX[col] ?? 0,
    y: (geom.yOff[col] ?? 0) + row * ((geom.cellH[col] ?? 0) + (geom.rowGap[col] ?? 0)),
  };
}
