# Slice 21 — symbols as data, `tween` and `sound`: what was left behind

Slice: `docs/superpowers/plans/2026-09-19-symbols-and-fx.md`, spec
`2026-09-19-symbols-and-fx-design.md`. Commits `081e378..c76713c` on
`feat/slot-webide-cordis` (twenty-six, three of them spec amendments) plus
this note's. The board's art is `symbols.yml` — a symbol is `static`,
optional `idle` and `win`, each any registered scene node type with its
props — built into the legacy `SymbolView` by `@energy8engine/symbols`
(row `symbols1`, before `reels1`): a centred wrapper fitted to the cell,
`playWin` only when the def has `win`, played through the new
`NodeType.once`, a coloured box and a diagnostic for an id the file does
not name. The host serves, writes and checks the document with the node
check it shares with scenes; the IDE has a Symbols document (rows, state
chips, Explorer drops, a live canvas in `scene-edit`'s symbol mode) and a
Properties panel. `@energy8engine/flow-fx` (row `fx1`, before `flow1`)
adds `tween` and `sound` to the flow. `main.ts` and `editor.ts` hold no
art. Sub-project D is closed. Full Playwright alone: 124/124.

## Amendments made while running the plan

- **`PUT /api/symbols` writes and reports; it refuses only a non-document**
  (spec §4, twice amended). The first version refused on any error-level
  check, which made every create path of the Symbols document (Add, Create
  state, Clear static, a type change) dead while a game was connected —
  those paths produce `src: ''` states the user fills in next. The scenes
  PUT rule. The answer is the GET shape `{ doc, known, diagnostics }`.
- **The host validates flow kinds only against a game's report** (slice
  19 debt 1, now user-facing): the example flow uses `sound`, which no
  built-in list knows, so the host reported `unknown kind 'sound'` at every
  boot and every preview reload. `validateFlow(doc, null, …)` until the
  first `flow-kinds` frame; the last non-empty report is retained.
- **`fx1` sits BEFORE `flow1`** and the interpreter re-tries `replace` when
  the kinds registry changes while a doc is held un-armed. `flow1`'s boot
  GET validated the document against the registry at that instant; the
  `fx1` module (pixi + `@pixi/sound`) could land after a localhost GET and
  the flow was refused forever. The bundle order is the guarantee (the
  loader imports rows sequentially; `inject: ['flowNodes']` wakes the
  moment `flow1` provides); the re-try covers a project row after `flow1`.
- `sound.src` is optional (`report` + `next`, the `video.src` precedent);
  `Sound.from({ url })` without `preload` (preload plus an immediate `play`
  loads and plays twice); an abort while waiting rethrows, never reports;
  `wait && loop` is a warning and fire-and-forget; every `play()`
  rejection is reported, on both `wait` paths.
- `fit()` measures the child's LOCAL bounds and maps their centre through
  the child's linear transform, so the common `x`/`y`/`scale`/`rotation`
  a state carries move, shrink and turn the art inside the cell (the
  wrapper-bounds pivot cancelled them all).
- Symbol mode hides `scenes.container` and draws the preview on
  `app.stage`: the editor page composes the whole bundle, so `flow1`'s
  `boot → show base_game` was rendering the game under the preview.
- The Symbols document's iframe `src` is constant (`editor.html?symbol=`);
  a selection is a `symbol` RPC, not a reload. `scene-edit` enters symbol
  mode on `config.symbol !== undefined`; `editor.ts` passes the param only
  when present.
- `ReelsBoard.repaint()` defers past an in-flight board op: `ReelSystem`
  sets its `board` only after `spin` resolves, so a repaint mid-spin
  re-seated the previous spin's symbols.
- `scenes.view(ref)` finds nested nodes, scoped to the scene's own
  `where` prefix (an embedded scene's nodes are in the host's `all`).
- `NodeType.once` resolves on the view's `'destroyed'` event and removes
  that listener on normal completion.
- `@energy8engine/symbols` does not augment `Context.assets` (reels
  declares it); `checkNode` is the node check `checkScenes` and
  `checkSymbols` share.

## Debts

1. **A refused-then-armed flow keeps its stale `unknown kind` diagnostic**
   until reload: `DiagnosticsService` is append-only. Retraction is the
   fix; the re-try only makes the flow run.
2. **`known` (the `game/spec.json` symbol list) refreshes only on GET/PUT
   answers**, not on the `symbols` frame — stale after a `spec.json` edit
   until the next write.
3. **`SymbolsProperties.write` bypasses the document's commit chain** (as
   `FlowProperties` does); two blur-commits in flight can reduce a stale
   doc. Move the chain into `ctx.symbols.update` when a third writer
   appears.
4. **A project node type whose `once` never settles hangs `revealWins`**
   to the interpreter's 30 s timeout — race `once` against the wrapper's
   `'destroyed'` inside `playWin`.
5. **`contain` fits on the unrotated bounds**: a 45° art overflows the
   cell by ~6 %. A doc `fit: <garbage>` is dropped by the parser without a
   diagnostic.
6. **Interpreter**: a bare `stop()` (no `replace`) followed by a kind
   registration no longer re-arms (the watcher retries only after an
   `unknown kind` refusal) — no live caller; a doc refused for both a
   cycle and a missing kind re-reports the cycle on each registry change
   until the kind lands.
7. **Symbols document**: `symbols-harness` re-declares `flow-harness`
   types and seeds no `scenes1` row; unused `hasLoop`/`STATES` exports; the
   `''` sentinel `dropTarget`; a duplicate `:has` rule and a `border-left`
   jitter on marked rows in `styles.css`.
8. **Host `flow.test.ts`**: the pre-report window now accepts a PUT with a
   kind nothing registers — caught once the game boots (the ruling's
   cost).
9. **e2e**: `symbols.spec.ts`'s frame-change check polls for frame 0 after
   Replay (frame 0 lasts ~83 ms at 12 fps) — timing-based by nature.
10. **Prettier drift** in `scene-edit/src/index.ts`, `flow/src/interpreter.ts`
    and their tests predates the slice; no engine package has a lint script.
11. **The scene canvas shows `base_game` beneath any other edited scene**
    (slices 18/19; the same root as the symbol-mode fix: the flow runs in
    the editor page).

## Method

- **A spec that contradicts itself across sections ships the stricter
  half.** §4 "refused on an error-level check" vs §5.2 "Add creates
  `src: ''`" survived three reviews until the first client test hit the
  real host check. When one section produces data another section
  rejects, decide at spec time which wins.
- **A registry consulted at one instant is a race with every later
  registration.** The flow interpreter validated kinds once; the bundle's
  import order decided whether the reference example ran. Any "validate
  then arm" against a live registry needs a re-try on change, and the
  rows that feed the registry listed before the one that reads it.
- **`iframe src` is state, not configuration.** A selection id in the URL
  reloaded the whole game per click; the component's own comment claimed
  the opposite and no test could see it because `ready` resent
  everything. Assert "did not reload" when the design says so.
- **Measure geometry with a 20-line scratch test.** The nudge promise
  (§3.1) and the rotation regression were both settled by running the
  real `image` type through `fit()`; four reviews had read the code.
- **The editor page composes the whole bundle.** "The canvas shows only X"
  must account for `flow1`'s boot run there.
- **"Measured synchronous" is not "safe at any time".** `setBoard` is
  synchronous; its correctness depends on `reelSystem.board` being current,
  which it is not for the whole of `spin()`.
- **A fixture change can boot a process.** Giving a test fixture a
  `game/spec.json` with an `id` spawned a real `e8-server` per test
  (12 s → 0.3 s once the `id` was dropped). Read what the scope does
  with a file before adding it to a fixture.
- **One residual fix after the final wave is cheaper than carrying a
  regression the wave itself introduced** — ledgered as an adjudication,
  gated by unit tests only.
