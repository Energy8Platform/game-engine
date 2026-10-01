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
