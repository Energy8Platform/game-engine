import './setup-canvas';
import { describe, it, expect, vi } from 'vitest';
import { Container, EventBoundary, Matrix } from 'pixi.js';
import { openMenu } from '@/ui/pixi/components/Menu';
import { Toggle } from '@/ui/pixi/primitives/controls';
import { ScrollBox } from '@/ui/pixi/primitives/scroll';
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
