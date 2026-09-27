/**
 * The form the IDE draws for the `reels1` row — `e8.runtime.schema` in
 * this package's manifest. Imported by the IDE HOST (a node process), so
 * this module imports `schemastery` and nothing else: `./runtime` pulls in
 * `pixi.js` through `createReelsBoard`, and would not load there. That is
 * why every field of `@energy8engine/reel-core`'s `GridConfig`/`WinConfig`
 * is listed by hand and every default below is a literal —
 * `tests/schema.test.ts` checks them against `DEFAULT_REEL_CONFIG`, so they
 * cannot drift. Not even a TYPE import from reel-core: schemastery's
 * `Schema.object<X>` infers `X` rather than constraining it, so a type would
 * not check these literals — that equality test is the guard.
 *
 * The row's config is `ReelsRowConfig` (see `./runtime`), and it is flat:
 * `grid` (`GridConfig`), `win` (`WinConfig`) and `board`. The reels' motion,
 * anticipation and tumble are not this row's — they are the rows that
 * register them into the `reels` service. `resolve` is a function and
 * arrives as the `assets` service. A nested `config` key (the row's old
 * shape) still validates — schemastery passes unknown keys through — but
 * nothing reads it.
 */
import Schema from 'schemastery';

const FrameState = Schema.object({
  color: Schema.number().role('color').description('frame colour, 0xRRGGBB'),
  alpha: Schema.number().description('frame opacity, 0–1'),
});

const PerAxisGap = Schema.union([Schema.number(), Schema.array(Schema.number())]);

export const GridSchema = Schema.object({
  cols: Schema.natural().default(5).description('Reels (columns).'),
  rows: Schema.natural().default(3).description('Uniform row count. Ignored when `rowsPerReel` is set.'),
  rowsPerReel: Schema.array(Schema.natural()).description(
    'Per-reel row counts (Megaways / variable-height reels). Length should equal `cols`.',
  ),
  cellSize: Schema.number().default(96).description('Square cell size (shorthand: same width & height, all reels).'),
  cellWidth: Schema.number().description('Rectangular cells, uniform across reels. Override `cellSize` when set.'),
  cellHeight: Schema.number().description('Rectangular cells, uniform across reels. Override `cellSize` when set.'),
  cellSizePerReel: Schema.array(
    Schema.union([
      Schema.number(),
      Schema.object({
        width: Schema.number().description('cell width in px'),
        height: Schema.number().description('cell height in px'),
      }),
    ]),
  ).description('Per-strip cell size (square scalar or {width,height}). Overrides the above for that reel.'),
  gap: Schema.number().default(6).description('Uniform gap (shorthand for both axes).'),
  colGap: PerAxisGap.description(
    'Horizontal gap between adjacent reels. Scalar, or per-boundary (length cols-1). Overrides `gap`.',
  ),
  rowGap: PerAxisGap.description('Vertical gap between rows. Scalar, or per-reel (length cols). Overrides `gap`.'),
  evaluation: Schema.union(['lines', 'ways', 'anywhere', 'cluster', 'megaways', 'infinity'])
    .default('lines')
    .description('Win-evaluation model. Purely presentational here (affects geometry + highlight), the math lives in Lua.'),
  minRows: Schema.natural().default(2).description('For Megaways: clamp per-reel rows to [minRows, maxRows].'),
  maxRows: Schema.natural().default(7).description('For Megaways: clamp per-reel rows to [minRows, maxRows].'),
  topReel: Schema.union([Schema.object({ size: Schema.natural().description('symbols on the top reel') }), Schema.const(null)])
    .default(null)
    .description('Megaways top horizontal reel (renders above the grid, adds to ways).'),
  mask: Schema.boolean().default(true).description('Clip the symbols to the reel window.'),
  frameStyle: Schema.object({
    radius: Schema.number().description('corner radius of the cell frame, px'),
    idle: FrameState.description('a cell at rest'),
    winning: FrameState.description('a cell in a win'),
    removed: FrameState.description('a cell removed by a tumble'),
    fresh: FrameState.description('a cell just dropped in'),
  }).description('Cell frame look per state; an absent field keeps the built-in one.'),
  decoration: Schema.object({
    padding: Schema.number().default(0).description('px between the reel window and its decoration'),
  }).description('Padding around the reel window.'),
});

export const WinSchema = Schema.object({
  highlightScale: Schema.number().default(1.12).description('Scale a winning symbol pops to.'),
  glow: Schema.boolean().default(true).description('Glow around a winning symbol.'),
  frameShake: Schema.object({
    enabled: Schema.boolean().default(false).description('shake the frame on landing/win'),
    amp: Schema.number().default(3).description('shake amplitude, px'),
    ms: Schema.number().default(180).description('shake duration, ms'),
    onlyOnSymbols: Schema.union([Schema.array(Schema.string()), Schema.const(null)])
      .default(null)
      .description('shake only when one of these symbols lands; null = any'),
  }).description('Frame shake on landing/win.'),
});

export const Config = Schema.object({
  grid: GridSchema.description('reel grid'),
  win: WinSchema.description('win highlight'),
  board: Schema.any().description('initial board, board[col][row]; empty cells by default'),
});
