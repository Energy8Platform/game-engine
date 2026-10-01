# S Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every HB overlay in the S shell with an S version (flat, sharp, no outlines), and turn the burger into ✕ while the menu is open.

**Architecture:**
- **HB hooks.** HB's renderer gains an `overlays` override map, a `setMenuOpen` bar hook and a scroll look; HB defaults stay unchanged.
- **Primitives.** New S primitives live in `src/ui/pixi-s/primitives/`: title plate, ✕, text button, chip, slider, toggle, card modal and full-screen page.
- **Components.** The S overlay components live in `src/ui/pixi-s/components/`. They are forks of HB's that swap the look and keep the behaviour.
- **Wiring.** `createPixiSShell` passes the S overlays to the renderer.

**Tech Stack:** TypeScript 5.6, PixiJS 8.20, Vitest 2 (jsdom + the shared canvas stub).

**Spec:** `docs/superpowers/specs/2026-09-30-pixi-s-overlays-design.md` (slice 1: `docs/superpowers/specs/2026-09-29-pixi-s-shell-design.md`).

## Global Constraints

- Package `@energy8platform/shell` (`packages/shell`), branch `feat/pixi-s-shell`. S code lives under `packages/shell/src/ui/pixi-s/`.
- HB behaviour is unchanged. Every existing test in `tests/pixi-hb/`, `tests/pixi/` and `tests/pixi-s/` passes, except where a task says otherwise.
- **No stroke, no rounding, anywhere in S overlays:** no `roundRect` with a radius > 0, no `circle`/`ellipse`, no `stroke`, and S text never sets `stroke`. The only exceptions are HB/S glyphs (`IconView`, and `sIcon` Graphics labelled `s-glyph`).
- Palette (existing): yellow `#f8be45`, yellowHover `#e9ae36`, plate `#0b0b0b`, plateHover `#1b1b1b`, red `#e0301e`, redHover `#c42716`, fg `#f4f2eb`, ink `#0b0b0b`.
- New tokens: panel `#0b0b0b`, track `#2a2a2a`, muted `rgba(244,242,235,.6)`, veil `rgba(0,0,0,.55)`, winOk `#4ade80`, winNo `#f87171`.
- Type: labels, titles and values use Montserrat (`sLabel` / `sValue`); body copy uses Inter (`sBody`).
- Commands:
  - single test file: `cd packages/shell && npx vitest run <path>`;
  - full suite (from the repo root): `npm test --workspace @energy8platform/shell`;
  - typecheck (from the repo root): `npm run typecheck --workspace @energy8platform/shell`;
  - never run a root-level `npx vitest run <path>`.
- Commits:
  - stage only the files the task lists, and never anything under `engine/`;
  - never run `git stash`, `git checkout -- <file>` or `git restore` on files you did not write;
  - message: subject line, blank line, then exactly `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Verify with `git log -1 --format=%B`.
- Style: match the surrounding S code (2-space indent, single quotes, semicolons, short English doc comments).

## Review Focus

1. **A menu taller than the room above the burger** (Stake popout S 400×225, landscape phone). The stack must scale down and stay fully on screen. Test in Task 4.
2. **Resize or rotation with the menu open.** The burger stays ✕ (renderBar re-applies it) and the stack re-anchors to the new burger. Tests in Task 1 and Task 4.
3. **Game info with no sections, or only a custom one.** The page still shows its title plate and ✕ and does not throw. Test in Task 5.
4. **A paytable with 1 or 2 rows.** The cards keep a third of the column width and sit left-aligned, not stretched. Test in Task 5.
5. **Very long localized labels** (a menu row, a title plate, a CTA). They scale into their plates and never overflow. Tests in Task 2 and Task 4.

---

### Task 1: HB hooks — overlays map, burger state, scroll look

**Files:**
- Modify: `packages/shell/src/ui/pixi-hb/PixiHbRenderer.ts`
- Modify: `packages/shell/src/ui/pixi-hb/primitives/scroll-affordance.ts`
- Modify: `packages/shell/src/ui/pixi-hb/primitives/scroll.ts`
- Modify: `packages/shell/src/ui/pixi-s/SideBar.ts`
- Modify: `packages/shell/src/ui/pixi-s/icons.ts` (label `s-glyph`)
- Test: `packages/shell/tests/pixi-hb/renderer-overlays.test.ts` (create)
- Test: `packages/shell/tests/pixi-s/sidebar.test.ts` (add a test)

**Interfaces:**
- Produces:
  - `export interface HbOverlays { menu; gameInfo; buyBonus; betPicker; autoplayPicker; replay; modal }` (signatures in Step 3), and `PixiHbRendererOptions.overlays?: Partial<HbOverlays>`;
  - `HbBar.setMenuOpen?(open: boolean): void`;
  - `export interface ScrollLook { track: string; thumb: string; radius: number }` and `export const HB_SCROLL_LOOK`, both in `scroll-affordance.ts`;
  - `new ScrollBox(canvas?, ticker?, look?: ScrollLook)`;
  - `SideBar.setMenuOpen(open)`.
  - Every Graphics returned by `sIcon` has `label === 's-glyph'`.

- [ ] **Step 1: Write the failing tests**

Create `packages/shell/tests/pixi-hb/renderer-overlays.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import type { Application } from 'pixi.js';
import { PixiHbRenderer, type HbBar, type HbOverlays } from '@/ui/pixi-hb/PixiHbRenderer';
import { ScrollBox } from '@/ui/pixi-hb/primitives/scroll';
import { ShellController } from '@/core/ShellController';

const stubTicker = { add() {}, remove() {} };
function fakeApp(w: number, h: number): Application {
  return { screen: { width: w, height: h }, ticker: stubTicker, renderer: { on() {}, off() {} }, stage: new Container() } as unknown as Application;
}

function fakeBar(log: boolean[]): HbBar {
  const bar = new Container() as HbBar;
  Object.assign(bar, {
    applyFit() {},
    menuAnchor: () => ({ x: 10, y: 400, w: 40, h: 30 }),
    menuPlate: () => null,
    fitScale: () => 1,
    safeArea: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    setMenuOpen: (open: boolean) => log.push(open),
  });
  return bar;
}

function mount(overlays?: Partial<HbOverlays>, log: boolean[] = []) {
  const r = new PixiHbRenderer({ app: fakeApp(1280, 720), parent: new Container(), bar: () => fakeBar(log), overlays });
  const c = new ShellController({
    renderer: r,
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2],
    defaultBet: 1,
    currentBet: null,
    balance: 100,
    win: 0,
    mode: 'base',
    gameInfo: { sections: [] },
    features: { turbo: 0, autoplay: {}, buyBonus: [] },
  });
  return { r, c, log };
}

const layer = (tag: string) => Object.assign(new Container(), { tag });

describe('PixiHbRenderer — overridable overlays and burger state', () => {
  it('routes each overlay kind to its injected builder; the menu builder gets live getters', () => {
    const calls: string[] = [];
    let anchor: (() => unknown) | undefined;
    const { r } = mount({
      menu: (_ctx, a) => { calls.push('menu'); anchor = a; return layer('m'); },
      gameInfo: () => { calls.push('gameInfo'); return layer('g'); },
      buyBonus: () => { calls.push('buyBonus'); return layer('b'); },
      betPicker: () => { calls.push('betPicker'); return layer('p'); },
      autoplayPicker: () => { calls.push('autoplayPicker'); return layer('a'); },
      replay: () => { calls.push('replay'); return layer('r'); },
      modal: () => { calls.push('modal'); return layer('x'); },
    });
    r.openOverlay({ kind: 'menu' });
    expect(anchor!()).toEqual({ x: 10, y: 400, w: 40, h: 30 });
    r.openOverlay({ kind: 'gameInfo' });
    r.openOverlay({ kind: 'buyBonus' });
    r.openOverlay({ kind: 'betPicker' });
    r.openOverlay({ kind: 'autoplayPicker' });
    r.openOverlay({ kind: 'replay', opts: { bonusId: 'x', bet: 1, payoutMultiplier: 1, onReplay: () => {} } });
    r.openOverlay({ kind: 'modal', opts: { title: 't', body: 'b' } as never });
    expect(calls).toEqual(['menu', 'gameInfo', 'buyBonus', 'betPicker', 'autoplayPicker', 'replay', 'modal']);
  });

  it('without overrides the HB builders open (game info still works)', () => {
    const { r } = mount();
    expect(r.openOverlay({ kind: 'gameInfo' })).toBeTruthy();
  });

  it('tells the bar the menu is open, closed, and re-applies it after a bar rebuild', () => {
    const { r, log } = mount({ menu: () => layer('m') });
    log.length = 0;
    r.openOverlay({ kind: 'menu' });
    expect(log.at(-1)).toBe(true);
    r.renderBar(); // a state change rebuilds the bar under the open menu
    expect(log.at(-1)).toBe(true);
    r.closeOverlay();
    expect(log.at(-1)).toBe(false);
    r.openOverlay({ kind: 'gameInfo' });
    expect(log.at(-1)).toBe(false); // a non-menu layer never marks the burger
  });
});

describe('ScrollBox look', () => {
  it('a flat look draws the thumb and track as plain rects in its colours', () => {
    const box = new ScrollBox(undefined, undefined, { track: '#111111', thumb: '#222222', radius: 0 });
    box.setViewport(100, 100);
    box.content.addChild(new Graphics().rect(0, 0, 100, 500).fill(0xffffff));
    box.refresh();
    const thumb = (box.affordance as unknown as { thumb: Graphics }).thumb;
    const types = thumb.context.instructions.flatMap((i) =>
      (i.data as { path: { shapePath: { shapePrimitives: Array<{ shape: { type: string } }> } } }).path.shapePath.shapePrimitives.map((p) => p.shape.type),
    );
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((t) => t === 'rectangle')).toBe(true);
  });
});
```

Add to `packages/shell/tests/pixi-s/sidebar.test.ts`, inside `describe('S side bar — modes and controls', …)`:

```ts
  it('setMenuOpen swaps the burger glyph for ✕ and back', () => {
    const bar = build(host(1280, 720));
    const b = bar as unknown as { menuBtn: SButton; menuClose: Container };
    expect(b.menuBtn.glyph.visible).toBe(true);
    expect(b.menuClose.visible).toBe(false);
    bar.setMenuOpen(true);
    expect(b.menuBtn.glyph.visible).toBe(false);
    expect(b.menuClose.visible).toBe(true);
    expect((b.menuClose as IconView).iconName).toBe('close');
    bar.setMenuOpen(false);
    expect(b.menuBtn.glyph.visible).toBe(true);
    expect(b.menuClose.visible).toBe(false);
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd packages/shell && npx vitest run tests/pixi-hb/renderer-overlays.test.ts tests/pixi-s/sidebar.test.ts`
Expected: FAIL.
- The `overlays` option is ignored, so the injected builders are never called.
- `setMenuOpen` is not a function.
- The ScrollBox thumb draws a `roundedRectangle`.

- [ ] **Step 3: Renderer hooks**

In `PixiHbRenderer.ts`, add the type imports `ReplayModalOptions` and `ModalOptions` from `@/core/types`, and `ShellLayer` from `../pixi/context`. Then:

1. Add to `HbBar`:
```ts
  /** The menu layer opened (true) or closed (false) — a skin can mark its burger (S: ✕). */
  setMenuOpen?(open: boolean): void;
```
2. Add, above `PixiHbRendererOptions`:
```ts
/** The overlay builders PixiHbRenderer uses; a skin overrides any of them through `overlays`. */
export interface HbOverlays {
  menu(ctx: PixiComponentContext, anchor: () => Rect | null, plate: () => Rect | null, scale: () => number): ShellLayer;
  gameInfo(ctx: PixiComponentContext): ShellLayer;
  buyBonus(ctx: PixiComponentContext): ShellLayer | null;
  betPicker(ctx: PixiComponentContext): ShellLayer;
  autoplayPicker(ctx: PixiComponentContext): ShellLayer;
  replay(ctx: PixiComponentContext, opts: ReplayModalOptions, reopen: () => void): ShellLayer;
  modal(ctx: PixiComponentContext, opts: ModalOptions): ShellLayer;
}

const HB_OVERLAYS: HbOverlays = {
  menu: openMenu,
  gameInfo: openGameInfo,
  buyBonus: openBuyBonus,
  betPicker: openBetPicker,
  autoplayPicker: openAutoplayPicker,
  replay: buildReplayModal,
  modal: buildModal,
};
```
3. Add to `PixiHbRendererOptions`: `/** Replace any of HB's overlays (the S skin replaces them all). */ overlays?: Partial<HbOverlays>;`.
4. Add these fields: `private overlays: HbOverlays;` and `private currentKind: OverlayRequest['kind'] | null = null;`. In the constructor, set `this.overlays = { ...HB_OVERLAYS, ...opts.overlays };`.
5. In `renderBar()`, right after `this.bar.applyFit();`, add:
```ts
    // a bar rebuilt under the open menu keeps its "menu open" mark (the S burger's ✕)
    if (this.currentKind === 'menu') this.bar.setMenuOpen?.(true);
```
6. In `openOverlay`, build each kind through `this.overlays`. Keep the existing comment on the menu case:
```ts
    const o = this.overlays;
    let layer: ShellLayer | null = null;
    switch (req.kind) {
      case 'menu':
        layer = o.menu(
          this.ctx,
          () => this.bar?.menuAnchor() ?? null,
          () => this.bar?.menuPlate() ?? null,
          () => this.bar?.fitScale() ?? 1,
        );
        break;
      case 'gameInfo':
        layer = o.gameInfo(this.ctx);
        break;
      case 'buyBonus':
        layer = o.buyBonus(this.ctx);
        break;
      case 'betPicker':
        layer = o.betPicker(this.ctx);
        break;
      case 'autoplayPicker':
        layer = o.autoplayPicker(this.ctx);
        break;
      case 'replay':
        layer = o.replay(this.ctx, req.opts, () => this.host.openReplay(req.opts));
        break;
      case 'modal':
        layer = o.modal(this.ctx, req.opts);
        break;
    }
    if (!layer) return;
    this.pushLayer(layer, { backdrop: req.kind !== 'menu' });
    this.currentKind = req.kind; // after pushLayer: its clearLayer() resets it
    if (req.kind === 'menu') this.bar?.setMenuOpen?.(true);
```
7. In `private clearLayer()`, at the end add:
```ts
    this.currentKind = null;
    this.bar?.setMenuOpen?.(false);
```

- [ ] **Step 4: Scroll look**

In `scroll-affordance.ts`:
```ts
/** How the scrollbar is painted. HB: an orange rounded thumb on a dark groove; S: flat yellow. */
export interface ScrollLook {
  track: string;
  thumb: string;
  /** Corner radius of the thumb and track; 0 draws plain rects. */
  radius: number;
}
export const HB_SCROLL_LOOK: ScrollLook = { track: HB.track, thumb: HB.orange, radius: THUMB_THICK / 2 };
```
(Place it after the `THUMB_THICK` constant.)

- Give `ScrollAffordanceView` a `private look: ScrollLook` field, and change its constructor to `constructor(look: ScrollLook = HB_SCROLL_LOOK)`, storing it.
- Replace the two `this.thumb.roundRect(…)` lines with:
```ts
    const r = this.look.radius;
    if (r > 0) {
      this.thumb.roundRect(t.x, t.y, t.w, t.h, r).fill(this.look.track);
      this.thumb.roundRect(b.x, b.y, b.w, b.h, r).fill(this.look.thumb);
    } else {
      this.thumb.rect(t.x, t.y, t.w, t.h).fill(this.look.track);
      this.thumb.rect(b.x, b.y, b.w, b.h).fill(this.look.thumb);
    }
```

In `scroll.ts`:
- change the constructor to `constructor(canvas?: HTMLCanvasElement, _ticker?: Ticker, look?: ScrollLook)`;
- create the affordance with `new ScrollAffordanceView(look)`;
- add `type ScrollLook` to the import from `./scroll-affordance`.

- [ ] **Step 5: Burger ✕ and glyph label**

In `packages/shell/src/ui/pixi-s/icons.ts`, in `sIcon`, before `return g;`, add:
```ts
  g.label = 's-glyph'; // lets the no-round/no-stroke guard skip glyph geometry (SVG paths)
```

In `packages/shell/src/ui/pixi-s/SideBar.ts`:
- Add the field `private menuClose!: IconView;`. Import `type IconView` from `../pixi-hb/pixi-icon`, alongside `makeIcon`.
- In `buildLeft()`, right after `this.menuBtn = new SButton({…});`:
```ts
    // the ✕ the burger shows while the menu is open (setMenuOpen), in the same glyph box
    this.menuClose = makeIcon('close', z.menuGlyph, { ink: S.fg, fill: S.fg });
    this.menuClose.position.copyFrom(this.menuBtn.glyph.position);
    this.menuClose.visible = false;
    this.menuBtn.addChild(this.menuClose);
```
- Add the method, after `safeArea()`:
```ts
  /** The menu is open: the burger shows ✕ (a tap closes it — the controller toggles). */
  setMenuOpen(open: boolean): void {
    if (this.destroyed) return;
    this.menuBtn.glyph.visible = !open;
    this.menuClose.visible = open;
  }
```

- [ ] **Step 6: Run the tests and the gates**

Run: `cd packages/shell && npx vitest run tests/pixi-hb/renderer-overlays.test.ts tests/pixi-s/sidebar.test.ts`
Expected: PASS.

Run from the repo root: `npm test --workspace @energy8platform/shell && npm run typecheck --workspace @energy8platform/shell`
Expected: the whole suite passes and the typecheck exits 0. HB is unchanged by default.

- [ ] **Step 7: Commit**

```bash
git add packages/shell/src/ui/pixi-hb/PixiHbRenderer.ts packages/shell/src/ui/pixi-hb/primitives/scroll-affordance.ts packages/shell/src/ui/pixi-hb/primitives/scroll.ts packages/shell/src/ui/pixi-s/SideBar.ts packages/shell/src/ui/pixi-s/icons.ts packages/shell/tests/pixi-hb/renderer-overlays.test.ts packages/shell/tests/pixi-s/sidebar.test.ts
git commit -m "Overridable HB overlays, a menu-open bar hook and a scroll look; S burger turns into ✕

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: S overlay primitives

**Files:**
- Modify: `packages/shell/src/ui/pixi-s/theme.ts` (tokens)
- Modify: `packages/shell/src/ui/pixi-s/text.ts` (`sBody`)
- Create: `packages/shell/src/ui/pixi-s/primitives/controls.ts`
- Test: `packages/shell/tests/pixi-s/controls.test.ts` (create)

**Interfaces:**
- Consumes: `Slab`, `SKEW`, `slabPoints` and `SHADOW_OFFSET` (slab.ts); `SButton` (widgets.ts); `sLabel`/`sValue` (text.ts); `attachHover`/`attachPress` (HB widgets); `makeIcon` (HB); `ScrollLook` (Task 1).
- Produces:
  - `S.panel`, `S.track`, `S.muted`, `S.veil`, `S.winOk`, `S.winNo`;
  - `sBody(str, size, color?, wrapWidth?, align?)`;
  - `S_SCROLL: ScrollLook`;
  - `class STitlePlate(text, h, maxW?)` with `labelText`, `slab` and `measureSize()`;
  - `sCloseButton(size, onTap): SButton`;
  - `type SButtonKind = 'accent' | 'red' | 'ghost'`;
  - `class STextButton(label, { w, h, kind, size?, onTap })` with `labelText`, `slab`, `kind`, `disabled` and `measureSize()`;
  - `class SChip(host, id, label, selected, em, onTap)` with `id`, `labelText`, `selected`, `setSelected`, `setLayoutSize` and `measureSize`;
  - `class SSlider(value, onInput)` with `value`, `setValue`, `thumbRect`, `trackRect`, `setLayoutSize` and `measureSize`;
  - `class SToggle(value, onChange)` with `value`, `setValue`, `knobRect` and `measureSize`.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi-s/controls.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import { STitlePlate, sCloseButton, STextButton, SChip, SSlider, SToggle, S_SCROLL } from '@/ui/pixi-s/primitives/controls';
import { sBody } from '@/ui/pixi-s/text';
import { FONT_FAMILY } from '@/ui/pixi-hb/text';
import { S, DISABLED_ALPHA } from '@/ui/pixi-s/theme';
import { makeContext } from '../pixi/_host';

const tap = (n: { emit(e: string, ...a: unknown[]): unknown }) => n.emit('pointertap', {});

describe('S overlay primitives', () => {
  it('a title plate is a yellow slab with ink caps, sized to its text, capped by maxW (long text scales in)', () => {
    const p = new STitlePlate('Game info', 60);
    expect(p.slab.face).toBe(S.yellow);
    expect(p.labelText.text).toBe('GAME INFO');
    expect(p.labelText.style.fill).toBe(S.ink);
    expect(p.measureSize().h).toBe(60);
    expect(p.measureSize().w).toBeGreaterThanOrEqual(180); // min 3h
    const long = new STitlePlate('A very long localized title that cannot fit', 40, 200);
    expect(long.measureSize().w).toBe(200);
    expect(long.labelText.x + long.labelText.width).toBeLessThanOrEqual(200);
  });

  it('the close button is a yellow square slab that taps', () => {
    const onTap = vi.fn();
    const b = sCloseButton(48, onTap);
    expect(b.face).toBe('yellow');
    expect(b.measureSize()).toEqual({ w: 48, h: 48 });
    tap(b);
    expect(onTap).toHaveBeenCalled();
  });

  it('text buttons: accent yellow/ink, red red/fg, ghost plate/fg; long labels fit; disabled is inert', () => {
    const onTap = vi.fn();
    const a = new STextButton('Buy', { w: 120, h: 40, kind: 'accent', onTap });
    expect([a.slab.face, a.labelText.style.fill, a.labelText.text]).toEqual([S.yellow, S.ink, 'BUY']);
    expect(new STextButton('x', { w: 80, h: 30, kind: 'red', onTap }).slab.face).toBe(S.red);
    const g = new STextButton('Cancel', { w: 80, h: 30, kind: 'ghost', onTap });
    expect([g.slab.face, g.labelText.style.fill]).toEqual([S.plate, S.fg]);
    g.emit('pointerover', {});
    expect([g.slab.face, g.labelText.style.fill]).toEqual([S.yellow, S.ink]);
    const long = new STextButton('Deactivate the legendary feature now', { w: 100, h: 30, kind: 'accent', onTap });
    expect(long.labelText.width).toBeLessThanOrEqual(100 - 16);
    a.disabled = true;
    tap(a);
    expect(onTap).not.toHaveBeenCalled();
    expect(a.alpha).toBe(DISABLED_ALPHA);
  });

  it('a chip is a plate with an fg value; selected turns it yellow with ink; it resizes to its column', () => {
    const onTap = vi.fn();
    const c = new SChip(makeContext(), '2', '€2.00', false, 14, onTap);
    expect(c.labelText.style.fill).toBe(S.fg);
    c.setSelected(true);
    expect(c.selected).toBe(true);
    expect(c.labelText.style.fill).toBe(S.ink);
    c.setLayoutSize(90, undefined);
    expect(c.measureSize().w).toBe(90);
    tap(c);
    expect(onTap).toHaveBeenCalledWith('2');
  });

  it('the slider: an 8-thick full-width track and a 12×24 rect thumb; setValue moves it without firing', () => {
    const onInput = vi.fn();
    const s = new SSlider(0.5, onInput);
    s.setLayoutSize(212, undefined);
    expect(s.trackRect).toEqual({ x: 0, y: 8, w: 212, h: 8 });
    expect(s.thumbRect).toEqual({ x: 100, y: 0, w: 12, h: 24 });
    s.setValue(1);
    expect(s.thumbRect.x).toBe(200);
    expect(onInput).not.toHaveBeenCalled();
    expect(s.measureSize()).toEqual({ w: 212, h: 24 });
  });

  it('the toggle: a 44×24 rect track, an 18-square knob left when off, right when on', () => {
    const onChange = vi.fn();
    const t = new SToggle(false, onChange);
    expect(t.knobRect).toEqual({ x: 3, y: 3, w: 18, h: 18 });
    tap(t);
    expect(onChange).toHaveBeenCalledWith(true);
    t.setValue(true);
    expect(t.knobRect.x).toBe(44 - 21);
    expect(t.measureSize()).toEqual({ w: 44, h: 24 });
  });

  it('body copy is Inter; the S scroll look is flat yellow', () => {
    expect(sBody('Rules', 14).style.fontFamily).toBe(FONT_FAMILY);
    expect(S_SCROLL).toEqual({ track: S.track, thumb: S.yellow, radius: 0 });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/shell && npx vitest run tests/pixi-s/controls.test.ts`
Expected: FAIL (`@/ui/pixi-s/primitives/controls` does not resolve).

- [ ] **Step 3: Tokens and `sBody`**

In `theme.ts`, add these entries to `S` (after `ink`):
```ts
  panel: '#0b0b0b', // flat panels: menu rows, modal cards, content cards
  track: '#2a2a2a', // slider / toggle / scroll tracks, empty volatility bars, off grid cells
  muted: 'rgba(244,242,235,.6)', // secondary text: descriptions, stat labels, version
  veil: 'rgba(0,0,0,.55)', // the dark layer over the frosted game under a modal
  winOk: '#4ade80', // game info "✓ wins" tag
  winNo: '#f87171', // game info "✗ no win" tag
```

In `text.ts`, add after `sValue`:
```ts
/** Body copy (descriptions, rules, paragraphs): Inter — long text in Montserrat 800 caps is
 *  unreadable. Wraps when `wrapWidth` is given. */
export function sBody(str: string, size: number, color: string = S.fg, wrapWidth?: number, align: 'left' | 'center' | 'right' = 'left'): Text {
  return makeText(str, {
    size,
    family: FONT_FAMILY,
    weight: '400',
    color,
    wrapWidth,
    lineHeight: wrapWidth != null ? Math.round(size * 1.5) : undefined,
    align,
  });
}
```

- [ ] **Step 4: `primitives/controls.ts`**

Create `packages/shell/src/ui/pixi-s/primitives/controls.ts`:

```ts
import { Container, Graphics, Rectangle, type FederatedPointerEvent, type Text } from 'pixi.js';
import type { Sizable } from '../../pixi/primitives/flex';
import type { PixiComponentContext } from '../../pixi/context';
import type { ScrollLook } from '../../pixi-hb/primitives/scroll-affordance';
import { attachHover, attachPress } from '../../pixi-hb/primitives/widgets';
import { makeIcon } from '../../pixi-hb/pixi-icon';
import { Slab, SKEW, slabPoints, SHADOW_OFFSET } from '../slab';
import { SButton } from '../widgets';
import { sLabel, sValue } from '../text';
import { S, SHADOW_ALPHA, DISABLED_ALPHA } from '../theme';

// S overlay controls: every surface a flat or leaning plate, sharp corners, no outlines.

/** The S scrollbar: a flat yellow thumb on a flat track. */
export const S_SCROLL: ScrollLook = { track: S.track, thumb: S.yellow, radius: 0 };

/** A yellow title plate: ink caps on a leaning slab, as wide as its text (at least 3h, at most
 *  `maxW` — a longer title scales down inside). */
export class STitlePlate extends Container implements Sizable {
  readonly labelText: Text;
  readonly slab: Slab;

  constructor(text: string, h: number, maxW = Infinity) {
    super();
    this.labelText = sLabel(text, Math.round(h * 0.42), S.ink);
    const pad = h * 0.6;
    const w = Math.round(Math.min(maxW, Math.max(h * 3, this.labelText.width + pad * 2)));
    if (this.labelText.width > w - pad * 2) this.labelText.scale.set((w - pad * 2) / this.labelText.width);
    this.slab = new Slab(w, h, { face: S.yellow, corners: SKEW.readout });
    this.labelText.position.set(pad, (h - this.labelText.height) / 2);
    this.addChild(this.slab, this.labelText);
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
  setLayoutSize(): void {
    /* sized by its text */
  }
}

/** The ✕: a yellow square slab with the ink `close` glyph. */
export function sCloseButton(size: number, onTap: () => void): SButton {
  const g = Math.round(size * 0.5);
  return new SButton({
    w: size,
    h: size,
    face: 'yellow',
    corners: SKEW.menu,
    glyph: makeIcon('close', g, { ink: S.ink, fill: S.ink }),
    glyphSize: g,
    onTap,
  });
}

export type SButtonKind = 'accent' | 'red' | 'ghost';

const KIND: Record<SButtonKind, { fill: string; hover: string; ink: string; hoverInk: string }> = {
  accent: { fill: S.yellow, hover: S.yellowHover, ink: S.ink, hoverInk: S.ink },
  red: { fill: S.red, hover: S.redHover, ink: S.fg, hoverInk: S.fg },
  ghost: { fill: S.plate, hover: S.yellow, ink: S.fg, hoverInk: S.ink },
};

/** A caps label on a slab: `accent` yellow/ink, `red` red/fg, `ghost` plate/fg (yellow on hover). */
export class STextButton extends Container implements Sizable {
  readonly labelText: Text;
  readonly slab: Slab;
  readonly kind: SButtonKind;
  private _disabled = false;

  constructor(label: string, o: { w: number; h: number; kind: SButtonKind; size?: number; onTap: () => void }) {
    super();
    const k = KIND[o.kind];
    this.kind = o.kind;
    this.slab = new Slab(o.w, o.h, { face: k.fill, corners: SKEW.menu });
    this.labelText = sLabel(label, o.size ?? Math.round(o.h * 0.36), k.ink);
    const room = o.w - 16;
    if (this.labelText.width > room) this.labelText.scale.set(room / this.labelText.width);
    this.labelText.position.set((o.w - this.labelText.width) / 2, (o.h - this.labelText.height) / 2);
    this.addChild(this.slab, this.labelText);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, o.w, o.h);
    attachHover(
      this,
      () => {
        if (this._disabled) return;
        this.slab.setFace(k.hover);
        this.labelText.style.fill = k.hoverInk;
      },
      () => {
        this.slab.setFace(k.fill);
        this.labelText.style.fill = k.ink;
      },
    );
    attachPress(this, 0.96, () => {
      if (!this._disabled) o.onTap();
    });
  }

  set disabled(v: boolean) {
    this._disabled = v;
    this.alpha = v ? DISABLED_ALPHA : 1;
    this.eventMode = v ? 'none' : 'static';
    this.cursor = v ? 'default' : 'pointer';
  }
  get disabled(): boolean {
    return this._disabled;
  }

  measureSize(): { w: number; h: number } {
    return { w: this.slab.w, h: this.slab.h };
  }
  setLayoutSize(): void {
    /* fixed size */
  }
}

/** A picker chip — same API as HB `Chip`: a plate with the value in fg; selected = yellow + ink.
 *  The picker sets every chip to its column width, so the slab is redrawn on resize. */
export class SChip extends Container implements Sizable {
  readonly id: string;
  readonly labelText: Text;
  private shadow = new Graphics();
  private face = new Graphics();
  private _on: boolean;
  private hovering = false;
  private w: number;
  private h: number;

  constructor(_host: PixiComponentContext, id: string, label: string, selected: boolean, em: number, onTap: (id: string) => void) {
    super();
    this.id = id;
    this._on = selected;
    this.labelText = sValue(label, em, S.fg);
    this.w = Math.ceil(this.labelText.width + em * 2);
    this.h = Math.round(em * 2.6);
    this.shadow.position.set(SHADOW_OFFSET, SHADOW_OFFSET);
    this.addChild(this.shadow, this.face, this.labelText);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    attachHover(this, () => { this.hovering = true; this.paint(); }, () => { this.hovering = false; this.paint(); });
    this.on('pointertap', () => onTap(this.id));
    this.paint();
  }

  get selected(): boolean {
    return this._on;
  }
  setSelected(v: boolean): void {
    this._on = v;
    this.paint();
  }

  private paint(): void {
    const pts = slabPoints(this.w, this.h, SKEW.menu);
    this.shadow.clear().poly(pts).fill({ color: S.shadow, alpha: SHADOW_ALPHA });
    this.face.clear().poly(pts).fill(this._on ? S.yellow : this.hovering ? S.plateHover : S.plate);
    this.labelText.style.fill = this._on ? S.ink : S.fg;
    this.labelText.position.set((this.w - this.labelText.width) / 2, (this.h - this.labelText.height) / 2);
    this.hitArea = new Rectangle(0, 0, this.w, this.h);
  }

  setLayoutSize(w: number | undefined, h?: number | undefined): void {
    if (w != null) this.w = w;
    if (h != null) this.h = h;
    this.paint();
  }
  measureSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }
}

const SLIDER_H = 24;
const TRACK_H = 8;
const THUMB_W = 12;

/** The volume slider: a flat 8-thick track across its width, the yellow fill up to the thumb and a
 *  flat 12×24 fg rect thumb. Same drag / `setValue` API as HB `Slider`. */
export class SSlider extends Container implements Sizable {
  private track = new Graphics();
  private fill = new Graphics();
  private thumb = new Graphics();
  private w = 0;
  private _value: number;
  private onInput: (v: number) => void;
  private dragging = false;

  constructor(value: number, onInput: (v: number) => void) {
    super();
    this._value = Math.max(0, Math.min(1, value));
    this.onInput = onInput;
    this.addChild(this.track, this.fill, this.thumb);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerdown', (e: FederatedPointerEvent) => {
      this.dragging = true;
      this.setFromX(this.toLocal(e.global).x);
    });
    this.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (this.dragging) this.setFromX(this.toLocal(e.global).x);
    });
    const end = (): void => {
      this.dragging = false;
    };
    this.on('pointerup', end);
    this.on('pointerupoutside', end);
  }

  get value(): number {
    return this._value;
  }
  private get thumbX(): number {
    return this._value * Math.max(0, this.w - THUMB_W);
  }
  get thumbRect(): { x: number; y: number; w: number; h: number } {
    return { x: this.thumbX, y: 0, w: THUMB_W, h: SLIDER_H };
  }
  get trackRect(): { x: number; y: number; w: number; h: number } {
    return { x: 0, y: (SLIDER_H - TRACK_H) / 2, w: this.w, h: TRACK_H };
  }

  private setFromX(x: number): void {
    const usable = this.w - THUMB_W;
    this._value = Math.max(0, Math.min(1, usable > 0 ? (x - THUMB_W / 2) / usable : 0));
    this.draw();
    this.onInput(this._value);
  }

  private draw(): void {
    const t = this.trackRect;
    const x = this.thumbX;
    this.track.clear().rect(t.x, t.y, t.w, t.h).fill(S.track);
    this.fill.clear();
    if (x > 0) this.fill.rect(0, t.y, x + THUMB_W / 2, t.h).fill(S.yellow);
    this.thumb.clear().rect(x, 0, THUMB_W, SLIDER_H).fill(S.fg);
    this.hitArea = new Rectangle(0, 0, this.w, SLIDER_H);
  }

  /** Move the thumb (0..1) without firing onInput — for live updates while the menu is open. */
  setValue(v: number): void {
    this._value = Math.max(0, Math.min(1, v));
    this.draw();
  }

  setLayoutSize(w: number | undefined): void {
    if (w != null) this.w = w;
    this.draw();
  }
  measureSize(): { w: number; h: number } {
    return { w: this.w, h: SLIDER_H };
  }
}

/** The S switch: a flat 44×24 track (track colour off, yellow on) with an 18-square knob — fg on the
 *  left when off, ink on the right when on. */
export class SToggle extends Container implements Sizable {
  private track = new Graphics();
  private knob = new Graphics();
  private _value: boolean;

  constructor(value: boolean, onChange: (v: boolean) => void) {
    super();
    this._value = value;
    this.addChild(this.track, this.knob);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, 44, 24);
    this.on('pointertap', () => onChange(!this._value));
    this.paint();
  }

  get value(): boolean {
    return this._value;
  }
  setValue(v: boolean): void {
    this._value = v;
    this.paint();
  }
  get knobRect(): { x: number; y: number; w: number; h: number } {
    return { x: this._value ? 44 - 21 : 3, y: 3, w: 18, h: 18 };
  }

  private paint(): void {
    this.track.clear().rect(0, 0, 44, 24).fill(this._value ? S.yellow : S.track);
    const k = this.knobRect;
    this.knob.clear().rect(k.x, k.y, k.w, k.h).fill(this._value ? S.ink : S.fg);
  }

  measureSize(): { w: number; h: number } {
    return { w: 44, h: 24 };
  }
  setLayoutSize(): void {
    /* fixed size */
  }
}
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `cd packages/shell && npx vitest run tests/pixi-s/controls.test.ts`
Expected: PASS (7 tests). If `sBody(...).style.fontFamily` reads back as an array, compare with `String(...)`.

Run from the repo root: `npm run typecheck --workspace @energy8platform/shell`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shell/src/ui/pixi-s/theme.ts packages/shell/src/ui/pixi-s/text.ts packages/shell/src/ui/pixi-s/primitives/controls.ts packages/shell/tests/pixi-s/controls.test.ts
git commit -m "S overlay primitives: title plate, ✕, text button, chip, slider, toggle

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: SCardModal and the small modals (pickers, modal, replay)

**Files:**
- Create: `packages/shell/src/ui/pixi-s/primitives/card.ts`
- Create: `packages/shell/src/ui/pixi-s/components/pickers.ts` (fork of `pixi-hb/components/pickers.ts`)
- Create: `packages/shell/src/ui/pixi-s/components/Modal.ts`
- Create: `packages/shell/src/ui/pixi-s/components/ReplayModal.ts`
- Test: `packages/shell/tests/pixi-s/modals.test.ts` (create)

**Interfaces:**
- Consumes: Task 2 primitives; the types `CardAction` and `CardOpts` from `../../pixi-hb/primitives/card`.
- Produces:
  - `class SCardModal`, with the HB `CardModal` API plus `titlePlate` and `closeBtn`;
  - `openSBetPicker(host)` and `openSAutoplayPicker(host)`;
  - `buildSModal(host, opts)`;
  - `buildSReplayModal(host, opts, reopen)`.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi-s/modals.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import type { Container } from 'pixi.js';
import { SCardModal } from '@/ui/pixi-s/primitives/card';
import { SChip, STextButton, STitlePlate } from '@/ui/pixi-s/primitives/controls';
import { openSBetPicker, openSAutoplayPicker } from '@/ui/pixi-s/components/pickers';
import { buildSModal } from '@/ui/pixi-s/components/Modal';
import { buildSReplayModal } from '@/ui/pixi-s/components/ReplayModal';
import { S } from '@/ui/pixi-s/theme';
import { makeContext, defaultConfig } from '../pixi/_host';

function all<T>(n: Container, cls: abstract new (...a: never[]) => T, out: T[] = []): T[] {
  if (n instanceof cls) out.push(n as T);
  for (const c of n.children) all(c as Container, cls, out);
  return out;
}

describe('S card modal', () => {
  it('title plate rides the card top-left edge, ✕ top-right; the body has no title row', () => {
    const host = makeContext();
    const m = new SCardModal(host, { title: 'Bet', onClose: () => {} });
    m.build();
    expect(m.titlePlate.labelText.text).toBe('BET');
    expect(m.titlePlate.y).toBeLessThan(0); // overhangs the card's top edge
    expect(m.closeBtn).toBeDefined();
    expect(m.closeBtn!.x).toBeGreaterThan(m.titlePlate.x);
    expect(m.body.children.length).toBe(0);
  });

  it('not closable: no ✕', () => {
    const m = new SCardModal(makeContext(), { title: 'Replay', closable: false });
    m.build();
    expect(m.closeBtn).toBeUndefined();
  });

  it('actions become S text buttons by kind', () => {
    const m = new SCardModal(makeContext(), { title: 't', onClose: () => {} });
    m.setActions([
      { label: 'Cancel', kind: 'ghost', onTap: () => {} },
      { label: 'Buy', kind: 'accent', onTap: () => {} },
      { label: 'Activate', kind: 'red', onTap: () => {} },
    ]);
    m.build();
    expect(all(m, STextButton).map((b) => b.kind)).toEqual(['ghost', 'accent', 'red']);
  });
});

describe('S pickers, modal, replay', () => {
  it('bet picker: one S chip per bet, the current one selected (yellow); Enter confirms', () => {
    const emit = vi.fn();
    const host = makeContext({ emit, config: defaultConfig({ availableBets: [0.5, 1, 2, 5], defaultBet: 1 }) });
    const layer = openSBetPicker(host) as unknown as { onKey(e: KeyboardEvent): boolean } & Container;
    const chips = all(layer, SChip);
    expect(chips.map((c) => c.id)).toEqual(['0.5', '1', '2', '5']);
    expect(chips.filter((c) => c.selected).map((c) => c.id)).toEqual(['1']);
    expect(chips[1].labelText.style.fill).toBe(S.ink);
    layer.onKey({ code: 'ArrowRight' } as KeyboardEvent);
    layer.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(emit).toHaveBeenCalledWith('betChange', 2);
  });

  it('autoplay picker: counts as chips; the title plate says AUTOPLAY', () => {
    const host = makeContext({ config: defaultConfig({ features: { turbo: 0, autoplay: {}, buyBonus: false } }) });
    const layer = openSAutoplayPicker(host);
    expect(all(layer, SChip).length).toBeGreaterThan(3);
    expect(all(layer, STitlePlate)[0].labelText.text).toBe('AUTOPLAY');
  });

  it('generic modal: an action runs, then the modal closes', () => {
    const closeLayer = vi.fn();
    const on = vi.fn();
    const layer = buildSModal(makeContext({ closeLayer }), { title: 'Oops', body: 'Try again', actions: [{ title: 'OK', color: 'yellow', on }] } as never);
    all(layer, STextButton)[0].emit('pointertap', {});
    expect(on).toHaveBeenCalled();
    expect(closeLayer).toHaveBeenCalled();
  });

  it('replay: not closable; START REPLAY closes, runs onReplay, then reopens', async () => {
    const closeLayer = vi.fn();
    const reopen = vi.fn();
    const onReplay = vi.fn(() => Promise.resolve());
    const layer = buildSReplayModal(makeContext({ closeLayer }), { bonusId: 'x', bet: 1, payoutMultiplier: 2, onReplay }, reopen);
    expect((layer as SCardModal).closeBtn).toBeUndefined();
    all(layer, STextButton)[0].emit('pointertap', {});
    expect(closeLayer).toHaveBeenCalled();
    expect(onReplay).toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(reopen).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/shell && npx vitest run tests/pixi-s/modals.test.ts`
Expected: FAIL (the modules do not resolve).

- [ ] **Step 3: `primitives/card.ts`**

Create `packages/shell/src/ui/pixi-s/primitives/card.ts`:

```ts
import { Container, Graphics, Rectangle } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { FlexBox } from '../../pixi/primitives/flex';
import type { CardAction, CardOpts } from '../../pixi-hb/primitives/card';
import { STitlePlate, STextButton, sCloseButton, type SButtonKind } from './controls';
import { S } from '../theme';

/** Fraction of the screen a card modal may occupy (HB's MODAL_FIT). */
const MODAL_FIT = 0.86;

/** Card font-size knob — clamp(11px, 2% of the short side, 15px), as HB. */
function clampEm(w: number, h: number): number {
  return Math.max(11, Math.min(15, Math.min(w, h) * 0.02));
}

function kindOf(kind: CardAction['kind']): SButtonKind {
  return kind === 'red' ? 'red' : kind === 'ghost' ? 'ghost' : 'accent';
}

/** The S card modal — HB `CardModal`'s API in the S look: a flat black panel on the veil, a yellow
 *  title plate riding the card's top-left edge, a yellow ✕ plate top-right, the body column under
 *  them and a row of S text buttons. The pickers, the generic and replay modals and the buy-bonus
 *  confirm are forks that only swap this in. */
export class SCardModal extends Container implements ShellLayer {
  readonly tag?: string;
  readonly body: FlexBox;
  readonly titlePlate: STitlePlate;
  readonly closeBtn?: Container;
  private host: PixiComponentContext;
  private veil = new Graphics();
  private cardRoot = new Container();
  private bg = new Graphics();
  private actionsRow = new Container();
  private actionsH = 0;
  private em: number;
  private cardW: number;
  private cardH = 0;
  /** Title / ✕ plate height, and how far they overhang the card's top edge. */
  private headH: number;
  private lift: number;

  constructor(host: PixiComponentContext, opts: CardOpts) {
    super();
    this.host = host;
    this.tag = opts.tag;
    this.em = clampEm(host.screenW, host.screenH);
    this.cardW = Math.min((opts.maxEm ?? 28) * this.em, host.screenW * MODAL_FIT);
    this.headH = Math.round(2.4 * this.em);
    this.lift = Math.round(0.6 * this.em);
    const closable = opts.closable !== false && !!opts.onClose;
    const titleMax = this.cardW - 2.4 * this.em - (closable ? this.headH + 0.6 * this.em : 0);
    this.titlePlate = new STitlePlate(opts.title, this.headH, titleMax);
    this.body = new FlexBox({ direction: 'column', align: 'center', gap: 1.05 * this.em, padding: 1.2 * this.em });
    this.veil.eventMode = 'static'; // swallow taps to the game behind
    this.cardRoot.addChild(this.bg, this.body, this.actionsRow, this.titlePlate);
    if (closable) {
      this.closeBtn = sCloseButton(this.headH, () => opts.onClose!());
      this.cardRoot.addChild(this.closeBtn);
    }
    this.addChild(this.veil, this.cardRoot);
  }

  get emSize(): number {
    return this.em;
  }
  get cardWidth(): number {
    return this.cardW;
  }
  get cardAccent(): string {
    return S.yellow;
  }

  /** Footer buttons — a row of S text buttons inset from the card edge. */
  setActions(actions: CardAction[]): void {
    this.actionsRow.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!actions.length) return;
    const pad = 1.2 * this.em;
    const gap = 0.6 * this.em;
    const each = (this.cardW - pad * 2 - gap * (actions.length - 1)) / actions.length;
    const h = Math.round(3 * this.em);
    actions.forEach((a, i) => {
      const btn = new STextButton(a.label, { w: each, h, kind: kindOf(a.kind), size: this.em, onTap: a.onTap });
      btn.disabled = !!a.disabled;
      btn.position.set(pad + i * (each + gap), 0);
      this.actionsRow.addChild(btn);
    });
    this.actionsH = h + pad;
  }

  /** Measure body + actions, draw the card, place the plates. Call once after the body and actions. */
  build(): void {
    const top = this.headH - this.lift; // the plates' bottom edge, in card coordinates
    this.body.setLayoutSize(this.cardW, undefined);
    const bodyH = this.body.outerHeight;
    this.cardH = top + bodyH + this.actionsH;
    this.bg.clear().rect(0, 0, this.cardW, this.cardH).fill(S.panel);
    this.titlePlate.position.set(1.2 * this.em, -this.lift);
    this.closeBtn?.position.set(this.cardW - 1.2 * this.em - this.headH, -this.lift);
    this.body.position.set(0, top);
    this.actionsRow.position.set(0, top + bodyH);
    this.resize(this.host.screenW, this.host.screenH);
  }

  resize(w: number, h: number): void {
    this.veil.clear().rect(0, 0, w, h).fill(S.veil);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    this.fit();
  }

  /** Scale the card down to fit a short / narrow popout and keep it centred (plates included). */
  fit(): void {
    const W = this.host.screenW;
    const H = this.host.screenH;
    if (this.cardW <= 0 || this.cardH <= 0) return;
    const fullH = this.cardH + this.lift;
    const s = Math.min(1, (W * MODAL_FIT) / this.cardW, (H * MODAL_FIT) / fullH);
    this.cardRoot.scale.set(s < 0.999 ? s : 1);
    const k = this.cardRoot.scale.x;
    this.cardRoot.position.set((W - this.cardW * k) / 2, (H - fullH * k) / 2 + this.lift * k);
  }
}
```

- [ ] **Step 4: Fork the pickers**

Copy the HB file, then edit:
```bash
cp packages/shell/src/ui/pixi-hb/components/pickers.ts packages/shell/src/ui/pixi-s/components/pickers.ts
```
In the copy, make exactly these changes:
1. Imports:
   - replace `import { CardModal } from '../primitives/card';` with `import { SCardModal } from '../primitives/card';`;
   - replace `import { Chip } from '../primitives/controls';` with `import { SChip, S_SCROLL } from '../primitives/controls';`;
   - replace `import { ScrollBox } from '../primitives/scroll';` with `import { ScrollBox } from '../../pixi-hb/primitives/scroll';`.
   - The `FlexBox` import path (`'../../pixi/primitives/flex'`) is already correct at this depth.
2. `class PickerModal extends CardModal` becomes `class PickerModal extends SCardModal`, and `ConstructorParameters<typeof CardModal>[1]` becomes `ConstructorParameters<typeof SCardModal>[1]`.
3. In `SizedScrollBox`, change `super(canvas);` to `super(canvas, undefined, S_SCROLL);`.
4. `const chips: Chip[] = [];` becomes `SChip[]`, and `new Chip(` becomes `new SChip(`.
5. Rename the exports: `openBetPicker` becomes `openSBetPicker` and `openAutoplayPicker` becomes `openSAutoplayPicker`. Update their doc comments to "S bet picker …" and "S autoplay picker …".
6. At the top of the file, add the comment `// Fork of pixi-hb/components/pickers.ts — the S card modal and S chips; logic unchanged.`

- [ ] **Step 5: Modal and replay**

Create `packages/shell/src/ui/pixi-s/components/Modal.ts`:

```ts
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import type { ModalOptions } from '@/core/types';
import type { CardAction } from '../../pixi-hb/primitives/card';
import { SCardModal } from '../primitives/card';
import { sBody } from '../text';
import { S } from '../theme';

/** The generic externally-triggered modal in the S look — title plate, centred body copy, S action
 *  buttons. Each action runs its `on`, then closes; the ✕ shows when `availableClose`. */
export function buildSModal(host: PixiComponentContext, opts: ModalOptions): ShellLayer {
  const modal = new SCardModal(host, {
    tag: 'modal',
    title: opts.title,
    closable: opts.availableClose,
    blur: opts.blurLevel,
    onClose: () => host.closeLayer(),
  });
  const em = modal.emSize;
  modal.body.add(sBody(opts.body, 0.93 * em, S.fg, modal.cardWidth - 2.4 * em, 'center'));
  if (opts.actions?.length) {
    const actions: CardAction[] = opts.actions.map((a) => ({
      label: a.title,
      kind: a.color === 'red' ? 'red' : a.color ? 'accent' : 'ghost',
      onTap: () => {
        a.on?.();
        host.closeLayer();
      },
    }));
    modal.setActions(actions);
  }
  modal.build();
  return modal;
}
```

Create `packages/shell/src/ui/pixi-s/components/ReplayModal.ts`:

```ts
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import type { ReplayModalOptions } from '@/core/types';
import { FlexBox } from '../../pixi/primitives/flex';
import { SCardModal } from '../primitives/card';
import { sLabel, sValue } from '../text';
import { S } from '../theme';

/** Non-dismissable replay summary in the S look — label / value rows (no hairlines), the total win in
 *  yellow. The only way out is START REPLAY, which closes the modal, runs `onReplay`, then reopens it
 *  whether it resolves or rejects (so a failed replay can't strand the user). */
export function buildSReplayModal(host: PixiComponentContext, opts: ReplayModalOptions, reopen: () => void): ShellLayer {
  const { bonusId, bet, payoutMultiplier } = opts;
  const bonus = Array.isArray(host.config.features.buyBonus)
    ? host.config.features.buyBonus.find((b) => b.id === bonusId)
    : undefined;
  const mode = bonus?.title ?? bonusId;
  const costMultiplier = bonus?.priceMultiplier ?? 1;

  const modal = new SCardModal(host, { tag: 'replay-modal', title: host.t('Replay'), closable: false });
  const em = modal.emSize;
  const innerW = modal.cardWidth - 2.4 * em;
  const rows = new FlexBox({ direction: 'column', align: 'stretch', gap: 0 });
  const addRow = (label: string, value: string, total = false): void => {
    const row = new FlexBox({
      direction: 'row',
      align: 'center',
      justify: 'space-between',
      width: innerW,
      padding: { top: 0.73 * em, bottom: 0.73 * em },
    });
    row.add(sLabel(host.t(label), (total ? 0.8 : 0.73) * em, total ? S.fg : S.muted));
    row.add(sValue(value, (total ? 1.27 : 1) * em, total ? S.yellow : S.fg));
    rows.add(row);
  };
  addRow('Mode', mode);
  addRow('Base bet', host.fmt(bet));
  addRow('Cost multiplier', `${costMultiplier}×`);
  addRow('Total cost', host.fmt(bet * costMultiplier));
  addRow('Win multiplier', `${payoutMultiplier}×`);
  addRow('Total win', host.fmtWin(payoutMultiplier * bet), true);
  modal.body.add(rows);

  modal.setActions([
    {
      label: host.t('Start replay'),
      kind: 'accent',
      onTap: () => {
        host.closeLayer();
        Promise.resolve(opts.onReplay()).then(reopen, reopen);
      },
    },
  ]);
  modal.build();
  return modal;
}
```

- [ ] **Step 6: Run the tests and the gates**

Run: `cd packages/shell && npx vitest run tests/pixi-s/modals.test.ts`
Expected: PASS (7 tests).

If the bet picker test's `emit` expectation fails because the test host's `setBet` emits a different payload, read `tests/pixi/_host.ts` `setBet` and assert what it emits. The rule the test guards is "Enter confirms the next chip".

Run from the repo root: `npm run typecheck --workspace @energy8platform/shell`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shell/src/ui/pixi-s/primitives/card.ts packages/shell/src/ui/pixi-s/components/pickers.ts packages/shell/src/ui/pixi-s/components/Modal.ts packages/shell/src/ui/pixi-s/components/ReplayModal.ts packages/shell/tests/pixi-s/modals.test.ts
git commit -m "S card modal with the bet / autoplay pickers, generic and replay modals

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The S menu

**Files:**
- Create: `packages/shell/src/ui/pixi-s/components/Menu.ts`
- Test: `packages/shell/tests/pixi-s/menu.test.ts` (create)

**Interfaces:**
- Consumes:
  - `hbRows` from `../../pixi-hb/components/Menu`;
  - `resolveMenu` and `MenuRow` from `@/core/menu`;
  - `Slab` and `SKEW`;
  - `SSlider` and `SToggle` (Task 2);
  - `sLabel`.
- Produces: `openSMenu(host, getAnchor?, getPlate?, getScale?): ShellLayer` and `class SMenu`. Row nodes are labelled `menu-row-<id>`. `SMenu` exposes `rows: Container[]` and `stack: Container`.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi-s/menu.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import type { Container } from 'pixi.js';
import { openSMenu, SMenu } from '@/ui/pixi-s/components/Menu';
import { SSlider, SToggle } from '@/ui/pixi-s/primitives/controls';
import { Slab } from '@/ui/pixi-s/slab';
import { S } from '@/ui/pixi-s/theme';
import { makeContext } from '../pixi/_host';

function all<T>(n: Container, cls: abstract new (...a: never[]) => T, out: T[] = []): T[] {
  if (n instanceof cls) out.push(n as T);
  for (const c of n.children) all(c as Container, cls, out);
  return out;
}
const BURGER = { x: 16, y: 540, w: 64, h: 40 };

function menu(over: Parameters<typeof makeContext>[0] = {}, anchor = BURGER, scale = 1): SMenu {
  return openSMenu(makeContext({ screenW: 1280, screenH: 720, ...over }), () => anchor, () => null, () => scale) as SMenu;
}

describe('S menu', () => {
  it('one slab per row, no sound master row, no separators, in menu order', () => {
    const m = menu();
    expect(m.rows.map((r) => r.label)).toEqual(['menu-row-music', 'menu-row-sfx', 'menu-row-gameInfo']);
    for (const r of m.rows) expect(all(r, Slab).length).toBe(1);
  });

  it('stacks upward above the burger, left-aligned to it', () => {
    const m = menu();
    const b = m.stack.getBounds();
    expect(b.x).toBeCloseTo(BURGER.x, 0);
    expect(b.y + b.height).toBeLessThanOrEqual(BURGER.y - 8 + 3.5); // + the slab shadow
    expect(m.rows[0].getBounds().y).toBeLessThan(m.rows[2].getBounds().y); // menu order top → bottom
  });

  it('a short screen scales the stack down so it stays on screen', () => {
    const anchor = { x: 16, y: 120, w: 22, h: 14 };
    const m = menu({ screenW: 400, screenH: 225 }, anchor, 0.35);
    const b = m.stack.getBounds();
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(anchor.y);
  });

  it('re-anchors on resize (rotation with the menu open)', () => {
    let anchor = BURGER;
    const host = makeContext({ screenW: 1280, screenH: 720 });
    const m = openSMenu(host, () => anchor, () => null, () => 1) as SMenu;
    anchor = { x: 40, y: 600, w: 64, h: 40 };
    m.resize(1280, 720);
    expect(m.stack.getBounds().x).toBeCloseTo(40, 0);
  });

  it('range rows carry a slider (value = the menu value); live refresh moves it', () => {
    let refresh: ((id: string, v: boolean | number) => void) | null = null;
    const host = makeContext({ setMenuRefresh: (fn) => { refresh = fn; } });
    host.setMenuValue('music', 0.25);
    const m = openSMenu(host, () => BURGER, () => null, () => 1) as SMenu;
    const slider = all(m.rows[0], SSlider)[0];
    expect(slider.value).toBeCloseTo(0.25);
    refresh!('music', 0.75);
    expect(slider.value).toBeCloseTo(0.75);
  });

  it('button rows: hover gives the yellow face + ink label; tap closes and selects', () => {
    const closeLayer = vi.fn();
    const openInfo = vi.fn();
    const m = menu({ closeLayer, actions: { openInfo } as never });
    const row = m.rows[2];
    const slab = all(row, Slab)[0];
    row.emit('pointerover', {});
    expect(slab.face).toBe(S.yellow);
    row.emit('pointerout', {});
    expect(slab.face).toBe(S.plate);
    row.emit('pointertap', {});
    expect(closeLayer).toHaveBeenCalled();
    expect(openInfo).toHaveBeenCalled();
  });

  it('toggle rows carry an S toggle; a long label scales to leave the control room', () => {
    const host = makeContext({
      menu: [{ id: 'lefty', type: 'toggle', label: 'A very very long left-hand mode label for testing', value: false }] as never,
    });
    const m = openSMenu(host, () => BURGER, () => null, () => 1) as SMenu;
    const row = m.rows[0];
    const toggle = all(row, SToggle)[0];
    expect(toggle).toBeDefined();
    const label = row.children.find((c) => (c as { text?: string }).text !== undefined) as { x: number; width: number };
    expect(label.x + label.width).toBeLessThanOrEqual(toggle.x - 8);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/shell && npx vitest run tests/pixi-s/menu.test.ts`
Expected: FAIL (the module does not resolve).

- [ ] **Step 3: Implement `components/Menu.ts`**

Create `packages/shell/src/ui/pixi-s/components/Menu.ts`:

```ts
import { Container, Graphics, Rectangle } from 'pixi.js';
import { resolveMenu, type MenuRow } from '@/core/menu';
import type { Rect } from '@/core/popover';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { hbRows } from '../../pixi-hb/components/Menu';
import { Slab, SKEW } from '../slab';
import { SSlider, SToggle } from '../primitives/controls';
import { sLabel } from '../text';
import { S } from '../theme';

/** Row sizes in design px (the bar's readouts are 56 tall — the rows are "чуть покороче"). */
const WIDE_ROW = { w: 320, h: 44 };
const MOBILE_ROW = { w: 370, h: 40 };
const GAP = 6;
const PAD = 16;
/** Gap between the stack's bottom and the burger's top, and the screen margin it keeps. */
const LIFT = 8;
const MARGIN = 8;

/** The S bar menu: each row its own black slab (label + control, no icons), stacked upward from the
 *  burger, light-dismiss. Rows are HB's (`hbRows`: no separators, no master sound toggle). */
export function openSMenu(
  host: PixiComponentContext,
  getAnchor?: () => Rect | null,
  _getPlate?: () => Rect | null,
  getScale?: () => number,
): ShellLayer {
  return new SMenu(host, () => getAnchor?.() ?? null, () => getScale?.() ?? 1);
}

export class SMenu extends Container implements ShellLayer {
  readonly tag = 'menu';
  readonly dismissLayer = new Graphics();
  readonly stack = new Container();
  rows: Container[] = [];
  private host: PixiComponentContext;
  private getAnchor: () => Rect | null;
  private getScale: () => number;
  private updaters: Record<string, (v: boolean | number) => void> = {};

  constructor(host: PixiComponentContext, getAnchor: () => Rect | null, getScale: () => number) {
    super();
    this.host = host;
    this.getAnchor = getAnchor;
    this.getScale = getScale;
    this.dismissLayer.eventMode = 'static';
    this.dismissLayer.on('pointertap', () => host.closeLayer());
    this.stack.eventMode = 'static';
    this.stack.on('pointertap', (e?: { stopPropagation?: () => void }) => e?.stopPropagation?.());
    this.addChild(this.dismissLayer, this.stack);
    host.setMenuRefresh((id, v) => this.updaters[id]?.(v));
    this.resize(host.screenW, host.screenH);
  }

  resize(w: number, h: number): void {
    this.dismissLayer.clear().rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0 });
    this.dismissLayer.hitArea = new Rectangle(0, 0, w, h);

    this.stack.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.updaters = {};
    const z = this.host.layout === 'mobile' ? MOBILE_ROW : WIDE_ROW;
    this.rows = hbRows(resolveMenu(this.host)).map((row) => this.buildRow(row, z.w, z.h));
    this.rows.forEach((r, i) => {
      r.position.set(0, i * (z.h + GAP));
      this.stack.addChild(r);
    });
    const stackH = this.rows.length * z.h + Math.max(0, this.rows.length - 1) * GAP;

    // above the burger, left-aligned to it; shrink further when the room above is short
    const a = this.getAnchor();
    const s0 = this.getScale();
    const bottom = a ? a.y - LIFT * s0 : h - MARGIN;
    const left = a ? a.x : MARGIN;
    const s = Math.max(0.1, Math.min(s0, (bottom - MARGIN) / Math.max(1, stackH), (w - left - MARGIN) / z.w));
    this.stack.scale.set(s);
    this.stack.position.set(left, bottom - stackH * s);
  }

  fit(): void {
    this.resize(this.host.screenW, this.host.screenH);
  }

  private buildRow(row: MenuRow, w: number, h: number): Container {
    const node = new Container();
    if (row.kind === 'separator') return node; // filtered out by hbRows; keeps the union total
    node.label = `menu-row-${row.id}`;
    const slab = new Slab(w, h, { face: S.plate, corners: SKEW.readout });
    const label = sLabel(row.label, 13, S.fg);
    node.addChild(slab, label);
    const place = (maxW: number): void => {
      if (label.width > maxW) label.scale.set(maxW / label.width);
      label.position.set(PAD, (h - label.height) / 2);
    };

    if (row.kind === 'button') {
      place(w - PAD * 2);
      if (row.disabled) {
        node.alpha = 0.5;
        return node;
      }
      node.eventMode = 'static';
      node.cursor = 'pointer';
      node.hitArea = new Rectangle(0, 0, w, h);
      node.on('pointerover', () => {
        slab.setFace(S.yellow);
        label.style.fill = S.ink;
      });
      node.on('pointerout', () => {
        slab.setFace(S.plate);
        label.style.fill = S.fg;
      });
      node.on('pointertap', () => {
        this.host.closeLayer();
        row.select();
      });
      return node;
    }

    if (row.kind === 'toggle') {
      const toggle = new SToggle(row.get(), row.disabled ? () => {} : (v) => {
        row.set(v);
        toggle.setValue(v);
      });
      toggle.position.set(w - PAD - 44, (h - 24) / 2);
      place(toggle.x - 8 - PAD);
      node.addChild(toggle);
      this.updaters[row.id] = (v) => toggle.setValue(v === true);
      if (row.disabled) {
        node.alpha = 0.5;
        toggle.eventMode = 'none';
      }
      return node;
    }

    // range: label, then the slider to the right edge (0 on the slider is mute — no icons)
    const toUnit = (v: number): number => (row.max === row.min ? 0 : (v - row.min) / (row.max - row.min));
    const fromUnit = (u: number): number => {
      const raw = row.min + u * (row.max - row.min);
      const snapped = row.min + Math.round((raw - row.min) / row.step) * row.step;
      return Math.max(row.min, Math.min(row.max, snapped));
    };
    place(w * 0.45);
    const x = PAD + label.width + PAD;
    const slider = new SSlider(toUnit(row.get()), row.disabled ? () => {} : (u) => row.set(fromUnit(u)));
    slider.setLayoutSize(Math.max(120, w - PAD - x));
    slider.position.set(x, (h - 24) / 2);
    node.addChild(slider);
    this.updaters[row.id] = (v) => slider.setValue(toUnit(Number(v)));
    if (row.disabled) {
      node.alpha = 0.5;
      slider.eventMode = 'none';
    }
    return node;
  }
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `cd packages/shell && npx vitest run tests/pixi-s/menu.test.ts`
Expected: PASS (7 tests).

If a test host's `menu` override does not resolve a custom toggle (see `resolveMenu` in `src/core/menu.ts`), give the test item the shape `resolveMenu` expects. The rule stays: "a long toggle label leaves the control room".

Run from the repo root: `npm run typecheck --workspace @energy8platform/shell`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/ui/pixi-s/components/Menu.ts packages/shell/tests/pixi-s/menu.test.ts
git commit -m "S menu: a slab per row stacked above the burger, S sliders and toggles, no icons

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: SPage and the S game info

**Files:**
- Create: `packages/shell/src/ui/pixi-s/primitives/page.ts`
- Create: `packages/shell/src/ui/pixi-s/components/GameInfo.ts` (fork of `pixi-hb/components/GameInfo.ts`)
- Test: `packages/shell/tests/pixi-s/gameinfo.test.ts` (create)

**Interfaces:**
- Consumes:
  - Task 2 primitives and `S_SCROLL`;
  - `ScrollBox` (Task 1 look param);
  - `frameRect` and `clamp` from `../../pixi-hb/primitives/overlay`;
  - `giEm` and `setGiEm` from `../../pixi-hb/primitives/controls`;
  - `SButton`; `sIcon`; `makeIcon`.
- Produces:
  - `stripMetrics(h)`;
  - `pageColumn(w, h)`;
  - `class SPage(host, { tag, title, onClose, build })`, with `veil`, `titlePlate`, `closeBtn`, `scrollContent` and `onKey`;
  - `openSGameInfo(host)`.
  - Paytable cards are labelled `pt-card`, and each grid row is labelled `pt-row`.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi-s/gameinfo.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import type { Container } from 'pixi.js';
import { openSGameInfo } from '@/ui/pixi-s/components/GameInfo';
import { SPage, pageColumn, stripMetrics } from '@/ui/pixi-s/primitives/page';
import { STitlePlate } from '@/ui/pixi-s/primitives/controls';
import { S } from '@/ui/pixi-s/theme';
import { makeContext, defaultConfig } from '../pixi/_host';

function all<T>(n: Container, cls: abstract new (...a: never[]) => T, out: T[] = []): T[] {
  if (n instanceof cls) out.push(n as T);
  for (const c of n.children) all(c as Container, cls, out);
  return out;
}
function byLabel(n: Container, label: string, out: Container[] = []): Container[] {
  if (n.label === label) out.push(n);
  for (const c of n.children) byLabel(c as Container, label, out);
  return out;
}
const PAYTABLE = (n: number) => ({
  type: 'paytable',
  rows: Array.from({ length: n }, (_, i) => ({ symbol: { text: `S${i}` }, wins: [{ count: '5', multiplier: 10 * (i + 1) }] })),
});
function info(sections: unknown[], over: Record<string, unknown> = {}): SPage {
  const host = makeContext({ screenW: 1280, screenH: 720, config: defaultConfig({ gameInfo: { sections }, features: { turbo: 2, autoplay: {}, buyBonus: [], hotkeys: false } }), ...over });
  return openSGameInfo(host) as SPage;
}

describe('S game info page', () => {
  it('covers the whole screen; title plate at the column left, ✕ at the column right', () => {
    const p = info([PAYTABLE(3)]);
    expect(p.veil.hitArea).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 });
    const col = pageColumn(1280, 720);
    expect(p.titlePlate!.x).toBeCloseTo(col.x, 0);
    expect(p.titlePlate!.labelText.text).toBe('GAME INFO');
    expect(p.closeBtn!.x + stripMetrics(720).height).toBeCloseTo(col.x + col.width, 0);
  });

  it('section titles are yellow title plates', () => {
    const p = info([PAYTABLE(3), { type: 'controls' }]);
    const plates = all(p.scrollContent.content, STitlePlate);
    expect(plates.map((t) => t.labelText.text)).toEqual(expect.arrayContaining(['PAYTABLE', 'CONTROLS']));
    for (const t of plates) expect(t.slab.face).toBe(S.yellow);
  });

  it('the paytable is always 3 per row across the column: 7 rows → 3, 3, 1, each card a third', () => {
    const p = info([PAYTABLE(7)]);
    const width = pageColumn(1280, 720).width;
    const rows = byLabel(p.scrollContent.content, 'pt-row');
    expect(rows.map((r) => byLabel(r, 'pt-card').length)).toEqual([3, 3, 1]);
    const cards = byLabel(p.scrollContent.content, 'pt-card') as unknown as Array<{ measureSize(): { w: number } }>;
    for (const c of cards) expect(c.measureSize().w).toBeCloseTo((width - 24) / 3, 1);
  });

  it('a 2-row paytable keeps third-width cards, left-aligned', () => {
    const p = info([PAYTABLE(2)]);
    const width = pageColumn(1280, 720).width;
    const cards = byLabel(p.scrollContent.content, 'pt-card') as unknown as Array<{ x: number; measureSize(): { w: number } }>;
    expect(cards.length).toBe(2);
    expect(cards[0].measureSize().w).toBeCloseTo((width - 24) / 3, 1);
    expect(cards[0].x).toBeCloseTo(0, 0);
  });

  it('no sections: still a titled page with ✕', () => {
    const p = info([]);
    expect(p.titlePlate).toBeDefined();
    expect(p.closeBtn).toBeDefined();
  });

  it('✕ closes; scroll keys are consumed, Escape is left to the controller', () => {
    const closeLayer = vi.fn();
    const p = info([PAYTABLE(30)], { closeLayer });
    p.closeBtn!.emit('pointertap', {});
    expect(closeLayer).toHaveBeenCalled();
    expect(p.onKey({ code: 'ArrowDown' } as KeyboardEvent)).toBe(true);
    expect(p.onKey({ code: 'End' } as KeyboardEvent)).toBe(true);
    expect(p.onKey({ code: 'Escape' } as KeyboardEvent)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/shell && npx vitest run tests/pixi-s/gameinfo.test.ts`
Expected: FAIL (the modules do not resolve).

- [ ] **Step 3: `primitives/page.ts`**

Create `packages/shell/src/ui/pixi-s/primitives/page.ts`:

```ts
import { Container, Graphics, Rectangle } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { FlexBox } from '../../pixi/primitives/flex';
import { ScrollBox } from '../../pixi-hb/primitives/scroll';
import { clamp, frameRect } from '../../pixi-hb/primitives/overlay';
import type { SButton } from '../widgets';
import { STitlePlate, sCloseButton, S_SCROLL } from './controls';
import { S } from '../theme';

/** Where the page's top strip sits on a screen `h` tall: its top edge and height. */
export function stripMetrics(h: number): { top: number; height: number } {
  return { top: clamp(12, h * 0.03, 24), height: clamp(44, h * 0.09, 72) };
}

/** The page column: HB game info's body width, centred — "по ширине и позиционированию оставить
 *  также". HB: inner = frame − 2·border; body = min(760, inner − 2·sidePad − gutter). */
export function pageColumn(w: number, h: number): { x: number; width: number } {
  const inner = frameRect(w, h).width - 4;
  const sidePad = clamp(12, inner * 0.04, 24);
  const width = Math.min(760, inner - sidePad * 2 - ScrollBox.GUTTER);
  return { x: Math.round((w - width - ScrollBox.GUTTER) / 2), width };
}

export interface SPageOpts {
  tag: string;
  title: string;
  onClose(): void;
  /** Build the scrolling column's content for a given width (a Sizable column). */
  build(width: number): Container;
}

/** The S full-screen page (game info): a veil over the frosted game, a yellow title plate at the
 *  column's left and a yellow ✕ at its right, and the column scrolling under them. Rebuilt on resize. */
export class SPage extends Container implements ShellLayer {
  readonly tag: string;
  readonly veil = new Graphics();
  titlePlate?: STitlePlate;
  closeBtn?: SButton;
  private host: PixiComponentContext;
  private opts: SPageOpts;
  private scroll: ScrollBox;
  private viewH = 0;

  get scrollContent(): ScrollBox {
    return this.scroll;
  }

  constructor(host: PixiComponentContext, opts: SPageOpts) {
    super();
    this.host = host;
    this.opts = opts;
    this.tag = opts.tag;
    this.veil.eventMode = 'static'; // swallow taps to the game behind
    this.scroll = new ScrollBox(host.canvas, host.ticker, S_SCROLL);
    this.addChild(this.veil, this.scroll);
    this.resize(host.screenW, host.screenH);
  }

  resize(w: number, h: number): void {
    this.veil.clear().rect(0, 0, w, h).fill(S.veil);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    const col = pageColumn(w, h);
    const strip = stripMetrics(h);

    this.titlePlate?.destroy({ children: true });
    this.closeBtn?.destroy({ children: true });
    this.titlePlate = new STitlePlate(this.opts.title, strip.height, col.width - strip.height * 1.5);
    this.titlePlate.position.set(col.x, strip.top);
    this.closeBtn = sCloseButton(strip.height, () => this.opts.onClose());
    this.closeBtn.position.set(col.x + col.width - strip.height, strip.top);
    this.addChild(this.titlePlate, this.closeBtn);

    const top = strip.top + strip.height * 1.3;
    this.viewH = Math.max(0, h - top - 12);
    this.scroll.position.set(col.x, top);
    this.scroll.setViewport(col.width + ScrollBox.GUTTER, this.viewH);
    this.scroll.content.removeChildren().forEach((c) => c.destroy({ children: true }));
    const content = this.opts.build(col.width);
    if (content instanceof FlexBox) content.setLayoutSize(col.width, undefined);
    const tail = new Graphics().rect(0, 0, 1, 1).fill({ color: 0, alpha: 0 });
    tail.position.set(0, content.y + content.height + 16);
    this.scroll.content.addChild(content, tail);
    this.scroll.refresh();
  }

  fit(): void {
    /* re-laid out on resize */
  }

  /** Scroll keys as HB's overlay; Escape is left to the controller (it closes the layer). */
  onKey(e: KeyboardEvent): boolean {
    const page = Math.floor(this.viewH * 0.9);
    switch (e.code) {
      case 'ArrowDown':
        this.scroll.scrollBy(60);
        return true;
      case 'ArrowUp':
        this.scroll.scrollBy(-60);
        return true;
      case 'PageDown':
        this.scroll.scrollBy(page);
        return true;
      case 'PageUp':
        this.scroll.scrollBy(-page);
        return true;
      case 'Space':
        this.scroll.scrollBy(e.shiftKey ? -page : page);
        return true;
      case 'Home':
        this.scroll.scrollBy(-999999);
        return true;
      case 'End':
        this.scroll.scrollBy(999999);
        return true;
      default:
        return false;
    }
  }

  onRemove(): void {
    this.scroll.destroy({ children: true });
  }
}
```

- [ ] **Step 4: Fork game info**

```bash
cp packages/shell/src/ui/pixi-hb/components/GameInfo.ts packages/shell/src/ui/pixi-s/components/GameInfo.ts
```

Apply these changes to the copy. Behaviour — section order, the hotkeys injection, the examples, `persistentSlot` and `imageBox` — stays exactly as HB.

**4a. Header comment and imports.**
- Add the first line `// Fork of pixi-hb/components/GameInfo.ts in the S look — sections, order and behaviour unchanged.`
- Replace the HB imports of `Overlay`, `makeText`/`textBaseline`, `section`/`paragraph`/`Spacer`/`card`/`giEm`/`setGiEm`, `IconButton`/`BonusButton`, `HB` and `plaque` with:
```ts
import { SPage } from '../primitives/page';
import { STitlePlate } from '../primitives/controls';
import { Spacer, giEm, setGiEm } from '../../pixi-hb/primitives/controls';
import { makeIcon } from '../../pixi-hb/pixi-icon';
import { FlexBox } from '../../pixi/primitives/flex';
import { SButton } from '../widgets';
import { SKEW } from '../slab';
import { sIcon } from '../icons';
import { sLabel, sValue, sBody } from '../text';
import { PACKAGE_VERSION } from '@/core/version';
import { S } from '../theme';
```
- Keep the `pixi.js` and `@/core/types` imports. Fix the relative paths for the new depth (`../../pixi/context`).

**4b. The entry.**
```ts
/** Game info — the S full-screen page: yellow title plate + ✕, sections under yellow title plates. */
export function openSGameInfo(host: PixiComponentContext): ShellLayer {
  return new SPage(host, {
    tag: 'game-info',
    title: host.t('Game info'),
    onClose: () => host.closeLayer(),
    build: (w) => buildBody(host, w),
  });
}
```

**4c. Local S helpers.** Add these near the top. They replace HB's `section` / `paragraph` / `card` / `heading`:
```ts
/** A section: its title in a yellow plate on the left, then the content centred as HB. */
function section(_host: PixiComponentContext, title: string | undefined, width: number): FlexBox {
  const sec = new FlexBox({ direction: 'column', align: 'center', gap: 12, padding: { top: 8, bottom: 8 } });
  if (title) {
    const head = new FlexBox({ direction: 'row', justify: 'start', width });
    head.add(new STitlePlate(title, Math.round(giEm() * 2.6)));
    sec.add(head);
  }
  return sec;
}

/** Wrapped body copy (Inter), centred by default as HB. */
function paragraph(_host: PixiComponentContext, text: string, width: number, opts: { size?: number; color?: string; align?: 'left' | 'center' } = {}) {
  return sBody(text, opts.size ?? 15, opts.color ?? S.fg, width, opts.align ?? 'center');
}

/** A flat content panel — no border, sharp corners. */
function card(opts: { padding?: number; gap?: number; align?: 'start' | 'center' | 'stretch'; direction?: 'row' | 'column' } = {}): FlexBox {
  return new FlexBox({
    direction: opts.direction ?? 'column',
    align: opts.align ?? 'center',
    gap: opts.gap ?? 8,
    padding: opts.padding ?? 12,
    background: { fill: S.panel, radius: 0 },
  });
}
```

**4d. Section call sites.** Every `section(host, X)` becomes `section(host, X, width)`: modes, controls, hotkeys, paytable and custom. In `sectionWins`, the header row's `makeText(title, …)` becomes `new STitlePlate(title, Math.round(giEm() * 2.6))`. Its `sec` stays `section(host, undefined, inner)`, and the badge pill stays next to the plate.

**4e. Colour and text mapping** across the whole file:
- Colours:
  - `HB.fg` → `S.fg`;
  - `HB.muted` → `S.muted`;
  - `HB.orange` → `S.yellow`;
  - `HB.track` → `S.track`;
  - `HB.ink` → `S.ink`;
  - `HB.winOk` → `S.winOk`;
  - `HB.winNo` → `S.winNo`.
- Text builders:
  - `makeText(…, { heading: true … })`, and any other caps title/name, → `sLabel(text, size, color)`;
  - numeric values (multipliers, stats, line numbers) → `sValue(text, size, color)`;
  - plain copy → `sBody(text, size, color, wrap?, align?)`.

**4f. Mode row stats.** Replace the baseline block that uses `textBaseline` with centred cells:
```ts
  const LABEL_SIZE = giEm() * 0.72, VALUE_SIZE = giEm(), LV_GAP = 5;
  const cells: Container[] = [];
  const stat = (label: string, val: string): void => {
    const lt = sLabel(host.t(label), LABEL_SIZE, S.muted);
    const vt = sValue(val, VALUE_SIZE, S.yellow);
    const h = Math.max(lt.height, vt.height);
    lt.position.set(0, (h - lt.height) / 2);
    vt.position.set(lt.width + LV_GAP, (h - vt.height) / 2);
    const cell = new Container();
    cell.addChild(lt, vt);
    cells.push(cell);
  };
```
The mode title becomes `sLabel(m.title, giEm() * 1.15, S.fg)`.

**4g. Controls badges.** Replace `slotIcon` and `buyBadge` with one S badge. The row list is unchanged except for the `vis` values:
```ts
  /** A 36-square S plate badge in a 48 box: yellow for SPIN / buy, black for the rest. */
  const badge = (face: 'yellow' | 'plate', glyph: Container, g: number): Container => {
    const box = new Container();
    const b = new SButton({ w: 36, h: 36, face, corners: SKEW.menu, glyph, glyphSize: g, onTap: () => {} });
    b.eventMode = 'none';
    b.position.set(6, 6);
    box.addChild(spacerBox(48, 48), b);
    return box;
  };
  const fgIcon = (name: Parameters<typeof makeIcon>[0]) => badge('plate', makeIcon(name, 20, { ink: S.fg, fill: S.fg }), 20);
```
- Game rows:
  - spin: `badge('yellow', makeIcon('spin', 26, { ink: S.ink, fill: S.ink }), 26)`;
  - plus / minus: `fgIcon('plus')` / `fgIcon('minus')`;
  - autoplay: `badge('plate', sIcon('play', 18, S.fg), 18)`;
  - turbo: `badge('plate', sIcon('bolt', 18, S.fg), 18)`;
  - buy bonus: `badge('yellow', sIcon('mask', 30, S.ink), 30)`.
- Menu rows: `fgIcon('menu')`, `fgIcon('soundOn')`, `fgIcon('musicOn')`, `fgIcon('info')`, `fgIcon('close')`.
- In `ctlBlock`:
  - the head text becomes `sLabel(host.t(label), 12, S.muted)`;
  - the name becomes `sLabel(host.t(r.name), giEm() * 1.0, S.fg)`;
  - the description becomes `paragraph(host, host.t(r.desc), w - 48 - 14, { size: giEm(), color: S.muted, align: 'left' })`.

**4h. Hotkeys.**
- `keycap` becomes a flat rect:
```ts
function keycap(_host: PixiComponentContext, label: string): Container {
  const c = new Container();
  const txt = sValue(label, 11, S.fg);
  const padH = 8, padV = 5;
  const w = txt.width + padH * 2, h = txt.height + padV * 2;
  c.addChild(new Graphics().rect(0, 0, w, h).fill(S.track), txt);
  txt.position.set(padH, padV);
  return c;
}
```
- The `/` separator becomes `sBody('/', 12, S.muted)`.
- The action name becomes `sBody(host.t(r.name), giEm(), S.fg, labelW, 'right')`.

**4i. Paytable — always 3 per row, across the column.**
```ts
function sectionPaytable(host: PixiComponentContext, rows: PaytableRow[], title: string, width: number): FlexBox {
  const sec = section(host, title, width);
  const gap = 12;
  const cols = 3; // always three across (the user's call) — the last row keeps third-width cards
  const cardW = (width - gap * (cols - 1)) / cols;
  const grid = new FlexBox({ direction: 'column', align: 'start', gap, width });
  for (let i = 0; i < rows.length; i += cols) {
    const row = new FlexBox({ direction: 'row', align: 'start', gap });
    row.label = 'pt-row';
    for (const r of rows.slice(i, i + cols)) row.add(paytableCard(host, r, cardW));
    row.layout();
    grid.add(row);
  }
  sec.add(grid);
  return sec;
}

function paytableCard(_host: PixiComponentContext, r: PaytableRow, w: number): FlexBox {
  const card = new FlexBox({
    direction: 'column',
    align: 'center',
    gap: 8,
    padding: { top: 14, bottom: 14, left: 12, right: 12 },
    width: w,
    background: { fill: S.panel, radius: 0 },
  });
  card.label = 'pt-card';
  const sym = new FlexBox({ direction: 'column', align: 'center', gap: 5 });
  if (r.symbol.image) sym.add(imageBox(r.symbol.image, 56, 56));
  if (r.symbol.text) sym.add(sLabel(r.symbol.text, 13, S.fg));
  card.add(sym);
  const wins = new FlexBox({ direction: 'column', align: 'stretch', gap: 2, width: w - 24 });
  for (const win of r.wins) {
    const wr = new FlexBox({ direction: 'row', align: 'center', justify: 'space-between' });
    wr.add(sBody(win.count ? String(win.count) : '', 13.5, S.muted));
    wr.add(new Spacer(), { grow: 1 });
    wr.add(sValue(`×${win.multiplier}`, 13.5, S.yellow));
    wins.add(wr);
  }
  card.add(wins);
  return card;
}
```

**4j. Wins.**
- `gridIllustration` becomes flat squares:
```ts
function gridIllustration(_host: PixiComponentContext, grid: { cols: number; rows: number }, on: CellRef[], width: number): Container {
  const { cols, rows } = grid;
  const cell = width / cols;
  const gap = 2;
  const onSet = new Set(on.map(([c, r]) => `${c},${r}`));
  const g = new Graphics();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      g.rect(x * cell + gap / 2, y * cell + gap / 2, cell - gap, cell - gap).fill(onSet.has(`${x},${y}`) ? S.yellow : S.track);
    }
  }
  const c = new Container();
  c.addChild(g);
  return c;
}
```
- `badgePill` becomes a yellow flat rect with `sLabel(text, 11, S.ink)`, padding 8×3.
- `lineItem` numbers become `sValue(String(n), 13, S.fg)`.
- `waysCol` tags become `sLabel(tag, 12, color)`.
- `shapeRow` names become `sLabel(sh.name, 16, S.fg)`.

**4k. Version footer.** `sBody(stamp, 11, S.muted)`, centred as HB.

**4l. Clean-up.** Delete anything left unused: `HOTKEYS_DEFAULT_ORDER` stays; `SECTION_PAD` and `CARD_PAD` stay if they are still used.

Run `grep -nE "HB\.|makeText|plaque|roundRect|stroke" packages/shell/src/ui/pixi-s/components/GameInfo.ts`. Expected: no matches.

- [ ] **Step 5: Run the tests and the gates**

Run: `cd packages/shell && npx vitest run tests/pixi-s/gameinfo.test.ts`
Expected: PASS (6 tests).

Run from the repo root: `npm test --workspace @energy8platform/shell && npm run typecheck --workspace @energy8platform/shell`
Expected: all green; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shell/src/ui/pixi-s/primitives/page.ts packages/shell/src/ui/pixi-s/components/GameInfo.ts packages/shell/tests/pixi-s/gameinfo.test.ts
git commit -m "S game info: full-screen page, yellow section plates, paytable always 3 across

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The S buy-bonus page

**Files:**
- Create: `packages/shell/src/ui/pixi-s/components/BuyBonus.ts` (fork of `pixi-hb/components/BuyBonus.ts`)
- Test: `packages/shell/tests/pixi-s/buybonus.test.ts` (create)

**Interfaces:**
- Consumes:
  - `SCardModal` (Task 3);
  - `STitlePlate`, `sCloseButton`, `STextButton` and `S_SCROLL` (Task 2);
  - `stripMetrics` (Task 5);
  - `SReadout`, `SBet` and `SButton` (widgets);
  - `sIcon`; `makeIcon`.
- Produces:
  - `openSBuyBonus(host): ShellLayer | null`;
  - `class SBuyBonusPage` with `slots`, `current(slot)`, `step(slot, dir)`, `ctas: STextButton[]`, `titlePlate` and `onKey`;
  - `sVolatilityRow(level, em)`.
  - The hero face Graphics is labelled `bb-hero-yellow` or `bb-hero-red`.

- [ ] **Step 1: Write the failing test**

Create `packages/shell/tests/pixi-s/buybonus.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import type { Container } from 'pixi.js';
import { openSBuyBonus, SBuyBonusPage } from '@/ui/pixi-s/components/BuyBonus';
import { makeContext, defaultConfig } from '../pixi/_host';

const OPTIONS = [
  { id: 'a1', type: 'feature', groupedBy: 'ante', title: 'Warrior', description: 'w', priceMultiplier: 1.25, volatility: 2 },
  { id: 'a2', type: 'feature', groupedBy: 'ante', title: 'Mage', description: 'm', priceMultiplier: 1.25, volatility: 4 },
  { id: 'fs', type: 'bonus', title: 'Free spins', description: 'f', priceMultiplier: 10, volatility: 5 },
];
function page(over: Record<string, unknown> = {}) {
  const emit = vi.fn();
  const host = makeContext({ emit, screenW: 1280, screenH: 720, config: defaultConfig({ balance: 1000, features: { turbo: 0, autoplay: false, buyBonus: OPTIONS } }), ...over });
  return { host, emit, page: openSBuyBonus(host) as SBuyBonusPage };
}
function byLabel(n: Container, label: string, out: Container[] = []): Container[] {
  if (n.label === label) out.push(n);
  for (const c of n.children) byLabel(c as Container, label, out);
  return out;
}

describe('S buy bonus page', () => {
  it('one card per slot; a grouped slot flips through its members with wrap', () => {
    const { page: p } = page();
    expect(p.slots.length).toBe(2);
    expect(p.current(0).id).toBe('a1');
    p.step(0, 1);
    expect(p.current(0).id).toBe('a2');
    p.step(0, 1);
    expect(p.current(0).id).toBe('a1');
    p.step(1, 1);
    expect(p.current(1).id).toBe('fs');
  });

  it('feature cards get the red ACTIVATE CTA, bonus cards the accent BUY', () => {
    const { page: p } = page();
    expect([p.ctas[0].labelText.text, p.ctas[0].kind]).toEqual(['ACTIVATE', 'red']);
    expect([p.ctas[1].labelText.text, p.ctas[1].kind]).toEqual(['BUY', 'accent']);
  });

  it('tapping a CTA opens the confirm; Enter commits it', () => {
    const { page: p, emit, host } = page();
    const closeLayer = vi.spyOn(host, 'closeLayer');
    p.ctas[1].emit('pointertap', {});
    expect((p as unknown as { confirm?: unknown }).confirm).toBeDefined();
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(emit).toHaveBeenCalledWith('buyBonusSelect', { id: 'fs' });
    expect(closeLayer).toHaveBeenCalled();
  });

  it('an unaffordable option disables its CTA', () => {
    const { page: p, host } = page();
    host.state.balance = 1;
    (p as unknown as { rebuild(): void }).rebuild();
    expect(p.ctas[1].disabled).toBe(true);
  });

  it('a BUY BONUS title plate; the hero face is red for a feature, yellow for a bonus', () => {
    const { page: p } = page();
    expect(p.titlePlate!.labelText.text).toBe('BUY BONUS');
    expect(byLabel(p, 'bb-hero-red').length).toBe(1);
    expect(byLabel(p, 'bb-hero-yellow').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/shell && npx vitest run tests/pixi-s/buybonus.test.ts`
Expected: FAIL (the module does not resolve).

- [ ] **Step 3: Fork**

```bash
cp packages/shell/src/ui/pixi-hb/components/BuyBonus.ts packages/shell/src/ui/pixi-s/components/BuyBonus.ts
```

Apply these changes. The behaviour must stay as HB: slots, groups, `select`, confirm, `commit`, keys, affordability and the persistence of custom nodes.

**3a. Header, imports and names.**
- First line: `// Fork of pixi-hb/components/BuyBonus.ts in the S look — behaviour unchanged.`
- Imports:
  - keep `pixi.js`, `BonusOption`, `groupBonusSlots` and `betDir`;
  - fix the relative paths for the new depth;
  - replace `makeText` / `navButton` / `plaque` / `CardModal` / `IconButton` / `Readout` / `TextButton` / `HB` / `BORDER` / `RADIUS` with:
```ts
import { clamp } from '../../pixi-hb/primitives/overlay';
import { ScrollBox } from '../../pixi-hb/primitives/scroll';
import { makeIcon } from '../../pixi-hb/pixi-icon';
import { SCardModal } from '../primitives/card';
import { STitlePlate, STextButton, sCloseButton, S_SCROLL } from '../primitives/controls';
import { stripMetrics } from '../primitives/page';
import { SButton, SReadout, SBet } from '../widgets';
import { SKEW } from '../slab';
import { sIcon } from '../icons';
import { sLabel, sValue, sBody } from '../text';
import { S } from '../theme';
```
- Renames:
  - `openBuyBonus` → `openSBuyBonus`;
  - `BuyBonusPage` → `SBuyBonusPage`;
  - `volatilityRow` → `sVolatilityRow`.
- Change the `ctas` type to `STextButton[]`, change `confirm?: CardModal` to `SCardModal`, and add `titlePlate?: STitlePlate`.

**3b. Veil.** `this.veil.clear().rect(0, 0, w, h).fill(S.veil);`

**3c. `rebuild()` top.** Replace the ✕ block and `top` with the S strip, aligned to the card column:
```ts
    const em = clamp(11, this.h / 36, 15);
    const pad = clamp(12, em * 1.2, 20);
    const strip = stripMetrics(this.h);
    const contentW = Math.min(1100, this.w - pad * 2 - ScrollBox.GUTTER);
    const left = (this.w - ScrollBox.GUTTER - contentW) / 2;
    this.titlePlate?.destroy({ children: true });
    this.closeBtn?.destroy({ children: true });
    this.titlePlate = new STitlePlate(this.host.t('Buy bonus'), strip.height, contentW - strip.height * 1.5);
    this.titlePlate.position.set(left, strip.top);
    this.closeBtn = sCloseButton(strip.height, () => this.host.closeLayer());
    this.closeBtn.position.set(left + contentW - strip.height, strip.top);
    this.addChild(this.titlePlate, this.closeBtn);
    const top = strip.top + strip.height * 1.3;
```
- Remove the old `nav`, `closeBtn`, `top`, `contentW` and `left` lines.
- Create the ScrollBox with `new ScrollBox(this.host.canvas, this.host.ticker, S_SCROLL)`.
- The bet band background becomes `new Graphics().rect(0, 0, bandW, betH).fill(S.panel)`.

**3d. `buildCard`.**
- The card background becomes `new Graphics().rect(0, 0, w, h).fill(S.panel)`. Delete the divider line.
- `colX = heroW + pad`.
- Title: `const title = sLabel(bonus.title, em * 1.3, S.fg);`. Keep the `anchor.set(1, 0.5)` and the scale-to-room logic.
- The group arrows become S slabs:
```ts
      const g = Math.round(arrow * 0.5);
      const prev = new SButton({ w: arrow, h: arrow, face: 'yellow', corners: SKEW.menu, glyph: makeIcon('back', g, { ink: S.ink, fill: S.ink }), glyphSize: g, onTap: () => this.step(slot, -1) });
      const next = new SButton({ w: arrow, h: arrow, face: 'yellow', corners: SKEW.menu, glyph: makeIcon('chevronRight', g, { ink: S.ink, fill: S.ink }), glyphSize: g, onTap: () => this.step(slot, 1) });
```
  Keep the labels `bb-prev-<slot>` / `bb-next-<slot>`.
- Volatility: `const vol = sVolatilityRow(bonus.volatility, em);`. Advance `y += em * 1.1 + pad * 0.5`.
- CTA:
```ts
    const cta = new STextButton(ctaText, {
      w: ctaW,
      h: ctaH,
      kind: bonus.type === 'feature' ? 'red' : 'accent',
      size: em * 0.95,
      onTap: () => this.select(bonus),
    });
```
  To measure `ctaW`, use `const probe = sLabel(ctaText, em * 0.95, S.ink);`.
- Price: `sValue(this.host.fmt(price), em * 1.3, S.fg)`.
- Description: `sBody(bonus.description, em * 0.95, S.muted, colW, 'right')`. Keep the clip mask as a plain rect.

**3e. `buildHero`.**
- The clip becomes `new Graphics().rect(0, 0, w, h).fill(0xffffff)`, with no inset and no radius, and `cover()` uses `iw = w`, `ih = h`, `ix = 0`.
- The `custom` and `thumbnail` branches are unchanged.
- The default branch:
```ts
    } else {
      const face = new Graphics().rect(0, 0, w, h).fill(bonus.type === 'feature' ? S.red : S.yellow);
      face.label = bonus.type === 'feature' ? 'bb-hero-red' : 'bb-hero-yellow';
      const size = Math.round(w * 0.7);
      const mask = sIcon('mask', size, bonus.type === 'feature' ? S.fg : S.ink);
      mask.position.set((w - size) / 2, (h - size) / 2);
      hero.addChild(face, mask);
    }
```
- In the `custom` context, `accent: HB.orange` becomes `accent: S.yellow`.

**3f. `buildBetBand`.** Replace the HB readouts and stepper with the bar's S widgets at the band's height:
```ts
  private buildBetBand(w: number, h: number, _em: number): Container {
    const band = new Container();
    const { state } = this.host;
    const pad = clamp(10, h * 0.25, 20);
    const rh = Math.round(h * 0.78);
    const i = state.availableBets.indexOf(state.bet);
    const feature = state.activeFeature;
    const locked = state.busy || state.autoplay.active || !!feature;
    const labelSize = Math.round(rh * 0.27);
    const valueSize = Math.round(rh * 0.41);
    const bet = new SBet({
      label: feature ? feature.title : this.host.t('Bet'),
      value: this.host.fmt(feature ? state.bet * feature.priceMultiplier : state.bet),
      w: Math.round(rh * 5),
      h: rh,
      labelSize,
      valueSize,
      stepper: true,
      onStep: (dir) => this.stepBetBy(dir),
    });
    bet.up!.disabled = locked || i >= state.availableBets.length - 1;
    bet.down!.disabled = locked || i <= 0;
    bet.up!.label = 'bb-bet-up';
    bet.down!.label = 'bb-bet-down';
    bet.position.set(w - pad - bet.measureSize().w, (h - rh) / 2);
    const balance = new SReadout({ label: this.host.t('Balance'), value: this.host.fmt(state.balance), w: Math.round(rh * 4.8), h: rh, labelSize, valueSize });
    balance.position.set(pad, (h - rh) / 2);
    band.addChild(balance, bet);
    return band;
  }
```

**3g. Confirm.**
- `new CardModal(` becomes `new SCardModal(`.
- The description becomes `sBody(bonus.description, 0.96 * em, S.fg, modal.cardWidth - 2.4 * em, 'center')`.
- The price becomes `sValue(this.host.fmt(price), 1.6 * em, S.fg)`.

**3h. Volatility.**
```ts
/** Five flat bars; the first `level` filled yellow, the rest the track colour. */
export function sVolatilityRow(level: number, em: number): Container {
  const c = new Container();
  const n = Math.max(0, Math.min(5, level));
  const bw = Math.round(em * 0.5);
  const bh = Math.round(em * 1.1);
  const gap = Math.max(2, Math.round(em * 0.25));
  const g = new Graphics();
  for (let i = 0; i < 5; i++) g.rect(i * (bw + gap), 0, bw, bh).fill(i < n ? S.yellow : S.track);
  c.addChild(g);
  return c;
}
```

**3i. Check.** Run `grep -nE "HB\.|makeText|plaque|roundRect|stroke|IconButton|TextButton\b|Readout\b" packages/shell/src/ui/pixi-s/components/BuyBonus.ts`. Expected: no matches, except `STextButton` / `SReadout`.

- [ ] **Step 4: Run the tests and the gates**

Run: `cd packages/shell && npx vitest run tests/pixi-s/buybonus.test.ts`
Expected: PASS (5 tests).

Run from the repo root: `npm test --workspace @energy8platform/shell && npm run typecheck --workspace @energy8platform/shell`
Expected: all green; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shell/src/ui/pixi-s/components/BuyBonus.ts packages/shell/tests/pixi-s/buybonus.test.ts
git commit -m "S buy bonus: full-screen page, flat cards, mask hero, S CTA and bet band

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Wire the S overlays, the no-round guard, demo, docs, visual check

**Files:**
- Modify: `packages/shell/src/ui/pixi-s/index.ts`
- Test: `packages/shell/tests/pixi-s/no-round.test.ts` (create)
- Test: `packages/shell/tests/pixi-s/shell.test.ts` (add a test)
- Modify: `examples/pixi-s-shell-demo/src/main.ts` (the `open=` params)
- Modify: `CLAUDE.md` (the S line)
- Scratch (never committed): `<scratchpad>/overlays.mjs`, `<scratchpad>/ov/*.png`

**Interfaces:**
- Consumes: all S builders (Tasks 3–6) and `HbOverlays` (Task 1).

- [ ] **Step 1: Write the failing tests**

Create `packages/shell/tests/pixi-s/no-round.test.ts`:

```ts
import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { Container, Graphics, Text } from 'pixi.js';
import { IconView } from '@/ui/pixi-hb/pixi-icon';
import { openSMenu } from '@/ui/pixi-s/components/Menu';
import { openSGameInfo } from '@/ui/pixi-s/components/GameInfo';
import { openSBuyBonus } from '@/ui/pixi-s/components/BuyBonus';
import { openSBetPicker } from '@/ui/pixi-s/components/pickers';
import { buildSReplayModal } from '@/ui/pixi-s/components/ReplayModal';
import { makeContext, defaultConfig } from '../pixi/_host';

/** Every shape and stroke drawn under `root`, skipping glyphs (SVG paths in IconView / sIcon). */
function offenders(root: Container): string[] {
  const out: string[] = [];
  const walk = (n: Container, path: string): void => {
    if (n instanceof IconView || n.label === 's-glyph') return;
    if (n instanceof Graphics) {
      for (const ins of n.context.instructions) {
        if (ins.action === 'stroke') out.push(`${path}: stroke`);
        const prims = (ins.data as { path?: { shapePath: { shapePrimitives: Array<{ shape: { type: string; radius?: number } }> } } }).path?.shapePath.shapePrimitives ?? [];
        for (const p of prims) {
          const t = p.shape.type;
          if (t === 'circle' || t === 'ellipse') out.push(`${path}: ${t}`);
          if (t === 'roundedRectangle' && (p.shape.radius ?? 0) > 0) out.push(`${path}: roundRect r=${p.shape.radius}`);
        }
      }
    }
    if (n instanceof Text && n.style.stroke != null) out.push(`${path}: text stroke "${n.text}"`);
    n.children.forEach((c, i) => walk(c as Container, `${path}/${c.label || c.constructor.name}#${i}`));
  };
  walk(root, root.constructor.name);
  return out;
}

const CFG = defaultConfig({
  balance: 1000,
  gameInfo: {
    sections: [
      { type: 'modes', modes: [{ title: 'Base', price: '1×', rtp: 96.5, maxWin: '5,000×', description: 'd' }] },
      { type: 'controls' },
      { type: 'paytable', rows: [{ symbol: { text: 'A' }, wins: [{ count: '5', multiplier: 10 }] }] },
      { type: 'wins', kind: 'classic', grid: { cols: 5, rows: 3 }, lines: [[1, 1, 1, 1, 1]] },
      { type: 'wins', kind: 'cluster', grid: { cols: 6, rows: 5 }, minCount: 5 },
      { type: 'custom', title: 'Rules', html: '<p>Rules</p>' },
    ],
  },
  features: {
    turbo: 2,
    autoplay: {},
    buyBonus: [
      { id: 'f', type: 'feature', title: 'Ante', description: 'x', priceMultiplier: 1.25, volatility: 2 },
      { id: 'b', type: 'bonus', title: 'FS', description: 'y', priceMultiplier: 10, volatility: 5 },
    ],
  },
});

describe('S overlays: no rounding and no outlines anywhere', () => {
  const host = () => makeContext({ screenW: 1280, screenH: 720, config: CFG });
  it('menu', () => {
    expect(offenders(openSMenu(host(), () => ({ x: 16, y: 540, w: 64, h: 40 }), () => null, () => 1))).toEqual([]);
  });
  it('game info', () => {
    expect(offenders(openSGameInfo(host()))).toEqual([]);
  });
  it('buy bonus (with its confirm open)', () => {
    const p = openSBuyBonus(host())!;
    (p as unknown as { ctas: Array<{ emit(e: string, a: unknown): void }> }).ctas[1].emit('pointertap', {});
    expect(offenders(p)).toEqual([]);
  });
  it('bet picker and replay modal', () => {
    expect(offenders(openSBetPicker(host()))).toEqual([]);
    expect(offenders(buildSReplayModal(host(), { bonusId: 'b', bet: 1, payoutMultiplier: 2, onReplay: () => {} }, () => {}))).toEqual([]);
  });
});
```

Add to `packages/shell/tests/pixi-s/shell.test.ts`, inside the `describe`:

```ts
  it('opens the S overlays, and the burger shows ✕ while the menu is open', () => {
    const shell = createPixiSShell(config(fakeApp(1280, 720)));
    shell.openMenu();
    const r = (shell as unknown as { renderer: { currentLayer: { tag?: string } | null; bar: { menuClose: { visible: boolean } } } }).renderer;
    expect(r.currentLayer?.tag).toBe('menu');
    expect(r.currentLayer?.constructor.name).toBe('SMenu');
    expect(r.bar.menuClose.visible).toBe(true);
    shell.openInfo();
    expect(r.currentLayer?.constructor.name).toBe('SPage');
    expect(r.bar.menuClose.visible).toBe(false);
  });
```

(If the controller keeps the renderer under a different field name, find it in `src/core/ShellController.ts` and use that. The rule is: the S layers open, and the ✕ tracks the menu.)

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd packages/shell && npx vitest run tests/pixi-s/no-round.test.ts tests/pixi-s/shell.test.ts`
Expected:
- the shell test FAILS, because the HB layers open and not `SMenu`;
- the no-round test either passes or names offenders — fix every one in the S file that draws it (usually a leftover `roundRect`, or a FlexBox background with a radius).

- [ ] **Step 3: Wire**

In `packages/shell/src/ui/pixi-s/index.ts`:
```ts
import { PixiHbRenderer, type HbOverlays } from '../pixi-hb/PixiHbRenderer';
import { openSMenu } from './components/Menu';
import { openSGameInfo } from './components/GameInfo';
import { openSBuyBonus } from './components/BuyBonus';
import { openSBetPicker, openSAutoplayPicker } from './components/pickers';
import { buildSModal } from './components/Modal';
import { buildSReplayModal } from './components/ReplayModal';

/** Every overlay in the S look (slice 2): the menu, game info, buy bonus and the small modals. */
const S_OVERLAYS: HbOverlays = {
  menu: openSMenu,
  gameInfo: openSGameInfo,
  buyBonus: openSBuyBonus,
  betPicker: openSBetPicker,
  autoplayPicker: openSAutoplayPicker,
  replay: buildSReplayModal,
  modal: buildSModal,
};
```
Then pass `overlays: S_OVERLAYS` into `new PixiHbRenderer({ … })`, and update the file's top comment: "HB's renderer with the S bar and the S overlays".

- [ ] **Step 4: Run all the gates**

Run: `cd packages/shell && npx vitest run tests/pixi-s/no-round.test.ts tests/pixi-s/shell.test.ts`
Expected: PASS.

Run from the repo root:
- `npm test --workspace @energy8platform/shell`
- `npm run typecheck --workspace @energy8platform/shell`
- `npm run build --workspace @energy8platform/shell`

Expected: all green / exit 0.

- [ ] **Step 5: Demo params and docs**

In `examples/pixi-s-shell-demo/src/main.ts`, extend the `open` handling at the bottom to:
```ts
const open = params.get('open');
if (open === 'settings' || open === 'menu') shell.openMenu();
else if (open === 'info') shell.openInfo();
else if (open === 'buybonus') shell.openBuyBonus();
else if (open === 'bet') shell.openBetPicker();
else if (open === 'auto') shell.openAutoplayPicker();
else if (open === 'replay') shell.openReplay({ bonusId: 'fs', bet: state.bet, payoutMultiplier: 87.5, onReplay: () => log('▶ replay started') });
```

In the root `CLAUDE.md`, in the `pixi-s` sentence, replace `HB's renderer and overlays with a side-column bar` with `HB's renderer with S overlays (flat sharp plates: a slab-per-row menu over the burger, full-screen game info / buy-bonus pages with yellow title plates, S card modals) and a side-column bar`.

- [ ] **Step 6: Visual check**

The session scratchpad is `/private/tmp/claude-501/-Users-mrphelko-Documents-repo-game-engine/968dd56f-f1b3-4442-a728-5f12a6cdbb98/scratchpad` (create it with `mkdir -p` if it is missing).

Write `<scratchpad>/overlays.mjs`:
```js
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('/Users/mrphelko/Documents/repo/game-engine/package.json');
const { chromium } = require('playwright');
const OUT = new URL('./ov/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SHOTS = [
  ['menu', 'screen=desktop&open=menu'], ['info', 'screen=desktop&open=info'], ['buybonus', 'screen=desktop&open=buybonus'],
  ['bet', 'screen=desktop&open=bet'], ['auto', 'screen=desktop&open=auto'], ['replay', 'screen=desktop&open=replay'],
  ['stake-menu', 'screen=stake-s&open=menu'], ['phone-menu', 'screen=phone&open=menu'], ['phone-info', 'screen=phone&open=info'],
  ['phone-buybonus', 'screen=phone&open=buybonus'], ['phone-bet', 'screen=phone&open=bet'],
];
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 1 });
for (const [name, query] of SHOTS) {
  await page.goto(`http://localhost:4331/?${query}`);
  await page.waitForSelector('#game canvas');
  await page.waitForTimeout(2500);
  await (await page.$('#game')).screenshot({ path: `${OUT}${name}.png` });
  console.log('shot', name);
}
await browser.close();
```

Then:
1. Build: `npm run build --workspace @energy8platform/shell`.
2. Serve: `cd examples/pixi-s-shell-demo && npx vite --port 4331 --strictPort --force` (in the background).
3. Wait until `curl -s localhost:4331 | grep -q "Pixi S"`.
4. Shoot: `node <scratchpad>/overlays.mjs`.
5. Stop only your Vite process.

Open every PNG and check it against the spec:
- no rounded corners or outlines anywhere;
- the burger shows ✕ with the menu open;
- the menu rows stack above the burger with sliders and no icons;
- game info fills the screen: yellow title plate top-left, yellow ✕ top-right, yellow section plates, paytable 3 across;
- buy bonus: title plate, flat cards, mask heroes, S CTAs, S bet band;
- the modals are flat cards with a title plate on the edge and a ✕ plate.

You may tune only sizes, paddings and font sizes in the S files of this slice, and the suite must stay green after tuning. Run at most 3 rounds, then list the remaining differences in the report.

- [ ] **Step 7: Commit**

```bash
git add packages/shell/src/ui/pixi-s/index.ts packages/shell/tests/pixi-s/no-round.test.ts packages/shell/tests/pixi-s/shell.test.ts examples/pixi-s-shell-demo/src/main.ts CLAUDE.md
git commit -m "Wire the S overlays into createPixiSShell; guard against rounding and outlines

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

If Step 6 tuned any source file, commit it separately before this commit, with the subject `Tune the S overlays against the asks` and the same trailer.
