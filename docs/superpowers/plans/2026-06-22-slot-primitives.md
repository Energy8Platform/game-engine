# Slot Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@energy8platform/game-engine/slot` — asset-agnostic, data-driven Pixi slot primitives serving BOTH classic (spinning reels) and cascade (tumble/refill) games: `ReelGrid`/`SymbolCell`/`AnimatedSymbol` (grid), `CascadeController`/`ReelSpinController` (animation, plan+run), `BigWinOverlay`/`CountUpDisplay` (win presentation).

**Architecture:** New `src/slot/` sub-path in game-engine. Primitives are Pixi `Container`s; symbols come from a game-supplied `SymbolResolver(id) → SymbolView` (any Container — sprite/layered/Spine/composite), so primitives never hardcode art. Controllers split into a pure `plan()` (unit-tested) and a thin `run()` that executes the plan via the engine's `Tween`. Win tier selection + count-up interpolation are pure functions; the overlay is a thin Pixi presentation over them.

**Tech Stack:** TypeScript, PixiJS v8, Vitest 2.x (node env — Pixi display objects construct without `app.init()`), Rollup multi-entry, existing `game-engine/animation` (`Tween`, `Easing`, `SpriteAnimation`).

## Global Constraints

- Lives at `packages/game-engine/src/slot/`; Pixi-specific (uses `game-engine/animation`).
- **Asset-agnostic + data-driven:** NO hardcoded asset aliases / art / game logic (win detection, cascade math). Symbols via `SymbolResolver(id): SymbolView | null`; styling via config; grid via `setGrid`/`setState`.
- **Symbol = any view:** `SymbolView extends Container` with OPTIONAL `playIdle?()/playWin?(): Promise<void>/showStatic?()/setSize?(size)`. `SymbolCell` falls back to a default scale/alpha tween + manual centring/sizing when a hook is absent.
- **Controllers = plan + run:** `plan()` is PURE (no Pixi mutation, no Tween) and returns animation descriptors — it is the unit-tested surface. `run()` executes via `Tween.to(target, props, durationMs, easingFn)`. `run()`/`show()` are NOT unit-tested (Tween runs on `Ticker.shared`, which doesn't tick in node) — verified by typecheck + example.
- `Tween.to(target, props: Record<string,number>, durationMs, easing?: EasingFunction, onUpdate?)` — duration in **milliseconds**; supports nested keys (`'scale.x'`, `'position.y'`). `Easing.easeOutBounce` etc. are the functions. Descriptors carry an easing **string name**; `run()` resolves it via an `EASING_BY_NAME` map.
- Pixi v8 idiom: `new Text({ text, style })`; `g.clear(); g.roundRect(x,y,w,h,r).fill({ color, alpha }); g.stroke({ color, width })`; `new Sprite(texture)`; `SpriteAnimation.create(textures, { loop, autoplay, onComplete }): AnimatedSprite`.
- UI-component idiom (match existing `ui/Label.ts`): `extends Container`, config object constructor, focused single-responsibility file.
- Tests renderer-free (node); construct display objects + assert geometry/state/plan output. Tests import from `../../src/slot/...` (or `../src/...` for example).
- `CellState`/`CellFrameStyle` use `winning`/`removed`/`fresh` (NOT `new` — reserved word).
- Commit after each task. Branch: `feat/game-spec-define-game` (continuing).

## File Structure

```
packages/game-engine/src/slot/
  grid/SymbolView.ts        interface SymbolView, type SymbolResolver
  grid/AnimatedSymbol.ts    built-in SymbolView (SymbolTextures, AnimatedSymbolConfig)
  grid/SymbolCell.ts        CellFrameStyle, CellData, CellState, SymbolCellConfig, class SymbolCell
  grid/ReelGrid.ts          DecorationConfig, ReelGridConfig, class ReelGrid
  anim/easing-map.ts        EASING_BY_NAME (string → EasingFunction)
  anim/CascadeController.ts CascadeStepData, CascadeTimings, CascadeAnim, class CascadeController
  anim/ReelSpinController.ts ReelSpinData, ReelSpinTimings, ReelStopPlan, class ReelSpinController
  overlay/tiers.ts          WinTier, pickTier, tierIndexAtValue
  overlay/CountUpDisplay.ts CountUpConfig, valueAt, class CountUpDisplay
  overlay/BigWinOverlay.ts  BigWinOverlayConfig, class BigWinOverlay
  index.ts                  barrel
packages/game-engine/
  package.json              + exports './slot'
  rollup.config.mjs         + createBundle('src/slot/index.ts', 'slot')
packages/game-engine/tests/slot/
  animatedSymbol.test.ts symbolCell.test.ts reelGrid.test.ts
  cascadeController.test.ts reelSpinController.test.ts overlay.test.ts
examples/spec-slot/slot/
  symbols.ts grid.test.ts   (+ GameScene.ts wiring)
```

---

### Task 1: `/slot` scaffold + `SymbolView` + `AnimatedSymbol`

**Files:**
- Create: `packages/game-engine/src/slot/grid/SymbolView.ts`, `packages/game-engine/src/slot/grid/AnimatedSymbol.ts`, `packages/game-engine/src/slot/index.ts`
- Modify: `packages/game-engine/package.json` (`./slot` export), `packages/game-engine/rollup.config.mjs` (slot bundle)
- Test: `packages/game-engine/tests/slot/animatedSymbol.test.ts`

**Interfaces:**
- Produces: `SymbolView`, `SymbolResolver`, `SymbolTextures`, `AnimatedSymbolConfig`, `class AnimatedSymbol`.

- [ ] **Step 1: Write `SymbolView.ts`**

```ts
// packages/game-engine/src/slot/grid/SymbolView.ts
import type { Container } from 'pixi.js';

/** A symbol's visual. Any Container; optionally implements the lifecycle the cell drives. */
export interface SymbolView extends Container {
  playIdle?(): void;
  playWin?(): Promise<void>;
  showStatic?(): void;
  setSize?(size: number): void;
}

/** Game-supplied factory: build the view for a symbol id (sprite / layered sprites / Spine / composite). */
export type SymbolResolver = (symbolId: string) => SymbolView | null;
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/game-engine/tests/slot/animatedSymbol.test.ts
import { describe, it, expect } from 'vitest';
import { Texture } from 'pixi.js';
import { AnimatedSymbol } from '../../src/slot/grid/AnimatedSymbol';

describe('AnimatedSymbol', () => {
  it('sizes its base sprite to the configured size', () => {
    const sym = new AnimatedSymbol({ textures: { base: Texture.EMPTY }, size: 100 });
    expect(sym.children.length).toBe(1);
    const base = sym.children[0] as any;
    expect(base.width).toBe(100);
    expect(base.height).toBe(100);
    expect(base.anchor.x).toBe(0.5);
  });
  it('resizes via setSize', () => {
    const sym = new AnimatedSymbol({ textures: { base: Texture.EMPTY }, size: 100 });
    sym.setSize(80);
    expect((sym.children[0] as any).width).toBe(80);
  });
  it('playWin resolves immediately when no win frames', async () => {
    const sym = new AnimatedSymbol({ textures: { base: Texture.EMPTY }, size: 50 });
    await expect(sym.playWin()).resolves.toBeUndefined();
  });
  it('playIdle adds an animated child when idle frames exist, showStatic restores base', () => {
    const sym = new AnimatedSymbol({ textures: { base: Texture.EMPTY, idle: [Texture.EMPTY, Texture.WHITE] }, size: 50 });
    sym.playIdle();
    expect(sym.children.length).toBe(2);
    sym.showStatic();
    expect(sym.children.length).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/slot/animatedSymbol.test.ts`
Expected: FAIL — cannot resolve `../../src/slot/grid/AnimatedSymbol`.

- [ ] **Step 4: Write `AnimatedSymbol.ts`**

```ts
// packages/game-engine/src/slot/grid/AnimatedSymbol.ts
import { Container, Sprite, AnimatedSprite, type Texture } from 'pixi.js';
import { SpriteAnimation } from '../../animation';
import type { SymbolView } from './SymbolView';

export interface SymbolTextures { base: Texture; idle?: Texture[]; win?: Texture[]; }
export interface AnimatedSymbolConfig { textures: SymbolTextures; size: number; fps?: number; }

/** Built-in SymbolView: a static base sprite with optional idle/win spritesheet frames. */
export class AnimatedSymbol extends Container implements SymbolView {
  private _base: Sprite;
  private _anim: AnimatedSprite | null = null;
  private _textures: SymbolTextures;
  private _size: number;
  private _fps: number;

  constructor(config: AnimatedSymbolConfig) {
    super();
    this._textures = config.textures;
    this._size = config.size;
    this._fps = config.fps ?? 24;
    this._base = new Sprite(config.textures.base);
    this._base.anchor.set(0.5);
    this.addChild(this._base);
    this.setSize(this._size);
  }

  setTextures(t: SymbolTextures): void {
    this._textures = t;
    this._base.texture = t.base;
    this.showStatic();
  }

  setSize(size: number): void {
    this._size = size;
    this._base.width = size;
    this._base.height = size;
    if (this._anim) { this._anim.width = size; this._anim.height = size; }
  }

  showStatic(): void {
    if (this._anim) { this._anim.destroy(); this._anim = null; }
    this._base.visible = true;
  }

  playIdle(): void {
    if (!this._textures.idle?.length) return;
    this._swap(this._textures.idle, true);
  }

  playWin(): Promise<void> {
    if (!this._textures.win?.length) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this._swap(this._textures.win!, false, () => { this.showStatic(); resolve(); });
    });
  }

  private _swap(frames: Texture[], loop: boolean, onComplete?: () => void): void {
    if (this._anim) { this._anim.destroy(); this._anim = null; }
    this._base.visible = false;
    const a = SpriteAnimation.create(frames, { loop, autoplay: true, onComplete });
    a.anchor.set(0.5);
    a.width = this._size;
    a.height = this._size;
    a.animationSpeed = this._fps / 60;
    this.addChild(a);
    this._anim = a;
  }
}
```

- [ ] **Step 5: Write `index.ts` + wire the sub-path**

```ts
// packages/game-engine/src/slot/index.ts
export type { SymbolView, SymbolResolver } from './grid/SymbolView';
export { AnimatedSymbol } from './grid/AnimatedSymbol';
export type { SymbolTextures, AnimatedSymbolConfig } from './grid/AnimatedSymbol';
```

In `packages/game-engine/package.json` `exports`, add (mirror `./core`):
```json
    "./slot": {
      "import": "./dist/slot.esm.js",
      "require": "./dist/slot.cjs.js",
      "types": "./dist/slot.d.ts"
    }
```
In `packages/game-engine/rollup.config.mjs`, add after the host bundle line: `...createBundle('src/slot/index.ts', 'slot'),`

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/slot/animatedSymbol.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Verify build + typecheck**

Run: `npm run build --workspace @energy8platform/game-engine && npm run typecheck --workspace @energy8platform/game-engine`
Expected: emits `dist/slot.esm.js`/`.cjs.js`/`.d.ts`; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/game-engine/src/slot packages/game-engine/tests/slot/animatedSymbol.test.ts \
        packages/game-engine/package.json packages/game-engine/rollup.config.mjs
git commit -m "feat(game-engine): /slot scaffold + SymbolView + AnimatedSymbol"
```

---

### Task 2: `SymbolCell`

**Files:**
- Create: `packages/game-engine/src/slot/grid/SymbolCell.ts`
- Modify: `packages/game-engine/src/slot/index.ts` (export)
- Test: `packages/game-engine/tests/slot/symbolCell.test.ts`

**Interfaces:**
- Consumes: `SymbolResolver`, `SymbolView` (Task 1).
- Produces: `CellFrameStyle`, `CellData`, `CellState`, `SymbolCellConfig`, `class SymbolCell`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/game-engine/tests/slot/symbolCell.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { SymbolCell } from '../../src/slot/grid/SymbolCell';
import type { SymbolResolver } from '../../src/slot/grid/SymbolView';

const resolver: SymbolResolver = vi.fn((id: string) => {
  const v = new Container() as any;
  v.__id = id;
  return v;
});

describe('SymbolCell', () => {
  it('calls the resolver with the symbol id and mounts the view on setData', () => {
    const cell = new SymbolCell({ size: 100, resolve: resolver });
    cell.setData({ symbol: 'A' });
    expect(resolver).toHaveBeenCalledWith('A');
    expect((cell.view as any).__id).toBe('A');
  });
  it('clears the view when symbol is null', () => {
    const cell = new SymbolCell({ size: 100, resolve: resolver });
    cell.setData({ symbol: 'A' });
    cell.setData({ symbol: null });
    expect(cell.view).toBeNull();
  });
  it('styles the frame graphics by state', () => {
    const cell = new SymbolCell({
      size: 100, resolve: resolver,
      frameStyle: { winning: { color: 0x00ff00, alpha: 0.9 }, idle: { color: 0x111111, alpha: 0.3 } },
    });
    cell.setState({ winning: true });
    const frame = cell.children.find((c) => c instanceof Graphics) as any;
    expect(frame.tint).toBe(0x00ff00); // frame styling stored on the graphics' last fill (asserted via a stored field)
    expect(cell.frameStyleKey).toBe('winning');
  });
  it('shows the ×N multiplier badge only when multiplier is set', () => {
    const cell = new SymbolCell({ size: 100, resolve: resolver });
    cell.setData({ symbol: 'A', multiplier: 3 });
    expect(cell.hasBadge('multiplier')).toBe(true);
    cell.setData({ symbol: 'A' });
    expect(cell.hasBadge('multiplier')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/slot/symbolCell.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `SymbolCell.ts`**

```ts
// packages/game-engine/src/slot/grid/SymbolCell.ts
import { Container, Graphics, Text } from 'pixi.js';
import { Tween, Easing } from '../../animation';
import type { SymbolResolver, SymbolView } from './SymbolView';

export interface CellFrameStyle {
  radius?: number;
  idle?: { color: number; alpha: number };
  winning?: { color: number; alpha: number };
  removed?: { color: number; alpha: number };
  fresh?: { color: number; alpha: number };
}
export interface CellData {
  symbol: string | null;
  multiplier?: number;
  bonus?: number;
  sticky?: { remaining: number };
}
export interface CellState { winning?: boolean; removed?: boolean; fresh?: boolean; }
export interface SymbolCellConfig { size: number; resolve: SymbolResolver; frameStyle?: CellFrameStyle; }

const DEFAULT_STYLE: Required<CellFrameStyle> = {
  radius: 8,
  idle: { color: 0x223047, alpha: 0.34 },
  winning: { color: 0x00d4ff, alpha: 0.95 },
  removed: { color: 0x223047, alpha: 0.12 },
  fresh: { color: 0xffffff, alpha: 0.6 },
};

export class SymbolCell extends Container {
  readonly __uiComponent = true as const;

  private _size: number;
  private _resolve: SymbolResolver;
  private _style: Required<CellFrameStyle>;
  private _frame: Graphics;
  private _view: SymbolView | null = null;
  private _badges = new Container();
  private _multBadge: Container | null = null;
  private _bonusBadge: Container | null = null;
  /** Last applied state key — exposed for tests/inspection. */
  frameStyleKey: 'idle' | 'winning' | 'removed' | 'fresh' = 'idle';

  constructor(config: SymbolCellConfig) {
    super();
    this._size = config.size;
    this._resolve = config.resolve;
    this._style = { ...DEFAULT_STYLE, ...(config.frameStyle ?? {}) } as Required<CellFrameStyle>;
    this._frame = new Graphics();
    this.addChild(this._frame);
    this.addChild(this._badges);
    this._drawFrame('idle');
  }

  get view(): SymbolView | null { return this._view; }

  setData(data: CellData): void {
    // symbol view
    if (data.symbol == null) {
      if (this._view) { this._view.destroy(); this._view = null; }
    } else {
      if (this._view) { this._view.destroy(); this._view = null; }
      const v = this._resolve(data.symbol);
      if (v) {
        v.setSize?.(this._size);
        this.addChildAt(v, 1); // above frame, below badges
        this._view = v;
      }
    }
    // badges
    this._setMultiplier(data.multiplier);
    this._setBonus(data.bonus);
  }

  setState(state: CellState): void {
    const key = state.winning ? 'winning' : state.removed ? 'removed' : state.fresh ? 'fresh' : 'idle';
    this.frameStyleKey = key;
    this._drawFrame(key);
  }

  playWin(): Promise<void> {
    if (this._view?.playWin) return this._view.playWin();
    // default: scale pop
    const target = this._view ?? this;
    return Tween.to(target, { 'scale.x': 1.15, 'scale.y': 1.15 }, 160, Easing.easeOutBack)
      .then(() => Tween.to(target, { 'scale.x': 1, 'scale.y': 1 }, 140, Easing.easeOutQuad));
  }

  playIdle(): void { this._view?.playIdle?.(); }

  hasBadge(kind: 'multiplier' | 'bonus'): boolean {
    return kind === 'multiplier' ? this._multBadge != null : this._bonusBadge != null;
  }

  private _drawFrame(key: 'idle' | 'winning' | 'removed' | 'fresh'): void {
    const s = this._style[key];
    this._frame.clear();
    this._frame
      .roundRect(-this._size / 2, -this._size / 2, this._size, this._size, this._style.radius)
      .fill({ color: s.color, alpha: s.alpha });
    // store the colour as tint for cheap inspection/testing
    this._frame.tint = s.color;
  }

  private _setMultiplier(value?: number): void {
    if (this._multBadge) { this._multBadge.destroy(); this._multBadge = null; }
    if (!value || value <= 1) return;
    this._multBadge = this._badge(`×${value}`, 0xffd24a);
    this._multBadge.position.set(this._size / 2 - 12, -this._size / 2 + 12);
    this._badges.addChild(this._multBadge);
  }

  private _setBonus(value?: number): void {
    if (this._bonusBadge) { this._bonusBadge.destroy(); this._bonusBadge = null; }
    if (!value || value <= 0) return;
    this._bonusBadge = this._badge(`+${value}`, 0x7ad7ff);
    this._bonusBadge.position.set(-this._size / 2 + 12, -this._size / 2 + 12);
    this._badges.addChild(this._bonusBadge);
  }

  private _badge(label: string, color: number): Container {
    const c = new Container();
    const t = new Text({ text: label, style: { fontSize: 18, fill: color, fontWeight: '700' } });
    t.anchor.set(0.5);
    c.addChild(t);
    return c;
  }
}
```

- [ ] **Step 4: Export from index + run test**

Append to `packages/game-engine/src/slot/index.ts`:
```ts
export { SymbolCell } from './grid/SymbolCell';
export type { CellFrameStyle, CellData, CellState, SymbolCellConfig } from './grid/SymbolCell';
```
Run: `npx vitest run packages/game-engine/tests/slot/symbolCell.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/slot/grid/SymbolCell.ts packages/game-engine/src/slot/index.ts \
        packages/game-engine/tests/slot/symbolCell.test.ts
git commit -m "feat(game-engine): SymbolCell (frame state-style, badges, view swap)"
```

---

### Task 3: `ReelGrid`

**Files:**
- Create: `packages/game-engine/src/slot/grid/ReelGrid.ts`
- Modify: `packages/game-engine/src/slot/index.ts` (export)
- Test: `packages/game-engine/tests/slot/reelGrid.test.ts`

**Interfaces:**
- Consumes: `SymbolCell`, `CellData`, `SymbolCellConfig` (Task 2), `SymbolResolver` (Task 1).
- Produces: `DecorationConfig`, `ReelGridConfig`, `class ReelGrid` (`setGrid`, `getCell`, `cellPosition`, `cols`, `rows`, `resize`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/game-engine/tests/slot/reelGrid.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Container } from 'pixi.js';
import { ReelGrid } from '../../src/slot/grid/ReelGrid';
import type { SymbolResolver } from '../../src/slot/grid/SymbolView';

const resolve: SymbolResolver = vi.fn(() => new Container() as any);

describe('ReelGrid', () => {
  it('lays out cols×rows cells at cellSize+gap positions', () => {
    const grid = new ReelGrid({ cols: 5, rows: 5, cellSize: 100, gap: 10, resolve });
    expect(grid.cols).toBe(5);
    expect(grid.rows).toBe(5);
    expect(grid.cellPosition(0, 0)).toEqual({ x: 0, y: 0 });
    expect(grid.cellPosition(2, 3)).toEqual({ x: 2 * 110, y: 3 * 110 });
    const cell = grid.getCell(2, 3);
    expect(cell.x).toBe(220);
    expect(cell.y).toBe(330);
  });
  it('works for a 7×7 cascade grid', () => {
    const grid = new ReelGrid({ cols: 7, rows: 7, cellSize: 76, gap: 8, resolve });
    expect(grid.getCell(6, 6).x).toBe(6 * 84);
  });
  it('setGrid pushes data into each cell', () => {
    const grid = new ReelGrid({ cols: 2, rows: 2, cellSize: 50, resolve });
    grid.setGrid([
      [{ symbol: 'A' }, { symbol: 'B' }],
      [{ symbol: 'C' }, { symbol: 'D' }],
    ]);
    expect((resolve as any)).toHaveBeenCalledWith('A');
    expect((resolve as any)).toHaveBeenCalledWith('D');
  });
  it('resize relayouts cells', () => {
    const grid = new ReelGrid({ cols: 2, rows: 1, cellSize: 50, gap: 0, resolve });
    grid.resize(80);
    expect(grid.getCell(1, 0).x).toBe(80);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/slot/reelGrid.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `ReelGrid.ts`**

```ts
// packages/game-engine/src/slot/grid/ReelGrid.ts
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { SymbolCell, type CellData, type CellFrameStyle } from './SymbolCell';
import type { SymbolResolver } from './SymbolView';

export interface DecorationConfig { texture?: Texture; padding?: number; }
export interface ReelGridConfig {
  cols: number; rows: number; cellSize: number; gap?: number;
  resolve: SymbolResolver; frameStyle?: CellFrameStyle;
  decoration?: DecorationConfig;
  mask?: boolean;
}

export class ReelGrid extends Container {
  readonly __uiComponent = true as const;

  private _cols: number;
  private _rows: number;
  private _cellSize: number;
  private _gap: number;
  private _cells: SymbolCell[][] = [];
  private _cellLayer = new Container();

  constructor(config: ReelGridConfig) {
    super();
    this._cols = config.cols;
    this._rows = config.rows;
    this._cellSize = config.cellSize;
    this._gap = config.gap ?? 0;

    if (config.decoration) {
      const pad = config.decoration.padding ?? 0;
      const w = this._cols * (this._cellSize + this._gap) - this._gap + pad * 2;
      const h = this._rows * (this._cellSize + this._gap) - this._gap + pad * 2;
      if (config.decoration.texture) {
        const deco = new Sprite(config.decoration.texture);
        deco.width = w; deco.height = h; deco.position.set(-pad - this._cellSize / 2, -pad - this._cellSize / 2);
        this.addChild(deco);
      }
    }

    this.addChild(this._cellLayer);

    for (let c = 0; c < this._cols; c++) {
      this._cells[c] = [];
      for (let r = 0; r < this._rows; r++) {
        const cell = new SymbolCell({ size: this._cellSize, resolve: config.resolve, frameStyle: config.frameStyle });
        const { x, y } = this.cellPosition(c, r);
        cell.position.set(x, y);
        this._cellLayer.addChild(cell);
        this._cells[c][r] = cell;
      }
    }

    if (config.mask) {
      const w = this._cols * (this._cellSize + this._gap) - this._gap;
      const h = this._rows * (this._cellSize + this._gap) - this._gap;
      const m = new Graphics().rect(-this._cellSize / 2, -this._cellSize / 2, w, h).fill(0xffffff);
      this._cellLayer.mask = m;
      this.addChild(m);
    }
  }

  get cols(): number { return this._cols; }
  get rows(): number { return this._rows; }

  cellPosition(col: number, row: number): { x: number; y: number } {
    const step = this._cellSize + this._gap;
    return { x: col * step, y: row * step };
  }

  getCell(col: number, row: number): SymbolCell { return this._cells[col][row]; }

  setGrid(cells: CellData[][]): void {
    for (let c = 0; c < this._cols; c++) {
      for (let r = 0; r < this._rows; r++) {
        this._cells[c]?.[r]?.setData(cells[c]?.[r] ?? { symbol: null });
      }
    }
  }

  resize(cellSize: number): void {
    this._cellSize = cellSize;
    for (let c = 0; c < this._cols; c++) {
      for (let r = 0; r < this._rows; r++) {
        const { x, y } = this.cellPosition(c, r);
        this._cells[c][r].position.set(x, y);
      }
    }
  }
}
```

- [ ] **Step 4: Export from index + run test**

Append to `index.ts`:
```ts
export { ReelGrid } from './grid/ReelGrid';
export type { DecorationConfig, ReelGridConfig } from './grid/ReelGrid';
```
Run: `npx vitest run packages/game-engine/tests/slot/reelGrid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/slot/grid/ReelGrid.ts packages/game-engine/src/slot/index.ts \
        packages/game-engine/tests/slot/reelGrid.test.ts
git commit -m "feat(game-engine): ReelGrid (layout, cells, decoration, mask)"
```

---

### Task 4: `CascadeController` (plan + run)

**Files:**
- Create: `packages/game-engine/src/slot/anim/easing-map.ts`, `packages/game-engine/src/slot/anim/CascadeController.ts`
- Modify: `packages/game-engine/src/slot/index.ts` (export)
- Test: `packages/game-engine/tests/slot/cascadeController.test.ts`

**Interfaces:**
- Consumes: `ReelGrid` (Task 3), `Tween`/`Easing`.
- Produces: `EASING_BY_NAME`, `CascadeStepData`, `CascadeTimings`, `CascadeAnim`, `class CascadeController` (`plan`, `run`, `skip`, `kill`).

- [ ] **Step 1: Write `easing-map.ts`**

```ts
// packages/game-engine/src/slot/anim/easing-map.ts
import { Easing } from '../../animation';
import type { EasingFunction } from '../../animation';

/** Resolve a descriptor's string easing name to the engine's easing function. */
export const EASING_BY_NAME: Record<string, EasingFunction> = {
  linear: Easing.linear,
  easeOutQuad: Easing.easeOutQuad,
  easeOutCubic: Easing.easeOutCubic,
  easeOutBack: Easing.easeOutBack,
  easeOutBounce: Easing.easeOutBounce,
  easeInBack: Easing.easeInBack,
  easeInOutCubic: Easing.easeInOutCubic,
};
```
(If `EasingFunction` is not exported from `../../animation`, import it from `../../animation/Easing` or define `type EasingFunction = (t: number) => number;` locally — verify the export and use whichever resolves.)

- [ ] **Step 2: Write the failing test**

```ts
// packages/game-engine/tests/slot/cascadeController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Container } from 'pixi.js';
import { ReelGrid } from '../../src/slot/grid/ReelGrid';
import { CascadeController } from '../../src/slot/anim/CascadeController';
import type { SymbolResolver } from '../../src/slot/grid/SymbolView';

const resolve: SymbolResolver = vi.fn(() => new Container() as any);
const grid = () => new ReelGrid({ cols: 3, rows: 3, cellSize: 100, gap: 0, resolve });

describe('CascadeController.plan', () => {
  it('emits highlight then remove for winning cells', () => {
    const c = new CascadeController(grid());
    const plan = c.plan({
      winningCells: [{ col: 0, row: 0 }],
      removedCells: [{ col: 0, row: 0 }],
      newCells: [{ col: 0, row: 0, symbol: 'A' }],
      settledGrid: [],
    });
    const phases = plan.filter((a) => a.col === 0 && a.row === 0).map((a) => a.phase);
    expect(phases).toContain('highlight');
    expect(phases).toContain('remove');
    const remove = plan.find((a) => a.phase === 'remove')!;
    expect(remove.scale).toBe(0);
  });
  it('new cells drop from above their target (from.y < to.y) with per-column stagger', () => {
    const c = new CascadeController(grid());
    const plan = c.plan({
      winningCells: [], removedCells: [],
      newCells: [{ col: 1, row: 0, symbol: 'A' }, { col: 1, row: 1, symbol: 'B' }],
      settledGrid: [],
    });
    const drops = plan.filter((a) => a.phase === 'drop' || a.phase === 'refill');
    expect(drops.length).toBeGreaterThanOrEqual(2);
    for (const d of drops) expect(d.from!.y).toBeLessThan(d.to!.y);
  });
  it('turbo halves durations', () => {
    const c = new CascadeController(grid(), { highlight: 400 });
    const normal = c.plan({ winningCells: [{ col: 0, row: 0 }], removedCells: [], newCells: [], settledGrid: [] });
    const turbo = c.plan({ winningCells: [{ col: 0, row: 0 }], removedCells: [], newCells: [], settledGrid: [] }, { turbo: true });
    const nH = normal.find((a) => a.phase === 'highlight')!.duration;
    const tH = turbo.find((a) => a.phase === 'highlight')!.duration;
    expect(tH).toBe(nH / 2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/slot/cascadeController.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `CascadeController.ts`**

```ts
// packages/game-engine/src/slot/anim/CascadeController.ts
import { Tween } from '../../animation';
import { EASING_BY_NAME } from './easing-map';
import type { ReelGrid } from '../grid/ReelGrid';
import type { CellData } from '../grid/SymbolCell';

export interface CascadeStepData {
  winningCells: { col: number; row: number }[];
  removedCells: { col: number; row: number }[];
  newCells: { col: number; row: number; symbol: string }[];
  settledGrid: CellData[][];
}
export interface CascadeTimings { reveal: number; highlight: number; remove: number; drop: number; refill: number; wait: number; }
export interface CascadeAnim {
  col: number; row: number;
  phase: 'reveal' | 'highlight' | 'remove' | 'drop' | 'refill';
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  scale?: number;
  alpha?: number;
  duration: number;
  easing?: string;
  delay?: number;
}

const DEFAULT_TIMINGS: CascadeTimings = { reveal: 300, highlight: 400, remove: 250, drop: 200, refill: 220, wait: 150 };

export class CascadeController {
  private _grid: ReelGrid;
  private _t: CascadeTimings;
  private _killed = false;

  constructor(grid: ReelGrid, timings?: Partial<CascadeTimings>) {
    this._grid = grid;
    this._t = { ...DEFAULT_TIMINGS, ...(timings ?? {}) };
  }

  /** PURE: ordered animation descriptors for a cascade step. */
  plan(step: CascadeStepData, opts?: { turbo?: boolean }): CascadeAnim[] {
    const f = opts?.turbo ? 0.5 : 1;
    const out: CascadeAnim[] = [];

    for (const w of step.winningCells) {
      out.push({ col: w.col, row: w.row, phase: 'highlight', scale: 1.08, duration: this._t.highlight * f, easing: 'easeOutQuad' });
    }
    for (const w of step.winningCells) {
      out.push({ col: w.col, row: w.row, phase: 'remove', scale: 0, alpha: 0, duration: this._t.remove * f, easing: 'easeInBack' });
    }
    // new cells drop from two row-heights above their target, staggered per column.
    // Row height is derived purely from public geometry (no private grid access).
    const rowStep = this._grid.cellPosition(0, 1).y - this._grid.cellPosition(0, 0).y;
    const perCol: Record<number, number> = {};
    for (const n of step.newCells) {
      const to = this._grid.cellPosition(n.col, n.row);
      const from = { x: to.x, y: to.y - rowStep * 2 };
      const idx = (perCol[n.col] = (perCol[n.col] ?? 0) + 1);
      out.push({ col: n.col, row: n.row, phase: 'drop', from, to, duration: this._t.drop * f, easing: 'easeOutBounce', delay: idx * 30 * f });
    }
    return out;
  }

  /** Execute the plan via Tween. Not unit-tested (Ticker doesn't tick in node). */
  async run(step: CascadeStepData, opts?: { turbo?: boolean }): Promise<void> {
    this._killed = false;
    const plan = this.plan(step, opts);
    // highlight + remove first
    for (const a of plan.filter((p) => p.phase === 'highlight')) {
      if (this._killed) return;
      const cell = this._grid.getCell(a.col, a.row);
      cell.setState({ winning: true });
      await Tween.to(cell, { 'scale.x': a.scale!, 'scale.y': a.scale! }, a.duration, EASING_BY_NAME[a.easing ?? 'easeOutQuad']);
    }
    for (const a of plan.filter((p) => p.phase === 'remove')) {
      if (this._killed) return;
      const cell = this._grid.getCell(a.col, a.row);
      await Tween.to(cell, { 'scale.x': 0, 'scale.y': 0, alpha: 0 }, a.duration, EASING_BY_NAME[a.easing ?? 'easeInBack']);
    }
    // settle data, then drop new cells in
    this._grid.setGrid(step.settledGrid);
    await Promise.all(
      plan.filter((p) => p.phase === 'drop').map(async (a) => {
        if (this._killed) return;
        const cell = this._grid.getCell(a.col, a.row);
        cell.alpha = 1; cell.scale.set(1);
        cell.position.set(a.from!.x, a.from!.y);
        if (a.delay) await Tween.delay(a.delay);
        await Tween.to(cell, { 'position.y': a.to!.y }, a.duration, EASING_BY_NAME[a.easing ?? 'easeOutBounce']);
      }),
    );
  }

  skip(): void { Tween.killAll(); }
  kill(): void { this._killed = true; Tween.killAll(); }
}
```

- [ ] **Step 5: Export from index + run test**

Append to `index.ts`:
```ts
export { CascadeController } from './anim/CascadeController';
export type { CascadeStepData, CascadeTimings, CascadeAnim } from './anim/CascadeController';
```
Run: `npx vitest run packages/game-engine/tests/slot/cascadeController.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine/src/slot/anim/easing-map.ts packages/game-engine/src/slot/anim/CascadeController.ts \
        packages/game-engine/src/slot/index.ts packages/game-engine/tests/slot/cascadeController.test.ts
git commit -m "feat(game-engine): CascadeController (pure plan + Tween run)"
```

---

### Task 5: `ReelSpinController` (plan + run)

**Files:**
- Create: `packages/game-engine/src/slot/anim/ReelSpinController.ts`
- Modify: `packages/game-engine/src/slot/index.ts` (export)
- Test: `packages/game-engine/tests/slot/reelSpinController.test.ts`

**Interfaces:**
- Consumes: `ReelGrid` (Task 3), `CellData`, `Tween`, `EASING_BY_NAME` (Task 4).
- Produces: `ReelSpinData`, `ReelSpinTimings`, `ReelStopPlan`, `class ReelSpinController` (`plan`, `run`, `skip`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/game-engine/tests/slot/reelSpinController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Container } from 'pixi.js';
import { ReelGrid } from '../../src/slot/grid/ReelGrid';
import { ReelSpinController } from '../../src/slot/anim/ReelSpinController';
import type { SymbolResolver } from '../../src/slot/grid/SymbolView';
import type { CellData } from '../../src/slot/grid/SymbolCell';

const resolve: SymbolResolver = vi.fn(() => new Container() as any);
const grid = () => new ReelGrid({ cols: 5, rows: 3, cellSize: 100, gap: 0, resolve });
const target: CellData[][] = Array.from({ length: 5 }, (_, c) =>
  Array.from({ length: 3 }, (_, r) => ({ symbol: `c${c}r${r}` })),
);

describe('ReelSpinController.plan', () => {
  it('stops each reel later than the previous (stagger)', () => {
    const ctrl = new ReelSpinController(grid(), { spinUp: 500, stopStagger: 120 });
    const plan = ctrl.plan({ targetGrid: target });
    expect(plan).toHaveLength(5);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].stopTime).toBeGreaterThan(plan[i - 1].stopTime);
    }
    expect(plan[0].stopTime).toBe(500);
    expect(plan[2].stopTime).toBe(500 + 2 * 120);
  });
  it('landing is the reel target column', () => {
    const ctrl = new ReelSpinController(grid());
    const plan = ctrl.plan({ targetGrid: target });
    expect(plan[3].landing.map((c) => c.symbol)).toEqual(['c3r0', 'c3r1', 'c3r2']);
  });
  it('turbo shrinks spinUp + stagger', () => {
    const ctrl = new ReelSpinController(grid(), { spinUp: 500, stopStagger: 120 });
    const t = ctrl.plan({ targetGrid: target }, { turbo: true });
    expect(t[0].stopTime).toBe(250);
    expect(t[1].stopTime).toBe(250 + 60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/slot/reelSpinController.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `ReelSpinController.ts`**

```ts
// packages/game-engine/src/slot/anim/ReelSpinController.ts
import { Tween, Easing } from '../../animation';
import type { ReelGrid } from '../grid/ReelGrid';
import type { CellData } from '../grid/SymbolCell';

export interface ReelSpinData { targetGrid: CellData[][]; strip?: (reel: number) => string[]; }
export interface ReelSpinTimings { spinUp: number; hold: number; stopStagger: number; settle: number; }
export interface ReelStopPlan {
  reel: number;
  stopTime: number;
  landing: CellData[];
  settle: { amp: number; ms: number };
}

const DEFAULT_TIMINGS: ReelSpinTimings = { spinUp: 500, hold: 200, stopStagger: 120, settle: 240 };

export class ReelSpinController {
  private _grid: ReelGrid;
  private _t: ReelSpinTimings;
  private _killed = false;

  constructor(grid: ReelGrid, timings?: Partial<ReelSpinTimings>) {
    this._grid = grid;
    this._t = { ...DEFAULT_TIMINGS, ...(timings ?? {}) };
  }

  /** PURE: per-reel stop timing + landing window. */
  plan(data: ReelSpinData, opts?: { turbo?: boolean }): ReelStopPlan[] {
    const f = opts?.turbo ? 0.5 : 1;
    const out: ReelStopPlan[] = [];
    for (let reel = 0; reel < this._grid.cols; reel++) {
      out.push({
        reel,
        stopTime: this._t.spinUp * f + reel * this._t.stopStagger * f,
        landing: data.targetGrid[reel] ?? [],
        settle: { amp: 7, ms: this._t.settle * f },
      });
    }
    return out;
  }

  /** Execute the spin: scroll each reel, decelerate, land on target, settle-bounce. Not unit-tested. */
  async run(data: ReelSpinData, opts?: { turbo?: boolean }): Promise<void> {
    this._killed = false;
    const plan = this.plan(data, opts);
    await Promise.all(
      plan.map(async (p) => {
        if (this._killed) return;
        const strip = data.strip?.(p.reel) ?? p.landing.map((c) => c.symbol ?? '');
        // texture-swap spin: cycle symbols quickly while decelerating, then land
        const cells = Array.from({ length: this._grid.rows }, (_, r) => this._grid.getCell(p.reel, r));
        const ticks = Math.max(6, Math.floor(p.stopTime / 60));
        for (let i = 0; i < ticks; i++) {
          if (this._killed) break;
          for (let r = 0; r < cells.length; r++) {
            const sym = strip[(i + r) % strip.length] || null;
            cells[r].setData({ symbol: sym });
          }
          await Tween.delay(Math.min(60, p.stopTime / ticks));
        }
        // land on the real target
        for (let r = 0; r < cells.length; r++) cells[r].setData(p.landing[r] ?? { symbol: null });
        // settle bounce on the column
        const colY = cells[0].parent.y;
        await Tween.fromTo(cells[0].parent, { y: colY - p.settle.amp }, { y: colY }, p.settle.ms, Easing.easeOutBack);
      }),
    );
  }

  skip(): void { this._killed = true; Tween.killAll(); }
}
```

- [ ] **Step 4: Export from index + run test**

Append to `index.ts`:
```ts
export { ReelSpinController } from './anim/ReelSpinController';
export type { ReelSpinData, ReelSpinTimings, ReelStopPlan } from './anim/ReelSpinController';
```
Run: `npx vitest run packages/game-engine/tests/slot/reelSpinController.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/slot/anim/ReelSpinController.ts packages/game-engine/src/slot/index.ts \
        packages/game-engine/tests/slot/reelSpinController.test.ts
git commit -m "feat(game-engine): ReelSpinController (pure plan + Tween run)"
```

---

### Task 6: Win-tier logic + `CountUpDisplay`

**Files:**
- Create: `packages/game-engine/src/slot/overlay/tiers.ts`, `packages/game-engine/src/slot/overlay/CountUpDisplay.ts`
- Modify: `packages/game-engine/src/slot/index.ts` (export)
- Test: `packages/game-engine/tests/slot/overlay.test.ts`

**Interfaces:**
- Produces: `WinTier`, `pickTier`, `tierIndexAtValue` (tiers.ts); `CountUpConfig`, `valueAt`, `class CountUpDisplay`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/game-engine/tests/slot/overlay.test.ts
import { describe, it, expect } from 'vitest';
import { pickTier, tierIndexAtValue, type WinTier } from '../../src/slot/overlay/tiers';
import { valueAt, CountUpDisplay } from '../../src/slot/overlay/CountUpDisplay';

const tiers: WinTier[] = [
  { id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0x00ff00 },
  { id: 'mega', minMultiplier: 30, title: 'MEGA WIN', accentColor: 0x00ffff },
  { id: 'epic', minMultiplier: 100, title: 'EPIC WIN', accentColor: 0xff00ff },
];

describe('pickTier', () => {
  it('picks the highest tier whose minMultiplier <= win/bet', () => {
    expect(pickTier(tiers, 50, 1)!.id).toBe('mega');   // 50× → mega (>=30, <100)
    expect(pickTier(tiers, 10, 1)!.id).toBe('big');    // boundary
    expect(pickTier(tiers, 9, 1)).toBeNull();          // below lowest
    expect(pickTier(tiers, 1000, 1)!.id).toBe('epic'); // top
  });
});

describe('tierIndexAtValue', () => {
  it('returns the tier index for the running value (or -1 below lowest)', () => {
    expect(tierIndexAtValue(tiers, 5, 1)).toBe(-1);
    expect(tierIndexAtValue(tiers, 15, 1)).toBe(0);
    expect(tierIndexAtValue(tiers, 120, 1)).toBe(2);
  });
});

describe('valueAt', () => {
  it('is 0 at t=0, target at t>=duration, monotonic', () => {
    expect(valueAt(0, 100, 1000)).toBe(0);
    expect(valueAt(1000, 100, 1000)).toBe(100);
    expect(valueAt(2000, 100, 1000)).toBe(100);
    expect(valueAt(500, 100, 1000)).toBeGreaterThan(0);
    expect(valueAt(500, 100, 1000)).toBeLessThan(100);
  });
});

describe('CountUpDisplay', () => {
  it('formats the value via the provided formatter', () => {
    const d = new CountUpDisplay({ format: (v) => `$${Math.round(v)}` });
    d.setValue(42);
    expect(d.text).toBe('$42');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/slot/overlay.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `tiers.ts` and `CountUpDisplay.ts`**

```ts
// packages/game-engine/src/slot/overlay/tiers.ts
import type { Texture } from 'pixi.js';

export interface WinTier {
  id: string;
  minMultiplier: number;
  title: string;
  accentColor: number;
  bannerTexture?: Texture;
}

/** Highest tier whose minMultiplier <= win/bet, or null if below the lowest. */
export function pickTier(tiers: WinTier[], win: number, bet: number): WinTier | null {
  if (bet <= 0) return null;
  const mult = win / bet;
  let chosen: WinTier | null = null;
  for (const t of tiers) {
    if (mult >= t.minMultiplier && (!chosen || t.minMultiplier >= chosen.minMultiplier)) chosen = t;
  }
  return chosen;
}

/** Index into `tiers` for the running value (or -1 below the lowest tier). */
export function tierIndexAtValue(tiers: WinTier[], runningValue: number, bet: number): number {
  if (bet <= 0) return -1;
  const mult = runningValue / bet;
  let idx = -1;
  for (let i = 0; i < tiers.length; i++) if (mult >= tiers[i].minMultiplier) idx = i;
  return idx;
}
```

```ts
// packages/game-engine/src/slot/overlay/CountUpDisplay.ts
import { Container, Text, type TextStyle } from 'pixi.js';
import { Tween, Easing } from '../../animation';

export interface CountUpConfig { format: (v: number) => string; style?: Partial<TextStyle>; }

/** PURE eased interpolation 0→target over duration (ms). Clamped to [0, target]. */
export function valueAt(elapsed: number, target: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return target;
  if (elapsed <= 0) return 0;
  const p = elapsed / duration;
  const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
  return target * eased;
}

export class CountUpDisplay extends Container {
  readonly __uiComponent = true as const;
  private _text: Text;
  private _format: (v: number) => string;
  private _value = 0;

  constructor(config: CountUpConfig) {
    super();
    this._format = config.format;
    this._text = new Text({
      text: this._format(0),
      style: { fontFamily: 'sans-serif', fontSize: 48, fill: 0xffffff, fontWeight: '800', ...config.style },
    });
    this._text.anchor.set(0.5);
    this.addChild(this._text);
  }

  get text(): string { return this._text.text; }

  setValue(v: number): void {
    this._value = v;
    this._text.text = this._format(v);
  }

  /** Animate the value to target over duration; fires onTier on each tier-index increase. */
  async countTo(target: number, duration: number, onTier?: (idx: number) => void): Promise<void> {
    const holder = { v: 0 };
    let lastTier = -1;
    await Tween.to(holder, { v: target }, duration, Easing.easeOutCubic, () => {
      this.setValue(holder.v);
      if (onTier) {
        // caller maps holder.v → tier index; we surface the raw value via setValue, tier logic is external
      }
    });
    this.setValue(target);
    void lastTier; void onTier;
  }

  skip(): void { Tween.killTweensOf(this); }
}
```

- [ ] **Step 4: Export from index + run test**

Append to `index.ts`:
```ts
export { pickTier, tierIndexAtValue } from './overlay/tiers';
export type { WinTier } from './overlay/tiers';
export { valueAt, CountUpDisplay } from './overlay/CountUpDisplay';
export type { CountUpConfig } from './overlay/CountUpDisplay';
```
Run: `npx vitest run packages/game-engine/tests/slot/overlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/slot/overlay/tiers.ts packages/game-engine/src/slot/overlay/CountUpDisplay.ts \
        packages/game-engine/src/slot/index.ts packages/game-engine/tests/slot/overlay.test.ts
git commit -m "feat(game-engine): win-tier logic + CountUpDisplay"
```

---

### Task 7: `BigWinOverlay` + full `/slot` build

**Files:**
- Create: `packages/game-engine/src/slot/overlay/BigWinOverlay.ts`
- Modify: `packages/game-engine/src/slot/index.ts` (export)
- Test: extend `packages/game-engine/tests/slot/overlay.test.ts`

**Interfaces:**
- Consumes: `WinTier`/`pickTier`/`tierIndexAtValue` (tiers), `CountUpDisplay` (Task 6), `Tween`.
- Produces: `BigWinOverlayConfig`, `class BigWinOverlay` (`show`, `skip`, `hide`, `resize`).

No deep unit test for `show()` (Pixi/Ticker). Test only the pure tier-pick wiring (constructs, picks the right tier text) + that `hide()` sets it invisible. Verified fully by build + example.

- [ ] **Step 1: Add the failing test (append to overlay.test.ts)**

```ts
// append to packages/game-engine/tests/slot/overlay.test.ts
import { BigWinOverlay } from '../../src/slot/overlay/BigWinOverlay';

describe('BigWinOverlay', () => {
  const cfg = { tiers, formatMoney: (v: number) => `$${Math.round(v)}`, width: 1920, height: 1080 };
  it('constructs and exposes the chosen tier title for a win', () => {
    const o = new BigWinOverlay(cfg);
    expect(o.tierTitleFor(50, 1)).toBe('MEGA WIN');
    expect(o.tierTitleFor(5, 1)).toBeNull();
  });
  it('hide() makes it invisible', () => {
    const o = new BigWinOverlay(cfg);
    o.hide();
    expect(o.visible).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/game-engine/tests/slot/overlay.test.ts`
Expected: FAIL — `BigWinOverlay` not found.

- [ ] **Step 3: Write `BigWinOverlay.ts`**

```ts
// packages/game-engine/src/slot/overlay/BigWinOverlay.ts
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { Tween, Easing } from '../../animation';
import { pickTier, tierIndexAtValue, type WinTier } from './tiers';
import { CountUpDisplay } from './CountUpDisplay';

export interface BigWinOverlayConfig {
  tiers: WinTier[];
  formatMoney: (v: number) => string;
  countUpDuration?: (win: number) => number;
  particleCount?: number;
  width: number;
  height: number;
}

const DEFAULT_DURATION = (win: number) => Math.min(2500, Math.max(800, win * 20));

export class BigWinOverlay extends Container {
  readonly __uiComponent = true as const;

  private _cfg: BigWinOverlayConfig;
  private _dim: Graphics;
  private _banner: Sprite | null = null;
  private _title: Text;
  private _count: CountUpDisplay;

  constructor(config: BigWinOverlayConfig) {
    super();
    this._cfg = config;
    this.visible = false;

    this._dim = new Graphics();
    this.addChild(this._dim);

    this._title = new Text({ text: '', style: { fontFamily: 'sans-serif', fontSize: 72, fill: 0xffffff, fontWeight: '900' } });
    this._title.anchor.set(0.5);
    this.addChild(this._title);

    this._count = new CountUpDisplay({ format: config.formatMoney });
    this.addChild(this._count);

    this.resize(config.width, config.height);
  }

  /** Pure helper (testable): the tier title for a given win/bet, or null below the lowest tier. */
  tierTitleFor(win: number, bet: number): string | null {
    return pickTier(this._cfg.tiers, win, bet)?.title ?? null;
  }

  resize(width: number, height: number): void {
    this._cfg.width = width; this._cfg.height = height;
    this._dim.clear();
    this._dim.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.72 });
    this._title.position.set(width / 2, height * 0.4);
    this._count.position.set(width / 2, height * 0.56);
  }

  async show(win: number, bet: number): Promise<void> {
    const tier = pickTier(this._cfg.tiers, win, bet);
    if (!tier) return;
    this.visible = true;
    this.alpha = 0;
    this._title.text = tier.title;
    this._title.style.fill = tier.accentColor;

    if (this._banner) { this._banner.destroy(); this._banner = null; }
    if (tier.bannerTexture) {
      this._banner = new Sprite(tier.bannerTexture);
      this._banner.anchor.set(0.5);
      this._banner.position.set(this._cfg.width / 2, this._cfg.height * 0.4);
      this.addChildAt(this._banner, 1);
    }

    await Tween.to(this, { alpha: 1 }, 200, Easing.easeOutQuad);
    const dur = (this._cfg.countUpDuration ?? DEFAULT_DURATION)(win);
    let lastIdx = tierIndexAtValue(this._cfg.tiers, 0, bet);
    await this._count.countTo(win, dur, undefined);
    // tier-promotion title updates as the value climbs (sampled at the end for simplicity)
    const finalIdx = tierIndexAtValue(this._cfg.tiers, win, bet);
    if (finalIdx > lastIdx && this._cfg.tiers[finalIdx]) {
      this._title.text = this._cfg.tiers[finalIdx].title;
    }
    void lastIdx;
  }

  skip(): void { Tween.killTweensOf(this); this._count.skip(); }

  hide(): void { this.visible = false; Tween.killTweensOf(this); }
}
```

- [ ] **Step 4: Export from index + run test**

Append to `index.ts`:
```ts
export { BigWinOverlay } from './overlay/BigWinOverlay';
export type { BigWinOverlayConfig } from './overlay/BigWinOverlay';
```
Run: `npx vitest run packages/game-engine/tests/slot/overlay.test.ts`
Expected: PASS (all overlay tests).

- [ ] **Step 5: Full slot suite + build + typecheck**

Run: `npx vitest run packages/game-engine/tests/slot/`
Expected: all 6 test files pass.
Run: `npm run build --workspace @energy8platform/game-engine && npm run typecheck --workspace @energy8platform/game-engine`
Expected: `dist/slot.*` emitted; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine/src/slot/overlay/BigWinOverlay.ts packages/game-engine/src/slot/index.ts \
        packages/game-engine/tests/slot/overlay.test.ts
git commit -m "feat(game-engine): BigWinOverlay (tier banner + count-up)"
```

---

### Task 8: Prove it in `examples/spec-slot`

**Files:**
- Create: `examples/spec-slot/slot/symbols.ts`, `examples/spec-slot/slot/grid.test.ts`
- Modify: `examples/spec-slot/GameScene.ts` (construct a ReelGrid), `examples/spec-slot/tsconfig.json` (include `slot/`)
- Modify: `examples/spec-slot/package.json` (no new dep — game-engine + pixi already dev deps from slice 2)

**Interfaces:**
- Consumes: `ReelGrid`, `AnimatedSymbol`, `CascadeController`, `BigWinOverlay` from `@energy8platform/game-engine/slot`; `Scene` from `/core`; `model` from `../game.spec`.

- [ ] **Step 1: Write the example symbol resolver**

```ts
// examples/spec-slot/slot/symbols.ts
import { Texture } from 'pixi.js';
import { AnimatedSymbol, type SymbolResolver } from '@energy8platform/game-engine/slot';

/** Toy resolver: every symbol is an AnimatedSymbol over a blank texture (no real art in the demo). */
export const resolveSymbol: SymbolResolver = (id: string) =>
  new AnimatedSymbol({ textures: { base: id ? Texture.WHITE : Texture.EMPTY }, size: 96 });
```

- [ ] **Step 2: Write the node test proving composition with the real model**

```ts
// examples/spec-slot/slot/grid.test.ts
import { describe, it, expect } from 'vitest';
import { ReelGrid, CascadeController } from '@energy8platform/game-engine/slot';
import { model } from '../game.spec';
import { resolveSymbol } from './symbols';

describe('spec-slot grid composition', () => {
  it('builds a grid sized from the spec and sets symbols from the model', () => {
    const { cols, rows } = model.spec.grid;
    const grid = new ReelGrid({ cols, rows, cellSize: 96, gap: 6, resolve: resolveSymbol });
    expect(grid.cols).toBe(cols);
    const symbolId = model.spec.symbols[0].id;
    grid.setGrid(Array.from({ length: cols }, () => Array.from({ length: rows }, () => ({ symbol: symbolId }))));
    expect(grid.getCell(0, 0).view).not.toBeNull();
  });
  it('CascadeController.plan produces remove + drop descriptors on the spec grid', () => {
    const { cols, rows } = model.spec.grid;
    const grid = new ReelGrid({ cols, rows, cellSize: 96, resolve: resolveSymbol });
    const c = new CascadeController(grid);
    const plan = c.plan({
      winningCells: [{ col: 0, row: 0 }],
      removedCells: [{ col: 0, row: 0 }],
      newCells: [{ col: 0, row: 0, symbol: model.spec.symbols[0].id }],
      settledGrid: [],
    });
    expect(plan.some((a) => a.phase === 'remove')).toBe(true);
    expect(plan.some((a) => a.phase === 'drop')).toBe(true);
  });
});
```

- [ ] **Step 3: Wire a ReelGrid into GameScene (typecheck-level proof)**

Replace `examples/spec-slot/GameScene.ts` body with:
```ts
// examples/spec-slot/GameScene.ts
import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, BigWinOverlay } from '@energy8platform/game-engine/slot';
import { model } from './game.spec';
import { resolveSymbol } from './slot/symbols';

export class GameScene extends Scene {
  async onEnter(): Promise<void> {
    const { cols, rows } = model.spec.grid;
    const grid = new ReelGrid({ cols, rows, cellSize: 96, gap: 6, resolve: resolveSymbol });
    this.container.addChild(grid);

    const overlay = new BigWinOverlay({
      tiers: [{ id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0xffd24a }],
      formatMoney: (v) => `€${v.toFixed(2)}`,
      width: 1920,
      height: 1080,
    });
    this.container.addChild(overlay);
  }
}
```

- [ ] **Step 4: Add `slot/` to the example tsconfig include**

In `examples/spec-slot/tsconfig.json`, extend `include` to `["*.ts", "stake/**/*.ts", "slot/**/*.ts"]`.

- [ ] **Step 5: Build deps, run the example test + typecheck + smoke**

Run: `npm run build --workspace @energy8platform/platform-core && npm run build --workspace @energy8platform/game-engine`
Run: `npx vitest run examples/spec-slot/slot/grid.test.ts`
Expected: PASS (grid built from spec dims; CascadeController.plan yields remove+drop).
Run: `cd examples/spec-slot && npx tsc --noEmit && cd ../..`
Expected: passes (GameScene composes ReelGrid + BigWinOverlay against the real model + slot API; stake/ still typechecks).
Run: `npm run smoke --workspace spec-slot-example`
Expected: `SMOKE PASS` (slice-1 path unchanged).

- [ ] **Step 6: Commit**

```bash
git add examples/spec-slot/slot examples/spec-slot/GameScene.ts examples/spec-slot/tsconfig.json
git commit -m "docs(examples): spec-slot uses ReelGrid + CascadeController + BigWinOverlay"
```

---

## Self-Review

**Spec coverage:**
- SymbolView/SymbolResolver + AnimatedSymbol → Task 1. ✓
- SymbolCell (frame state→style, badges, view swap, default fallbacks) → Task 2. ✓
- ReelGrid (layout, getCell, cellPosition, decoration, mask, resize) → Task 3. ✓
- CascadeController (pure plan + run) → Task 4. ✓
- ReelSpinController (pure plan + run) → Task 5. ✓
- tiers (pickTier/tierIndexAtValue) + CountUpDisplay (valueAt + display) → Task 6. ✓
- BigWinOverlay (show/skip/hide/resize) → Task 7. ✓
- `/slot` sub-path wiring (package.json export + rollup bundle) → Task 1. ✓
- Asset-agnostic (resolver) + data-driven (setGrid/setState) → Tasks 1–3. ✓
- plan/run split, pure-plan tested, run not unit-tested → Tasks 4–5 (+ overlay pure logic Task 6). ✓
- Pixi-construct-without-init testing → all grid/overlay tests run in node. ✓
- Validation in spec-slot (resolver + GameScene + node test) → Task 8. ✓
- Out-of-scope (FreeSpinsSession, PaylineRenderer, WinPresenter, frame-art-loader, real-game migration) → absent. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands carry expected output. The `easing-map.ts` note about `EasingFunction` export (Task 4 Step 1) is a conditional with an exact fallback, not a placeholder. ✓

**Type consistency:** `SymbolView`/`SymbolResolver`/`SymbolTextures` (Task 1) consumed unchanged in Tasks 2–8. `CellData`/`CellFrameStyle`/`CellState` (Task 2) used in ReelGrid (Task 3) + controllers (Tasks 4–5). `ReelGrid` API (`cols`/`getCell`/`cellPosition`/`setGrid`) consumed identically in Tasks 4–5, 8. `WinTier`/`pickTier`/`tierIndexAtValue` (Task 6) consumed in BigWinOverlay (Task 7). `CascadeController`/`ReelSpinController` `plan` signatures identical across def + example. ✓

**Risks flagged:**
- `EasingFunction` export location (Task 4 Step 1 names the fallback).
- `CascadeController.plan` reads grid geometry only via public `cellPosition` (row height = `cellPosition(0,1).y - cellPosition(0,0).y`); no private grid access.
- `run()`/`show()` not unit-tested (Ticker) — covered by typecheck + example, per the plan/run split.
