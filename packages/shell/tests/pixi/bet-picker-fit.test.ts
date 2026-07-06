import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
// @vitest-environment jsdom
/**
 * Bet picker fit: when a wide currency makes the bet labels grow, the Pixi shell must (a) reflow to
 * fewer columns so no chip is clipped horizontally, and (b) cap the grid height with a scroll region
 * so every bet stays reachable — parity with the HTML shell's `auto-fill minmax` + `overflow-y:auto`.
 *
 * The load-bearing claim is that chips stay CLICKABLE under the scroll mask (the ScrollBox comment
 * warned masks block pointer events in Pixi v8; pixi.js 8.16's EventBoundary only prunes points
 * OUTSIDE the mask). We prove it by hit-testing a chip that is only reachable after scrolling.
 */
import { describe, it, expect } from 'vitest';
import { Container, EventBoundary, Matrix } from 'pixi.js';
import { openBetPicker } from '@/ui/pixi/components/pickers';
import { ScrollBox } from '@/ui/pixi/primitives/scroll';
import { Chip } from '@/ui/pixi/primitives/controls';
import { makeContext, defaultConfig } from './_host';

// The events mixin (isInteractive(), interactiveChildren, …) is applied to Container.prototype by
// the renderer's EventSystem, which never initialises in these render-less tests — so EventBoundary
// finds interactiveChildren undefined (skips all children) and isInteractive missing (throws).
// Polyfill both with their real defaults so hit-testing traverses and resolves targets.
{
  const proto = Container.prototype as unknown as { isInteractive?: () => boolean; interactiveChildren?: boolean };
  if (typeof proto.isInteractive !== 'function') {
    proto.isInteractive = function (this: Container) {
      return this.eventMode === 'static' || this.eventMode === 'dynamic';
    };
  }
  if (proto.interactiveChildren === undefined) proto.interactiveChildren = true;
}

// A wide currency: symbol + grouped thousands + 2 decimals → labels like "₦1.000.000,00".
const wideFmt = (n: number): string => `₦${n.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`;
const MANY_BETS = [
  10, 20, 50, 100, 200, 400, 600, 800, 1_000, 1_200, 1_400, 1_600, 1_800, 2_000, 3_000, 4_000,
  5_000, 6_000, 7_000, 8_000, 9_000, 10_000, 12_000, 14_000, 16_000, 18_000, 20_000, 30_000,
  40_000, 50_000, 75_000, 100_000, 150_000, 200_000, 250_000, 300_000, 350_000, 400_000, 450_000,
  500_000, 750_000, 1_000_000,
];

function collect<T extends Container>(root: Container, pred: (n: Container) => n is T): T[] {
  const out: T[] = [];
  const walk = (n: Container): void => {
    if (pred(n)) out.push(n);
    for (const c of n.children) walk(c as Container);
  };
  walk(root);
  return out;
}

const isChip = (n: Container): n is Chip => n instanceof Chip;
const isScroll = (n: Container): n is ScrollBox => n instanceof ScrollBox;

/** Populate worldTransform across the subtree (the render loop does this live; tests don't render). */
function updateWorld(node: Container, parent: Matrix): void {
  node.updateLocalTransform();
  node.worldTransform.copyFrom(parent).append(node.localTransform);
  for (const c of node.children) updateWorld(c as Container, node.worldTransform);
}

function mountWide(): { stage: Container; layer: Container; chips: Chip[]; scroll?: ScrollBox } {
  const host = makeContext({
    config: defaultConfig({
      availableBets: MANY_BETS,
      defaultBet: 1_000,
      currentBet: 1_000,
      features: { turbo: 0, autoplay: {}, buyBonus: false },
    }),
    fmt: wideFmt,
    formatCurrency: wideFmt,
    screenW: 1200,
    screenH: 675,
  });
  const layer = openBetPicker(host) as unknown as Container;
  const stage = new Container();
  stage.eventMode = 'static';
  stage.addChild(layer);
  updateWorld(stage, Matrix.IDENTITY);
  return { stage, layer, chips: collect(layer, isChip), scroll: collect(layer, isScroll)[0] };
}

/** Columns = size of the widest chip row (chips grouped by their row container). */
function columnCount(chips: Chip[]): number {
  const perRow = new Map<Container, number>();
  for (const c of chips) perRow.set(c.parent as Container, (perRow.get(c.parent as Container) ?? 0) + 1);
  return Math.max(...perRow.values());
}

/** Hit-test the centre of a chip's on-screen box; returns the resolved target (or null). */
function hitCentre(stage: Container, chip: Chip): Container | null {
  const b = new EventBoundary(stage);
  const wt = chip.worldTransform;
  const { w, h } = chip.measureSize();
  return (b.hitTest(wt.tx + w / 2, wt.ty + h / 2) as Container) ?? null;
}

const chipAncestor = (n: Container | null): boolean => {
  for (let p: Container | null = n; p; p = p.parent as Container | null) if (p instanceof Chip) return true;
  return false;
};

describe('bet picker — wide-currency fit (Pixi)', () => {
  it('reflows to fewer than the max 6 columns so wide labels are not clipped', () => {
    const { chips } = mountWide();
    expect(chips.length).toBe(MANY_BETS.length);
    expect(columnCount(chips)).toBeLessThan(6); // dropped below the 6-wide max to fit the labels
  });

  it('caps the grid height with a scrollable region when the ladder overflows', () => {
    const { scroll } = mountWide();
    expect(scroll).toBeDefined();
    expect(scroll!.maxScrollY).toBeGreaterThan(0);
  });

  it('a chip only reachable by scrolling is still clickable under the mask', () => {
    const { stage, chips, scroll } = mountWide();
    const last = chips[chips.length - 1];

    // Before scrolling, the last chip sits below the mask → hit-testing must NOT reach it (clipped).
    expect(chipAncestor(hitCentre(stage, last))).toBe(false);

    // Scroll to the bottom and re-resolve world transforms.
    scroll!.scrollBy(scroll!.maxScrollY);
    updateWorld(stage, Matrix.IDENTITY);

    // Now the last chip is inside the viewport → the mask lets the click through to it.
    const hit = hitCentre(stage, last);
    expect(chipAncestor(hit)).toBe(true);
  });

  it('a normal-width currency keeps the compact layout with no scroll region', () => {
    const host = makeContext({
      config: defaultConfig({
        availableBets: [0.2, 0.5, 1, 2, 5, 10, 20, 50],
        defaultBet: 1,
        features: { turbo: 0, autoplay: {}, buyBonus: false },
      }),
      screenW: 1200,
      screenH: 675,
    });
    const layer = openBetPicker(host) as unknown as Container;
    const chips = collect(layer, isChip);
    expect(columnCount(chips)).toBe(6); // unchanged — short labels still pack the 6-wide max
    expect(collect(layer, isScroll).length).toBe(0); // fits → no mask/scroll needed
  });
});
