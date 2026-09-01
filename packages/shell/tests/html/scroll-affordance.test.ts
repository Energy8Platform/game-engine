// @vitest-environment jsdom
/**
 * Scroll affordance in the DOM shell.
 *
 * Stake rejected a build in Popout S (400×225): "the screen can currently be dragged or scrolled,
 * but this functionality is not clearly communicated to the player". Every overflowing region now
 * carries `data-scroll`, which the stylesheet turns into a persistent thumb, an edge fade and a
 * "more below" chevron.
 *
 * jsdom doesn't lay out, so `scrollHeight`/`clientHeight` are 0 everywhere. Each test stubs the
 * metrics it cares about and calls the returned `sync()` — the same call the real `scroll` and
 * `resize` listeners make.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { attachScrollAffordance } from '@/ui/html/scroll-affordance';
import { createGameShell, removeGameShell } from '@/ui/html';
import type { ShellConfig } from '@/core/types';

/** A scroller inside a positioned parent, with layout metrics jsdom won't compute for us. */
function makeScroller(scrollHeight: number, clientHeight: number): HTMLElement {
  const parent = document.createElement('div');
  const el = document.createElement('div');
  parent.appendChild(el);
  document.body.appendChild(parent);
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => 0 });
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 0 });
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('attachScrollAffordance — the data-scroll state machine', () => {
  it('marks an overflowing region as being at its start', () => {
    const el = makeScroller(2000, 200);
    attachScrollAffordance(el).sync();
    expect(el.dataset.scroll).toBe('start');
  });

  it('leaves a region that fits unmarked, so no fade or thumb is styled at all', () => {
    const el = makeScroller(200, 200);
    attachScrollAffordance(el).sync();
    expect(el.dataset.scroll).toBeUndefined();
  });

  it('moves to `mid` once scrolled off the top', () => {
    const el = makeScroller(2000, 200);
    const a = attachScrollAffordance(el);
    el.scrollTop = 500;
    a.sync();
    expect(el.dataset.scroll).toBe('mid');
  });

  it('moves to `end` at the bottom, so the trailing fade and chevron switch off', () => {
    const el = makeScroller(2000, 200);
    const a = attachScrollAffordance(el);
    el.scrollTop = 1800;
    a.sync();
    expect(el.dataset.scroll).toBe('end');
  });

  it('drops the mark again when content shrinks to fit (a resize that removes the overflow)', () => {
    const parent = document.createElement('div');
    const el = document.createElement('div');
    parent.appendChild(el);
    document.body.appendChild(parent);
    let contentH = 2000;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => contentH });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 200 });
    const a = attachScrollAffordance(el);
    a.sync();
    expect(el.dataset.scroll).toBe('start');
    contentH = 150;
    a.sync();
    expect(el.dataset.scroll).toBeUndefined();
  });

  it('re-syncs on the element\'s own scroll event without the caller doing anything', () => {
    const el = makeScroller(2000, 200);
    attachScrollAffordance(el);
    el.scrollTop = 900;
    el.dispatchEvent(new Event('scroll'));
    expect(el.dataset.scroll).toBe('mid');
  });
});

describe('attachScrollAffordance — the chevron cue', () => {
  it('adds a cue element that sits outside the scroller, so it cannot scroll away', () => {
    const el = makeScroller(2000, 200);
    attachScrollAffordance(el).sync();
    const cue = el.parentElement!.querySelector('.ge-scroll-cue');
    expect(cue).toBeTruthy();
    expect(cue!.parentElement).toBe(el.parentElement);
    expect(el.contains(cue!)).toBe(false);
  });

  it('hides the cue from assistive tech — the keyboard already scrolls, and it is pure decoration', () => {
    const el = makeScroller(2000, 200);
    attachScrollAffordance(el).sync();
    const cue = el.parentElement!.querySelector('.ge-scroll-cue')!;
    expect(cue.getAttribute('aria-hidden')).toBe('true');
  });

  it('builds no cue at all for a region that fits', () => {
    const el = makeScroller(200, 200);
    attachScrollAffordance(el).sync();
    expect(el.parentElement!.querySelector('.ge-scroll-cue')).toBeNull();
  });

  it('retires the cue for good after the first scroll — it has done its job', () => {
    const el = makeScroller(2000, 200);
    const a = attachScrollAffordance(el);
    a.sync();
    expect(el.parentElement!.querySelector('.ge-scroll-cue')).toBeTruthy();
    el.scrollTop = 40;
    el.dispatchEvent(new Event('scroll'));
    expect(el.parentElement!.querySelector('.ge-scroll-cue')).toBeNull();
    // and it does not come back when the player scrolls home again
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
    expect(el.parentElement!.querySelector('.ge-scroll-cue')).toBeNull();
  });

  it('pins the cue to the bottom of the SCROLLER, clear of anything hung below it', () => {
    // The buy-bonus overlay hangs a bet bar under its scroll region; a cue pinned to the overlay's
    // own bottom edge lands on top of that bar.
    const parent = document.createElement('div');
    const el = document.createElement('div');
    parent.appendChild(el);
    document.body.appendChild(parent);
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 2000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 160 });
    Object.defineProperty(el, 'offsetTop', { configurable: true, get: () => 44 });
    Object.defineProperty(el, 'offsetLeft', { configurable: true, get: () => 0 });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => 160 });
    Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => 400 });
    attachScrollAffordance(el).sync();
    const cue = parent.querySelector('.ge-scroll-cue') as HTMLElement;
    // scroller bottom is 44 + 160 = 204; the cue sits just inside it, nowhere near the host bottom
    expect(parseFloat(cue.style.top)).toBeGreaterThan(160);
    expect(parseFloat(cue.style.top)).toBeLessThan(204);
    expect(parseFloat(cue.style.left)).toBeCloseTo(189, 0); // (400 - 22) / 2
  });

  it('destroy() removes the cue and the mark, leaving the element as it was found', () => {
    const el = makeScroller(2000, 200);
    const a = attachScrollAffordance(el);
    a.sync();
    a.destroy();
    expect(el.dataset.scroll).toBeUndefined();
    expect(el.parentElement!.querySelector('.ge-scroll-cue')).toBeNull();
  });
});

describe('attachScrollAffordance — horizontal regions (the buy-bonus card strip)', () => {
  it('reads the X metrics and marks the axis so the fade runs left-to-right', () => {
    const parent = document.createElement('div');
    const el = document.createElement('div');
    parent.appendChild(el);
    document.body.appendChild(parent);
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => 1200 });
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 400 });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 200 });
    attachScrollAffordance(el, { axis: 'x' }).sync();
    expect(el.dataset.scroll).toBe('start');
    expect(el.dataset.scrollAxis).toBe('x');
  });

  it('ignores vertical overflow entirely on an x-axis region', () => {
    const parent = document.createElement('div');
    const el = document.createElement('div');
    parent.appendChild(el);
    document.body.appendChild(parent);
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => 400 });
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 400 });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 5000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 200 });
    attachScrollAffordance(el, { axis: 'x' }).sync();
    expect(el.dataset.scroll).toBeUndefined();
  });
});

// ─── wiring: the shell's real surfaces ───────────────────────────────────────

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount,
    gameInfo: { sections: [{ type: 'modes', modes: [{ title: 'Base game', rtp: 96.5 }] }, { type: 'controls' }] },
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: {}, buyBonus: false },
  };
}

describe('shell surfaces are wired to the affordance', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    await removeGameShell();
  });

  it('the game-info overlay announces its overflow (the 2843-in-226 case Stake hit)', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    const scrollEl = mount.querySelector('.ge-ov-scroll') as HTMLElement;
    expect(scrollEl).toBeTruthy();
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, get: () => 2843 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, get: () => 226 });
    scrollEl.dispatchEvent(new Event('scroll'));
    expect(scrollEl.dataset.scroll).toBe('start');
    expect(scrollEl.parentElement!.querySelector('.ge-scroll-cue')).toBeTruthy();
  });

  it('the menu popover announces the row hidden below its fold', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const shell = createGameShell(cfg(mount));
    shell.openMenu();
    const body = mount.querySelector('.ge-pop-body') as HTMLElement;
    expect(body).toBeTruthy();
    Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => 391 });
    Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => 345 });
    body.dispatchEvent(new Event('scroll'));
    expect(body.dataset.scroll).toBe('start');
  });
});
