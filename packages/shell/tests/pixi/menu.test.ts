import './setup-canvas';
import { describe, it, expect, vi } from 'vitest';
import { Container, EventBoundary, Matrix } from 'pixi.js';
import type { Application } from 'pixi.js';
import { openMenu } from '@/ui/pixi/components/Menu';
import { BottomBar } from '@/ui/pixi/components/BottomBar';
import { PixiRenderer } from '@/ui/pixi/PixiRenderer';
import { ShellController } from '@/core/ShellController';
import { POPOVER } from '@/core/popover';
import { Toggle, Slider } from '@/ui/pixi/primitives/controls';
import { ScrollBox } from '@/ui/pixi/primitives/scroll';
import { Popover } from '@/ui/pixi/primitives/popover';
import { IconView } from '@/ui/pixi/pixi-icon';
import type { PixiComponentContext } from '@/ui/pixi/context';
import { makeContext } from './_host';

// The events mixin (isInteractive(), interactiveChildren, …) is applied to Container.prototype by
// the renderer's EventSystem, which never initialises in these render-less component tests — so
// EventBoundary finds interactiveChildren undefined (skips all children) and isInteractive missing
// (throws). Polyfill both with their real defaults, exactly like tests/pixi/bet-picker-fit.test.ts,
// so hit-testing traverses the tree and resolves real targets (used by the risk-2 tests below).
{
  const proto = Container.prototype as unknown as { isInteractive?: () => boolean; interactiveChildren?: boolean };
  if (typeof proto.isInteractive !== 'function') {
    proto.isInteractive = function (this: Container) {
      return this.eventMode === 'static' || this.eventMode === 'dynamic';
    };
  }
  if (proto.interactiveChildren === undefined) proto.interactiveChildren = true;
}

function labels(node: { children: Array<{ label?: string; children?: unknown[] }> }): string[] {
  const out: string[] = [];
  const walk = (n: { label?: string; children?: unknown[] }): void => {
    if (n.label && (n.label.startsWith('menu-row-') || n.label === 'menu-sep')) out.push(n.label);
    for (const c of (n.children ?? []) as Array<{ label?: string; children?: unknown[] }>) walk(c);
  };
  walk(node as never);
  return out;
}

describe('Pixi bar menu', () => {
  it('renders the default rows in order', () => {
    const layer = openMenu(makeContext());
    expect(labels(layer as never)).toEqual([
      'menu-row-sound', 'menu-row-music', 'menu-row-sfx', 'menu-sep', 'menu-row-gameInfo',
    ]);
  });

  it('renders custom rows and runs a button callback', () => {
    const onSelect = vi.fn();
    const host = makeContext({
      menu: [
        { id: 'lefty', type: 'toggle', label: 'Left-hand', value: false },
        { id: 'paytable', type: 'button', label: 'Paytable', onSelect },
      ],
    });
    const layer = openMenu(host);
    expect(labels(layer as never)).toEqual(['menu-row-lefty', 'menu-row-paytable']);
    const row = findByLabel(layer as never, 'menu-row-paytable')!;
    row.emit('pointertap');
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('toggling a row writes through the host', () => {
    const host = makeContext({ menu: [{ id: 'lefty', type: 'toggle', label: 'L', value: false }] });
    const layer = openMenu(host);
    const row = findByLabel(layer as never, 'menu-row-lefty')!;
    const toggle = row.children.find((c: unknown) => c instanceof Toggle) as Toggle;
    toggle.emit('pointertap');
    expect(host.getMenuValue('lefty')).toBe(true);
  });
});

function findByLabel(n: any, label: string): any {
  if (n.label === label) return n;
  for (const c of n.children ?? []) {
    const hit = findByLabel(c, label);
    if (hit) return hit;
  }
  return null;
}

// ── Risk 1: IconView had no setIcon — the sound row's glyph swap silently no-op'd ──────────────
describe('Pixi bar menu — sound row icon swap (risk 1)', () => {
  it('swaps the sound row glyph when the menu-refresh hook fires (soundOn ↔ soundOff)', () => {
    let refresh: ((id: string, v: boolean | number) => void) | null = null;
    const host = makeContext({ setMenuRefresh: (fn) => { refresh = fn; } });
    const layer = openMenu(host);
    const row = findByLabel(layer as never, 'menu-row-sound')!;
    const icon = row.children.find((c: unknown) => c instanceof IconView) as IconView;
    // makeContext's default getMenuValue('sound') is true → resolveMenu's sound preset starts soundOn.
    expect(icon.iconName).toBe('soundOn');

    // openMenu registered its updater via host.setMenuRefresh — invoke it as the real controller
    // would after an external sound change (setSound / Shift+M), not by tapping a control here.
    refresh?.('sound', false);
    expect(icon.iconName).toBe('soundOff');

    refresh?.('sound', true);
    expect(icon.iconName).toBe('soundOn');
  });
});

// ── Risk 2: does an overflowing (masked) ScrollBox kill interactivity for ALL its rows? ─────────
// scroll.ts's own comment claims "a masked container blocks pointer events to its children in Pixi
// v8". tests/pixi/bet-picker-fit.test.ts already found that claim false for Chips in the bet picker
// (pixi.js 8.16+'s EventBoundary only prunes points OUTSIDE the mask). The menu is a different
// consumer of the same ScrollBox with a different row shape (toggles/sliders/buttons instead of
// chips), so it is verified again here, independently, using REAL hit-testing (not row.emit(), which
// bypasses Pixi's hitTest/mask machinery entirely and so could never observe this failure mode).
describe('Pixi bar menu — rows stay interactive under the scroll mask (risk 2)', () => {
  /** Populate worldTransform across the subtree (the render loop does this live; tests don't render). */
  function updateWorld(node: Container, parent: Matrix): void {
    node.updateLocalTransform();
    node.worldTransform.copyFrom(parent).append(node.localTransform);
    for (const c of node.children) updateWorld(c as Container, node.worldTransform);
  }

  function findScrollBox(n: Container): ScrollBox | null {
    if (n instanceof ScrollBox) return n;
    for (const c of n.children) {
      const hit = findScrollBox(c as Container);
      if (hit) return hit;
    }
    return null;
  }

  /** Hit-test the centre of a toggle's on-screen box; returns the resolved target (or null). */
  function hitCentre(stage: Container, toggle: Toggle): Container | null {
    const b = new EventBoundary(stage);
    const wt = toggle.worldTransform;
    const { w, h } = toggle.measureSize();
    return (b.hitTest(wt.tx + w / 2, wt.ty + h / 2) as Container) ?? null;
  }

  /** Build a menu with far more toggle rows than a short popover can show at once. */
  function mountOverflowing(): { stage: Container; layer: Container; scroll: ScrollBox; host: PixiComponentContext } {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `t${i}`,
      type: 'toggle' as const,
      label: `Row ${i}`,
      value: false,
    }));
    const host = makeContext({ menu: rows, screenW: 1200, screenH: 250 }); // short surface → forces overflow
    const layer = openMenu(host) as unknown as Container;
    const stage = new Container();
    stage.eventMode = 'static';
    stage.addChild(layer);
    updateWorld(stage, Matrix.IDENTITY);
    const scroll = findScrollBox(layer);
    if (!scroll) throw new Error('menu popover did not build a ScrollBox');
    return { stage, layer, scroll, host };
  }

  it('a row visible at the top of an overflowing (masked) list still responds to a real tap', () => {
    const { stage, layer, scroll, host } = mountOverflowing();
    expect(scroll.maxScrollY).toBeGreaterThan(0); // sanity: the mask really is active for this list

    const row0 = findByLabel(layer, 'menu-row-t0');
    const toggle0 = row0.children.find((c: unknown) => c instanceof Toggle) as Toggle;
    const hit = hitCentre(stage, toggle0);
    expect(hit).toBe(toggle0); // resolves to the control itself — not pruned by the mask

    hit!.emit('pointertap');
    expect(host.getMenuValue('t0')).toBe(true); // row.set() ran all the way through to the host
  });

  it('a row only reachable by scrolling is unreachable before, and clickable after, scrolling', () => {
    const { stage, layer, scroll, host } = mountOverflowing();
    const rowLast = findByLabel(layer, 'menu-row-t19');
    const toggleLast = rowLast.children.find((c: unknown) => c instanceof Toggle) as Toggle;

    // Before scrolling, the last row sits below the mask → hit-testing must NOT reach it (clipped).
    expect(hitCentre(stage, toggleLast)).toBeNull();

    // Scroll to the bottom and re-resolve world transforms (mirrors the real render loop).
    scroll.scrollBy(scroll.maxScrollY);
    updateWorld(stage, Matrix.IDENTITY);

    // Now the last row is inside the viewport → the mask lets the tap through to it.
    const hit = hitCentre(stage, toggleLast);
    expect(hit).toBe(toggleLast);
    hit!.emit('pointertap');
    expect(host.getMenuValue('t19')).toBe(true);
  });
});

// ── Finding 1 (fix round 1): the anchor must track a bar REPLACED after open, not the reference
// captured at open time. PixiRenderer.renderBar() destroys and rebuilds the BottomBar on every
// resize AND on ~20 other state changes, in the SAME resize handler that then repositions the open
// menu — so openMenu takes a getAnchor FUNCTION precisely so each reposition reads whichever bar is
// current, never a captured (possibly already-destroyed) instance. ─────────────────────────────────
describe('Pixi bar menu — anchor re-resolves after the bar is replaced (finding 1)', () => {
  it('follows a bar swapped in after open, not the one captured at open time', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    let current = { menuAnchor: () => ({ x: 100, y: 540, w: 40, h: 40 }) };
    const layer = openMenu(host, () => current.menuAnchor()) as unknown as Popover;
    expect(layer.arrowVisible).toBe(true);
    expect(layer.cardX).toBe(100);

    // Simulate PixiRenderer.renderBar(): the old bar is torn down and a brand-new one, at a
    // different position, takes its place — exactly what happens to the real BottomBar on the next
    // resize/bet/balance change while the menu stays open.
    current = { menuAnchor: () => ({ x: 300, y: 540, w: 40, h: 40 }) };
    layer.resize(1000, 600);

    expect(layer.arrowVisible).toBe(true);
    expect(layer.cardX).toBe(300); // tracks the NEW bar's rect, not the stale one from open time
  });

  it('recentres (arrow hidden) once the current bar reports no anchor, instead of freezing on the old one', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    let current: { menuAnchor(): { x: number; y: number; w: number; h: number } | null } | null = {
      menuAnchor: () => ({ x: 100, y: 540, w: 40, h: 40 }),
    };
    const layer = openMenu(host, () => current?.menuAnchor() ?? null) as unknown as Popover;
    expect(layer.arrowVisible).toBe(true);

    current = null; // e.g. the bar was destroyed and hasn't been rebuilt yet
    layer.resize(1000, 600);
    expect(layer.arrowVisible).toBe(false);
  });
});

// ── Defect 1 & 2: openMenu's PLATE (placement) vs POINTER (arrow only), and the shared bar-scale ──
describe('Pixi bar menu — plate drives placement, pointer drives only the arrow, scale matches the bar', () => {
  it('places the card by the injected PLATE and points the arrow at a distinct POINTER', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    const layer = openMenu(
      host,
      () => ({ x: 100, y: 516, w: 36, h: 36 }), // getAnchor — the burger (pointer)
      () => ({ x: 40, y: 500, w: 400, h: 70 }), // getPlate — the wide plaque
    ) as unknown as Popover;
    expect(layer.cardX).toBe(40); // plate's left, not the pointer's (100)
    expect(layer.arrowX).toBeCloseTo(118 - 40, 5); // pointer's centre, not the plate's
  });

  it('falls back to the pointer for placement when getPlate is omitted (today\'s single-rect behaviour)', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    const layer = openMenu(host, () => ({ x: 100, y: 540, w: 40, h: 40 })) as unknown as Popover;
    expect(layer.cardX).toBe(100);
    expect(layer.arrowVisible).toBe(true);
  });

  // Defect 4: a DEGENERATE (fully zero-sized) plate must fall back to the pointer exactly like a
  // null plate does — matching the DOM renderer's rectOf(), which treats {w:0,h:0} (e.g. a plaque
  // read before the bar's first layout pass) as unresolved. Before the fix, Pixi's `??` chain only
  // checked for null/undefined, so this real-but-zero-sized rect would win over a good pointer.
  it('falls back to the pointer when the plate resolves to a degenerate (zero-sized) rect', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    const layer = openMenu(
      host,
      () => ({ x: 100, y: 540, w: 40, h: 40 }), // getAnchor — a good pointer
      () => ({ x: 0, y: 0, w: 0, h: 0 }), // getPlate — degenerate
    ) as unknown as Popover;
    expect(layer.cardX).toBe(100); // the pointer's rect, not clamped/centred as if plate had "won"
    expect(layer.arrowVisible).toBe(true);
  });

  // A zero-HEIGHT (or zero-WIDTH) plate alone is still a REAL rect, per placePopover's own rule
  // (a not-yet-laid-out anchor). Only BOTH being zero counts as degenerate — this must keep winning
  // over the pointer, so the fix above doesn't overreach into the already-correct case.
  it('a plate with only one dimension at zero is still resolved (not degenerate)', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    const layer = openMenu(
      host,
      () => ({ x: 100, y: 540, w: 40, h: 40 }), // getAnchor — a distinct pointer
      () => ({ x: 40, y: 500, w: 400, h: 0 }), // getPlate — zero HEIGHT only, width is real
    ) as unknown as Popover;
    expect(layer.cardX).toBe(40); // the plate's x, not the pointer's (100)
  });

  it('re-resolves the PLATE getter on every reposition, tracking a bar rebuilt after open', () => {
    // Mirrors "Finding 1" above (which does this for the pointer/menuAnchor) — renderBar() destroys
    // and rebuilds the BottomBar the SAME way regardless of which rect a caller reads off it, so
    // menuPlate() needs the identical re-resolve-per-call treatment or a resize after rebuild would
    // silently keep placing the card at the stale bar's position.
    const host = makeContext({ screenW: 1000, screenH: 600 });
    let plate = { x: 40, y: 500, w: 400, h: 70 };
    const layer = openMenu(host, undefined, () => plate) as unknown as Popover;
    expect(layer.cardX).toBe(40);

    plate = { x: 200, y: 500, w: 400, h: 70 }; // e.g. renderBar() rebuilt the bar at a new position
    layer.resize(1000, 600);
    expect(layer.cardX).toBe(200);
  });

  it('scales the card by the injected getScale factor', () => {
    const host = makeContext({ screenW: 420, screenH: 600 });
    const layer = openMenu(
      host,
      () => ({ x: 190, y: 532, w: 36, h: 36 }),
      () => ({ x: 10, y: 520, w: 380, h: 60 }),
      () => 0.5,
    ) as unknown as Popover;
    expect(layer.card.scale.x).toBeCloseTo(0.5, 5);
  });

  // A real BottomBar (not a stub) actually exposes menuPlate()/fitScale() correctly, and openMenu
  // wired to it (mirroring PixiRenderer.openOverlay's 'menu' case) ends up scaled and placed by it.
  //
  // Defect 6 (review of the anchoring fix): the two assertions below used to be unable to fail.
  // `expect(s).toBe(bar.inner.scale.x)` is tautological — fitScale() is LITERALLY `return
  // this.inner.scale.x`, so this can never observe a real bug — and the cardX assertion re-derived
  // its own expectation from `bar.menuPlate()`, the very method under test. Both are replaced with
  // independently-derived expectations from the layout constants, so a real regression in either
  // method's arithmetic (wrong field, a missing `* s`, ...) would actually be caught.
  it('a real BottomBar exposes a usable menuPlate()/fitScale(), and openMenu positions by them', () => {
    const host = makeContext({ screenW: 420, screenH: 675, layout: 'wide' }); // narrow → forces fit-scale
    const bar = new BottomBar(host);
    bar.applyFit();

    // screenW(420) = BAR_REF_W(840)/2. The bar's design-width floor (MAX_BAR_W=850, minus 2*
    // OUTER_PAD=14 padding) means barW is ALWAYS ≥ 850 regardless of content, so the content-fit ratio
    // (W-28)/barW ≤ 392/850 ≈ 0.46 — strictly below BAR_MIN_SCALE(0.5) — for ANY content width. `s`
    // therefore lands exactly on the 0.5 floor: a known value derived from the layout constants alone,
    // not from the same `inner.scale.x` this assertion exists to verify was never independently
    // recomputed with different (possibly disagreeing) arithmetic.
    const s = bar.fitScale();
    expect(s).toBe(0.5);

    const plate = bar.menuPlate();
    expect(plate).not.toBeNull();
    expect(plate!.w).toBeGreaterThan(0);
    expect(plate!.h).toBeGreaterThan(0);

    // menuPlate().x = origin.x + panelX*s. panelX = OUTER_PAD(14) + buyW — this host's default config
    // has features.buyBonus: false and no onBonusBuy, so BUY BONUS doesn't render and buyW = 0, giving
    // panelX = 14. `origin.x` is read straight off the bar's OWN stored inner.position.x (not
    // re-derived via menuPlate() itself) — bar has no parent here, so its global position equals its
    // local one.
    const innerX = (bar as unknown as { inner: { position: { x: number } } }).inner.position.x;
    const PANEL_X = 14; // OUTER_PAD; no BUY BONUS badge in this config
    expect(plate!.x).toBeCloseTo(innerX + PANEL_X * s, 5);

    const layer = openMenu(
      host,
      () => bar.menuAnchor(),
      () => bar.menuPlate(),
      () => bar.fitScale(),
    ) as unknown as Popover;
    // clamped inside the surface margins exactly like placePopover always clamps x — a raw plate.x
    // this close to the left edge is expected to land on the margin floor, not the unclamped value.
    expect(layer.cardX).toBeCloseTo(Math.max(POPOVER.margin, plate!.x), 5);
    expect(layer.card.scale.x).toBeCloseTo(s, 5);
  });

  // Defect 3: menuPlate()/fitScale() lacked the `destroyed` guard menuAnchor() already has. Pixi v8's
  // Container.destroy() nulls `_position`/`_scale`, so `inner.scale.x` / `inner.getGlobalPosition()`
  // on a destroyed bar throws. Not reachable today (PixiRenderer destroys and reassigns `this.bar`
  // synchronously), but the asymmetry is a trap for a future caller.
  it('menuPlate()/fitScale() return the destroyed-safe fallback instead of throwing once torn down', () => {
    const host = makeContext({ screenW: 420, screenH: 675, layout: 'wide' });
    const bar = new BottomBar(host);
    bar.applyFit();
    expect(bar.menuPlate()).not.toBeNull();
    expect(bar.fitScale()).toBeGreaterThan(0);

    bar.destroy({ children: true });
    expect(() => bar.menuPlate()).not.toThrow();
    expect(bar.menuPlate()).toBeNull();
    expect(() => bar.fitScale()).not.toThrow();
    expect(bar.fitScale()).toBe(1);
  });
});

// ── Defect 1 (review of the anchoring fix): on mobile the controls row is 62px (M_CTRL_H) tall but
// the SPIN/FS hero is 84px, centred, so it pops (84-62)/2 = 11px above (and, separately, below) the
// row's own box. The plate the popover math used only ever covered the row's own 62px box, so the
// card's bottom — `gap`(8px) above the plate's top — clipped the top ~3px of the hero's arc (11-8=3).
// Fixed by extending the plate's TOP edge upward by the hero's pop-out amount (`pop`), so the plate
// is the row's true visual extent on the side that matters, without touching the wide layout (whose
// own pop(8) already exactly equals `gap`, so it never needed the fix) or the row's bottom edge
// (the info pill's own, separate concern). ──────────────────────────────────────────────────────────
describe('Pixi bar menu — mobile plate clears the popped-out hero (defect 1)', () => {
  const POP = 11; // (SPIN 84 − M_CTRL_H 62) / 2 — the hero's pop-out on each side of the row

  it("menuPlate()'s top matches the hero's true (popped-out) top, not the row's own lower top", () => {
    const host = makeContext({ layout: 'mobile', screenW: 375, screenH: 667 }); // mode: 'base' by default
    const bar = new BottomBar(host);
    bar.applyFit();

    const s = bar.fitScale();
    const origin = (bar as unknown as { inner: { getGlobalPosition(): { y: number } } }).inner.getGlobalPosition();
    // The hero is vertically centred over a row 22px shorter than itself (topPad === pop, by
    // construction — see applyFitMobile), so its own true top always sits at LOCAL y=0, i.e. exactly
    // at the bar's own origin — independent of this fix, which only changes what the PLATE reports.
    const heroTrueTop = origin.y;

    const plate = bar.menuPlate();
    expect(plate).not.toBeNull();
    expect(plate!.y).toBeCloseTo(heroTrueTop, 5);
    // Regression guard: the PRE-fix value (the row's own top, `pop` below the hero's true top) must
    // be clearly distinct — i.e. this assertion couldn't have passed by coincidence either way.
    expect(plate!.y).not.toBeCloseTo(heroTrueTop + POP * s, 1);
  });

  it('a real popover opened against the mobile bar clears the hero — its bottom never dips past the true top', () => {
    const host = makeContext({ layout: 'mobile', screenW: 375, screenH: 667 });
    const bar = new BottomBar(host);
    bar.applyFit();
    const origin = (bar as unknown as { inner: { getGlobalPosition(): { y: number } } }).inner.getGlobalPosition();
    const heroTrueTop = origin.y;

    const layer = openMenu(
      host,
      () => bar.menuAnchor(),
      () => bar.menuPlate(),
      () => bar.fitScale(),
    ) as unknown as Popover;
    // card.height reflects card.scale AND the arrow (which itself extends ~7px past the rounded
    // card body, pointing down at the plate/burger) — i.e. the card's FULL visual footprint, arrow
    // tip included. That footprint must never dip below the hero's true top.
    const cardBottom = layer.cardY + layer.card.height;
    expect(cardBottom).toBeLessThanOrEqual(heroTrueTop + 0.01);
  });

  it('the wide layout (whose plate already contains its content) is unaffected', () => {
    const host = makeContext({ layout: 'wide', screenW: 1200, screenH: 675 });
    const bar = new BottomBar(host);
    bar.applyFit();
    const plateWide = bar.menuPlate();
    // Wide's own hero pop (8px = SPIN_POP) already equals POPOVER.gap (8px) — the fix only ever
    // touches applyFitMobile's plateRect computation, so the wide plate's y is the panel's own,
    // un-extended top exactly as before.
    const origin = (bar as unknown as { inner: { getGlobalPosition(): { y: number } } }).inner.getGlobalPosition();
    const s = bar.fitScale();
    const SPIN_POP_WIDE = 8; // (SPIN 84 − BAR_H 68) / 2
    expect(plateWide!.y).toBeCloseTo(origin.y + SPIN_POP_WIDE * s, 5);
  });
});

// ── Finding 2 (fix round 1): row.disabled was ignored for toggle and range rows — the button
// branch dimmed + skipped wiring, but a disabled custom toggle/range item rendered fully interactive
// and wrote through, unlike the DOM renderer, which sets the native `disabled` attribute on both. ──
describe('Pixi bar menu — disabled toggle/range rows do not write through (finding 2)', () => {
  it('a disabled toggle row is dimmed, non-hit-testable, and ignores a direct tap', () => {
    const host = makeContext({ menu: [{ id: 'x', type: 'toggle', label: 'X', disabled: true }] });
    const layer = openMenu(host);
    const row = findByLabel(layer as never, 'menu-row-x')!;
    expect(row.alpha).toBe(0.5);
    const toggle = row.children.find((c: unknown) => c instanceof Toggle) as Toggle;
    expect(toggle.eventMode).toBe('none');
    toggle.emit('pointertap'); // even a direct emit (bypassing hit-testing) must not write through
    expect(host.getMenuValue('x')).toBeUndefined(); // never written — the disabled row ignored the tap
  });

  it('a disabled range row is dimmed, non-hit-testable, and ignores a direct drag', () => {
    const host = makeContext({ menu: [{ id: 'y', type: 'range', label: 'Y', min: 0, max: 1, disabled: true }] });
    const layer = openMenu(host);
    const row = findByLabel(layer as never, 'menu-row-y')!;
    expect(row.alpha).toBe(0.5);
    const slider = row.children.find((c: unknown) => c instanceof Slider) as Slider;
    expect(slider.eventMode).toBe('none');
    expect(host.getMenuValue('y')).toBeUndefined(); // nothing has written to it yet
    slider.emit('pointerdown', { global: { x: 99999, y: 0 } } as any); // would normally start a drag
    expect(host.getMenuValue('y')).toBeUndefined(); // still nothing — the disabled row ignored it
  });
});

// ── Finding 3 (fix round 1): the slider snapped to a bare multiple of `step`, ignoring the `min`
// offset — wrong whenever min isn't itself a multiple of step, which the default step (span/20)
// makes the common case. A far-left drag on { min: 1, max: 10 } (step 0.45) used to emit 0.9. ──────
describe('Pixi bar menu — range slider snaps to the min-anchored lattice (finding 3)', () => {
  it('dragging to the far left/right emits exactly min/max, not an off-lattice value below min', () => {
    const host = makeContext({ menu: [{ id: 'r', type: 'range', label: 'R', min: 1, max: 10 }] });
    const layer = openMenu(host);
    const row = findByLabel(layer as never, 'menu-row-r')!;
    const slider = row.children.find((c: unknown) => c instanceof Slider) as Slider;

    slider.emit('pointerdown', { global: { x: -99999, y: 0 } } as any); // drag to the far left (u → 0)
    expect(host.getMenuValue('r')).toBe(1); // exactly min — the old formula gave 0.9

    slider.emit('pointerdown', { global: { x: 99999, y: 0 } } as any); // drag to the far right (u → 1)
    expect(host.getMenuValue('r')).toBe(10); // exactly max, still on the lattice
  });
});

// ── Defect 2 (review of the anchoring fix): renderBar() re-fits the bar (barScale + plate can
// change) on ~20 state changes, but only the RESIZE hook (onResize) used to reposition an open
// popover — so a live bar-content change while the menu was open (e.g. a WIN pill appearing
// mid-autoplay, which can retrigger the overflow-tightening branch) left the card at the old
// scale/position until the next resize. Tested at the PixiRenderer level (not just Popover/BottomBar
// in isolation) since the defect is specifically in the WIRING between renderBar() and the open
// layer — mirrors tests/pixi/mount-layout.test.ts's ShellController+PixiRenderer+fake-Application
// pattern. ──────────────────────────────────────────────────────────────────────────────────────────
describe('Pixi bar menu — renderBar() repositions an already-open popover (defect 2)', () => {
  const stubTicker = { add() {}, remove() {} };

  function fakeApp(w: number, h: number): Application {
    return {
      screen: { width: w, height: h },
      ticker: stubTicker,
      renderer: { on() {}, off() {} },
      stage: new Container(),
    } as unknown as Application;
  }

  function mountShell(w: number, h: number): { controller: ShellController; renderer: PixiRenderer } {
    const renderer = new PixiRenderer({ app: fakeApp(w, h), parent: new Container() });
    const controller = new ShellController({
      renderer,
      language: 'en',
      currency: { symbol: '€', position: 'left' },
      availableBets: [0.5, 1, 2, 5],
      defaultBet: 1,
      currentBet: null,
      balance: 100,
      win: 0,
      mode: 'base',
      gameInfo: {},
      // Rich enough (auto + turbo + buy, matching mount-layout.test.ts's feature set) that the wide
      // layout's content width sits close to the MAX_BAR_W design floor — so adding a WIN readout
      // measurably shifts the bar's own centring, not just its (already content-independent) scale.
      features: { turbo: 3, autoplay: {}, buyBonus: {} },
    });
    return { controller, renderer };
  }

  it('a state change that triggers renderBar() (not a resize) repositions the open menu popover', () => {
    const { controller, renderer } = mountShell(1400, 675); // wide, well above BAR_REF_W(840) → s=1 baseline
    controller.actions.openMenu();

    const priv = renderer as unknown as { currentLayer: Popover | null };
    expect(priv.currentLayer).not.toBeNull();
    // Spy WITHOUT replacing the implementation — the real resize() must still run so the card's
    // geometry genuinely updates, not just get observed as "called".
    const resizeSpy = vi.spyOn(priv.currentLayer!, 'resize');
    const beforeX = priv.currentLayer!.cardX;

    // Leaving base mode (e.g. entering free spins) drops the whole BUY BONUS badge from the wide
    // panel — `this.buy = isBase ? … : undefined` — which shrinks panelX (OUTER_PAD + buyW) by
    // BUY_W+ROW_GAP (81px), a guaranteed, content-metric-independent shift. This is exactly the
    // "same renderBar(), different content" class of change the review calls out (its own example —
    // a WIN pill appearing mid-autoplay — shifts the SAME panelX-relative geometry, just by a much
    // smaller, FlexBox-text-metric-dependent amount that isn't reliably assertable byte-for-byte
    // here). setMode() calls renderer.renderBar() directly — no resize/onResize involved.
    controller.setMode('freeSpins');

    expect(resizeSpy).toHaveBeenCalledWith(1400, 675); // the mechanism: renderBar() invoked it
    // Outcome: BUY BONUS disappearing shifts the panel's own left edge — the card actually followed
    // to the NEW position, not a stale one.
    expect(priv.currentLayer!.cardX).not.toBe(beforeX);
  });

  it('does not throw when renderBar() runs with no layer open', () => {
    const { controller } = mountShell(1400, 675);
    expect(() => controller.setWin(25, { animate: false })).not.toThrow();
  });
});
