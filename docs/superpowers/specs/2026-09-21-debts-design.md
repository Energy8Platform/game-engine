# Debts — design (slice 28)

Date: 2026-09-21. Branch: `feat/slot-webide-cordis`. The user asked for the
debts of slices 21–27 to be fixed. This spec is the triage: bucket A is
fixed here; bucket B (`packages/*`, off limits by the standing rule) and
bucket C (product decisions) stay listed in the notes.

## 0. Rules

Each fix is the smallest change that closes the debt as the note states it;
no redesign rides along. A fix that turns out to need a design decision is
dropped back to bucket C with a one-line reason in the ledger. Every fix
carries a unit test; the browser proof is the existing e2e suite plus the
two test repairs in §7.

## 1. Flow (`@energy8engine/flow`, `flow-fx`, `play-loop`)

- **Diagnostic retraction.** `DiagnosticsService` gains
  `retract(plugin: string, where: string): void` (drops every entry with
  that speaker/where pair and notifies subscribers; `ide-bridge` forwards
  the list as it does today, so the IDE panel follows). The flow's
  interpreter retracts its own `flow`/`<node>` entries when a document is
  armed successfully after a refusal (the stale `unknown kind`).
- **A `step` loop cap.** The interpreter counts `step` hops per run;
  the 500th reports `step loop: 500 hops in one run` and leaves by
  `failed` (the CLI's cap, mirrored).
- **Re-arm after a bare `stop()`.** A kinds-registry change re-tries
  `replace` whenever a document is held but unarmed, not only after an
  `unknown kind` refusal.
- **`present.turbo` diagnostics.** A literal other than `'true'`/`'false'`
  (and a `$path` resolving to a non-boolean/non-number) → a warning
  `turbo "<v>" is not true/false`; the run continues without turbo.
- **`step.roundId` type guard.** A resolved non-string/empty `roundId` →
  `failed` with the same message shape as `action`'s.
- **No flow on the editor page.** `createGame({ provide: { editorPage:
  true } })` from `editor.ts` ×2; `flow1`'s `apply` reads
  `ctx.reflect.get('editorPage', false)` and, when set, provides `events`
  and `flowNodes` but neither fetches nor arms a document (the `flow`
  service answers `doc() === null`, `busy() === false`). Closes: `base_game`
  drawn under any other edited scene (21-11), the `reset` warning on the
  editor page (26-7), the spec's old `ui.tap` suppression stays.
- **Skip fan-out.** `PlayService`'s latched re-fan calls `board.skip?.()`
  ONCE per skip and only the handlers per later step (each `reelSystem.skip()`
  destroys the `fx` overlay's children).
- **`once` races.** `SymbolView`'s `playWin` (symbols) races a node type's
  `once` against the wrapper's `'destroyed'`; `strip`/`spritesheet`'s `once`
  queues a second call behind the first (both promises settle).

## 2. Scenes (`@energy8engine/scenes`, `scene-edit`, host `checkNode`)

- **`COLOUR` pattern** refuses malformed function forms: `rgb()`/`rgba()`/
  `hsl()` take numeric arguments only (a percent allowed where CSS allows
  it); the host and the runtime agree.
- **`emptyProp` for a `union`** yields the union's first literal.
- **`prop` on a `scene` node's `scene`** re-mounts the embedded document
  through the slice-27 `remountNode` device (the `setProps` path for an
  update-less type whose OWN prop changed), keeping show/hide bookkeeping
  right; a test through the flow's `prop` kind.
- **One rounding table.** `scene-edit`'s `applyEdit` rounds with the IDE's
  `DECIMALS` (exported from a shared place — `@energy8engine/contracts`
  `sceneRounding`), so an echo acks and no <0.5 px snap remains.
- **Grid snap on a pinned node** snaps the OFFSET (pointer − pin point) to
  the grid, not the absolute.
- **A mask node is pickable**: `pick` falls back to the view's own
  `getLocalBounds()` transformed to world when `getBounds()` is empty
  because `measurable` is false.
- **The safe area is re-read without a resize**: the scenes row compares
  the insets on each ticker frame (four numbers) and re-fits when they
  change — a `renderBar()` that re-scales the bar moves pinned nodes at
  once.
- **`SAFE_BOTTOM.mobile` = 131** (measured on the example at 390×844;
  the nominal 142 never occurs — the mobile bar scales); comment says so.
- **`checkNode` memoises** the rebuilt schema per `NodeTypeInfo` identity.
- **The asset-prop binding message**: `image.src: '$cell.symbol'` →
  `an asset prop cannot be bound to $cell (assets are preloaded from the
  document)`.

## 3. Symbols and the IDE (`@energy8engine/symbols`, `ide-client`)

- **`known` refreshes on the `symbols` frame** (the client's symbols
  service re-reads `game/spec.json`'s list when the frame lands, not only
  on GET/PUT answers).
- **`SymbolsProperties.write` goes through the document's commit chain**:
  `ctx.symbols.update(next)` serialises writes (the chain moves into the
  service; `SymbolsDocument` and `SymbolsProperties` both call it).
- **Flow palette drop position**: a new node lands at the centre of the
  visible viewport (React Flow's `screenToFlowPosition` of the pane's
  centre) instead of `80 + 40n`; `flow.spec`'s add-wait case loses its
  1200-px viewport.
- **`ide-web` TS7016**: a `src/monaco-subpaths.d.ts` declaring the six
  `monaco-editor/esm/...` subpaths as `any`-typed modules; `npm run
  typecheck -w @energy8engine/ide-web` goes clean.

## 4. Host and CLI (`@energy8engine/ide-host`, `e8`)

- **`config.action` in `dev-game`** is removed (the flow always posts an
  action); the doc line goes with it.
- **`.e8/shots` is visible in the Explorer**: `SKIPPED_DIRS` skips
  `.e8/game` (the assembled spin) but lists `.e8/shots/*.png`.
- **`e8 check` on a broken spec** answers the `spec` error alone (no
  `schema` block from the authored file); the CLI help's
  `incompleteRounds` line names the no-action case too.
- **Tumble needs two switches** — the host's composition check warns
  `mechanics1.config.tumble is on but reels1.config.config.cascade.enabled
  is off — the tumble is instant` when the pair disagrees.
- **`e8 shot` hides the dev chrome**: `PageLike.addStyleTag({ content })`
  (the fake gains it) and `shot` injects `#controls,#log{display:none}`
  after the spin settles, before the screenshot.
- **`session-sdk` handshake timeout** is row config `handshakeMs`
  (default 15000; the page outside a casino frame falls back sooner when
  set); **Artube's** `config.artube.currencyMinimalUnit` (decimals) and
  `defaultBetIndex` (an index into the ladder) are read leniently into
  `init`.
- **The dev wallet persists** in `sessionStorage` (`e8:wallet:<gameId>`)
  so a reload keeps the balance; `GET /api/session` still seeds 1000 when
  nothing is stored.

## 5. Tests

- **Quadrant checks** in `composition.spec.ts`/`schema.spec.ts` become
  "the board region's hash changes after a spin" (the canvas box clipped
  to the design's reel area, before vs after `__e8.spin()`).
- **`symbols.spec.ts:96`** polls 15 s.
- Every fix above: a unit test in its package (named per task in the
  plan).

## 6. Not here

- B (`packages/*`): `TumbleController.skip()`'s alpha/scale residue;
  `PRELUDE_NUMBERS` into `validate.ts`; the SDK transport leak on a failed
  `ready()`; an `i18n` hook in `ShellController`.
- C (product): session bet accounting; modals/replay/recovery/persisted
  volumes/resume; percent sizing/notches/breakpoints; `prop` as a map +
  `format`; the paytable derived into `gameInfo`; the double-tap skip;
  `text.font` swap through an override; the un-pin jump (documented);
  `--base` other than `/`; a fresh clone's dist prerequisite.
