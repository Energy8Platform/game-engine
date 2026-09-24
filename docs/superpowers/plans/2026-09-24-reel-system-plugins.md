# Reel system as plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The engine stops importing the legacy `@energy8platform/game-engine/slot`: a forked library `@energy8engine/reel-core` plus four cordis rows — `reels1` (core), `motion1`, `cascade1`, `anticipation1` — each with its own full schema; F9 and two bucket-B debts fixed in the fork.

**Architecture:** `reel-core` is plain TypeScript + pixi (no cordis): the forked grid/cell/geometry/config/controllers, and a NEW pluggable `createReelSystem` whose motion styles, anticipator and board controllers are registered, not built in. The `reels` row wraps it as today's `BoardApi` and provides it as the `reels` service; the three plugin rows `ctx.inject(['reels'])` and register into it (a hot re-apply of `reels1` re-provides the service, and cordis re-applies the dependents — which is why the spec's `onRebuild` is not needed, see Amendments).

**Tech Stack:** TypeScript, pixi.js v8, cordis 4, schemastery, vitest, Playwright; `@energy8platform/game-engine/animation` (`Tween`, `Easing`) stays imported.

**Spec:** `docs/superpowers/specs/2026-09-24-reel-system-plugins-design.md`

## Global Constraints

- `packages/*` is not edited (the legacy `slot` is only READ, as the fork's source).
- The engine keeps importing `@energy8platform/game-engine/animation` for `Tween`/`Easing`; nothing in `engine/` imports `@energy8platform/game-engine/slot` after Task 8.
- Behaviour is kept except where the spec says otherwise (§4): every forked legacy test stays green (adapted only in import paths and in how the system is constructed).
- Every row's config is a schemastery schema with a default and a `.description()` for every field; every row's `package.json` `e8` block says `"hot": true`.
- No compatibility for `reels1.config.config` — the flat shape only.
- One workspace per test command: `npm test -w @energy8engine/<pkg>`, `npm run typecheck -w @energy8engine/<pkg>`. `@energy8engine/ide-host` runs ALONE (it spawns Chromium).
- Playwright ALONE, one spec file at a time unless a step says otherwise, with `E8_E2E_HOST_PORT=5779`, from `engine/apps/web`.
- After adding a package under `engine/*/*`, run `npm install` at the repo root once so the workspace symlink exists.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`. Never `git stash`/`checkout`/`restore`.

## Amendments to the spec (rulings made while planning)

1. **No `onRebuild`.** `reels1` is `hot`: a re-apply builds a NEW reel system and re-provides `reels`; every plugin row that `ctx.inject(['reels'])`s is re-applied by cordis against the new one. A geometry change needs nothing more.
2. **Styles and controllers are FACTORIES.** The spec's `MotionStyle { plan, run, skip }` and `BoardController { run, skip }` become `create(kit, config) → runner` (§ Task 3 contracts): a runner holds grid-bound state (the forked `SpinEngine`/`TumbleController` take the grid in their constructor), so the registry holds the recipe and the system builds the runner lazily for its own grid.
3. **The built-in styles share the forked `SpinEngine`.** `swap`, `strip`, `cascade-drop` are three registered keys whose `create` builds a `SpinEngine` with that style — the spec's "split by style" is the registry, not three copies of the engine. The legacy config's string-union type `MotionStyle` is renamed `MotionStyleKey` (a `string`) in the fork so the plugin interface can own the name.
4. **The template has no `reel-step` plugin** — only `first-slot` does; the template moves its `reels1` config and composes the new rows.
5. **Overlay sweep once per run** is decided by the CALLER: `BoardApi.skip(opts?: { overlays?: boolean })`; the play row passes `{ overlays: false }` on the latch's re-fans (`onStepStarted`) and nothing on the first skip. `play-loop` gets that two-line change in Task 4.

## Review Focus

1. A `spinTo` with no `motion1` row, or a `style` nothing registered: the board lands on the result (never a stuck promise) and one diagnostic says why. Pinned in Task 3 and Task 4.
2. A hot re-apply of `reels1` (a grid edit in the IDE) while `motion1`/`cascade1`/`anticipation1` are composed: the new system has every registration again. Pinned in Task 4 (a cordis test re-applying the row).
3. `SymbolCell.setData` with the same symbol but different extras (`band`, `mv`): the view is kept AND `cell.data` is the new record (a symbol state's `$cell` props read it on the next `bind`). Pinned in Task 1.
4. A skip during `TumbleController`'s `wait` window: no cell left at alpha < 1 or scale ≠ 1, grid on the settled board. Pinned in Task 2.
5. The latch's re-fanned skips must not wipe `fx`; the first skip still does. Pinned in Task 4.

---

### Task 1: `@energy8engine/reel-core` — package, grid layer, config, F9

**Files:**
- Create: `engine/game/reel-core/{package.json,tsconfig.json,vitest.config.ts}` — copy `engine/game/reels`'s three files and change: `name` `@energy8engine/reel-core`; `exports` `{ ".": "./src/index.ts" }`; NO `e8` block (a library, not a row); `dependencies`: `@energy8platform/game-engine` (same range as `reels`), `pixi.js`, nothing else.
- Create (forked): `engine/game/reel-core/src/grid/{SymbolView,AnimatedSymbol,SymbolCell,ReelGrid,geometry}.ts`, `src/anim/easing-map.ts`, `src/config/ReelSystemConfig.ts`, `src/index.ts`
- Create (forked tests): `engine/game/reel-core/tests/{geometry,reelGrid,symbolCell,animatedSymbol}.test.ts`

**Interfaces:**
- Produces: `SymbolView`, `SymbolResolver`, `AnimatedSymbol`, `SymbolCell`, `CellData`, `CellState`, `CellFrameStyle`, `ReelGrid`, `ReelGridConfig`, `resolveGeometry`, `cellPositionOf`, `easingByName`, `EASING_BY_NAME`, and from the config: `ReelSystemConfig` (sections `grid`, `motion`, `anticipation`, `cascade`, `win` — NO `features`), `GridConfig`, `MotionConfig`, `MotionStyleKey`, `AnticipationConfig`, `CascadeConfig`, `WinConfig`, `DeepPartial`, `DEFAULT_REEL_CONFIG`, `resolveReelConfig`, `mergeReelConfig`, `effectiveRowsPerReel`, `resolveGridGeometry`, `waysCount`, `perReelValue`, `INTENSITY_SCALE` and every sub-type the legacy file exports for those sections.

- [ ] **Step 1: Fork the files.** Copy each from `packages/game-engine/src/slot/<same path>`. Then, and only then:
  - `'../../animation'` → `'@energy8platform/game-engine/animation'`.
  - `easing-map.ts`: replace `import type { EasingFunction } from '../../types';` with a local `type EasingFunction = (t: number) => number;`.
  - `ReelSystemConfig.ts`: delete the `features` section — `FeaturesConfig`, every `*Config` type only it uses, `FeatureKey`, `FEATURE_KEYS`, the `features` key of `ReelSystemConfig` and of `DEFAULT_REEL_CONFIG` (and of `resolveReelConfig`/`mergeReelConfig` if they name it). Rename the string-union type `MotionStyle` → `MotionStyleKey` and widen it to `string` (keep the three literals in its doc comment as the built-ins).
  - `src/index.ts`: export exactly the "Produces" list.
  - First line of each forked file: `// Forked from packages/game-engine/src/slot/<path> (slice 35).`
- [ ] **Step 2: Fork the tests** from `packages/game-engine/tests/slot/<name>.test.ts`, imports rewritten to `../src/...`. Run `npm install` (root), then `npm test -w @energy8engine/reel-core` — Expected: PASS (the forked code is unchanged in behaviour).
- [ ] **Step 3: Write the F9 tests (failing)** in `tests/symbolCell.test.ts`:

```ts
describe('F9 — a cell keeps its view for the same symbol', () => {
  const resolve = vi.fn(() => new Container() as unknown as SymbolView);
  const cell = () => new SymbolCell({ width: 10, height: 10, resolve } as SymbolCellConfig);

  it('the same symbol keeps the view object; the data is the new record', () => {
    const c = cell();
    c.setData({ symbol: 'orb', band: 'green' } as CellData);
    const first = c.view;
    resolve.mockClear();
    c.setData({ symbol: 'orb', band: 'red' } as CellData);
    expect(c.view).toBe(first);
    expect(resolve).not.toHaveBeenCalled();
    expect((c.data as CellData & { band: string }).band).toBe('red');
  });

  it('a different symbol replaces the view', () => {
    const c = cell();
    c.setData({ symbol: 'a' });
    const first = c.view;
    c.setData({ symbol: 'b' });
    expect(c.view).not.toBe(first);
  });

  it('null clears it, and a symbol after null resolves again', () => {
    const c = cell();
    c.setData({ symbol: 'a' });
    c.setData({ symbol: null });
    expect(c.view).toBeNull();
    c.setData({ symbol: 'a' });
    expect(c.view).not.toBeNull();
  });
});
```

(Use whatever `SymbolCellConfig` fields the forked constructor requires — read it; the assertions stay.) Run — Expected: the first case FAILS (`resolve` called again, a new view).

- [ ] **Step 4: Implement F9** in the forked `SymbolCell.setData`:

```ts
  setData(data: CellData): void {
    if (this.destroyed) return; // a killed-tween chain may resume after the cell is gone
    const previous = this._data?.symbol;
    this._data = data;
    if (data.symbol == null) {
      if (this._view) {
        this._view.destroy();
        this._view = null;
      }
    } else if (!this._view || previous !== data.symbol) {
      // F9 (slice 35): only a CHANGED symbol re-resolves — the same id keeps its view, so a
      // full-board `setGrid` (a refill, a repaint) rebuilds only the cells that changed.
      if (this._view) {
        this._view.destroy();
        this._view = null;
      }
      const v = this._resolve(data.symbol);
      if (v) {
        v.resize?.({ width: this._w, height: this._h });
        this.addChildAt(v, 1); // above frame, below badges
        this._view = v;
      }
    }
    // badges
    this._setMultiplier(data.multiplier);
    this._setBonus(data.bonus);
  }
```

(Keep the forked file's own field names if they differ.) Run tests — PASS. Typecheck — 0.
- [ ] **Step 5: Commit** — `git add engine/game/reel-core package-lock.json` (only if `npm install` changed it) — message `Reel core: the grid layer forked into the engine, and a cell keeps its view for the same symbol`.

---

### Task 2: reel-core — the controllers, and the tumble skip residue

**Files:**
- Create (forked): `engine/game/reel-core/src/motion/{SpinEngine,AnticipationController}.ts`, `src/cascade/{TumbleController,ReelStepController}.ts`; export them from `src/index.ts` (`SpinEngine`, `SpinData`, `SpinRunOpts`, `ReelStopPlan`, `AnticipationController`, `AnticipationDecision`, `TumbleController`, `TumbleStep`, `ReelStepController`, `ReelStepData`, `buildReelStepTape`).
- Create (forked tests): `tests/{spinMotion,reelStepController}.test.ts`, and a new `tests/tumbleController.test.ts`.

**Interfaces:**
- Consumes: Task 1's grid/config.
- Produces: the classes above, constructor signatures unchanged from the legacy (`new SpinEngine(grid, resolve, motionCfg, win)`, `new AnticipationController(cfg)`, `new TumbleController(grid, cascadeCfg, win)`, `new ReelStepController(grid, resolve, cascadeCfg, win)`).

- [ ] **Step 1: Fork** the four files (same rules as Task 1 Step 1; `MotionStyle` type references → `MotionStyleKey`). If a forked file imports `anim/ReelSpinController` or `anim/CascadeController`, fork that file (and its test) too; otherwise do not.
- [ ] **Step 2: Fork the tests.** `spinMotion.test.ts` and `reelStepController.test.ts` from the legacy. Where a legacy case builds the whole system with the legacy `createReelSystem` (the ones in `reelStepController.test.ts`), rebuild it with the controllers directly (`new ReelGrid(...)` + `new ReelStepController(...)`), keeping the assertion; a case that only makes sense on the legacy facade (features, `runFeature`) is dropped — list every dropped case by name in the report. Run — PASS.
- [ ] **Step 3: The residue test (failing)** in `tests/tumbleController.test.ts`. Drive the controller with `Tween`'s own clock the way the forked `spinMotion.test.ts` does (read it: whatever it uses to advance tweens — a fake ticker, `vi.useFakeTimers`, or the shared `Ticker` — use the same). Build a 3×3 grid, a `TumbleStep` with two winning cells and a `settledGrid`; start `step(...)`; advance past `timings.highlight` into the `wait` window; call `skip()`; let the step's promise settle; assert every cell has `alpha === 1`, `scale.x === 1`, `scale.y === 1`, and the grid's cells hold `settledGrid`'s symbols. Run — Expected: FAIL (the removed cells end at alpha/scale 0, or the grid keeps the pre-tumble board).
- [ ] **Step 4: Fix the forked `TumbleController`:**
  - a `private _pending: CellData[][] | null = null;` set to `step.settledGrid` at the start of `step()` (after the `enabled` early-out) and cleared at its normal end;
  - after `await Tween.delay(t.wait * f);` add the same `if (this._dead) { if (dimmed) this._undim(); return; }` the other awaits have;
  - `skip()` becomes `ReelStepController.skip()`'s shape: kill tweens, `if (this._pending && !this._grid.destroyed) this._grid.setGrid(this._pending); this._pending = null; this._resetPositions();`.
  Run — PASS. Typecheck — 0.
- [ ] **Step 5: Commit** — `Reel core: the controllers forked, and a skipped tumble leaves no residue`.

---

### Task 3: reel-core — the pluggable reel system and its contracts

**Files:**
- Create: `engine/game/reel-core/src/system/{contracts,ReelSystem,builtins}.ts`; export from `src/index.ts`
- Test: `engine/game/reel-core/tests/reelSystem.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces (exact):

```ts
// contracts.ts
export interface ReelKit {
  readonly grid: ReelGrid;
  readonly fx: Container;
  readonly resolve: SymbolResolver;
  readonly win: WinConfig;
  readonly board: CellData[][];
  setBoard(board: CellData[][]): void;
  log?(message: string): void;
}
export interface MotionRunner {
  plan(target: CellData[][], opts?: SpinRunOpts): ReelStopPlan[];
  run(target: CellData[][], opts?: SpinRunOpts): Promise<void>;
  skip(): void;
}
/** A way the reels spin to a target — registered by key; the `motion1` row picks one. */
export interface MotionStyle {
  readonly key: string;
  create(kit: ReelKit, config: MotionConfig): MotionRunner;
}
/** Which reels get the anticipation treatment, and the zoom around it. */
export interface Anticipator {
  readonly config: AnticipationConfig;
  decide(target: CellData[][]): AnticipationDecision;
  zoomIn(grid: ReelGrid): Promise<() => Promise<void>>;
}
export interface ControllerRunner<S> {
  run(step: S, opts?: { turbo?: boolean }): Promise<void>;
  skip(): void;
}
/** A board step the core does not perform itself — today `tumble`. */
export interface BoardController<S = unknown> {
  readonly kind: string;
  create(kit: ReelKit): ControllerRunner<S>;
}
export interface Registry<T> {
  register(item: T): () => void;
  get(key: string): T | undefined;
  keys(): string[];
}
export type Report = (severity: 'error' | 'warning', message: string) => void;

// ReelSystem.ts
export interface CreateReelSystemOptions {
  resolve: SymbolResolver;
  grid?: DeepPartial<GridConfig>;
  win?: DeepPartial<WinConfig>;
  board?: CellData[][];
  log?: (message: string) => void;
  report?: Report;
}
export interface ReelSystem {
  readonly view: Container;
  readonly grid: ReelGrid;
  readonly fx: Container;
  readonly config: { grid: GridConfig; win: WinConfig };
  readonly board: CellData[][];
  kit(): ReelKit;
  setBoard(board: CellData[][]): void;
  readonly motions: Registry<MotionStyle>;
  /** Picks the active style; resolved at spin time, so a style registered later still counts. */
  useMotion(key: string, config: MotionConfig): () => void;
  readonly anticipation: { set(a: Anticipator): () => void };
  readonly controllers: Registry<BoardController>;
  planSpin(target: CellData[][], opts?: SpinRunOpts): ReelStopPlan[];
  spin(target: CellData[][], opts?: SpinRunOpts): Promise<void>;
  /** One `tumble` round per step, through the registered `tumble` controller; throws `no reels-cascade row — a tumble step cannot play` without one. */
  cascade(steps: TumbleStep[], opts?: { turbo?: boolean }): Promise<void>;
  skip(opts?: { overlays?: boolean }): void;
  destroy(): void;
}
export function createReelSystem(opts: CreateReelSystemOptions): ReelSystem;

// builtins.ts
export const BUILTIN_MOTION_STYLES: MotionStyle[]; // swap, strip, cascade-drop — each `create` = new SpinEngine(kit.grid, kit.resolve, { ...config, style: key }, kit.win) wrapped as a MotionRunner
export function createAnticipator(config: AnticipationConfig): Anticipator; // over AnticipationController
export function tumbleController(config: CascadeConfig): BoardController<TumbleStep>; // create = new TumbleController(kit.grid, config, kit.win); run = step(s, 0, opts)
```

- [ ] **Step 1: Write the failing tests** (`reelSystem.test.ts`, a fake `resolve` returning `new Container()`, a 3×3 grid). Cases, each its own `it`:
  1. `spin` with no style in use: resolves, `board` is the target, the grid's cells hold it, `report` called once with `('warning', 'no motion row — the reels snap to the result')`.
  2. `useMotion('nope', cfg)` then `spin`: `report('error', …)` naming `nope` and the registered keys (`swap, strip, cascade-drop` after registering the built-ins), then snaps as in 1.
  3. A registered fake style: `spin` calls its runner's `run(target, opts)` once; `planSpin` calls `plan`; the runner is created once across two spins with the same `useMotion`, and again after a second `useMotion` (the first runner's `skip` is called on the swap).
  4. A style registered AFTER `useMotion` names it: `spin` uses it.
  5. The disposer of `motions.register` removes it (spin then reports as in 2).
  6. An anticipator whose `decide` returns `{ active: true, reels: [2], … }`: the runner's `run` receives `opts.anticipateReels = [2]` and `zoomIn` is awaited around it (its returned reset is called after `run`); an explicit `opts.anticipateReels` wins over `decide` (the legacy `resolveAnticipation` rule).
  7. `cascade([step])` with no `tumble` controller rejects with the exact message; with a fake controller registered, its runner's `run(step, opts)` is called and `board` becomes `step.settledGrid`.
  8. `skip()` calls the active runner's and every created controller runner's `skip`, and empties `fx`; `skip({ overlays: false })` leaves `fx`'s children.
  9. `destroy()` skips and destroys the view; a later `spin` does nothing and does not throw.
  Run — FAIL (no module).
- [ ] **Step 2: Implement** `contracts.ts`, `builtins.ts` and `ReelSystem.ts`. Port from the legacy `createReelSystem` (read `packages/game-engine/src/slot/system/ReelSystem.ts`): `buildGrid` (grid + `fx` over it — once; no rebuild path, see Amendment 1), `emptyBoard`, `resolveAnticipation`/`mergeAnticipation` (reading the anticipator's `config` for the explicit-override defaults, or `DEFAULT_REEL_CONFIG.anticipation` with none set), `spin` (decision → `zoomIn` → runner `run` → reset → `board = target`), `skip`'s overlay sweep (`Tween.killTweensOf` each child, then remove and destroy) under `opts?.overlays !== false`. A registry is a `Map` in insertion order; `register` of an existing key replaces it (last wins) and its disposer removes only its own entry. Runners are created lazily and cached: the motion runner per active `useMotion`, a controller runner per kind (dropped when its controller is unregistered).
- [ ] **Step 3:** Run tests and typecheck — PASS / 0.
- [ ] **Step 4: Commit** — `Reel core: a reel system whose motion, anticipation and controllers are registered`.

---

### Task 4: the `reels` row on reel-core — flat config, the `reels` service, skip overlays once

**Files:**
- Modify: `engine/game/reels/src/{index,runtime,schema}.ts`, `engine/game/reels/package.json` (drop `@energy8platform/game-engine`, add `@energy8engine/reel-core: "*"`)
- Modify: `engine/game/play-loop/src/index.ts` (`BoardApi.skip` signature), `engine/game/play-loop/src/runtime.ts` (`hurry`/`fanOut`)
- Test: `engine/game/reels/tests/*.test.ts` (adapt), `engine/game/play-loop/tests/runtime.test.ts`

**Interfaces:**
- Consumes: Task 3's `createReelSystem`, `ReelSystem`.
- Produces: `ctx.reels: ReelSystem` (declared on cordis's `Context` in `reels/src/runtime.ts`); `BoardApi.skip?(opts?: { overlays?: boolean }): void`; the row config type `ReelsRowConfig = { grid?: DeepPartial<GridConfig>; win?: DeepPartial<WinConfig>; board?: CellData[][] }`.

- [ ] **Step 1: Tests first.**
  - `reels`: adapt the existing tests to the flat config and to `reel-core`; add: (a) the row provides `reels` and a registered style is used by `board.spinTo` (a fake style registered on `ctx.reels`); (b) a HOT re-apply (`ctx.scope.update(newConfig)` or however `runtime.test.ts` already re-applies the row) gives a NEW `ctx.reels` — and a dependent plugin that `ctx.inject(['reels'])`s and registers a style inside `ctx.effect` has registered it on the new one; (c) `schema.ts`'s `Config` validates `{ grid: { cols: 5, rows: 3 }, win: {} }`, fills every `GridConfig`/`WinConfig` default from `DEFAULT_REEL_CONFIG`, and REJECTS nothing it used to accept except the nested `config` key (a `{ config: { grid } }` row is not read — assert the grid stays at its default); (d) the no-motion warning reaches the composition's `diagnostics` service (`plugin: 'reels'`).
  - `play-loop`: in the existing latch test (`a skip latches: every later step …`), the board's `skip` records its argument: the FIRST call gets `undefined`, every re-fan gets `{ overlays: false }`.
  Run — FAIL.
- [ ] **Step 2: `schema.ts`** — `Config = Schema.object({ grid: GridSchema, win: WinSchema, board: Schema.any().description(…) })` where `GridSchema`/`WinSchema` list EVERY field of `GridConfig`/`WinConfig` (read the forked `ReelSystemConfig.ts`): the default from `DEFAULT_REEL_CONFIG`, the description from the field's doc comment, unions as `Schema.union([...literals])`, per-reel arrays as `Schema.array(...)`, optional objects as `Schema.object({...})`. `schema.ts` stays importable by the IDE host: it imports `schemastery` and TYPE-only from `reel-core` — the defaults are written as literals (a test asserts they equal `DEFAULT_REEL_CONFIG`'s, so they cannot drift).
- [ ] **Step 3: `index.ts`** — `createReelsBoard(options)` builds `createReelSystem` from `reel-core` instead of the legacy; `LegacyReelSystem` is renamed `ReelSystemLike` and gains `skip(opts?: { overlays?: boolean })`; `board.skip(opts)` forwards `opts` to `reelSystem.skip(opts)`; the module doc's legacy paragraphs are rewritten to say it wraps `@energy8engine/reel-core` (keep the measured facts that still hold). `cellSize`/`config` read `reelSystem.config.grid`.
- [ ] **Step 4: `runtime.ts`** — `apply(ctx, config: ReelsRowConfig)`: `createReelsBoard({ resolve, grid: config.grid, win: config.win, board: config.board, report: (severity, message) => diagnostics?.report(diagnostic(severity, 'reels', 'reels1', message)) })` (use the `diagnostic` helper and the lenient `ctx.reflect.get('diagnostics', false)` read other rows use); `ctx.provide('reels', board.system)` (expose the `ReelSystem` on `ReelsBoard` as `readonly system`); declare `reels: ReelSystem` on cordis's `Context`.
- [ ] **Step 5: `play-loop`** — `BoardApi.skip?(opts?: { overlays?: boolean }): void` with a doc line; in `runtime.ts`, `hurry(target, opts?)` passes `opts` to `target.skip(opts)`; `fanOut(opts?)` passes it to the BOARD only (handlers keep `skip()`); `skip()` calls `fanOut()`; `onStepStarted` calls `fanOut({ overlays: false })`.
- [ ] **Step 6:** `npm install` (root); run `reels`, `play-loop` tests and typecheck, plus typecheck of every package importing `@energy8engine/reels` (`grep -rl "@energy8engine/reels" engine --include=package.json`). PASS / 0.
- [ ] **Step 7: Commit** — `Reels: the row runs on reel-core, with a flat config, the reels service, and one overlay sweep per skipped run`.

---

### Task 5: `@energy8engine/reels-motion` — the `motion1` row

**Files:**
- Create: `engine/game/reels-motion/{package.json,tsconfig.json,vitest.config.ts,src/runtime.ts,src/schema.ts,tests/runtime.test.ts}` — `package.json` like `reels`' (with the `e8` block: `runtime.entry`/`schema`, `"hot": true`), deps `@energy8engine/reel-core`, `@energy8engine/reels`, `cordis`, `schemastery`.

**Interfaces:**
- Consumes: `ctx.reels: ReelSystem`, `BUILTIN_MOTION_STYLES`, `MotionConfig`.
- Produces: row `motion1` with config `{ style: string } & MotionConfig`.

- [ ] **Step 1: Tests (failing):** with a composed `reels` row (or a provided fake `reels` service exposing `motions`/`useMotion` spies): on apply the three built-ins are registered and `useMotion('swap', <defaults>)` is called; a config `{ style: 'cascade-drop', spinUp: 300 }` calls `useMotion('cascade-drop', { …defaults, spinUp: 300 })`; disposing the row runs every disposer (registrations and the `useMotion` one); the schema fills every `MotionConfig` default from `DEFAULT_REEL_CONFIG.motion` (a test asserts equality field by field, as Task 4 does for grid).
- [ ] **Step 2: Implement.** `schema.ts`: `style: Schema.string().default('swap').description('a registered motion style — built-in: swap, strip, cascade-drop')` + every `MotionConfig` field (same rules as Task 4 Step 2). `runtime.ts`: `export const name = 'reels-motion'`; `apply(ctx, config)` → `ctx.inject(['reels'], (c) => { c.effect(() => { const offs = BUILTIN_MOTION_STYLES.map((s) => c.reels.motions.register(s)); const off = c.reels.useMotion(config.style, motionOf(config)); return () => { off(); offs.forEach((f) => f()); }; }, 'reels-motion'); })`.
- [ ] **Step 3:** `npm install`; tests and typecheck — PASS / 0.
- [ ] **Step 4: Commit** — `Reels motion: the motion1 row registers the built-in styles and picks one`.

---

### Task 6: `@energy8engine/reels-anticipation` — the `anticipation1` row

**Files:** as Task 5, for `engine/game/reels-anticipation`.

**Interfaces:**
- Consumes: `ctx.reels`, `createAnticipator`, `AnticipationConfig`.
- Produces: row `anticipation1` with config `AnticipationConfig`.

- [ ] **Step 1: Tests (failing):** apply sets an anticipator built from the config (`reels.anticipation.set` spy receives one whose `config` equals the defaults merged with the row's); dispose unsets it; the schema fills every default from `DEFAULT_REEL_CONFIG.anticipation`.
- [ ] **Step 2: Implement** the same shape as Task 5 (`ctx.inject(['reels'])`, `c.effect(() => c.reels.anticipation.set(createAnticipator(config)), 'reels-anticipation')`).
- [ ] **Step 3:** `npm install`; tests, typecheck — PASS / 0.
- [ ] **Step 4: Commit** — `Reels anticipation: the anticipation1 row`.

---

### Task 7: `@energy8engine/reels-cascade` — the `cascade1` row: `tumble` and `reelStep`

**Files:**
- Create: `engine/game/reels-cascade/{package.json,tsconfig.json,vitest.config.ts,src/runtime.ts,src/schema.ts,src/reel-step.ts,tests/runtime.test.ts,tests/reel-step.test.ts}`
- Read (the source of `reel-step.ts`): `engine/examples/first-slot/plugins/reel-step/src/step.ts` and its `tests/step.test.ts`, `tests/chain.test.ts`

**Interfaces:**
- Consumes: `ctx.reels`, `tumbleController`, `ReelStepController`, `CascadeConfig`; play-loop's `ctx.steps` (`BoardStepRegistry`).
- Produces: row `cascade1` with config `CascadeConfig` (without `enabled`, see Step 2); `createReelStepHandler(deps)` exported from the package root for projects that register it themselves.

- [ ] **Step 1: Tests (failing):**
  - `runtime.test.ts`: apply registers a `tumble` controller in `reels.controllers` and a `reelStep` handler in `steps`; dispose removes both; the schema fills every `CascadeConfig` default except `enabled`, which is not in the schema.
  - `reel-step.test.ts`: port `first-slot`'s `step.test.ts`/`chain.test.ts` cases to the new handler (the grid and `resolve` now come from `ctx.reels.kit()`, the cascade config from the row), assertions unchanged.
- [ ] **Step 2: Implement.**
  - `schema.ts`: every `CascadeConfig` field but `enabled`.
  - The forked `TumbleController`/`ReelStepController` read `cfg.enabled` for an instant-settle shortcut: the row always passes `{ ...config, enabled: true }` — the row's presence IS the switch (spec §3.3).
  - `reel-step.ts`: `createReelStepHandler({ reels: () => ReelSystem | undefined, cascade: () => CascadeConfig })` — `first-slot`'s `step.ts` logic, building its `ReelStepController` from `reels().kit()` (rebuilt when `kit().grid` changes, as `step.ts` does with `boundGrid`), then `board.refill({ kind: 'refill', board: reelStep.settled }, opts)` exactly as today.
  - `runtime.ts`: `ctx.inject(['reels'], c => c.effect(() => c.reels.controllers.register(tumbleController({ ...config, enabled: true })), 'reels-cascade:tumble'))` and `ctx.inject(['steps'], c => c.effect(() => c.steps.register(createReelStepHandler({ reels: () => ctx.reflect.get('reels', false), cascade: () => ({ ...config, enabled: true }) })), 'reels-cascade:reelStep'))`.
- [ ] **Step 3:** `npm install`; tests, typecheck — PASS / 0.
- [ ] **Step 4: Commit** — `Reels cascade: the cascade1 row plays tumble and reelStep`.

---

### Task 8: compose it — bundle, example, template, symbols, docs, fixtures

**Files:**
- Modify: `engine/bundles/e8-base/e8.bundle.yml` — after `reels1`, add rows `motion1` (`@energy8engine/reels-motion`), `anticipation1` (`@energy8engine/reels-anticipation`), `cascade1` (`@energy8engine/reels-cascade`), each with a comment in the file's own style (what it is, why its place).
- Modify: `engine/examples/first-slot/e8.patch.yml`, `engine/templates/slot-basic/e8.patch.yml` — `reels1.config.config.grid` → `reels1.config.grid`; the comment about the inner `config` goes.
- Modify: `engine/examples/first-slot/plugins/reel-step/src/{index,step}.ts` + its `tests/` — the plugin keeps its mechanic and its `require`d art; its step registration and `step.ts` go (the step is `cascade1`'s now); `step.test.ts`/`chain.test.ts` go with it (ported in Task 7); `ReelStepRowConfig.cascade` goes (the cascade config is `cascade1`'s).
- Modify: `engine/game/symbols/src/{view,runtime}.ts` — `SymbolView`/`SymbolResolver` types from `@energy8engine/reel-core`; `package.json` dep swap.
- Modify: `engine/examples/first-slot/README.md`, `engine/templates/slot-basic/README.md` — the reels section describes the four rows and the flat config.
- Modify: `engine/game/reels/package.json` (already), `engine/ide/host/tests/fixtures/*/bundles/e8-base/e8.bundle.yml` and any host/client test pinning the bundle's row list or the old nested shape (`grep -rn "reels1\|config:\s*$" engine/ide engine/core --include=*.ts --include=*.yml` and read each hit).

- [ ] **Step 1:** `grep -rn "game-engine/slot" engine --include=*.ts --include=*.json` (excluding `node_modules`, `dist`, `paper-duel`) — every hit is removed by this task; list them in the report.
- [ ] **Step 2:** Make the edits. `npm install` (root).
- [ ] **Step 3: Unit gate:** `contracts`, `reel-core`, `reels`, `reels-motion`, `reels-anticipation`, `reels-cascade`, `symbols`, `play-loop`, `flow`, `scenes`, `ide-bridge`, `ide-client`, `ide-web`, `e8`, the `first-slot` plugin's own tests (`engine/examples/first-slot/plugins/reel-step`: run its `vitest` the way its `package.json` says), then `ide-host` ALONE. Typecheck all of them. Expected: PASS / 0 everywhere; the `template.test.ts` pins pass (the example and the template still agree where they are pinned).
- [ ] **Step 4:** the Step 1 grep is empty.
- [ ] **Step 5: Commit** (one or two commits by theme) — e.g. `Compose: e8-base carries motion1, anticipation1 and cascade1; the example and template move to the flat reels config`.

---

### Task 9: the browser proof — F9 on screen, and the reel specs

**Files:**
- Modify: `engine/examples/first-slot/src/main.ts` AND `engine/templates/slot-basic/src/main.ts` (byte-identical — `template.test.ts` pins it): two `__e8` hooks.
- Create/Modify: `engine/apps/web/tests/e2e/reel-step.spec.ts` (one new case)

**Interfaces:**
- Consumes: everything above; the page's `liveGrid()` helper in `main.ts`.

- [ ] **Step 1: Hooks.** Next to `symbols()`:

```ts
  /**
   * A stable number per cell VIEW object (`WeakMap` identity): equal numbers
   * across two reads mean the cell kept its view — slice 35's F9, read off the
   * screen. `null` for an empty cell or with no board.
   */
  viewIds(): (number | null)[][] | null {
    const grid = liveGrid();
    if (!grid) return null;
    return Array.from({ length: grid.cols }, (_, col) =>
      Array.from({ length: grid.rows }, (_, row) => {
        const view = grid.getCell(col, row)?.view;
        if (!view) return null;
        let id = viewIdOf.get(view);
        if (id === undefined) viewIdOf.set(view, (id = ++nextViewId));
        return id;
      }),
    );
  },
  /** Plays ONE `refill` step: the live board with `(col, row)` changed to `symbol`. */
  async refillCell(col: number, row: number, symbol: string): Promise<void> { … },
```

(Declare `const viewIdOf = new WeakMap<object, number>(); let nextViewId = 0;` at module level. `refillCell` builds the board from `symbols()` with the one cell changed and runs it through the composed play service — `ctx.play.execute([{ kind: 'refill', board }], ctx.board)` — reaching `ctx` the way the other hooks do.) Copy the identical text into the template's `main.ts`.
- [ ] **Step 2: The case** in `reel-step.spec.ts` (its fixture idiom): boot, `__e8.spin()` once (a seated board), read `viewIds()`, `refillCell(0, 0, <a symbol different from the current one>)`, read `viewIds()` again: exactly one cell's id changed — `(0, 0)` — and every other is equal.
- [ ] **Step 3: Prove it is not vacuous:** temporarily restore the old `setData` branch in `engine/game/reel-core/src/grid/SymbolCell.ts` (always destroy + resolve), run only the new case — Expected: FAIL (every id changed); put the F9 code back exactly; `git diff engine/game/reel-core/src/grid/SymbolCell.ts` empty. Record both results.
- [ ] **Step 4: Run alone, one file at a time** (`E8_E2E_HOST_PORT=5779`): `reel-step.spec.ts`, `tempo.spec.ts`, `symbols.spec.ts`, `contract.spec.ts`, `runtime.spec.ts`. Expected: all green (a load-budget failure is recorded with its number, not fixed by widening budgets). `npm run typecheck -w @energy8engine/ide-web` — 0.
- [ ] **Step 5: Commit** — `E2e: a refill of one cell rebuilds one view`.
