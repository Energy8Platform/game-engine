# A reels editor you can understand — design (slice 41)

Date: 2026-09-27. Branch: `feat/slot-webide-cordis` at `d971f1f3` (slice 40).
Source: the user — "reels board: unclear how to configure it" (item 4 of
the slice-39 feedback). Today `reels1` is one long auto-form in the
Composition: `unsupported (union)` fields, colours typed as numbers, the
initial `board` as raw `any`, and nothing to look at beside it; motion,
anticipation, cascade and features are four more rows elsewhere in the same
list.

Decided with the user: a Reels document that is a reel lab (the sections of
every reel row on the left, a canvas with the project's own reel board and
test buttons on the right, like the legacy `examples/reel-lab`); the data
widgets live in SchemaForm so every form gets them; symbol chips and the
board painter only in Reels; "changed + reset" in the composition forms.
Not now: presets, auto-replay, slow motion, a ways counter.

## 0. What is there today

- Reel rows in `e8-base`: `reels1` (`@energy8engine/reels`: `grid`, `win`,
  `board`), `motion1`, `anticipation1`, `cascade1`, `features1` — all
  `hot: true`; an edit is `PUT /api/composition/rows/:id` with the user's
  whole object (`gameComposition.update`), and the running game re-applies
  the row through `gameRows.update(id, config)`.
- SchemaForm draws a union only when it is a union of string literals; any
  other union (`number | number[]`, `object | null`, `'trailing' |
  number[]`) is `unsupported (union)`. Colours are plain `number` fields.
- `row.config` (`GameCompositionRow.config`) is what the patch holds — the
  user's own values, not a defaults-filled copy.
- The editor page (`editor.html`) composes the whole game with
  `editorPage: true` (no flow document runs) and no `ide-bridge`; scene-edit
  has scene mode and symbol mode. Symbol mode reads `board.cellSize` /
  `frameStyle` once at boot (slice 40 debt 1).
- The reel board API (`BoardApi`, `play-loop`): `spinTo`, `revealWins`,
  `remove`, `refill`, `tumble`, `playState`, … — steps with data, no math.

## 1. Rules

- `packages/*` is not edited. No `@energy8platform/game-engine` under
  `engine/`. Every change carries a test in its package.
- The rows' YAML shapes do not change (a colour stays a number).

## 2. SchemaForm: data widgets, in every form

- **Colour.** A `number` field whose schema has `.role('color')` is a colour
  picker plus a `#rrggbb` text field; it reads and writes the number
  (`0xRRGGBB`). The reel rows' colour fields get the role:
  `reels1.grid.frameStyle.*.color` and the `features1` colours
  (`ringColor`, `labelColor`, `totalColor`).
- **One value or one per reel.** A union of `number` and `number[]` is a
  switch `one | per reel`: one number, or a row of numbers (one input per
  entry, `+`/`−` at the end). Switching keeps what it can (one → a list of
  that value; a list → its first value).
- **A literal or a value.** A two-member union where one member is a
  literal (`null` or a string constant) and the other is anything else
  (`object`, `array`, `number`, …) is that literal as a switch and the
  other member's own editor: `topReel: null | { size }` is `off | on` with
  `size`; `onlyOnSymbols: null | string[]` is `any | these`; anticipation
  `reels: 'trailing' | number[]` is `trailing | these`.
- `unsupported (<type>)` stays only for shapes none of the above covers.

## 3. Changed and reset, in the composition forms

- A field whose key is present in the row's `config` (what the patch holds)
  has a `●` marker after its label; its hint names the default when it
  differs ("default 96").
- Its `reset` button removes that key from the object and writes (the same
  `PUT`): the row falls back to the default.
- A nested object's legend has `reset section`, removing that whole key.
- Only in forms that edit a composition row (the Composition screen and
  the Reels document); scene, flow and symbol properties are unchanged.

## 4. The Reels document

- Contributed like Symbols (an activity button and a `shell.document`),
  shown only when the game's composition has a `reels1` row.
- Left: sections, in this order, each only when its row is in the
  composition — **Grid**, **Win**, **Board** (`reels1`), **Motion**
  (`motion1`), **Anticipation** (`anticipation1`), **Cascade**
  (`cascade1`), **Features** (`features1`). Each is the SchemaForm of that
  part of that row (§2, §3), writing through `gameComposition.update` as
  the Composition does.
- Reels-only editors (they need the project's symbols —
  `ctx.symbols.known()` and the symbols document's ids):
  - **symbol lists** (`anticipation1.triggerSymbols`,
    `reels1.win.frameShake.onlyOnSymbols`): chips of the chosen symbols
    plus an add menu of the known ones; a chosen id the project does not
    know stays as a chip marked unknown;
  - **the initial board** (`reels1.board`, `board[col][row]`): a
    `cols × rows` grid (per-reel heights when `rowsPerReel` is set); a
    click on a cell opens a menu of the known symbols and `empty`; `clear
    board` removes the key. A board whose shape no longer matches the grid
    is shown as it is, with a line saying so and a `fit to grid` action
    (truncate/pad with empty).

## 5. The reel-lab canvas

`editor.html?reels=` — a third scene-edit mode:

- **The board alone**: the project's reel board (`board.view`) on a
  checkerboard (slice 40's), fitted to the screen with a margin, re-fitted
  on resize and whenever the board is rebuilt (a hot `reels1` re-apply
  provides a new board — the mode follows it).
- **Live rows**: rpc `rows({ rows: { id, config }[] })` hands each reel
  row's current config to the page's `gameRows.update(id, config)`; the
  Reels document sends it after every successful write and on the canvas's
  `ready`.
- **Test actions** (rpc, and buttons in the document's canvas toolbar);
  each is synthetic — no mechanic, no host spin — built from the project's
  known symbol ids:
  - `Spin` — `spinTo` a random board;
  - `Spin → scatters` — `spinTo` a board whose first `threshold` reels
    each hold one of `anticipation1.triggerSymbols` (the rest random), so
    the trailing reels anticipate; disabled without `anticipation1` or
    with `enabled: false`;
  - `Win` — `revealWins` one random full-width line on the current board;
  - `Tumble` — `revealWins` + `remove` + `tumble` of one random cluster;
    shown only with `cascade1`.
  An action while one runs is ignored (the button is disabled).
- **Symbol mode follows the board too** (slice 40 debt 1): it reads
  `board.cellSize` / `frameStyle` on every layout, so a live `reels1` edit
  reaches the Symbols canvas.

## 6. Tests

- `ide-client` SchemaForm: colour role (picker + text, reads/writes the
  number); `one | per reel` both ways and the conversion; literal-or-value
  for `null | object`, `null | string[]`, `'trailing' | number[]`; the
  marker/reset/reset-section write the object without the key; a field not
  in `config` has no marker.
- `reels` / `reels-features` schemas: the colour fields carry the role
  (the schema tests that pin defaults stay green).
- `ide-client` Reels document: sections only for present rows; a section
  write goes through `gameComposition.update` with the row's whole object;
  symbol chips add/remove and keep unknown ids; the board painter sets a
  cell, clears, fits to grid; the canvas gets `rows` after a write and on
  `ready`; buttons send the actions, disabled while one runs and per §5.
- `scene-edit` reels mode: the board is mounted and fitted, re-fitted on a
  rebuilt board; `rows` calls `gameRows.update` per row; each action calls
  the matching board steps with a board of known symbols (`Spin →
  scatters` puts a trigger symbol on the first `threshold` reels); symbol
  mode re-reads the cell size per layout.
- e2e (alone): open Reels; `cols` 5 → 6 rebuilds the canvas board (6
  reels); `Spin` spins (the board's cells change); a frame colour picked
  reaches `e8.patch.yml` as a number; `reset` removes the key; the
  Composition's `reels1` shows no `unsupported (union)`. Full Playwright
  alone.

## 7. Not here

- Presets, auto-replay after an edit, slow motion, a ways counter.
- Running `features1` steps from the canvas.
- Moving the Reels UI into the reels package's own client half.
- `stacked`/`holdAndSpin`/… (slice 36's list).

## 8. Amendments made while running the plan

- **Tumble on the canvas is `board.tumble(step)` alone** — a `TumbleStep`
  carries `winning`/`removed`; the controller highlights, removes and drops
  them (a separate `revealWins` + `remove` would highlight twice).
- **The lab board is measured once per view and screen size**, never per
  frame — a spin's overshoot or glow would otherwise make the board pulse.
- **The start board is normalised where it enters `reels1`**: plain ids,
  numbers, `null` and `{ symbol }` records all seat (the runtime read only
  records before, so a painted board rendered empty); the painter shows and
  keeps records.
- **`frameStyle`'s states have their built-in colours as schema defaults**
  (pinned against `DEFAULT_CELL_FRAME_STYLE`), so the form shows the real
  colours instead of black.
- **The Reels forms carry their own id prefix** (`reels-<row>`) — the
  Composition stays mounted beside them.
- **A write re-applies only its row on the canvas**; the canvas' `ready`
  re-applies all. Lab actions wait up to 60 s; a disabled Scatters says why
  (`no anticipation1 row`, `turn on Anticipation › enabled`, `no trigger
  symbols`); a row the canvas could not apply is named in the status.
- **Win/Tumble act on what the last spin or tumble left on the same
  board**; after a rebuild they answer `spin first`.
