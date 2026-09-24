# Slice 33 — declared assets, and `scenes.once`: what was left behind

Slice: `docs/superpowers/plans/2026-09-23-declared-assets-and-once.md`, spec
`2026-09-23-declared-assets-and-node-once-design.md` (F8 and the `strip` item
of F10 from the paper-duel round-4 report). Commits `38e37ca3..5bb24cd9` on
`feat/slot-webide-cordis` plus this note's. Designed with the user: F9 (a
full-board `refill` rebuilds every cell) is DEFERRED — the rebuild is the
legacy `SymbolCell.setData` (`packages/game-engine`, bucket B), and the
engine-side workaround (writing into `ReelSystem.board` in place) was
declined; it belongs to a slice that brings the reel system into the engine.
The rest of F10 needed no code (one `ART` table + `require(Object.values(ART))`;
a second node takes the same `srcOf`).

What shipped:
- **`AssetLoader.expect?(urls)`** — paths something declared it will load. The
  pixi loader counts them as asked, so `get` no longer reports
  `nothing loaded` for a hidden document's art after the first batch settled.
  Called by `scenes.replace` (every declared document's `assetsOf`, before the
  remount), by `scenes.require` (at once, not when its batch runs) and by
  `symbols.replace` (every non-`scene` state's art, before live handles
  re-mount; `scene` states are the scenes row's). Additive: a path stays
  declared after the document naming it is gone. Optional: a loader without it
  behaves as before.
- **`scenes.once(ref): Promise<boolean>`** — plays a node's type `once` (a
  strip's one-shot) on every mounted copy and settles when the last ends;
  `false` for a type without one, `false` + an error for a node nothing
  mounted; a throwing copy is reported and the others play. `visible` is the
  caller's.

Unit gate: scenes 211, symbols 57, node-media 48, scene-edit 54, ide-bridge
77, flow 134; typecheck 0 in all six.
Full Playwright alone (`E8_E2E_HOST_PORT=5779`, 19.3 min, load average 5–10):
150/153. The three failures are timing budgets, none this slice's:
`headless.spec` (`e8 shot` load 3535 ms) and `runtime.spec` (IDE preview load
3934 ms) against `LOAD_BUDGET_MS` 2500, and `tempo.spec`'s 100 ms skip (slice
32's debt 10). Proven by A/B, back to back: the two load specs with this
slice's `src` changes reverted in the working tree fail the same way (4063 /
4672 ms, then 4327 / 6884 ms, load average 10–16); the changes were re-applied
and the tree checked clean after. The budget was set at 3 × an 810 ms median
on an idle machine — this one has not been idle for two slices.

## Amendments made while running the plan

- **No browser case for F8.** The false warning needs a `get` AFTER the first
  batch settled (a remount, a re-apply), which a browser run cannot schedule
  without the IDE; an integration test through the real scenes row (the pixi
  loader and `replace` wired as the game wires them) stands in for it.
- **`once` passes `mountCtx([])`, not the plan's bare `ctx`** — the service
  object has no `ctx` in scope (the plan's snippet was copied from
  `CellMount.once`, where one is). The implementer reported the bare `ctx`
  "passed typecheck"; the whole-slice review re-ran `tsc` and it does not
  (TS2304) — the implementer had seen vitest, which does not typecheck.
- **`symbols.replace` expects too** (final wave): the whole-slice review found
  a symbols.yml hot edit adding art to a non-`scene` state could still warn,
  since live handles re-mount before `load()` runs.

## Debts

1. **F9** — a `refill` rebuilds all thirty cells (bucket B). Waits for the
   reel system in the engine.
2. **`once` answers `true` when every copy threw** (errors reported) — same as
   `CellMount.once`.
3. **The expected set only grows** — a path removed from every document never
   warns again. By design, pinned by a test.
4. **A skip before the plan starts is dropped** (slice 32's debt 10) — still
   open; it is also why `tempo.spec`'s skip cases race the network under load.
5. Carried: i18n, a mobile asset tier, a bitmap glyph-map `text` font;
   bucket B; slice 30's cell-copy `refresh`/orientation; slice 29's
   `emit { wait }` vs abort.
6. **paper-duel**: the knight's attack can drop its 1400 ms timer for
   `setProps(visible) → await scenes.once(ref) → setProps(hidden)`.
   Unmeasured here.

## Method

- **A "typecheck passed" claim is checked against `tsc`, not the test run** —
  vitest strips types; the implementer's claim was wrong and only a reviewer
  re-running `tsc` said so.
- **A fix to a shared contract names every row that mounts before it loads**:
  the plan covered the scenes row and missed symbols, which has the same
  mount-then-load order.
