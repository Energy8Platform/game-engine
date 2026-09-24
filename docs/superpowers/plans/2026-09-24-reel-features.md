# Reel features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nine data-driven plan steps — `expandWild`, `walkWild`, `dropWilds`, `reveal`, `transform`, `multipliers`, `sticky`, `giant`, `nudge` — each animating an outcome the mechanic hands it, registered by a new row `features1`.

**Architecture:** `reel-core` gains `src/fx/` (animation primitives forked from the legacy `features/types.ts`, plus `moveCell`) and `ReelSystem.onSpinStart`. A new package `@energy8engine/reels-features` holds one handler per kind (each a play-loop `StepHandler`), shared helpers (`checkCells`, `reseat`, a `Pace` for turbo/skip), a persistent overlay layer for `sticky` rings and `giant` views, and the `features1` row that registers the enabled handlers into `ctx.steps`.

**Tech Stack:** TypeScript, pixi.js v8, cordis 4, schemastery, vitest, Playwright; `Tween`/`Easing` from `@energy8platform/game-engine/animation` (via reel-core, which depends on the workspace copy).

**Spec:** `docs/superpowers/specs/2026-09-24-reel-features-design.md`

## Global Constraints

- `packages/*` is not edited; `packages/game-engine/src/slot/features/*` is read as the reference for the animations.
- A feature never draws a random number or reads a math knob: everything it shows comes from the step's data.
- The row's config is presentation only; every leaf has a default and a `.description()`, pinned by a walker test; the row merges its config over its own defaults (the loader passes `{}`); `"hot": true`.
- A package depending on `@energy8platform/game-engine` declares it `"*"` (a `^0.41` range fetches a second registry copy — slice 35).
- One workspace per test command: `npm test -w @energy8engine/<pkg>`, `npm run typecheck -w @energy8engine/<pkg>`; `@energy8engine/ide-host` ALONE.
- After adding a package under `engine/*/*`: `npm install` at the root, then confirm the new package has no nested `node_modules/@energy8platform`.
- Playwright ALONE, from `engine/apps/web`, `E8_E2E_HOST_PORT=5779`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`. Never `git stash`/`checkout`/`restore`.

## Review Focus

1. A step whose data names a cell past a SHORT reel (a ragged / Megaways grid: `rowsOf(col)` < `rows`): refused with the message, board untouched. Pinned in Task 2 (`checkCells` test on a ragged grid).
2. `skip()` arriving between two steps (no animation in flight) must not leave the NEXT step pre-skipped: the pace resets at the start of every `run`. Pinned in Task 2.
3. A hot re-apply of `reels1` (new grid) while `sticky` rings are up: the old layer goes with the old grid, the row re-applies on the new system with no rings (the math re-sends `sticky on` if it still wants them). Pinned in Task 5.
4. `giant` twice in a row without a spin between: the first overlay is replaced, never stacked. Pinned in Task 3.
5. `nudge` with `by: 0` or a `settled` column equal to the current one: completes with no motion and no error. Pinned in Task 4.

---

### Task 1: reel-core — `fx` primitives and `onSpinStart`

**Files:**
- Create: `engine/game/reel-core/src/fx/index.ts` (forked from `packages/game-engine/src/slot/features/types.ts`: `cellCenter`, `rowStepOf`, `colStepOf`, `glowRing`, `pulseCell`, `floatLabel`, `morphSymbol`, `dropCell` — NOT `ReelFeature`, `FeatureContext`, `pickFromBoard`) plus a new `moveCell`
- Modify: `engine/game/reel-core/src/system/ReelSystem.ts` (`onSpinStart`), `src/system/contracts.ts` if the interface lives there, `src/index.ts` (exports)
- Test: `engine/game/reel-core/tests/fx.test.ts`, `tests/reelSystem.test.ts`

**Interfaces:**
- Produces: `cellCenter(grid, col, row)`, `rowStepOf(grid, col?)`, `colStepOf(grid, col?)`, `glowRing(layer, grid, col, row, color): () => void`, `pulseCell(cell, scale?, ms?)`, `floatLabel(layer, x, y, text, color?, ms?)`, `morphSymbol(cell, data, ms?)`, `dropCell(grid, cell, col, row, ms?)` — signatures exactly the legacy ones; `moveCell(grid, cell, from: {col,row}, to: {col,row}, ms: number, easing?: EasingName): Promise<void>` (tweens `cell.position` from `from`'s centre to `to`'s centre); `ReelSystem.onSpinStart(fn: () => void): () => void`.

- [ ] **Step 1: Tests (failing).** `fx.test.ts` — drive `Tween` the way `tests/tumbleController.test.ts` does; cases: `morphSymbol` ends with `cell.scale` = 1 and `cell.data` = the new data; `glowRing` adds one child to the layer and its disposer removes it; `moveCell` ends with the cell at `to`'s centre; `dropCell` ends at the cell's home position. `reelSystem.test.ts` — `onSpinStart(fn)`: `fn` runs once when `spin()` starts (before the runner's `run` is called: record order), not on `cascade()`; its disposer unhooks; a throwing listener is swallowed and the spin still runs; after `destroy()` nothing fires. Run — FAIL.
- [ ] **Step 2: Implement.** Fork the helpers (header line `// Forked from packages/game-engine/src/slot/features/types.ts (slice 36).`, `'../../animation'` → `'@energy8platform/game-engine/animation'`, imports to the forked grid/cell/easing-map). `onSpinStart`: a `Set` of listeners; `spin()` calls each (try/catch per listener) as its first statement after the `destroyed` guard. Export everything from `src/index.ts`.
- [ ] **Step 3:** tests + typecheck — PASS / 0.
- [ ] **Step 4: Commit** — `Reel core: the feature animation primitives, and a hook on the start of a spin`.

---

### Task 2: `@energy8engine/reels-features` — package, shared helpers, and the morph kinds

**Files:**
- Create: `engine/game/reels-features/{package.json,tsconfig.json,vitest.config.ts,README.md}` — modelled on `engine/game/reels-cascade` (`e8` block: `runtime.entry` `./src/runtime.ts`, `schema` `./src/schema.ts`, `requires: ["steps"]`, `"hot": true`); deps `@energy8engine/reel-core`, `@energy8engine/reels`, `@energy8engine/play-loop`, `@energy8engine/contracts`, `@energy8platform/game-engine: "*"`, `cordis`, `pixi.js`, `schemastery`.
- Create: `src/shared.ts`, `src/layer.ts`, `src/handlers/{expandWild,dropWilds,reveal,transform}.ts`, `src/index.ts`
- Test: `tests/shared.test.ts`, `tests/morph.test.ts`

**Interfaces:**
- Consumes: Task 1's `fx`; `ReelSystem.kit()`; the reels board's `refill(step, opts)`; play-loop's `StepHandler`.
- Produces (exact):

```ts
// shared.ts
export type Cell = { col: number; row: number };
export interface FeatureDeps<C> {
  reels(): ReelSystem | undefined;
  config(): C;
  layer(): OverlayLayer | undefined;
}
/** Throws `${kind}: ${field}[${i}] (${col}, ${row}) is outside the grid` for a cell past a reel's own height (rowsOf) or past cols; `${kind}: ${field} is empty` for []. */
export function checkCells(kind: string, grid: ReelGrid, cells: Cell[], field?: string): void;
/** The live board with `changes` applied, re-seated through the board's refill (→ ctx.board, symbols bind). */
export function reseat(board: RefillBoard, kit: ReelKit, changes: { col: number; row: number; data: CellData }[], opts?: StepOpts): Promise<void>;
/** Turbo and skip for one run: `ms(n)` is n × 0.5 under turbo, 0 once skipped; `skipped` is read after every await. */
export interface Pace { ms(n: number): number; readonly skipped: boolean; skip(): void; }
export function createPace(opts?: StepOpts): Pace;
/** The (kit, board) pair a handler needs, or a throw naming what is missing — the reels-cascade messages. */
export function need(kind: string, deps: FeatureDeps<unknown>, board: unknown): { kit: ReelKit; board: RefillBoard; reels: ReelSystem };

// layer.ts
export interface OverlayLayer {
  readonly view: Container;          // added to kit.grid above the cells and fx; label 'reels-features'
  ringOn(cell: Cell, color: number): void;   // idempotent per cell; child label 'sticky'
  ringOff(cell: Cell): void;
  showGiant(view: Container): void;  // replaces any current giant; label 'giant'
  clearGiants(): void;               // destroys giants, re-shows the cells they hid
  hideForGiant(cells: SymbolCell[]): void;
  destroy(): void;
}
export function createOverlayLayer(kit: ReelKit): OverlayLayer;
```

Each handler module exports `create<Kind>Handler(deps: FeatureDeps<Config>): StepHandler` with `kind` = the step kind; the handler keeps its current `Pace` and `skip()` calls `pace.skip()` and `Tween.killTweensOf` on every cell/label it touched.

- [ ] **Step 1: `shared.test.ts` (failing):** `checkCells` accepts in-range cells, throws the exact messages for a col past `cols`, a row past a SHORT reel on a ragged grid (`rowsPerReel: [3, 2, 3]`, cell `(1, 2)`), and `[]`; `reseat` calls `board.refill` once with the live board changed only at the given cells (extras kept: a `{ symbol, band }` record survives); `createPace({ turbo: true }).ms(100)` = 50, after `skip()` = 0, and a NEW pace (next run) is not skipped.
- [ ] **Step 2: `morph.test.ts` (failing)** — a fake `reels` (real `ReelGrid` from reel-core, `resolve` → `new Container()`), a fake board whose `refill` records its board; per kind:
  - `expandWild { reel: 1, symbol: 'W' }` → refill board has column 1 all `W`; `rows: [0, 2]` → only those rows; `reel: 9` → throws `expandWild: reel 9 is outside the grid`, no refill.
  - `dropWilds { cells: [{col:0,row:0},{col:2,row:1}], symbol: 'W', multiplier: 3 }` → those cells `{ symbol: 'W', multiplier: 3 }`.
  - `reveal { cells: [...], symbol: 'Q' }` → those cells `Q`.
  - `transform { cells: [...], to: 'H1' }` → those cells `H1`.
  - each: `skip()` called while the run is mid-animation → the run resolves and the refill board is the same end board; `turbo: true` → the run's total tween time is half (assert via the durations passed to a spied `Tween.to`, or elapsed ticker time — whichever the reel-core tests use).
  Run — FAIL.
- [ ] **Step 3: Implement** `shared.ts`, `layer.ts`, the four handlers. Animations (defaults from Task 5's schema; the handler reads them through `deps.config()`):
  - `expandWild`: for each target row top→bottom: `morphSymbol(cell, data, pace.ms(cfg.ms))` + `glowRing(kit.fx, …, cfg.ringColor)`; after the last, wait `pace.ms(cfg.holdMs)` (a `Tween.delay`, skipped by checking `pace.skipped` after), dispose rings; `reseat`.
  - `dropWilds`: `cell.setData(data)` then `dropCell(grid, cell, col, row, pace.ms(cfg.ms))`, cells started `pace.ms(cfg.staggerMs)` apart; `reseat`.
  - `reveal`: all cells `morphSymbol` together, `pace.ms(cfg.ms)`; `reseat`.
  - `transform`: per cell `morphSymbol` then `pulseCell(cell, cfg.pulseScale, pace.ms(cfg.pulseMs))`; `reseat`.
  Data from a step's `symbol`/`to` goes through `cellData()` (`@energy8engine/contracts`) so a record's extras ride along.
- [ ] **Step 4:** `npm install`; confirm no `engine/game/reels-features/node_modules/@energy8platform`; tests + typecheck — PASS / 0.
- [ ] **Step 5: Commit** — `Reels features: the package, its shared helpers, and four morph kinds`.

---

### Task 3: reels-features — `multipliers`, `sticky`, `giant`

**Files:**
- Create: `engine/game/reels-features/src/handlers/{multipliers,sticky,giant}.ts`
- Test: `engine/game/reels-features/tests/overlay.test.ts`

**Interfaces:**
- Consumes: Task 2's `shared.ts`/`layer.ts`; Task 1's `onSpinStart` (wired in Task 5; this task's handlers only use the layer).
- Produces: `createMultipliersHandler`, `createStickyHandler`, `createGiantHandler`.

- [ ] **Step 1: Tests (failing):**
  - `multipliers { cells: [{col:0,row:0,value:2},{col:1,row:1,value:5}], total: 10 }` → those cells carry `multiplier` 2 / 5 (symbol unchanged); one float label per cell and one for the total were created on `kit.fx` (count children added during the run); a `value` that is not a positive number → throws `multipliers: cells[0].value must be a positive number`.
  - `sticky { cells, on: true }` → the layer has one `'sticky'` child per cell; the same step again → still one per cell; `on: false` for one of them → that ring gone, the other stays; the board is NOT re-seated (refill not called).
  - `giant { col: 1, row: 0, width: 2, height: 2, symbol: 'H1' }` → the four covered cells = `H1` in the refill board, hidden (`visible === false`), and the layer has one `'giant'` child; a second `giant` before any spin → still ONE `'giant'` child; `layer.clearGiants()` → none, and the covered cells visible again; `width: 9` → throws `giant: the 9×2 area at (1, 0) does not fit the grid`.
  - `skip()` mid-run for each → end state as above.
  Run — FAIL.
- [ ] **Step 2: Implement.**
  - `multipliers`: per cell `cell.setData({ ...cell.data, multiplier: value })`, `pulseCell(cell, 1.2, pace.ms(cfg.pulseMs))`, `floatLabel(kit.fx, x, y, '×' + value, cfg.labelColor, pace.ms(cfg.labelMs))` (all cells together); then, if `total`, `floatLabel` at `grid.center()` with `cfg.totalColor`, `pace.ms(cfg.totalMs)`; `reseat` with the multiplier added to each cell's current data.
  - `sticky`: `layer.ringOn/ringOff` per cell with `cfg.ringColor`; no reseat.
  - `giant`: the view from `kit.resolve(symbol)` resized to `width × height` cells (the legacy `GiantSymbol` sizing), placed at the area's centre on the layer via `layer.showGiant`, covered cells hidden via `layer.hideForGiant`, scale-in from 0.2/alpha 0 to 1 over `pace.ms(cfg.ms)` with `cfg.easing`; `reseat` with the covered cells = `symbol`. A giant stays until `layer.clearGiants()` (Task 5 calls it on spin start).
- [ ] **Step 3:** tests + typecheck — PASS / 0.
- [ ] **Step 4: Commit** — `Reels features: multipliers, sticky rings and giant symbols`.

---

### Task 4: reels-features — `walkWild`, `nudge`

**Files:**
- Create: `engine/game/reels-features/src/handlers/{walkWild,nudge}.ts`
- Test: `engine/game/reels-features/tests/motion.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `createWalkWildHandler`, `createNudgeHandler`.

- [ ] **Step 1: Tests (failing):**
  - `walkWild { path: [{col:0,row:1},{col:1,row:1},{col:2,row:0}], symbol: 'W' }` → refill board: `(2,0)` = `W`, `(0,1)` and `(1,1)` empty (`symbol: null`), every other cell unchanged; every cell back at its home position after the run; `path` of length 1 → throws `walkWild: path needs at least 2 cells`.
  - `nudge { reel: 2, by: 1, settled: ['A','B','C'] }` (3-row grid) → column 2 = `A,B,C`, cells at home positions; `settled` of length 2 → throws `nudge: settled has 2 cells, reel 2 has 3`; `by: 0` → completes, no motion, column = `settled`.
  - `skip()` mid-run → end state, cells at home.
  Run — FAIL.
- [ ] **Step 2: Implement.**
  - `walkWild`: `morphSymbol` at `path[0]` (`pace.ms(cfg.morphMs)`); for each next cell: set the previous cell `{ symbol: null }`, set the next cell's data to the symbol, place it at the previous cell's centre, `moveCell(... pace.ms(cfg.stepMs), cfg.easing)` with a `glowRing` (`cfg.ringColor`) disposed after; finally reset every touched cell to its home position; `reseat`.
  - `nudge`: tween every cell of the reel by `by × rowStepOf(grid, reel)` in y over `pace.ms(cfg.ms)` with `cfg.easing`; reset positions; `reseat` the reel's column with `settled` (through `cellData()`).
- [ ] **Step 3:** tests + typecheck — PASS / 0.
- [ ] **Step 4: Commit** — `Reels features: walking wilds and nudged reels`.

---

### Task 5: the `features1` row — schema, registration, spin-start clearing; composed

**Files:**
- Create: `engine/game/reels-features/src/{schema,runtime}.ts`; `src/index.ts` exports
- Test: `engine/game/reels-features/tests/{schema,runtime}.test.ts`
- Modify: `engine/bundles/e8-base/e8.bundle.yml` (row `features1` after `cascade1`, commented in the file's style), `engine/examples/first-slot/package.json` + `engine/templates/slot-basic/package.json` (add `@energy8engine/reels-features` beside the other reel rows), and any ide-host/client test pinning the bundle's row list (grep `cascade1` in `engine/ide` tests)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: row `features1`, config `FeaturesRowConfig` = one section per kind.

Schema (every leaf `.default()` + `.description()`; the values below are the defaults):

| section | fields |
|---|---|
| `expandWild` | `enabled: true`, `ms: 280` (per row), `holdMs: 500`, `ringColor: 0xffd700` |
| `walkWild` | `enabled: true`, `morphMs: 240`, `stepMs: 260`, `easing: 'easeInOutQuad'`, `ringColor: 0xff66cc` |
| `dropWilds` | `enabled: true`, `ms: 280`, `staggerMs: 60` |
| `reveal` | `enabled: true`, `ms: 280` |
| `transform` | `enabled: true`, `ms: 280`, `pulseScale: 1.15`, `pulseMs: 220` |
| `multipliers` | `enabled: true`, `pulseMs: 240`, `labelMs: 500`, `totalMs: 900`, `labelColor: 0xffd24a`, `totalColor: 0xffe24a` |
| `sticky` | `enabled: true`, `ringColor: 0xec4899` |
| `giant` | `enabled: true`, `ms: 420`, `easing: 'easeOutBack'` |
| `nudge` | `enabled: true`, `ms: 240`, `easing: 'easeOutBack'` |

`easing` fields are `Schema.string()` naming an `EasingName` (reel-core's easing-map keys; the description lists them).

- [ ] **Step 1: Tests (failing):**
  - `schema.test.ts`: `{}` validates to every default above; a walker asserts every leaf has a non-empty description.
  - `runtime.test.ts` (real `reels` row + real `play-loop` row composed in cordis, as `engine/game/reels-cascade/tests/runtime.test.ts` does): on apply all nine kinds are in `ctx.steps.kinds()`; `{ giant: { enabled: false } }` → `giant` absent, the other eight present; `{}` config → a handler reads the default `ms` (spy or read back); dispose removes every kind and the layer (`reels.kit().grid` has no `'reels-features'` child); `reels.spin(...)` after a `giant` step → the giant is cleared (`onSpinStart`); a hot re-apply of `reels1` → the row re-applies on the new system (kinds registered again, a fresh empty layer on the new grid).
  Run — FAIL.
- [ ] **Step 2: Implement** `schema.ts` (imports only `schemastery`; literal defaults) and `runtime.ts`: merge the config over the defaults (deep, per section); `ctx.inject(['reels'], c => c.effect(() => { layer = createOverlayLayer(c.reels.kit()); const off = c.reels.onSpinStart(() => layer?.clearGiants()); return () => { off(); layer?.destroy(); layer = undefined; }; }, 'reels-features:layer'))`; `ctx.inject(['steps'], c => c.effect(() => { const offs = enabledHandlers.map(h => c.steps.register(h)); return () => offs.forEach(f => f()); }, 'reels-features:steps'))`; handlers built with `deps = { reels: () => ctx.reflect.get('reels', false), config: () => merged.<section>, layer: () => layer }`.
- [ ] **Step 3: Compose.** Bundle row + package.json deps. `npm install`. Gate: reels-features, reel-core, reels, play-loop, game-runtime tests + typecheck; `ide-host` ALONE (template pins, bundle pins).
- [ ] **Step 4: Commit** — `Reels features: the features1 row, composed in e8-base`.

---

### Task 6: the browser proof

**Files:**
- Modify: `engine/examples/first-slot/src/main.ts` AND `engine/templates/slot-basic/src/main.ts` (byte-identical): one `__e8` hook
- Modify: a new case in `engine/apps/web/tests/e2e/reel-step.spec.ts` (or a new `features.spec.ts` using the same fixture helpers)

**Interfaces:**
- Consumes: everything above; the page's `liveGrid()`.

- [ ] **Step 1: Hook.** Next to `viewIds()`:

```ts
  /** What the `features1` row's persistent layer holds now: sticky rings and giant symbols. `null` with no board. */
  featureOverlays(): { sticky: number; giant: number } | null {
    const grid = liveGrid();
    if (!grid) return null;
    const layer = (grid as unknown as { children: { label?: string; children: { label?: string }[] }[] }).children
      .find((c) => c.label === 'reels-features');
    const count = (label: string) => layer?.children.filter((c) => c.label === label).length ?? 0;
    return { sticky: count('sticky'), giant: count('giant') };
  },
```

Same text in the template's `main.ts`. No hook calls `execute`/`record`/`/api/spin` (`flow.spec`'s rule).
- [ ] **Step 2: The fixture.** In the spec, write into the project copy (`projectCopy`/`dir` the spec already uses) a plugin `plugins/feature-probe/` modelled on `engine/examples/first-slot/plugins/reel-step/` (its `package.json` with `e8.runtime.entry` and `requires: ["mechanics"]`; an `src/index.ts` registering a mechanic through `ctx.inject(['mechanics'])`). The mechanic `id: 'feature-probe'`, `requires: { fields: {} }` (read `SpinShapeRequirement` in `engine/core/contracts/src/mechanic.ts` for the minimal legal value), and a module-level spin counter: the FIRST `present` returns `spinTo` a fixed 5×3 board, then one step of each of the nine kinds with fixed data (ending with `sticky { on: true }` on two cells and a `giant`); every later `present` returns only `spinTo` the same fixed board. Patch `e8.patch.yml`: `mechanics1.config.stages.base_game: feature-probe` and a row `- id: probe1\n  name: feature-probe\n  config: {}`.
- [ ] **Step 3: The case.** Boot, `__e8.spin()`; assert `__e8.liveDiagnostics()` has no `error`; `__e8.symbols()` equals the board the nine steps imply (compute it in the spec from the fixed data — write the expected board literally); `featureOverlays()` = `{ sticky: 2, giant: 1 }`. `__e8.spin()` again: `featureOverlays()` = `{ sticky: 2, giant: 0 }`.
- [ ] **Step 4: Non-vacuous:** temporarily make the `features1` row register nothing (e.g. `enabledHandlers = []` in `runtime.ts`), run only the new case — Expected: FAIL (an unknown-kind diagnostic / wrong board); restore exactly, `git diff engine/game/reels-features/src/runtime.ts` empty. Record both.
- [ ] **Step 5: Run alone, one file at a time:** the new case's spec, `reel-step.spec.ts`, `flow.spec.ts`, `tempo.spec.ts`, `symbols.spec.ts`. `npm run typecheck -w @energy8engine/ide-web` — 0. `ide-host` ALONE (main.ts pin).
- [ ] **Step 6: Commit** — `E2e: all nine feature steps play from a mechanic's plan`.
