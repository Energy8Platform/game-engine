# Slice 27 — responsive layout: what was left behind

Slice: `docs/superpowers/plans/2026-09-20-responsive.md`, spec
`2026-09-20-responsive-design.md` (answers R11 of
`2026-09-19-paper-duel-port-feasibility.md`). Commits `8f2ef6d..ac18217`
on `feat/slot-webide-cordis` plus this note's. Designed with the user; run
per the standing method. The renderer follows its mount when unsized; the
scenes fit the design into a SAFE rect (the viewport minus a `safeArea`
service or the shell's bar) and expose it in design units on `Fit`; a
COMMON `pin` places top-level nodes from the safe rect's nine points with
offsets, re-placed position-only on every resize; a scene document's
`portrait` block is a layer under the live `setProps` patches, applied when
the safe rect is taller than wide (`scenes1.config.portrait` or the
rotated design), on a document's roots even when embedded; the scene
editor sizes its iframe to a viewport preset, draws the safe rect, emits
pin offsets and `variant`-tagged edits, tells the IDE its orientation; the
IDE writes portrait edits into `portrait.nodes`; `first-slot` fills the
window, pins its win readout above the bar and turns to portrait (logo on
top, the board scaled under it, the coin hidden). Full Playwright alone:
148/148.

## Amendments made while running the plan

- **A resize re-places pinned nodes POSITION-ONLY.** The first pass re-ran
  the whole common pass — a shown pinned `scene` host (`visible: false` in
  the document) was hidden again by the next resize and a tweened node
  snapped. `place(view, c, fit)` is the one position rule; `placePinned`
  calls nothing else.
- **The scenes' fit is a microtask behind the renderer's `resize`** — its
  listener registers before the shell's, and the bar's height changes on
  that same event; deferred, the fit reads the NEW bar.
- **Embedded copies take no pin but DO take the variant**: a pin measured
  from the outer safe rect inside a positioned host is wrong (double
  offset), so `Entry.top` is only the outermost document's roots; but the
  template shows `big_win` only through a `scene` node, so its `portrait`
  block would have been dead — `Entry.root` marks a document's roots
  wherever mounted, and they turn.
- **A common-only override takes no remount** (`x/y/pin/scale/visible`):
  `container` (update-less) would otherwise remount on every flip and drop
  its children's live patches; the `reels` node turns (scaled, pinned)
  without losing the grid. A failed remount keeps the old node (mount
  first, unmount after). `assetsOf`/`refsOf`/the host follow a `scene`
  override's target.
- **The reels node's origin is reel 0's column centre and row 0's centre**,
  not the grid's centre: the spec's `board: { pin: center, y: 40 }` put the
  top-left cell at the rect's centre. Shipped: `pin: top, x: -112, y: 115,
  scale: 0.55` — the 504×300 grid at 277×165, 16 px under the logo, inside
  the 288-wide design.
- **The page says which orientation it edits.** The IDE first mirrored the
  page's formula from its preset; now `scene-edit` reports `orientation`
  on `ready` and on flips, the IDE keeps the variant PER SCENE (two tabs
  disagreed) and forgets it when the iframe `src` changes (the reload
  window wrote into the stale layer).
- **`portrait.nodes` follows its node**: remove → cleared; rename → moved;
  moved under a parent → cleared (a leftover was a permanent host warning
  with no row to clear it).
- `editor.html`'s `#mount` had no box (`line-height: 0`) — pixi's
  `resizeTo` read 0×0; both pages give it `position: fixed; inset: 0`.
  `#log` docks under the toolbar (at the bottom it covered the bar).
- A `renderer1` with exactly one of `width`/`height` → warning, follows the
  mount; half a `scenes1.config.portrait` → warning, the rotated design.
- The e2e's second landscape size is 800×600, not 800×450 — two 16:9 sizes
  give the same safe-rect bottom and could not tell a safe-rect pin from a
  design-box pin. `canvas.spec`'s corner-drag premise read the file's FIRST
  `scale:` — now the board's portrait `0.55`; it parses the node.
- The build test's chunk-name strip `/-[^-]+\.js$/` broke on a base64url
  hash containing `-` (the page's bytes changed the hash).
- `hot-fork.spec`'s helper scrolls the preview into view: Playwright's
  stability check never settled with a window-filling canvas scrolled
  offscreen (mechanism in Chromium not named).

## Debts

1. **The safe area is re-read only on a resize or a `shell` provide** — the
   bar's measured height also moves on a `renderBar()` without a resize
   (state re-renders re-tighten the bar's scale under 840 px); a `pin:
   bottom` node can sit a few px into the bar until the next resize.
2. **`SAFE_BOTTOM` is nominal** (92 / 142); the real mobile bar is 131 px at
   390×844 — the editor's band is 11 px taller than the game's; pinned
   nodes differ by ~4–8 design px between the two.
3. **Percent sizing, notches, breakpoints by width, a tablet variant** —
   spec non-goals; the reels' cell size does not adapt (the grid is scaled
   as a whole).
4. **`text.font` added/removed by an override cannot swap `Text` ↔
   `BitmapText`** through the update path; a cycle through a `scene`
   override reports at both ends; `m.missing` keeps an entry from the other
   orientation's subtree; a remounted root that masks its parent hits
   "already the mask" (custom types only).
5. **Un-pinning is a jump** (`prop { pin: '' }` reads the offsets as
   absolutes) — README says so; grid snap on a pinned node snaps the
   absolute, so the written offset is off-grid when the pin point is not a
   grid multiple; a drop under a portrait preset writes portrait-design
   coordinates into the node's own props.
6. **`e8 shot` on a dev host** shows the floating dev toolbar over the
   canvas's top band (the PNG is the viewport); hiding `#controls,#log`
   needs `PageLike.addStyleTag` and the test fake's document stub.
7. **`composition`/`schema` "the board is drawn" quadrant checks are
   vacuous** with in-canvas chrome (the toolbar and the bar make the
   quadrants differ on an empty board); `symbols.spec:96`'s 5 s poll is
   load-sensitive; a `renderBar` mid-poll can move the bar during an e2e.
8. `ide-web`'s six TS7016 remain; `scene-edit` rounds `x/y` to 0.01 and
   the IDE to 1, so a fractional drag is taken as the IDE's echo (≤ 0.5 px).

## Method

- **A ruling that accepts a deviation must name what the deviation
  re-applies.** "Idempotent for position" was true and irrelevant — the
  whole common pass re-applies `visible`; the reviewer's harness (a shown
  host + a resize) found it in minutes.
- **Read the ENTRY of the node you place, not its bounds**: the reels
  view's origin is a cell centre; every geometry ruling written from the
  bounds was wrong until a reviewer derived the numbers from
  `geometry.ts`.
- **Two sizes with the same aspect prove nothing about the safe rect** —
  pick a proof input that separates the hypotheses (800×600 vs 800×450).
- **A page that owns a fact should announce it** (orientation) rather than
  have a second party recompute it from shared inputs — the mirror was
  right on every preset and still wrong for two tabs and a reload.
- **The template's own composition is the test of "top-level"**: the
  embedded `big_win` made the "roots only" ruling a dead feature; check
  the shipped fixture against every "only X" rule.
- **A fixture change moves content hashes** — a test that parses a chunk
  name must tolerate the hash's alphabet.
- Parallel implementers on disjoint files held again (T1/T2, T3/T4,
  T5/re-reviews); reviews run read-only during a full Playwright.
