/**
 * The form the IDE draws for the `reels1` row — `e8.runtime.schema` in
 * this package's manifest. Imported by the IDE HOST (a node process), so
 * this module imports `schemastery` and nothing else: `./runtime` pulls in
 * `pixi.js` through `createReelsBoard`, and would not load there.
 *
 * The row's config is `CreateReelSystemOptions` (see `./runtime`), and
 * only its DATA keys can live in a `.yml` row: `config` (the reel
 * system's own settings — the outer `config` is the row's, the inner one
 * is `ReelSystemConfig`, see `first-slot`'s `e8.patch.yml`) and `board`.
 * `resolve`, `log`, `features` are functions and arrive as services or
 * not at all. Keys of `ReelSystemConfig` beyond `grid` pass through a
 * schemastery object untouched (measured), so a patch carrying `motion`
 * still validates; `grid` is the one the reference patch actually sets.
 */
import Schema from 'schemastery';

export const Config = Schema.object({
  config: Schema.object({
    grid: Schema.object({
      cols: Schema.natural().default(5),
      rows: Schema.natural().default(3),
    }),
  }).description('reel grid'),
  board: Schema.any().description('initial board, board[col][row]; empty cells by default'),
  layer: Schema.string().default('reels').description('stage layer to mount the board into'),
});
