# Design: slot rendering/animation primitives (`@energy8platform/game-engine/slot`)

Дата: 2026-06-22
Статус: согласован, готов к плану реализации
Контекст: четвёртый срез дорожной карты [docs/slots-analysis-and-bootstrapper.md](../../slots-analysis-and-bootstrapper.md) (§5.5 шаг 4 — каскадные примитивы, РАСШИРЕНО на классические по требованию пользователя).

## Проблема

Каждая игра заново пишет рендер сетки и символов (ReelGrid/SymbolCell ~по 200-500 строк),
анимацию (каскад tumble/refill ИЛИ классический reel-spin), big-win оверлеи с count-up. Движок
(`game-engine/src/ui`) даёт FlexContainer/Button/Label/Modal + Tween/Easing/SpriteAnimation, но
НИ ОДНОГО слот-специфичного примитива (нет ReelGrid, SymbolCell, контроллеров анимации, BigWin).
5 из 6 игр каскадные (kitsune/magnus/moon-spice/Stone-Rush), 1 классическая (hot-ross, line-game на
ванильном canvas). Примитивы должны служить ОБЕИМ моделям.

## Цель среза

`@energy8platform/game-engine/slot` — слот-специфичные Pixi-примитивы: сетка+ячейки (общие),
контроллеры каскада (каскад) и спина (классика), big-win оверлей (общий). Игра занимается артом +
математикой + механикой, а не рендером сетки и хореографией анимации.

## Решения (зафиксированы в брейншторме)

- **Один срез** (по требованию пользователя), под-путь `@energy8platform/game-engine/slot`
  (Pixi-специфичен; использует `Tween`/`Easing`/`SpriteAnimation` из `game-engine/animation`).
- **Обе модели:** примитивы покрывают классический видео-слот (крутящиеся барабаны) И каскад.
- **Asset-agnostic + data-driven:** примитивы НЕ хардкодят алиасы/арт/игровую логику. Игра передаёт
  `SymbolResolver`, стиль рамки/тиры конфигом, и данные (`setGrid`/`setState`). Layout и анимацию
  владеет примитив.
- **Символ = любой view, не один спрайт.** `SymbolResolver(id) → SymbolView` (любой `Container`,
  опц. реализующий жизненный цикл). Игра строит view: один спрайт / набор слоёных спрайтов / Spine /
  композит. `AnimatedSymbol` — встроенная реализация для частого случая.
- **Контроллеры = plan (чистый, тестируемый) + run (тонкое исполнение через Tween).** Чистый `plan()`
  возвращает дескрипторы анимации; `run()` исполняет. Тестируем план; исполнение — примером.
- **Тестируемость:** Pixi `Container/Graphics/Sprite/Texture.EMPTY` конструируются в node БЕЗ
  `app.init()` (проверено) → layout/state→style/бейджи юнит-тестируемы. Tween крутится на
  `Ticker.shared` (в node сам не тикает) → `run()`/`show()` не юнит-тестим, только `plan()` и чистую
  логику.
- **Без миграции боевых игр**; валидация — расширение `examples/spec-slot/`.

## Архитектура

```
packages/game-engine/src/slot/
  grid/
    SymbolView.ts       interface SymbolView, type SymbolResolver
    AnimatedSymbol.ts   встроенная реализация SymbolView (текстура + idle/win спрайтшит на SpriteAnimation)
    SymbolCell.ts       ячейка: SymbolView + frame-graphics (state→style) + бейджи (×N/+N/sticky)
    ReelGrid.ts         сетка: layout, держит SymbolCell[col][row], опц. внешняя декорация + маска
  anim/
    CascadeController.ts  plan(step)→дескрипторы фаз; run(grid,step) через Tween; skip/kill
    ReelSpinController.ts plan(data)→per-reel стоп-тайминги/landing; run(grid,data) прокрутка+settle
  overlay/
    tiers.ts            pickTier(tiers,win,bet), tierIndexAtValue(tiers,running,bet)  (чистые)
    CountUpDisplay.ts   тикер-счётчик; valueAt(elapsed,target,dur) (чистая) + дисплей
    BigWinOverlay.ts    show(win,bet)/skip/hide; тиры из конфига
  index.ts              barrel + типы конфигов
packages/game-engine/
  package.json          + exports './slot'
  rollup.config.mjs     + bundle 'src/slot/index.ts' 'slot'
```

Каждый модуль — одна ответственность, тестируется отдельно. game-engine ре-экспорт не нужен (это
game-engine собственный под-путь).

## Модуль: grid

### SymbolView.ts
```ts
import type { Container } from 'pixi.js';

/** A symbol's visual. Any Container; optionally drives lifecycle the cell calls. */
export interface SymbolView extends Container {
  playIdle?(): void;
  playWin?(): Promise<void>;
  showStatic?(): void;
  setSize?(size: number): void;
}

/** Game-supplied factory: build the view for a symbol id (sprite / layered sprites / Spine / composite). */
export type SymbolResolver = (symbolId: string) => SymbolView | null;
```

### AnimatedSymbol.ts (built-in SymbolView)
```ts
export interface SymbolTextures { base: Texture; idle?: Texture[]; win?: Texture[]; }
export interface AnimatedSymbolConfig { textures: SymbolTextures; size: number; fps?: number; }
export class AnimatedSymbol extends Container implements SymbolView {
  constructor(config: AnimatedSymbolConfig);
  setTextures(t: SymbolTextures): void;
  setSize(size: number): void;
  showStatic(): void;
  playIdle(): void;
  playWin(): Promise<void>;
}
```
Wraps a Sprite (base) + optional SpriteAnimation for idle/win frames. Centred, sized to `size`.

### SymbolCell.ts
```ts
export interface CellFrameStyle {
  radius?: number;
  idle?: { color: number; alpha: number };
  winning?: { color: number; alpha: number };
  removed?: { color: number; alpha: number };
  fresh?: { color: number; alpha: number };  // 'new' is reserved; use 'fresh'
}
export interface CellData {
  symbol: string | null;
  multiplier?: number;            // ×N badge (top-right)
  bonus?: number;                 // +N badge (top-left)
  sticky?: { remaining: number }; // sticky-wild ring + remaining badge
}
export interface CellState { winning?: boolean; removed?: boolean; fresh?: boolean; }
export interface SymbolCellConfig { size: number; resolve: SymbolResolver; frameStyle?: CellFrameStyle; }

export class SymbolCell extends Container {
  constructor(config: SymbolCellConfig);
  setData(data: CellData): void;          // swaps the SymbolView via resolve(), updates badges
  setState(state: CellState): void;       // re-styles the frame graphics
  get view(): SymbolView | null;
  playWin(): Promise<void>;               // delegates to view.playWin?() or default scale-pop
  playIdle(): void;
}
```
Owns: a frame `Graphics` (rounded rect, styled by state via `frameStyle` defaults), the current
`SymbolView` (from `resolve`), and badge `Container`s. `setData(null symbol)` clears the view.

### ReelGrid.ts
```ts
export interface DecorationConfig { texture?: Texture; padding?: number; }  // optional outer frame
export interface ReelGridConfig {
  cols: number; rows: number; cellSize: number; gap?: number;
  resolve: SymbolResolver; frameStyle?: CellFrameStyle;
  decoration?: DecorationConfig;   // optional art/graphics frame behind cells
  mask?: boolean;                  // clip mask over the cell area (for drop animations)
}
export class ReelGrid extends Container {
  constructor(config: ReelGridConfig);
  setGrid(cells: CellData[][]): void;            // cols × rows
  getCell(col: number, row: number): SymbolCell;
  cellPosition(col: number, row: number): { x: number; y: number };
  get cols(): number; get rows(): number;
  resize(cellSize: number): void;                // relayout
}
```
Layout: `cellPosition(c,r) = { x: c*(cellSize+gap), y: r*(cellSize+gap) }`. Holds `SymbolCell[col][row]`.

## Модуль: anim (controllers — plan + run)

### CascadeController.ts (cascade)
```ts
export interface CascadeStepData {
  winningCells: { col: number; row: number }[];     // highlight → remove
  removedCells: { col: number; row: number }[];
  newCells: { col: number; row: number; symbol: string }[];  // drop in from above
  settledGrid: CellData[][];                         // grid after this step
}
export interface CascadeTimings { reveal: number; highlight: number; remove: number; drop: number; refill: number; wait: number; }
export interface CascadeAnim {
  col: number; row: number; phase: 'reveal'|'highlight'|'remove'|'drop'|'refill';
  from?: { x: number; y: number }; to?: { x: number; y: number };
  scale?: number; alpha?: number; duration: number; easing?: string; delay?: number;
}
export class CascadeController {
  constructor(grid: ReelGrid, timings?: Partial<CascadeTimings>);
  plan(step: CascadeStepData, opts?: { turbo?: boolean }): CascadeAnim[];   // PURE — testable
  run(step: CascadeStepData, opts?: { turbo?: boolean }): Promise<void>;     // executes plan via Tween
  skip(): void;
  kill(): void;
}
```
`plan` is a pure function of `step` + `timings` + grid geometry (cell positions) — returns the ordered
descriptors (winning cells highlight-pulse then scale→0; surviving cells gravity-drop to settled rows;
new cells drop from above their target with per-column stagger). `run` maps descriptors to
`Tween.to(grid.getCell(col,row), ...)`. Turbo halves durations.

### ReelSpinController.ts (classic, greenfield Pixi from hot-ross model)
```ts
export interface ReelSpinData { targetGrid: CellData[][]; strip?: (reel: number) => string[]; }
export interface ReelSpinTimings { spinUp: number; hold: number; stopStagger: number; settle: number; }
export interface ReelStopPlan { reel: number; stopTime: number; landing: CellData[]; settle: { amp: number; ms: number }; }
export class ReelSpinController {
  constructor(grid: ReelGrid, timings?: Partial<ReelSpinTimings>);
  plan(data: ReelSpinData, opts?: { turbo?: boolean }): ReelStopPlan[];   // PURE — testable
  run(data: ReelSpinData, opts?: { turbo?: boolean }): Promise<void>;      // scroll → decelerate → stop → settle
  skip(): void;
}
```
`plan` (pure): per-reel `stopTime = spinUp + reel*stopStagger`, `landing` = the reel's target column,
`settle` bounce params. `run`: for each column, cycle cell symbols through the strip (texture-swap, the
hot-ross model: strip offset + base index) decelerating via easing, then land on `targetGrid` with a
settle bounce on the column container. `strip` optional (random fillers from resolved symbols if absent).

## Модуль: overlay

### tiers.ts (pure)
```ts
export interface WinTier { id: string; minMultiplier: number; title: string; accentColor: number; bannerTexture?: Texture; }
export function pickTier(tiers: WinTier[], win: number, bet: number): WinTier | null;   // highest tier whose minMultiplier <= win/bet
export function tierIndexAtValue(tiers: WinTier[], runningValue: number, bet: number): number;  // for mid-count promotions
```

### CountUpDisplay.ts
```ts
export interface CountUpConfig { format: (v: number) => string; style?: Partial<TextStyle>; }
export function valueAt(elapsed: number, target: number, duration: number): number;  // PURE — eased interpolation 0→target
export class CountUpDisplay extends Container {
  constructor(config: CountUpConfig);
  setValue(v: number): void;
  countTo(target: number, duration: number, onTier?: (idx: number) => void): Promise<void>;
  skip(): void;
}
```

### BigWinOverlay.ts
```ts
export interface BigWinOverlayConfig {
  tiers: WinTier[]; formatMoney: (v: number) => string;
  countUpDuration?: (win: number) => number;   // default min(2500, max(800, win*20))
  particleCount?: number; width: number; height: number;
}
export class BigWinOverlay extends Container {
  constructor(config: BigWinOverlayConfig);
  show(win: number, bet: number): Promise<void>;   // pickTier → dim + banner + countTo (tier promotions) + particles
  skip(): void;
  hide(): void;
  resize(width: number, height: number): void;
}
```

## Тестирование (node, без рендерера)

- **grid:** construct `ReelGrid` 5×5 and 7×7 → assert cell count + `cellPosition(c,r)`; `SymbolCell.setState({winning:true})` → assert frame `Graphics` fill color/alpha == `frameStyle.winning`; `×N` badge appears on `multiplier`, hides without; `resolve` called with the right id on `setData`. `AnimatedSymbol.setSize` resizes its sprite.
- **anim:** `CascadeController.plan(step)` → assert descriptor list (winning cells get highlight then remove with scale 0; new cells have `from.y < to.y` drop, per-column delay stagger; turbo halves durations). `ReelSpinController.plan(data)` → assert `stopTime` strictly increases per reel; `landing` == target column.
- **overlay:** `pickTier` (boundary at exactly minMultiplier; below lowest → null); `tierIndexAtValue` (promotion crossing); `valueAt` (0 at t=0, target at t=duration, monotonic, eased).
- **NOT unit-tested:** `run()`/`show()`/Pixi animation execution (Tween on Ticker doesn't tick in node) — verified via the example build + typecheck.

## Валидация — расширение `examples/spec-slot/`

No new example. Add to `examples/spec-slot/`:
- `slot/symbols.ts` — a `SymbolResolver` returning `AnimatedSymbol`s with `Texture.EMPTY`/`Texture.WHITE`
  bases (no real art needed for the demo) for the toy spec's symbols.
- `GameScene.ts` (slice 2) — extend `onEnter` to construct a `ReelGrid` from the resolver, `setGrid` a
  toy grid, and hold a `CascadeController` + `BigWinOverlay` (wired but not headless-run).
- `slot/grid.test.ts` — a node test that builds the `ReelGrid` with the example resolver + the real
  symbol ids from `game.spec`, `setGrid`, asserts cells/positions, and runs `CascadeController.plan`
  on a fixture step. Proves the primitives compose with example data.
Verified by `tsc --noEmit` (GameScene composition) + the node test + existing smoke/stake tests green.

## Scope

**В scope:** `src/slot/` (grid: SymbolView/AnimatedSymbol/SymbolCell/ReelGrid; anim: CascadeController/
ReelSpinController; overlay: tiers/CountUpDisplay/BigWinOverlay) + `/slot` sub-path wiring (package.json
export + rollup bundle) + tests + `examples/spec-slot/slot/` (resolver + node test) + GameScene wiring.

**Вне scope (отдельные шаги):**
- `FreeSpinsSession` controller (game-loop embedded; extract later once stable)
- `PaylineRenderer` / `LineWinHighlight` (classic line-win highlight; greenfield, add with a classic game)
- `WinPresenter` (unify BigWin + bonus-summary modes)
- frame-art-loader helper
- migrating real games (kitsune/magnus/hot-ross) onto the primitives

## Риски / открытые вопросы

- **Tween/Ticker in node:** `run()`/`show()` can't be unit-tested without a ticking renderer. Mitigated
  by the plan/run split (pure `plan` tested) + example typecheck. If deeper coverage is wanted later, a
  `Ticker.shared.update(dt)` manual pump in a node test could drive a short tween — flagged, not in scope.
- **`SymbolView` lifecycle is optional:** simple views (a bare `Sprite`) implement none of `playWin?`/
  `setSize?`; `SymbolCell` must fall back to a default scale/alpha tween + manual centring/sizing. The
  plan specifies these fallbacks.
- **Decoration/frame art** is game-specific; the primitive provides a minimal default (rounded-rect
  graphics) and an optional `decoration.texture` slot. Rich per-game frames stay in the game.
- **`CascadeStepData` shape** must map cleanly from the normalized Lua cascade output; the example uses a
  toy fixture. Real-game mapping is part of migration (out of scope).
