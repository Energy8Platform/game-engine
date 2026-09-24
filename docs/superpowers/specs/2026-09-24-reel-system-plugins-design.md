# The reel system in the engine, as plugins — design (slice 35)

Date: 2026-09-24. Branch: `feat/slot-webide-cordis` at `86608676` (slice 34).
Source: F9 of the paper-duel round-4 report (a full-board `refill` rebuilds
every cell) and bucket B — the debts that live in the legacy
`@energy8platform/game-engine/slot` the engine's `reels` row wraps.

Decided with the user:
- the engine gets its OWN reel system, forked from the legacy one, and it is
  **plugin-based through cordis and configurable per plugin** — motion,
  cascade/reelStep, anticipation and features are separate rows with their
  own schemas;
- the port goes **straight into the plugin structure** (no 1:1 wrapper step);
- slicing: **35 = everything but the features** (core, motion,
  cascade/reelStep, anticipation, F9); **36 = the 13 features + a plan step
  `feature`**. The engine's plan never calls a feature today, so after 35 the
  engine no longer depends on the legacy `slot` at all;
- **no compatibility** for the old row config shape (`reels1.config.config`):
  the example and template move; the user's `paper-duel` tree is theirs to move.

## 0. Rules

- `packages/*` is not edited. The legacy `slot` stays as it is, for legacy
  games; the engine stops importing it.
- The engine keeps importing `@energy8platform/game-engine/animation`
  (`Tween`, `Easing`) — `flow-fx` already does; forking the tween is not this
  slice.
- Behaviour is kept, except where this spec says otherwise (§4): every legacy
  `slot` test that covers a forked module is forked with it and stays green,
  and the full e2e suite keeps its expectations.
- Every row's config is a schemastery schema with defaults and descriptions —
  what the IDE draws a form from — and every row is `hot: true`, so an edit in
  the IDE re-applies it live.

## 1. Packages

| package | kind | holds |
|---|---|---|
| `@energy8engine/reel-core` | library, no cordis | forked `ReelGrid`, `SymbolCell`, geometry, `SymbolView`/`SymbolResolver`, the config types and defaults of every section, the controllers (`SpinEngine` split by style, `TumbleController`, `ReelStepController`, `AnticipationController`, `ReelSpinController`/`CascadeController` if the forked code needs them), `easing-map`, and the contracts of §2 |
| `@energy8engine/reels` (existing) | row `reels1` — the core | the grid, the board, `BoardApi`, the `reels` service (§2) |
| `@energy8engine/reels-motion` | row `motion1` | the three styles `swap`, `strip`, `cascade-drop`; the active one is chosen by config |
| `@energy8engine/reels-cascade` | row `cascade1` | the `tumble` controller and the `reelStep` step |
| `@energy8engine/reels-anticipation` | row `anticipation1` | the anticipator |

`reel-core` is to the rows what `executePlan` is to the play row: plain
TypeScript + pixi, tested without cordis; the rows are thin adapters.

Not forked: `devtools/`, `overlay/` (`BigWinOverlay`, `CountUpDisplay`,
`tiers`), `multiplier/MultiplierAccumulator`, `config/presets`, `features/`
(slice 36).

## 2. The contracts

In `reel-core`:

```ts
/** A way the reels spin to a target. Registered by key; `motion1` picks one. */
interface MotionStyle {
  key: string;
  plan(kit: ReelKit, target: CellData[][], opts: SpinRunOpts): ReelStopPlan[];
  run(kit: ReelKit, target: CellData[][], opts: SpinRunOpts): Promise<void>;
  skip(): void;
}

/** Which reels get the anticipation treatment, and the zoom around it. One at a time. */
interface Anticipator {
  decide(target: CellData[][]): AnticipationDecision;
  zoomIn(grid: ReelGrid): Promise<() => Promise<void>>;
}

/** A board step the core does not perform itself (today: `tumble`). */
interface BoardController<S> {
  kind: string;
  run(kit: ReelKit, step: S, opts?: StepOpts): Promise<void>;
  skip(): void;
}
```

`ReelKit` is what a plugin gets: `grid`, `fx`, `resolve`, `win`, `board` and
`setBoard(board)`, and the motion config the active style runs with.

The `reels` service (provided by `reels1`):

```ts
interface ReelsService {
  kit(): ReelKit;
  motions: { register(style: MotionStyle): () => void; get(key: string): MotionStyle | undefined; keys(): string[] };
  /** The active style — set by `motion1` from its config. */
  useMotion(key: string, config: MotionConfig): () => void;
  anticipation: { set(a: Anticipator): () => void };
  controllers: { register(c: BoardController<unknown>): () => void };
  /** Fires after the grid is rebuilt (a geometry change) — a plugin holding the grid rebinds. */
  onRebuild(fn: () => void): () => void;
}
```

Every `register`/`set`/`use*` returns its disposer, and each row registers
inside `ctx.effect`, so disposing or hot-re-applying a row takes its
registrations back.

## 3. The rows

### 3.1 `reels1` — the core

Config (flat; the old nested `config.config` is gone):

```yaml
- id: reels1
  config:
    grid: { cols: 5, rows: 3, cellSize: 96, gap: 6, … }   # the whole GridConfig
    win: { … }                                             # WinConfig
    board: …                                               # the initial board, optional
```

It builds the grid, provides `board: BoardApi` exactly as today
(`spinTo`, `revealWins`, `remove`, `refill`, `tumble`, `playState`, `skip`,
`grid`, `repaint`, …) and the `reels` service.

- `spinTo`: the active motion style's `plan`/`run`, with the anticipator's
  decision folded into the run options (the legacy `resolveAnticipation` /
  `mergeAnticipation`, moved here), and its `zoomIn` around the run. No
  motion row: the board is set at once and a `warning` says so
  (`no motion row — the reels snap to the result`). No anticipator: no
  anticipation.
- `tumble`: delegated to the registered `tumble` controller. None: the step
  fails with `no reels-cascade row — a tumble step cannot play`.
- `skip`: the active style's, every controller's, and the overlay sweep —
  the legacy `ReelSystem.skip()` behaviour (§4.2 changes one part).
- A geometry change in a hot re-apply rebuilds the grid (the legacy
  `geometryChanged` rule) and fires `onRebuild`.

### 3.2 `motion1`

Config: `style` (a string naming a registered style; default `swap`) and the
whole `MotionConfig` (`spinUp`, `hold`, `stopStagger`, `stopMode`,
`stopOrder`, `settle`, `squash`, `blur`, `turboFactor`, `intensity`,
`slamStop`, `symbolsPerReel`, `cellStagger`, `reelStaggerFactor`,
`dropFallFactor`, …). It registers the three built-in styles and calls
`useMotion(style, config)`. A style a game plugin registers is chosen the same
way. An unknown `style` is an `error` naming the registered keys, and the
reels snap as with no motion row.

### 3.3 `cascade1`

Config: the whole `CascadeConfig`. Registers the `tumble` controller in
`reels`, and the `reelStep` step (kind `reelStep`) in play-loop's `steps`
registry — the step `first-slot`'s `reel-step` plugin registers today by
building the legacy `ReelStepController` itself. The row being composed IS
the switch: `cascade.enabled` is gone, and with it the "two switches" debt of
slice 25 (the mechanic's `tumble: true` stays — that is the MATH choosing to
emit tumble steps). The running multiplier is the controller's, as today.

`first-slot`'s and the template's `reel-step` plugin keeps its mechanic and
drops its step (`step.ts`); their `e8.patch.yml` composes `cascade1`.

### 3.4 `anticipation1`

Config: the whole `AnticipationConfig`. Sets the anticipator in `reels`.

## 4. What changes in behaviour

### 4.1 F9 — a cell keeps its view for the same symbol

`SymbolCell.setData(data)` destroys and re-resolves the view only when the
symbol id changes (or there was no view); for the same id it keeps the view
and updates the data and the badges. So `setGrid` — and every `refill`,
`remove` re-sync and `repaint` — rebuilds only the cells whose symbol changed.
The reels row's `bindAll` still re-binds every cell (a symbol state's `$cell`
props read the new data).

### 4.2 Bucket B, where the fork reaches it

- **The overlay sweep on every latched skip** — `ReelSystem.skip()` destroys
  the `fx` layer's children, and the play row's latch fans a skip onto every
  later step, so a skipped tumble chain wiped a game's overlay art once per
  step (slice 28). The core's skip takes `{ overlays?: boolean }` (default
  `true`, the legacy behaviour); `BoardApi.skip` sweeps the overlay only on
  the FIRST skip of a run and passes `overlays: false` for the latch's
  re-fans.
- **`TumbleController.skip()` leaves alpha/scale residue** on cells killed
  inside its `Tween.delay(t.wait)` window (`_resetPositions` runs before the
  remove tweens start — slice 25). The forked controller does what
  `ReelStepController.skip()` does: it snaps the pending settled grid and
  resets every cell's alpha and scale, with a test that a skip inside the
  delay window leaves no cell at alpha < 1 or scale ≠ 1.
- `PRELUDE_NUMBERS`, the SDK transport leak, the shell's `i18n` hook are not
  in the `slot` module and stay in bucket B.

## 5. Tests

- `reel-core`: the forked legacy tests for every forked module
  (`packages/game-engine/tests/slot/*` minus overlay/multiplier/devtools),
  adapted only in import paths and in the split of `SpinEngine` by style;
  new: `setData` with the same symbol keeps the view object (identity), a
  different symbol replaces it; the two bucket-B fixes.
- `reels`: the service's registries (register/dispose, hot re-apply), `spinTo`
  with and without a motion style and an anticipator, `tumble` without a
  cascade row fails with the message, the flat config.
- `reels-motion`, `reels-cascade`, `reels-anticipation`: each row registers
  on apply and unregisters on dispose; an unknown `style` reports.
- e2e: the full suite unchanged in its expectations; `first-slot` and the
  template compose `motion1`/`cascade1`/`anticipation1`; one new case: a
  `refill` that changes one cell rebuilds one cell's view (the other views
  keep their identity — read through `__e8`).
- ide-host / template pins: whatever pins the template's `e8.patch.yml` and
  bundle rows moves with them.

## 6. Not here

- The 13 features, `registerFeature`/`runFeature`, and a plan step `feature`
  (slice 36).
- Forking `Tween`/`Easing`.
- The legacy `slot` itself, and the user's `paper-duel` tree.
