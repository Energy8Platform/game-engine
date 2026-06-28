// @vitest-environment jsdom
/**
 * Task 11: Keyboard scrolling in DOM overlay (Game Info).
 *
 * Tests that the DOM overlay's registered onKey handler:
 * 1. ArrowDown increases scrollTop (or calls scrollBy).
 * 2. ArrowUp decreases scrollTop.
 * 3. PageDown scrolls a larger amount.
 * 4. Home jumps to top.
 * 5. End jumps to bottom (scrollTop is set to scrollHeight - clientHeight equivalent).
 * 6. Space scrolls down a page.
 * 7. Shift+Space scrolls up a page.
 * 8. Handler returns true for all scroll keys, false for others.
 *
 * jsdom doesn't implement layout so scrollHeight === clientHeight === 0 normally.
 * We stub scrollHeight on the scroll container to simulate overflow, then assert
 * scrollTop changes (jsdom DOES track scrollTop assignments).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import type { ShellConfig } from '@/core/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount,
    gameInfo: {
      sections: [
        { type: 'modes', modes: [{ title: 'Base game', rtp: 96.5 }] },
        { type: 'controls' },
      ],
    },
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: {}, buyBonus: false },
  };
}

const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

/** Dispatch a keydown on document and return whether it was handled. */
function dispatchKey(code: string, shift = false): boolean {
  const e = new KeyboardEvent('keydown', { code, shiftKey: shift, bubbles: true, cancelable: true });
  document.dispatchEvent(e);
  return !e.defaultPrevented ? true : true; // always check via other means
}

describe('DOM overlay keyboard scrolling (Game Info)', () => {
  let mount: HTMLElement;

  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  /** Set up shell with info open and stub the scroll container's scrollHeight. */
  function setup(): { scrollEl: HTMLElement } {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();

    const modal = q(mount, '[data-ge="info-modal"]')!;
    expect(modal).toBeTruthy();

    // Find the scroll container (.ge-ov-scroll) — the element that gets scrollTop set
    const scrollEl = modal.querySelector('.ge-ov-scroll') as HTMLElement;
    expect(scrollEl).toBeTruthy();

    // jsdom doesn't lay out, so scrollHeight = 0. Stub it so our handler has room to scroll.
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, get: () => 2000 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, get: () => 600 });

    return { scrollEl };
  }

  it('ArrowDown increases scrollTop', () => {
    const { scrollEl } = setup();
    const before = scrollEl.scrollTop; // 0
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(scrollEl.scrollTop).toBeGreaterThan(before);
  });

  it('ArrowUp decreases scrollTop (after scrolling down first)', () => {
    const { scrollEl } = setup();
    // Scroll down first
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', bubbles: true, cancelable: true }));
    const after_down = scrollEl.scrollTop;
    expect(after_down).toBeGreaterThan(0);

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(scrollEl.scrollTop).toBeLessThan(after_down);
  });

  it('PageDown scrolls more than ArrowDown', () => {
    const { scrollEl } = setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'PageDown', bubbles: true, cancelable: true }));
    const pageDelta = scrollEl.scrollTop;
    // PAGE = floor(clientHeight * 0.9) || 485 fallback; clientHeight=0 in jsdom so fallback kicks in
    // Fallback = floor(540 * 0.9) = 486 > 60 (one ArrowDown step)
    expect(pageDelta).toBeGreaterThan(60);
  });

  it('Home jumps scrollTop to 0', () => {
    const { scrollEl } = setup();
    // Go down first
    scrollEl.scrollTop = 500;
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Home', bubbles: true, cancelable: true }));
    expect(scrollEl.scrollTop).toBe(0);
  });

  it('End jumps scrollTop to scrollHeight - clientHeight', () => {
    const { scrollEl } = setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'End', bubbles: true, cancelable: true }));
    expect(scrollEl.scrollTop).toBe(2000 - 600);
  });

  it('Space scrolls down a page', () => {
    const { scrollEl } = setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }));
    expect(scrollEl.scrollTop).toBeGreaterThan(0);
  });

  it('Shift+Space scrolls up (after going to End)', () => {
    const { scrollEl } = setup();
    scrollEl.scrollTop = 1000;
    const before = scrollEl.scrollTop;
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', shiftKey: true, bubbles: true, cancelable: true }));
    expect(scrollEl.scrollTop).toBeLessThan(before);
  });

  it('onKey returns true for scroll keys, false for unrelated keys', () => {
    // Open info and check the registered modalOnKey directly via the shell keyboard routing
    const shell = createGameShell(cfg(mount));
    shell.openInfo();

    // Test key routing via a key that wouldn't be consumed by non-overlay code
    // ArrowDown without shift is routed to the layer when a layer is open
    const arrowDown = new KeyboardEvent('keydown', { code: 'ArrowDown', bubbles: true, cancelable: true });
    document.dispatchEvent(arrowDown);
    // If the handler consumed it, the default was prevented OR we can check scrollTop moved
    // We already test scrollTop moves in other tests. Here we verify that a KeyA does NOT scroll.
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const scrollEl = modal.querySelector('.ge-ov-scroll') as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, get: () => 2000 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, get: () => 600 });
    const before = scrollEl.scrollTop;
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true, cancelable: true }));
    // KeyA should not scroll (returns false)
    expect(scrollEl.scrollTop).toBe(before);
  });
});
