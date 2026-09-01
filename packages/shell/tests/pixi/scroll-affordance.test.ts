import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
// @vitest-environment jsdom
/**
 * Scroll affordance in the Pixi shell.
 *
 * This is the renderer a scaffolded game actually ships with, and it was the worse of the two: a
 * ScrollBox masks, drags and takes the wheel, and drew nothing at all to say so. Stake rejected a
 * build over it in Popout S (400×225), where the game-info overlay holds twelve screens and the
 * buy-bonus stacks its cards taller than the frame.
 *
 * The view keeps its geometry readable (`thumbBounds`, `cueVisible`, `visible`) so these tests
 * assert what a player would SEE, not which Graphics calls were issued.
 */
import { describe, it, expect } from 'vitest';
import { ScrollAffordanceView, scrimRamp } from '@/ui/pixi/primitives/scroll-affordance';
import { ScrollBox } from '@/ui/pixi/primitives/scroll';
import { scrollHint } from '@/core/scrollHint';
import { openBuyBonus } from '@/ui/pixi/components/BuyBonus';
import type { BonusOption } from '@/core/types';
import { makeContext, defaultConfig } from './_host';

function view(): ScrollAffordanceView {
  return new ScrollAffordanceView();
}

describe('ScrollAffordanceView — visibility', () => {
  it('draws nothing for a region that fits', () => {
    const v = view();
    v.update({ x: 0, y: 0, w: 300, h: 200, axis: 'y' }, scrollHint({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 }));
    expect(v.visible).toBe(false);
    expect(v.thumbBounds).toBeNull();
  });

  it('appears once the content overflows', () => {
    const v = view();
    v.update({ x: 0, y: 0, w: 300, h: 200, axis: 'y' }, scrollHint({ scrollTop: 0, scrollHeight: 900, clientHeight: 200 }));
    expect(v.visible).toBe(true);
    expect(v.thumbBounds).not.toBeNull();
  });

  it('goes quiet again when a resize removes the overflow', () => {
    const v = view();
    v.update({ x: 0, y: 0, w: 300, h: 200, axis: 'y' }, scrollHint({ scrollTop: 0, scrollHeight: 900, clientHeight: 200 }));
    v.update({ x: 0, y: 0, w: 300, h: 900, axis: 'y' }, scrollHint({ scrollTop: 0, scrollHeight: 900, clientHeight: 900 }));
    expect(v.visible).toBe(false);
    expect(v.cueVisible).toBe(false);
  });
});

describe('ScrollAffordanceView — thumb geometry', () => {
  const LAYOUT = { x: 0, y: 40, w: 300, h: 200, axis: 'y' } as const;

  it('puts the thumb against the right edge of the viewport it describes', () => {
    const v = view();
    v.update(LAYOUT, scrollHint({ scrollTop: 0, scrollHeight: 400, clientHeight: 200 }));
    const t = v.thumbBounds!;
    expect(t.x + t.w).toBeLessThanOrEqual(LAYOUT.x + LAYOUT.w);
    expect(t.x).toBeGreaterThan(LAYOUT.x + LAYOUT.w - 20);
  });

  it('starts the thumb at the top of the track and keeps it inside', () => {
    const v = view();
    v.update(LAYOUT, scrollHint({ scrollTop: 0, scrollHeight: 400, clientHeight: 200 }));
    const t = v.thumbBounds!;
    expect(t.y).toBeGreaterThanOrEqual(LAYOUT.y);
    expect(t.y + t.h).toBeLessThanOrEqual(LAYOUT.y + LAYOUT.h);
  });

  it('moves the thumb down as the content scrolls', () => {
    const v = view();
    v.update(LAYOUT, scrollHint({ scrollTop: 0, scrollHeight: 400, clientHeight: 200 }));
    const top = v.thumbBounds!.y;
    v.update(LAYOUT, scrollHint({ scrollTop: 200, scrollHeight: 400, clientHeight: 200 }));
    const bottom = v.thumbBounds!.y;
    expect(bottom).toBeGreaterThan(top);
    expect(v.thumbBounds!.y + v.thumbBounds!.h).toBeLessThanOrEqual(LAYOUT.y + LAYOUT.h + 0.01);
  });

  it('lays the thumb along the bottom edge on a horizontal region', () => {
    const v = view();
    const layout = { x: 0, y: 40, w: 300, h: 200, axis: 'x' } as const;
    v.update(layout, scrollHint({ scrollTop: 0, scrollHeight: 900, clientHeight: 300 }));
    const t = v.thumbBounds!;
    expect(t.w).toBeGreaterThan(t.h);
    expect(t.y + t.h).toBeLessThanOrEqual(layout.y + layout.h);
  });

  it('keeps a deep-content thumb visibly long rather than a speck', () => {
    // Game info at Popout S: 2843px of content in a 226px viewport.
    const v = view();
    v.update({ x: 0, y: 0, w: 400, h: 226, axis: 'y' }, scrollHint({ scrollTop: 0, scrollHeight: 2843, clientHeight: 226 }));
    expect(v.thumbBounds!.h).toBeGreaterThan(30);
  });
});

describe('scrimRamp — the edge fade', () => {
  it('is densest AT the edge and fades inward, not the other way round', () => {
    // Inverted, this draws a hard-edged dark band floating over the content instead of a fade.
    const r = scrimRamp(34);
    expect(r[0].offset).toBe(0);
    expect(r[0].alpha).toBeGreaterThan(r[r.length - 1].alpha);
  });

  it('decreases monotonically all the way in', () => {
    const r = scrimRamp(34);
    for (let i = 1; i < r.length; i++) expect(r[i].alpha).toBeLessThan(r[i - 1].alpha);
  });

  it('reaches (near) zero at the inner end, so there is no step back to bare content', () => {
    const r = scrimRamp(34);
    expect(r[r.length - 1].alpha).toBeLessThan(0.01);
  });

  it('tiles the depth exactly — no gap and no overlap between slices', () => {
    const r = scrimRamp(34);
    for (let i = 1; i < r.length; i++) {
      expect(r[i].offset).toBeCloseTo(r[i - 1].offset + r[i - 1].thickness, 6);
    }
    const last = r[r.length - 1];
    expect(last.offset + last.thickness).toBeCloseTo(34, 6);
  });

  it('slices about a pixel at a time, so nothing bands', () => {
    expect(scrimRamp(34).every((s) => s.thickness <= 1.01)).toBe(true);
  });

  it('still produces a usable ramp for a hairline depth', () => {
    const r = scrimRamp(0.4);
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.every((s) => Number.isFinite(s.alpha) && s.alpha >= 0)).toBe(true);
  });
});

describe('ScrollAffordanceView — the chevron cue', () => {
  const LAYOUT = { x: 0, y: 0, w: 300, h: 200, axis: 'y' } as const;
  const deep = (scrollTop: number) => scrollHint({ scrollTop, scrollHeight: 900, clientHeight: 200 });

  it('shows the cue on an overflowing region at rest', () => {
    const v = view();
    v.update(LAYOUT, deep(0));
    expect(v.cueVisible).toBe(true);
  });

  it('hides the cue once the player has scrolled off the top', () => {
    const v = view();
    v.update(LAYOUT, deep(0));
    v.update(LAYOUT, deep(120));
    expect(v.cueVisible).toBe(false);
  });

  it('does not re-offer the cue after the player scrolls back to the top', () => {
    const v = view();
    v.update(LAYOUT, deep(0));
    v.update(LAYOUT, deep(120));
    v.update(LAYOUT, deep(0));
    expect(v.cueVisible).toBe(false);
  });

  it('never shows a cue for a region that fits', () => {
    const v = view();
    v.update(LAYOUT, scrollHint({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 }));
    expect(v.cueVisible).toBe(false);
  });
});

describe('ScrollBox wears the affordance', () => {
  function box(contentH: number, viewH: number): ScrollBox {
    const sb = new ScrollBox();
    (sb.content as unknown as { getLocalBounds: () => object }).getLocalBounds = () => ({ x: 0, y: 0, width: 200, height: contentH });
    sb.setViewport(200, viewH);
    return sb;
  }

  it('advertises itself when the content overflows', () => {
    const sb = box(900, 200);
    expect(sb.affordance.visible).toBe(true);
    expect(sb.affordance.cueVisible).toBe(true);
  });

  it('stays silent when the content fits', () => {
    const sb = box(150, 200);
    expect(sb.affordance.visible).toBe(false);
  });

  it('tracks the thumb to the scroll position', () => {
    const sb = box(900, 200);
    const top = sb.affordance.thumbBounds!.y;
    sb.scrollBy(400);
    expect(sb.affordance.thumbBounds!.y).toBeGreaterThan(top);
  });

  it('drops the cue once the box has been scrolled', () => {
    const sb = box(900, 200);
    sb.scrollBy(60);
    expect(sb.affordance.cueVisible).toBe(false);
  });

  it('draws the affordance above the scrolling content, not under it', () => {
    const sb = box(900, 200);
    const iContent = sb.getChildIndex(sb.content);
    const iAff = sb.getChildIndex(sb.affordance);
    expect(iAff).toBeGreaterThan(iContent);
  });

  it('is not clipped by the content mask — the mask covers content only', () => {
    const sb = box(900, 200);
    expect(sb.affordance.mask).toBeFalsy();
  });

  it('re-evaluates on refresh when the content shrinks to fit', () => {
    const sb = box(900, 200);
    expect(sb.affordance.visible).toBe(true);
    (sb.content as unknown as { getLocalBounds: () => object }).getLocalBounds = () => ({ x: 0, y: 0, width: 200, height: 120 });
    sb.refresh();
    expect(sb.affordance.visible).toBe(false);
  });
});

// ─── the case Stake screenshotted ────────────────────────────────────────────

const BONUSES: BonusOption[] = [
  { id: 'ante', type: 'feature', title: 'Ante bet', description: '+25% to trigger frequency', priceMultiplier: 1.5, volatility: 2 },
  { id: 'buy10', type: 'bonus', title: 'Buy Free Spins', description: '10 spins', priceMultiplier: 100, volatility: 4 },
  { id: 'buy20', type: 'bonus', title: 'Super Free Spins', description: '20 spins', priceMultiplier: 400, volatility: 5 },
];

function buyBonusAt(w: number, h: number): { scrollCue: ScrollAffordanceView } {
  const host = makeContext({
    config: defaultConfig({
      availableBets: [1, 2, 5], defaultBet: 1, balance: 1_000_000,
      features: { turbo: 0, autoplay: {}, buyBonus: BONUSES },
    }),
    screenW: w,
    screenH: h,
  });
  return openBuyBonus(host) as unknown as { scrollCue: ScrollAffordanceView };
}

describe('buy-bonus in a Stake popout', () => {
  it('announces the stacked cards that run past the bottom of a 400×225 frame', () => {
    // Below SHORT_STACK_H the cards stack and the band scrolls vertically — the exact screen
    // Stake sent back, where the price and the Buy button sat below the fold unannounced.
    const { scrollCue } = buyBonusAt(400, 225);
    expect(scrollCue.visible).toBe(true);
    expect(scrollCue.cueVisible).toBe(true);
  });

  it('stays silent on a desktop frame where every card fits', () => {
    const { scrollCue } = buyBonusAt(1200, 675);
    expect(scrollCue.visible).toBe(false);
  });
});
