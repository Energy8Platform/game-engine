# Slice 41 — a reels editor you can understand: what was left behind

Slice: `docs/superpowers/plans/2026-09-27-reels-editor.md`, spec
`2026-09-27-reels-editor-design.md` (its §8 records the amendments).
Commits `618cce36..18d7152c` on `feat/slot-webide-cordis` plus this note's.

Source: the user (item 4 of the slice-39 feedback) — "reels board: unclear
how to configure it". `reels1` was one long form with `unsupported (union)`
fields, colours as numbers and a raw `board`; motion, anticipation, cascade
and features were four more rows elsewhere; nothing to look at beside them.

What shipped:
- **SchemaForm, every form**: a colour widget (`.role('color')` numbers,
  picker + hex, one write per pick); `one | per reel` for `number |
  number[]`; a literal-or-value switch for `null | X` and `'const' | X`;
  `resettable` (a `●` on keys the patch sets, `reset` / `reset section`,
  the default in the hint) on the Composition's game rows and in Reels;
  `root` and `fieldOverrides` by path. The reels and features colour
  fields carry the role; `frameStyle` states default to the built-in
  colours.
- **Reels document** (only while `reels1` is composed): Grid, Win, Board,
  Motion, Anticipation, Cascade, Features sections beside a reel-lab
  canvas; symbol lists as chips of the project's symbols (the schema
  default shown); the start board painted cell by cell (mismatch shown,
  `fit to grid`).
- **Reel-lab canvas** (`editor.html?reels=`, scene-edit reels mode): the
  project's board alone on a checkerboard, following a rebuilt board;
  every write re-applies its row there; Spin, Spin → scatters, Win, Tumble
  from pure generators (`lab.ts`), each answering a reason instead of
  failing; the Symbols canvas now reads the board's cell size and frame
  live (slice 40 debt 1).
- **The start board works at runtime**: `reels1.board` of plain ids seats
  its symbols (it rendered empty before).

Unit gate: reels 69, reels-features 100, scene-edit 97, symbols 57,
ide-client 820, ide-web 38, ide-host (alone) 554; typecheck 0.
Full Playwright alone (`E8_E2E_HOST_PORT=5779`): 166/166 (11.3 min).

## Debts

1. **First follow-up — a frame colour edit breaks that frame's alpha.**
   reel-core's `SymbolCell` merges `frameStyle` shallowly (`{ ...DEFAULT,
   ...config.frameStyle }`), and so does scene-edit's symbol mode: a
   colour-only state edit (`{ idle: { color } }`, exactly what the Reels
   colour picker writes) leaves `alpha` undefined → NaN in Pixi. Fix: a
   per-state merge `{ ...DEFAULT[k], ...frameStyle?.[k] }` in both, with a
   test. Older than this slice; its new UI makes it one click away.
2. **Small**: a board record with no symbol becomes `symbol: 'undefined'`
   through `cellData`; a `null` board column throws a TypeError diagnostic
   rather than a named one; a "couldn't apply … on the canvas" status
   stays after a later success; an emptied hex on a set colour shows no
   `aria-invalid`; the swatch flashes back for one round-trip after a
   pick; the colour default hint has no test; the reset button inside
   `<legend>` joins the group's accessible name; `snapshot().fitted` keeps
   the last size after a view drop; six section blocks could be one
   table; the 1000 px breakpoint; the Escape/outside-close logic duplicates
   ExplorerMenu's; no `aria-haspopup` on the painter's cells; the e2e polls
   `busy` rather than holding it.
3. **Not here**: presets, auto-replay, slow motion, a ways counter;
   `features1` steps from the canvas; the Reels UI in the reels package's
   own client half; `cellSizePerReel` items (`number | {width,height}`)
   still unsupported.

## Method

- **A form that writes data needs one test that the CONSUMER reads it**:
  every painter test passed while the runtime rendered the painted board
  empty — only an e2e step from paint to canvas caught it.
- **Two documents drawing the same rows need their own ids**: hidden but
  mounted documents share the DOM, so labels and handlers cross.
- **Showing an unset value as a concrete one is a lie the user acts on**:
  `0` for an unset gap and black for an unset colour both invited wrong
  edits.
- **The implementer's e2e found two bugs the unit tests could not** (a
  missing test hook in reels mode, an inverted Scatters gate): keep the
  e2e task last and let it fix what it finds, with a unit test each.
