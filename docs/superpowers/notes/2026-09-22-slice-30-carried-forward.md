# Slice 30 — symbol scenes, named states, count-up: what was left behind

Slice: `docs/superpowers/plans/2026-09-22-symbol-scenes.md`, spec
`2026-09-21-symbol-scenes-design.md` (round 2 of the paper-duel port: N1, N4,
N5). Commits `81493dbb..76c7bd00` on `feat/slot-webide-cordis` plus this
note's. Designed with the user (a composite state is a SCENE, not children on
a node; named states in a `states` map with a `playState` board step; count-up
as its own kind). Run per the standing method, three waves of parallel
implementers on disjoint packages.

What shipped: `ScenesService.mountCell(id, data) → { view, bind, once,
bound, destroy }` — a private copy of a scene document, per cell, whose
`$cell.<field>` props re-resolve on `bind`; the resolver itself (`cellProps`)
moved out of `@energy8engine/symbols` into `@energy8engine/scenes`, where
EVERY mount now resolves leniently and the host alone refuses a binding
outside a cell scene. `SymbolDef.states` + `stateNode` + `view.playState(name)`
(replaces one in flight; unknown → one `info`), and `playState` as the sixth
KNOWN board step (`BoardApi.playState`, the reels board, `skip()` draining
in-flight states through `showStatic`). The `count` flow-fx kind — a text
node counted up with the pipe formats (`formatValue` refactored out of
`expr.ts`), on an injectable `Clock`, one count per node at a time. The host's
cell-scene rule and state-name checks; the IDE's chip row with named states;
the example's `orb` cell scene, its `pop` state emitted by the `reel-step`
mechanic, and `show_win` as a `count`.

Unit gate: contracts 105, scenes 158, symbols 54, play-loop 66, reels 58,
flow 193, flow-fx 61, e8 6, ide-client 688, ide-host 513; typecheck 0 errors
in eleven packages incl. `ide-web`. Full Playwright alone: 151/151 in
12.6 min, first pass (149 + the slice's two new symbols cases).

## Amendments made while running the plan

- **The plan's `tryVariant` was wrong**: it validated the UNRESOLVED merge, so
  a portrait override on a bound node (`alpha: '$cell.hot'`, a COMMON number)
  threw and the override was dropped. `tryVariant`/`applyVariant` route
  through `resolveCell` now.
- **`resolveCell` substitutes bindings into `raw`, not only into `props`**:
  `mountNode` feeds `raw` to `applyCommon`, so a bound COMMON prop would have
  failed the node even with the resolver moved.
- **The plan's reels `skip()` claim was wrong**: `skip()` never touched cell
  views at all (`revealWins`'s `playWin` has the same pre-existing gap). A
  `statesPlaying` set now drains through `showStatic`.
- **A `scene` state's assets were preloaded from a race** (the Critical of the
  whole-branch review): the symbols row called `scenes.assetsOf(id)` before
  the scenes row had fetched its documents, and `assetsOf` answers `[]` for a
  document it does not have. In a built `dist` the symbol drew blank, with no
  diagnostic and no recovery (`refresh()` skips `scene` states); in the IDE it
  hid behind the host's boot `symbols` frame calling `replace()` a second
  time. `load()` awaits the scenes service's `ready` now.
- **`CellMount.once()` had no 600 ms floor**, so a state made of non-media
  nodes mounted and unmounted inside one microtask. It answers
  `Promise<boolean>` (did anything run) and `view.ts` keeps both floors — the
  package that knows how long a state should be seen keeps the policy.
- **`count` takes a node over**: with the example's `show_win` on
  `wait: false`, a flow that counts once per tumble segment can have two ramps
  writing one text node under turbo, and the loser's last frame lands after
  the winner's end value. A second count finishes the incumbent the way a skip
  does (its own end value, its branch released) and starts clean.
- `CellMount.bound` is a fact fixed at mount: a copy with no bound entry skips
  both the `bind` and the `fit` (`getLocalBounds()` walks the whole copy, and
  `bindAll` runs per cell per step).
- **`parseSymbolDef` silently dropped `def.states`** — a named state never
  survived its own `PUT /api/symbols`. Found and fixed inside Task 6.
- The host's recheck is ONE way (symbols → `scenesHost.recheck()`): the
  symbols check reads scene ids off the file tree, so the edge set is acyclic
  by construction and a `symbolsHost.recheck()` would have had no caller.
- A `states` key that shadows a built-in is refused by the host and by the
  IDE, and is inert in the runtime (`stateNode` takes the built-in branch) —
  three layers, one verdict.
- The example's cell-scene e2e proves the bound text mounts EMPTY:
  `first-slot`'s math hands the board as `[[int]]`, so `cellData` is
  `{ symbol }` and `'$cell.multiplier'` stands at its prop's empty. Asserted
  `cellText === ''` on a `'6'` cell and `null` elsewhere — which is what
  proves the text node came from the document at all.
- Slice 29's own debt surfaced here: `flow-properties.test.tsx` still asserted
  the OLD prop descriptions (that slice ran `ide-client`'s typecheck but not
  its tests), and the host's example-flow check did not know `count`.

## Debts

1. **Bucket B (`packages/*`)** unchanged: `ReelSystem.skip({ overlays: false })`,
   `TumbleController.skip()` residue, `PRELUDE_NUMBERS`, the SDK transport
   leak, an `i18n` hook. New neighbour: `SymbolCell.setData` destroys and
   re-resolves a cell's view unconditionally, so every `spinTo`/`refill`/
   `tumble`/`repaint` re-mounts the whole cell-scene document for all 30 cells
   — no leak, but a per-step cost proportional to the document's size.
2. **A `$cell` binding resolved with no cell is silent** at run time (a string
   renders empty, a number `0`, a boolean `false`, a union its first literal).
   The host refuses it in an ordinary scene, but `e8 build` does not abort on
   an error diagnostic, and a cell scene reached through a `scene` node or a
   flow `show` has no cell at all and nothing complains. A runtime `warning`
   on a binding resolved with no cell is the fix; it was ruled out of the
   final wave.
3. **A cell copy takes a portrait override at mount and never flips** (it
   lives outside `mounted`, which `applyVariant` walks). Documented in the
   scenes module doc.
4. **A cell copy never gets `refresh()`**, so an UNBOUND image inside a cell
   scene that was mounted before its texture landed stays blank until a
   remount; board cells self-heal on `load()`'s `board.repaint()`, a
   `symbols.preview(...)` container does not.
5. **A skipped state's own promise is not force-settled** — `showStatic()`
   fixes the picture, and a media state's `once` settles with the destroyed
   view, but a state whose type has no `once` waits out its 600 ms after a
   skip. Same shape as `revealWins`; a decision about the skip contract.
6. **`statesPlaying` is keyed by view identity**: two overlapping `playState`
   steps on ONE cell collapse to one entry and the first settle drops it, so a
   later `skip()` misses the second. `ponytail:` comment in place; the upgrade
   is a `Map<view, count>`.
7. **The template ships an inert showcase**: its `classic` mechanic never
   names `pop`, and its math carries no `multiplier`, so the orb's text is
   permanently blank. Both READMEs say so.
8. **paper-duel round 3**: the example (`engine/examples/paper-duel`,
   gitignored) was being re-done against these seams in the working tree
   while the slice ran — its flow now carries `count`, `emit` beats and
   `$cell`-bound orb scenes — but nothing in this slice measured it. The
   round-3 report is still owed.
9. **Machine**: the `ide-host` suite spawns a headless Chromium of its own
   (`compute-shot`), which drove the load average to 45 and made
   `files.test.ts` and `monaco-jsdom.test.tsx` fail on 5 s timeouts; both pass
   alone. The 2026-09-19 orphan family (PIDs 23248–23253) is still there.

## Method

- **A plan's sketch is a claim about code the planner did not read**: two of
  this plan's (the `tryVariant` "unchanged", the `skip()` "already calls
  showStatic") were false, and both were caught by the implementer reading the
  real call order rather than transcribing. Budget for it: a sketch that names
  an existing function's behaviour is the first thing to verify.
- **The whole-branch pass earns its seat on boot order**: the preload race was
  invisible to every task review (each package's tests fake the other), and
  invisible to the e2e (the IDE's second `replace()` hides it) — it needed
  someone reading two rows' boot fetches side by side.
- **"Pre-existing and unrelated" is a claim to check**: the two `ide-client`
  failures a task report dismissed were slice 29's own, left by a gate that
  ran a package's typecheck but not its tests. Run the suite of every package
  whose PUBLIC strings you changed.
- **A reviewer's "not a regression, but newly reachable" is a fix, not a
  note**: `count`'s missing per-target dedup predated the slice; the example's
  `wait: false` made it reachable, so the slice owns it.
- **A load-sensitive failure names itself**: same file, different test, 5 s
  timeouts, and a suite that spawns a browser. Check the load average before
  believing a flake.
