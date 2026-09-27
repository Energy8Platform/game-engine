# The Symbols document you can read — design (slice 40)

Date: 2026-09-27. Branch: `feat/slot-webide-cordis` at `23737874` (slice 39).
Source: the user, after using the IDE — "symbols: a black screen and a very
small symbol; unclear how to look at it, what it is for, how to configure
it" (item 3 of the slice-39 feedback).

Decided with the user: the canvas shows ONE symbol large (not a sheet of
all symbols, not a mini board); a checkerboard behind the board's own cell
frame; the properties grouped with only what a symbol needs; SchemaForm
labels become the field's key everywhere, the description a hint.

## 0. What is there today

- `SymbolsDocument` (`engine/ide/client/src/shell/SymbolsDocument.tsx`): a
  list down the left (id, name, a chip per state, `+`, ghosts, an add input,
  a drop zone) and a canvas: `editor.html?symbol=` in an iframe sized to
  the game's DESIGN resolution (`scenes1.design`, else 480×288) and scaled
  by CSS to fit. `@energy8engine/scene-edit`'s symbol mode draws the state
  at `board.cellSize` (96×96) with a thin outline, centred, at the
  scenes root's design→screen scale — so a 96-px symbol sits in a
  1920×1080 frame shrunk to the pane: a tiny symbol on black. `Replay` sits
  beside the canvas and is clipped.
- `SymbolsProperties`: name, fit, the state's type and a `SchemaForm` over
  the type's schema merged with `COMMON` (`mergedSchema` in
  `PropertiesSidebar.tsx`) — every scene-node prop, including `width`,
  `height`, `visible`, `anchor*`, `mask`, `pin`, which mean nothing for a
  symbol's state.
- `SchemaForm`'s `label(node, key)` (`schema-form/fields.tsx`) is the
  description when there is one, else the key: long sentences as labels,
  and the YAML key nowhere on screen.
- Nothing on the screen says what a symbol is or what its states are for.

## 1. Rules

- `packages/*` is not edited. No `@energy8platform/game-engine` under
  `engine/`. Every change carries a test in its package.
- `symbols.yml`'s shape does not change.

## 2. The canvas: one symbol, large

The iframe fills the canvas pane at the pane's own size — no design-size
frame, no CSS scale. The editor page's renderer follows its `#mount`, so
`app.screen` is the pane.

`scene-edit`'s symbol mode draws, on `app.stage` (the composed game stays
hidden under `scenes.container`, as today):

- **a checkerboard** filling `app.screen` (two tones, 8-px squares at
  screen scale), redrawn on resize — transparency reads as transparency;
- **the board's cell frame**: a rounded rect of `board.cellSize`, drawn
  the way `reel-core`'s `SymbolCell` draws its `idle` frame — its
  `frameStyle.idle` colour/alpha and `radius` from `board.config`
  (`grid.frameStyle`), falling back to `SymbolCell`'s own defaults (export
  them from `reel-core` so they are not copied);
- **the selected state's view** inside it, exactly as today
  (`symbols.preview(id, state, cellSize)`, which applies `fit`).

**Zoom** — a new rpc call `zoom { mode: 'fit' | '1:1' | '2x' }`, default
`fit`:
- `fit`: the cell's larger side becomes 60 % of the screen's smaller side;
- `1:1`: one design px of the cell = one screen px;
- `2x`: two.
The box is centred on `app.screen` and re-laid out on every resize. The
`snapshot` answer gains `screen: { w, h }` (the cell's on-screen size) so
tests can read it.

## 3. The canvas toolbar and header

Above the canvas (a row, never clipped):
- the header: `<id> · <name> · <state>` (name omitted when empty);
- on the right, `cell <w>×<h>` (the board's cell size, from `snapshot`);
- `fit` / `1:1` / `2×` (a segmented control; the choice is per-viewer in
  `localStorage['e8.symbols-zoom']`, try/catch, default `fit`);
- `▶ Play` — replays the selected state (the existing `symbol` call).

## 4. What a symbol is, on the screen

- **Nothing selected** (or no `symbols.yml`): the canvas area shows a short
  explanation instead of an empty frame:
  - a symbol is the id a reel's board carries, and how it looks in each
    state;
  - `static` — at rest; `idle` — an optional looping look at rest; `win` —
    plays on a win; named states — played by a mechanic's plan steps;
  - how to add art: drop a file from the Explorer onto a state chip, onto a
    row (its `static`), or below the list (a new symbol);
  - with no `symbols.yml`: the first add creates it;
  - "pick a symbol on the left".
- **A state the symbol has not got** (selected chip empty): the canvas says
  `no <state> yet — drop a file on the chip, or Create in Properties`.

## 5. Properties, grouped

`SymbolsProperties` becomes three groups:

1. **Symbol** — `id` (read-only), `name`, `fit` (`contain`: scaled into the
   cell; `none`: centred at its own size — said as the field's hint).
2. **State `<state>`** — the type select (as today) and the type's OWN
   props (`src`, `sheet`, `loop`, `scene`, …).
3. **Adjust** — from `COMMON`, only `x`, `y` (offset in design px),
   `scale`, `rotation`, `alpha`, `tint`.

`width`, `height`, `visible`, `anchor`, `anchorX`, `anchorY`, `mask`, `pin`
are not shown for a symbol (an existing value in the YAML is kept — the
form only hides the fields; a write keeps every prop it did not touch). A
named state keeps its `Remove state` button; an absent state keeps
`Create <state>`.

## 6. SchemaForm labels, everywhere

- The label is the field's KEY, as written in the YAML (`cellSize`,
  `rowGap`, `frameStyle`).
- The description, when there is one, is a muted hint line under the
  control, tied to it with `aria-describedby`. Legends of object fields
  follow the same rule (key as the legend, description as the hint).
- Every SchemaForm (composition rows, scene properties, flow properties,
  symbols) gets it; e2e that find a field by its description text move to
  the key.

## 7. Tests

- `reel-core`: the frame defaults are exported and `SymbolCell` still uses
  them.
- `scene-edit`: symbol mode's layout — at `fit` the cell's on-screen larger
  side is 60 % of the screen's smaller side; `1:1` = cell size; `2x` =
  double; a resize re-lays out; the frame's colour/alpha come from
  `board.config`'s `frameStyle.idle` when set, the defaults otherwise; the
  checkerboard covers the screen; `snapshot().screen` reports the on-screen
  cell.
- `ide-client`:
  - `SymbolsDocument`: no design-size frame (the iframe is the pane's
    size); the header reads `3 · sym-3 · static`; the zoom control sends
    `zoom` and is remembered; `Play` sends `symbol`; the explanation with
    nothing selected and with no doc; the empty-state line.
  - `SymbolsProperties`: the three groups; the hidden common props are
    absent; a hidden prop already in the YAML survives an edit of another
    field.
  - `SchemaForm`: label = key; description = hint with `aria-describedby`;
    a field without a description has no hint.
- e2e (`symbols.spec.ts`, alone): at `fit` the symbol's on-screen cell is at
  least 40 % of the canvas's smaller side; `1:1` gives 96 px; `Play` on
  `win` plays the spritesheet (frame advances); the explanation shows with
  nothing selected. Specs that located a field by its description move to
  the key. Full Playwright alone.

## 8. Not here

- A sheet of all symbols, a symbol on a mini board, a background switcher.
- Per-reel cell sizes (the canvas uses `board.cellSize`).
- The reels board editor (slice 41).
