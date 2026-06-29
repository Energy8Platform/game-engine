import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
// @vitest-environment jsdom
/**
 * Task 11: Keyboard scrolling in overlays.
 *
 * Tests:
 * 1. ScrollBox.scrollBy(dy) adjusts offset clamped to [-maxScroll, 0].
 * 2. scrollBy with large negative value clamps to top (0).
 * 3. scrollBy with large positive value clamps to bottom (-maxScroll).
 * 4. Overlay.onKey: ArrowDown scrolls by ~60px.
 * 5. Overlay.onKey: ArrowUp scrolls back.
 * 6. Overlay.onKey: PageDown scrolls by ~0.9 × viewH.
 * 7. Overlay.onKey: End jumps to bottom.
 * 8. Overlay.onKey: Home jumps to top.
 * 9. Overlay.onKey: Space scrolls page down.
 * 10. Overlay.onKey: Shift+Space scrolls page up.
 * 11. Overlay.onKey returns true for scroll keys.
 * 12. Overlay.onKey returns false for unhandled keys.
 */
import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import type { PixiComponentContext } from '@/ui/pixi/context';
import { ScrollBox } from '@/ui/pixi/primitives/scroll';
import { Overlay } from '@/ui/pixi/primitives/overlay';
import { makeContext, defaultConfig, type HostOverrides } from './_host';

function makeHost(over: HostOverrides = {}): PixiComponentContext {
  return makeContext({ config: defaultConfig({ availableBets: [1], features: { turbo: 0, autoplay: {}, buyBonus: false } }), screenW: 800, screenH: 600, ...over });
}

const key = (code: string, shift = false): KeyboardEvent =>
  new KeyboardEvent('keydown', { code, shiftKey: shift, bubbles: true, cancelable: true });

// ─── ScrollBox.scrollBy ──────────────────────────────────────────────────────

describe('ScrollBox.scrollBy', () => {
  function makeScrollBox(contentH: number, viewH: number): ScrollBox {
    const sb = new ScrollBox();
    // Override getLocalBounds on the content container so ScrollBox.refresh() measures correctly
    (sb.content as any).getLocalBounds = () => ({ x: 0, y: 0, width: 200, height: contentH });
    sb.setViewport(200, viewH);
    return sb;
  }

  it('scrollBy(60) moves the scroll offset by 60 (positive dy = scroll down)', () => {
    const sb = makeScrollBox(400, 200); // maxScroll = 200
    sb.scrollBy(60);
    // content.y should be -60
    expect(sb.content.y).toBe(-60);
  });

  it('scrollBy clamps to maxScroll at the bottom', () => {
    const sb = makeScrollBox(400, 200); // maxScroll = 200
    sb.scrollBy(99999);
    expect(sb.content.y).toBe(-200);
  });

  it('scrollBy with large negative value clamps to top (0)', () => {
    const sb = makeScrollBox(400, 200);
    sb.scrollBy(100); // scroll down first
    sb.scrollBy(-99999); // then scroll back past top
    expect(sb.content.y).toBe(0);
  });

  it('scrollBy multiple times accumulates correctly', () => {
    const sb = makeScrollBox(400, 200); // maxScroll = 200
    sb.scrollBy(60);
    sb.scrollBy(60);
    expect(sb.content.y).toBe(-120);
  });

  it('maxScrollY is correct', () => {
    const sb = makeScrollBox(400, 200);
    expect(sb.maxScrollY).toBe(200);
  });
});

// ─── Overlay.onKey ──────────────────────────────────────────────────────────

describe('Overlay.onKey', () => {
  function makeOverlay(contentH = 1200, viewH = 600): Overlay {
    const host = makeHost({ screenH: viewH, screenW: 800 });
    // Build a tall content so it overflows and maxScroll > 0
    const overlay = new Overlay(host, {
      tag: 'test',
      title: 'Test Overlay',
      onClose: () => {},
      build: (w) => {
        const c = new Container();
        // Override getLocalBounds so ScrollBox.refresh() measures a tall content
        (c as any).getLocalBounds = () => ({ x: 0, y: 0, width: w, height: contentH });
        return c;
      },
    });
    // Also override on the scroll.content after layout, in case the child measurement
    // doesn't propagate through Pixi's getLocalBounds aggregation under jsdom
    (overlay.scrollContent.content as any).getLocalBounds = () => ({ x: 0, y: 0, width: 800, height: contentH });
    // Force a refresh so the overridden bounds take effect
    overlay.scrollContent.refresh();
    return overlay;
  }

  it('onKey(ArrowDown) scrolls down ~60px and returns true', () => {
    const overlay = makeOverlay();
    const before = overlay.scrollContent.content.y;
    const result = overlay.onKey(key('ArrowDown'));
    expect(result).toBe(true);
    expect(overlay.scrollContent.content.y).toBe(before - 60);
  });

  it('onKey(ArrowUp) scrolls up ~60px and returns true', () => {
    const overlay = makeOverlay();
    // First scroll down
    overlay.onKey(key('ArrowDown'));
    overlay.onKey(key('ArrowDown'));
    const before = overlay.scrollContent.content.y;
    const result = overlay.onKey(key('ArrowUp'));
    expect(result).toBe(true);
    expect(overlay.scrollContent.content.y).toBe(before + 60);
  });

  it('onKey(PageDown) scrolls by ~0.9×viewport height', () => {
    const overlay = makeOverlay(1200, 600);
    const before = overlay.scrollContent.content.y;
    const result = overlay.onKey(key('PageDown'));
    expect(result).toBe(true);
    // 0.9 × (600 - headerH) ≈ some positive scroll; just verify it moved more than ArrowDown
    const delta = before - overlay.scrollContent.content.y;
    expect(delta).toBeGreaterThan(60);
  });

  it('onKey(End) jumps to the bottom and returns true', () => {
    const overlay = makeOverlay();
    const result = overlay.onKey(key('End'));
    expect(result).toBe(true);
    expect(overlay.scrollContent.content.y).toBe(-overlay.scrollContent.maxScrollY);
  });

  it('onKey(Home) jumps to the top and returns true', () => {
    const overlay = makeOverlay();
    overlay.onKey(key('End')); // first go to bottom
    const result = overlay.onKey(key('Home'));
    expect(result).toBe(true);
    // Use Math.abs to handle -0 === 0 (JavaScript -0 quirk with Object.is)
    expect(Math.abs(overlay.scrollContent.content.y)).toBe(0);
  });

  it('onKey(Space) scrolls down a page and returns true', () => {
    const overlay = makeOverlay();
    const before = overlay.scrollContent.content.y;
    const result = overlay.onKey(key('Space'));
    expect(result).toBe(true);
    expect(overlay.scrollContent.content.y).toBeLessThan(before);
  });

  it('onKey(Space+Shift) scrolls up a page and returns true', () => {
    const overlay = makeOverlay();
    overlay.onKey(key('End')); // go to bottom
    const before = overlay.scrollContent.content.y;
    const result = overlay.onKey(key('Space', true));
    expect(result).toBe(true);
    expect(overlay.scrollContent.content.y).toBeGreaterThan(before);
  });

  it('onKey returns false for unhandled keys', () => {
    const overlay = makeOverlay();
    expect(overlay.onKey(key('KeyA'))).toBe(false);
    expect(overlay.onKey(key('Tab'))).toBe(false);
    expect(overlay.onKey(key('Enter'))).toBe(false);
  });
});
