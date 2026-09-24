# Slice 35 — the reel system in the engine, as plugins: what was left behind

Slice: `docs/superpowers/plans/2026-09-24-reel-system-plugins.md`, spec
`2026-09-24-reel-system-plugins-design.md` (F9 of the paper-duel round-4
report, plus bucket B's `slot` debts). Commits `8177cfb8..7bc31064` on
`feat/slot-webide-cordis` plus this note's. Designed with the user: the
engine gets its own reel system, forked from the legacy one, **plugin-based
through cordis and configurable per plugin**; ported straight into the plugin
structure; 35 = everything but the features, 36 = the 13 features + a plan
step `feature`; no compatibility for `reels1.config.config`.

What shipped:
- **`@energy8engine/reel-core`** — a library (no cordis): the forked grid,
  cell, geometry, config (no `features` section; `MotionStyleKey` is a string),
  `SpinEngine`, `AnticipationController`, `TumbleController`,
  `ReelStepController`, and a NEW `createReelSystem` whose motion styles,
  anticipator and board controllers are REGISTERED (factories
  `create(kit, config) → runner`, built lazily per grid).
- **Rows**, each with a full schemastery schema (every leaf described, pinned
  by a walker test) and `hot: true`:
  - `reels1` (`@energy8engine/reels`) — flat `{ grid, win, board }`; provides
    `board` and the `reels` service. No motion row → the reels snap with a
    warning; no cascade row → a `tumble` step fails with a message.
  - `motion1` (`@energy8engine/reels-motion`) — registers `swap`, `strip`,
    `cascade-drop` and picks one by `style`.
  - `anticipation1` (`@energy8engine/reels-anticipation`).
  - `cascade1` (`@energy8engine/reels-cascade`) — the `tumble` controller and
    the `reelStep` step (ported from `first-slot`'s plugin, which keeps only
    its mechanic). The row's presence IS the switch: `cascade.enabled` and
    slice 25's "two switches" are gone.
  - All four are in `e8-base`; `first-slot` and the template use the flat
    config. Nothing in `engine/` imports `@energy8platform/game-engine/slot`.
- **F9** — `SymbolCell.setData` keeps its view for the same symbol, so a
  refill/repaint rebuilds only changed cells; the symbols row's late-art path
  asks for `repaint({ remount: true })` explicitly. Proven on screen: a refill
  of one cell changes one view id (15 of 15 change with F9 off).
- **Bucket B** — a skipped tumble leaves no alpha/scale residue and no
  winning/fresh frame (reel step too); the fx overlay is swept only on the
  FIRST skip of a run (`BoardApi.skip({ overlays })`, the latch's re-fans pass
  `false`); the engine's `reelStep` handler now has a `skip`.

Unit gate: reel-core 77, reels 66, reels-motion 11, reels-anticipation 8,
reels-cascade 21, symbols 57, play-loop 87, flow 138, flow-fx 61, scenes 211,
ide-bridge 77, contracts 165, game-runtime 106, ide-client 688, ide-web 33,
e8 6, first-slot's reel-step plugin 11, ide-host (alone) 523; typecheck 0
everywhere.
Full Playwright alone (`E8_E2E_HOST_PORT=5779`): 155/155 in 10.3 min — on
the second run. The first (152/155) caught two regressions of this slice the
unit gate could not: Task 9's `__e8.refillCell` called `play.execute`, which
`flow.spec`'s "the page never drives a play" scan forbids (it now calls the
board's own `refill`), and `hot-fork.spec` still looked for the old nested
form field `#field-reels1-config-grid-cols`.

## Amendments made while running the plan

- **Planning rulings (in the plan):** no `onRebuild` (a hot `reels1`
  re-provides `reels`, cordis re-applies the plugin rows); styles and
  controllers are factories; the three built-in styles share one `SpinEngine`;
  the template never had a `reel-step` plugin; the caller decides the overlay
  sweep.
- **F9 broke the symbols row's late-art remount** (cell-scene copies have no
  `refresh`; they relied on `repaint` re-resolving). Kept F9, added the
  explicit `repaint({ remount: true })` path.
- **A second copy of the legacy engine.** `reel-core` declared
  `@energy8platform/game-engine: ^0.41.0`; the workspace is 0.44.1, which
  0.x semver does not match, so npm nested a registry 0.41.0 under it (its own
  `Tween`/`Ticker`). Now `"*"`; the stale entry had to be purged from the
  gitignored lockfile before npm let go of it.
- **Rows fill their own defaults.** The loader hands a row `{}` unvalidated
  (the schema only draws the IDE form), so `motion1` picked style `undefined`
  and `cascade1` had no timings. Each row merges over `DEFAULT_REEL_CONFIG`.
- **The ide-host tumble warning** now keys on "a tumble mechanic with no
  `reels-cascade` row".
- **`reels-cascade/src/reel-step.ts` → `reelStep.ts`** — `reel-step.spec`'s
  source scan asserts the engine never spells a project's mechanic id.
- **The engine-owned `reelStep` had no `skip`** (inherited from first-slot's
  step) — a skip during a reel-step chain played every round; fixed in the
  final wave.

## Debts

1. **Slice 36**: the 13 features, a feature registry row, and a plan step
   `feature` (`features/` was not forked).
2. **Four engine packages still carry a registry copy of game-engine 0.41.0**
   (`flow-fx`, `game-runtime`, `first-slot`, `slot-basic` declare `^0.41.0`):
   pre-existing; not on this slice's code paths (every tween on a reel object
   is reel-core's), but two `Tween`s in one page is a trap. `"*"` like
   reel-core, and purge the lock entries.
3. **reel-core needs `packages/game-engine/dist` built** (its README says so).
4. **Dead knobs**: `cascade1`'s `multiplier.*` (nothing draws it) and
   `perStepDecel*` for `tumble` (one step per call) — described honestly,
   not removed.
5. **A diagnostic is never retracted** — a fixed `style` keeps its "unknown
   style" row until reload (as every engine diagnostic today).
6. **`paper-duel`** (the user's tree) must move to the flat `reels1` config
   and the new rows; its `cascade.enabled`/`motion` keys go to `cascade1`/
   `motion1`.
7. **`tempo.spec` writes a dead `reels1.config.config.cascade.enabled`** — its
   tumble animates anyway (`cascade1` is in `e8-base`); drop the line.
8. Carried: i18n, a mobile tier, a glyph-map font; slice 34's "a `wait`
   before `spin` still drops a skip"; slice 30's cell-copy
   `refresh`/orientation.

## Method

- **A dependency range is a claim about the workspace** — `^0.41.0` against a
  0.44 workspace silently fetched a second engine. After adding a package,
  look under its own `node_modules` for a nested copy of a workspace package.
- **A schema the IDE draws is not a schema the loader applies** — rows must
  default themselves; a test with `{}` config catches it.
- **A spec edited but not run is not migrated** — Task 8 edited the e2e
  specs it found and ran none; the full suite found the one it missed and a
  hook that broke another spec's rule.
- **A reviewer who asks "what else relied on the old behaviour" finds the
  consumer** — F9's one real dependent (symbols' remount) surfaced from the
  implementer's failing test, not from the plan.
