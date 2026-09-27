# Slice 40 — the Symbols document you can read: what was left behind

Slice: `docs/superpowers/plans/2026-09-27-symbols-view.md`, spec
`2026-09-27-symbols-view-design.md` (amended with the rulings below).
Commits `0e32962b..4f655edc` on `feat/slot-webide-cordis` plus this note's.

Source: the user (item 3 of the slice-39 feedback) — "symbols: a black
screen and a very small symbol; unclear how to look at it, what it is for,
how to configure it". Cause: the symbol canvas was an iframe at the game's
design resolution scaled into the pane, with the 96-px symbol inside it at
the scenes root's scale; Properties were every scene-node prop; labels were
descriptions.

What shipped:
- **Canvas** (`scene-edit` symbol mode): the iframe fills its pane; a
  checkerboard; the board's own cell frame (`board.config.grid.frameStyle`,
  else `reel-core`'s now-exported `DEFAULT_CELL_FRAME_STYLE`); the state
  inside; rpc `zoom` (`fit` = the cell's larger side at 60 % of the smaller
  screen side, `1:1`, `2x`); re-laid out on resize (the checkerboard only
  on a size change); `snapshot()` adds `screen` (on-screen cell) and `cell`
  (design cell) — `w`/`h` stay the view's design size.
- **Symbols document**: toolbar with the header (`3 · sym-3 · static`),
  `cell 96×96`, zoom (remembered per viewer), `▶ Play` (disabled with
  nothing to play, wraps on a narrow pane); a help panel saying what a
  symbol and each state are and how to add art; `no win yet — …` for an
  absent state; a selection whose symbol is gone clears, a removed named
  state falls back to `static`.
- **Properties**: Symbol (id, name, fit with its hint) / State (type + the
  type's own fields) / Adjust (`x`, `y` as offsets, `scale`, `rotation`,
  `alpha`, `tint`). Hidden common props survive; a write applies only the
  changed keys onto the state's props as they stand at the write's turn.
- **SchemaForm, every form**: the label is the YAML key; the description is
  a hint under the control (`aria-describedby`), after the `restart` badge;
  a group's hint inside its fieldset; field ids sanitised.

Unit gate: reel-core 88, scene-edit 62, symbols 57, reels 66, ide-client
747, ide-web 38, ide-host (alone) 554; typecheck 0. Full Playwright alone
(`E8_E2E_HOST_PORT=5779`): 165/165 (11.3 min).

## Amendments made while running the plan

- **`snapshot().w/h` stay design units** — the plan said "stays as it
  is", the first cut let them follow the zoom; measured in the preview
  box's own space now.
- **The checkerboard redraws only on a size change** — the plan's memo
  redrew it on every zoom click.
- **A Properties write is a delta onto the live props** — the plan's
  `{ ...props, ...next }` off the render's closure dropped an edit when a
  State write and an Adjust write were in flight together.
- **Stale selections** — a symbol removed elsewhere, or a named state
  removed, no longer leaves a blank or misleading pane.
- **Hint placement** (final review) — in the composition's 3-column grid
  the hint had taken the badge's column.

## Debts

1. **The canvas reads `board.cellSize`/`frameStyle` once at boot**: a live
   `reels1` edit (`hot: true`) leaves the frame and `cell W×H` stale until
   the canvas reloads. Slice 41 (the reels editor) is where it matters —
   read the board per layout there.
2. **Checkerboard cost**: one Graphics with ~16k rects at 1080p, rebuilt on
   every frame of a resize drag. A `TilingSprite` over a 16×16 texture.
3. **The frame is a copy of `SymbolCell._drawFrame`** (including its
   `tint = color`); `new SymbolCell({ size, resolve: () => null,
   frameStyle })` would follow any change to the board's frame.
4. **Small**: `DEFAULT_CELL_FRAME_STYLE` is shallowly frozen; no guard on
   out-of-order `snapshot` answers (moot: a canvas's cell is fixed); a prop
   write queued behind a type change can carry a key the new type does not
   declare; `writeProps` has no empty-delta short-circuit; the e2e reads
   the fit size once; the delta rule is explained twice in
   `SymbolsProperties.tsx`; `safeId` is lossy (`a.b`/`a b`/`a_b` collide);
   `styles.test`'s `rule()` depends on rule order.
5. **Process**: implementers ran `git stash` twice despite the rule
   (verified harmless each time). Say the alternative in the dispatch
   (`git show HEAD:<path>` into a scratch file), not only the ban.
6. **Not here**: a sheet of all symbols, a mini board, a background
   switcher, per-reel cell sizes, panning at 2×.
7. **Slice 41**: the reels board editor (item 4 of the feedback).

## Method

- **A snapshot field's meaning is a contract**: when a change moves what a
  value is measured in, either keep the unit or rename the field.
- **A reducer that ignores its argument defeats the queue it runs in**:
  every write through `ctx.symbols.update` must read the doc it is given.
- **A grid layout change needs a look at every screen that uses the
  grid**: the hint was right in the sidebar and wrong in the composition.
