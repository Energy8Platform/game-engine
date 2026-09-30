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
