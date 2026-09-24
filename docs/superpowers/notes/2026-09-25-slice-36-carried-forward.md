# Slice 36 — reel features as data-driven plan steps: what was left behind

Slice: `docs/superpowers/plans/2026-09-24-reel-features.md`, spec
`2026-09-24-reel-features-design.md` (slice 35's debt 1). Commits
`4d90ede8..5d0d0fdf` on `feat/slot-webide-cordis` plus this note's.

Designed with the user, after reading the legacy `features/`: they were
DEMOS — each invented its own outcome (a random reel, hard-coded `[2, 3, 5]`,
the first three symbols) and most of their config was math (`chance`,
`triggerThreshold`, `respinsAwarded`, weighted pools). So a feature here is
**a plan step that carries the mechanic's outcome and only animates it**; one
step kind per feature in play-loop's existing `steps` registry (no `feature
{ key }` dispatcher, no second registry); nine kinds in one slice; no IDE
preview generator.

What shipped:
- **`@energy8engine/reel-core`**: `src/fx/` — the legacy animation
  primitives (`cellCenter`, `rowStepOf`, `colStepOf`, `glowRing`,
  `pulseCell`, `floatLabel`, `morphSymbol`, `dropCell`) forked, plus
  `moveCell`; `ReelSystem.onSpinStart(fn)`.
- **`@energy8engine/reels-features`**, row `features1` in `e8-base`: nine
  step kinds — `expandWild`, `walkWild`, `dropWilds`, `reveal`,
  `transform`, `multipliers`, `sticky`, `giant`, `nudge` — on one shared
  `createFeatureHandler` (look up the reels, check the data, animate,
  re-seat the board through its `refill`); a per-run pace (turbo ×0.5; skip
  kills the tweens and ends the run at once, every touched cell homed,
  tracked labels/views finalised); a persistent overlay layer beside `fx`
  for `sticky` rings (until `sticky { on: false }`) and `giant` views
  (until the next spin starts or `giant { clear: true }`). Config is
  presentation only, one section per kind with `enabled`; the runtime's
  defaults come from the schema's own `Config({})`.
- **Data is checked**: a cell past a reel's own height, an empty list, a
  giant that does not fit, a `settled` column of the wrong length — each
  throws a message naming the step and field; the board is untouched.
- **`__e8.featureOverlays()` and `__e8.cellMultiplier()`** — read-only
  hooks in both `main.ts` copies.
- **e2e `features.spec.ts`**: a fixture mechanic (written into the project
  copy) plays all nine from fixed data; the board after each, the
  multipliers read positively, sticky kept and giant cleared by the next
  spin, and an explicit `giant { clear: true }`.

Unit gate: reel-core 86, reels 66, reels-motion 11, reels-anticipation 8,
reels-cascade 21, reels-features 95, symbols 57, play-loop 87, flow 138,
scenes 211, contracts 165, game-runtime 106, ide-bridge 77, ide-client 688,
ide-web 33, e8 6, ide-host (alone) 523; typecheck 0 everywhere.
Full Playwright alone (`E8_E2E_HOST_PORT=5779`): 156/156 before the final wave
(10.7 min) and 156/156 after it (10.9 min).

## Amendments made while running the plan

- **One handler shape** (`createFeatureHandler`) instead of nine hand-rolled
  ones; a kind returning no changed cells skips the re-seat (`sticky`).
- **Skip ends the run at once** rather than waiting out a `Tween.delay`
  (a killed morph would otherwise restart at full length); the shared skip
  grew to track float labels and views (`run.label`, `track`).
- **`multipliers` proven positively** in the browser (the task review): a
  `cellMultiplier` hook, since `symbols()` cannot see a multiplier.
- **An explicit `giant { clear: true }`** (the whole-slice review): a giant
  otherwise stayed drawn, its cells hidden, through every later board step
  of the same plan — the screen disagreed with the board until the next
  spin. Not also on `cascade()`: `reelStep` bypasses the reel system, so
  that would be a second, still-leaky mechanism.

## Debts

1. **A mechanic must emit `giant { clear: true }` before a
   `tumble`/`reelStep`/`refill` over a giant's area** — in the spec and in
   `giant.ts`'s comment, not yet in the package README.
2. **Not features here**: `stacked`, `reelModifier`, `holdAndSpin`, `split`
   (spec §0). No IDE preview generator. No feature wired into
   `first-slot`'s own math.
3. **Error texts**: a missing/null `symbol`/`to`/`settled` entry throws
   `cellData`'s raw TypeError instead of a message naming the step (board
   untouched).
4. **Tests not pinned**: the real skip order (board's `fx` sweep before the
   handler's skip); `giant` with no art for its symbol (no overlay, board
   still re-seated); a partial nested row-config override; two
   `onSpinStart` listeners' order; `pulseCell`/`floatLabel` in `fx.test`.
5. **Couplings**: `layer.ringOn` labels the ring by `children[length-1]`
   after `glowRing`; `run.label` assumes `floatLabel` adds its Text before
   its first await; the easing-name list is copied from reel-core (as in
   reels-motion).
6. Carried from slice 35: four packages with a registry copy of game-engine
   0.41.0; `tempo.spec`'s dead `cascade.enabled` line; `paper-duel` must move
   to the new rows; i18n, mobile tier, glyph font.

## Method

- **Read the thing you port before deciding what it is**: the legacy
  features looked like a presentation layer and were demos with their own
  math — porting them as-is would have drawn outcomes the player did not win.
- **A persistent overlay needs a named end on every path that changes the
  board beneath it**, not only on the one the spec pictured (the next spin).
- **Batch same-shape tasks, but carry the shared rule into the dispatch**
  (`pace.skipped` after every await; tracked labels) — the batch's reviewer
  checks the rule once, not five times.
