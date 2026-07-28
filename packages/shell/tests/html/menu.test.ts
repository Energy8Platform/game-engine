// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import { createPopover } from '@/ui/html/primitives';
import type { ShellConfig } from '@/core/types';

const rect = (x: number, y: number, w: number, h: number): DOMRect =>
  ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;

function cfg(mount: HTMLElement, over: Partial<ShellConfig> = {}): ShellConfig & { mount: HTMLElement } {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: null, buyBonus: false },
    ...over,
  } as ShellConfig & { mount: HTMLElement };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('bar menu popover', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
    // ShellController installs a global capture-phase pointerdown listener (unrelated to this
    // popover) that calls window.focus() to pull focus into the game frame. jsdom doesn't
    // implement window.focus and logs "Not implemented" via its virtual console on every call;
    // the "closes on a click outside" test below dispatches a real pointerdown, so stub it quiet.
    vi.spyOn(window, 'focus').mockImplementation(() => {});
  });

  it('burger opens the popover with the default rows, in order', () => {
    const shell = createGameShell(cfg(mount));
    const opened = vi.fn();
    const setSpy = vi.fn();
    shell.on('menuOpen', opened);
    shell.on('settingsOpen', setSpy);
    q(mount, '[data-ge="menu"]')!.click();
    expect(opened).toHaveBeenCalledOnce();
    expect(setSpy).not.toHaveBeenCalled(); // settingsOpen is only emitted by the deprecated openSettings() alias
    expect(q(mount, '[data-ge="menu-popover"]')).toBeTruthy();
    const rows = Array.from(mount.querySelectorAll('[data-ge^="menu-row-"], [data-ge="menu-sep"]'));
    expect(rows.map((r) => (r as HTMLElement).dataset.ge)).toEqual([
      'menu-row-sound', 'menu-row-music', 'menu-row-sfx', 'menu-sep', 'menu-row-gameInfo',
    ]);
    expect(q(mount, '[data-ge="settings-modal"]')).toBeNull(); // the overlay is gone for good
  });

  it('a second burger tap closes it', () => {
    createGameShell(cfg(mount));
    const burger = q(mount, '[data-ge="menu"]')!;
    burger.click();
    expect(q(mount, '[data-ge="menu-popover"]')).toBeTruthy();
    burger.click();
    expect(q(mount, '[data-ge="menu-popover"]')).toBeNull();
  });

  it('closes on a click outside and on Escape', () => {
    createGameShell(cfg(mount));
    q(mount, '[data-ge="menu"]')!.click();
    q(mount, '[data-ge="menu-popover"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(q(mount, '[data-ge="menu-popover"]')).toBeNull();

    q(mount, '[data-ge="menu"]')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    expect(q(mount, '[data-ge="menu-popover"]')).toBeNull();
  });

  it('sound row toggles and swaps its glyph', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingChange', spy);
    shell.openMenu();
    const row = q(mount, '[data-ge="menu-row-sound"]')!;
    expect(row.querySelector('svg')).toBeTruthy();
    q(mount, '[data-ge="menu-item-sound"]')!.click();
    expect(spy).toHaveBeenCalledWith({ key: 'sound', value: false });
    expect(shell.soundOn).toBe(false);
  });

  it('volume rows move the shell volumes', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('settingChange', spy);
    shell.openMenu();
    const s = q(mount, '[data-ge="menu-item-music"]') as HTMLInputElement;
    s.value = '0.3';
    s.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith({ key: 'music', value: 0.3 });
    expect(shell.getVolume('music')).toBe(0.3);
  });

  it('game info row opens the info overlay', () => {
    const shell = createGameShell(cfg(mount));
    shell.openMenu();
    q(mount, '[data-ge="menu-item-gameInfo"]')!.click();
    expect(q(mount, '[data-ge="info-modal"]')).toBeTruthy();
    expect(q(mount, '[data-ge="menu-popover"]')).toBeNull();
  });

  it('renders custom toggle / range / button rows and runs their callbacks', () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();
    const shell = createGameShell(cfg(mount, {
      menu: [
        { id: 'lefty', type: 'toggle', label: 'Left-hand', value: false, onChange },
        { id: 'speed', type: 'range', label: 'Speed', min: 1, max: 5, step: 1, value: 2, format: (v) => `×${v}` },
        { id: 'paytable', type: 'button', label: 'Paytable', icon: 'ticket', chevron: true, onSelect },
      ],
    }));
    shell.openMenu();
    q(mount, '[data-ge="menu-item-lefty"]')!.click();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(shell.getMenuValue('lefty')).toBe(true);

    const speed = q(mount, '[data-ge="menu-item-speed"]') as HTMLInputElement;
    expect(speed.min).toBe('1');
    expect(speed.max).toBe('5');
    expect(q(mount, '[data-ge="menu-row-speed"]')!.textContent).toContain('×2');

    q(mount, '[data-ge="menu-item-paytable"]')!.click();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('live-updates an open popover from setMenuValue', () => {
    const shell = createGameShell(cfg(mount));
    shell.openMenu();
    shell.setMenuValue('sfx', 0.25);
    const s = q(mount, '[data-ge="menu-item-sfx"]') as HTMLInputElement;
    expect(s.value).toBe('0.25');
    expect(q(mount, '[data-ge="menu-row-sfx"]')!.textContent).toContain('25%');
  });

  it('places the card above the burger, clamped inside the shell root', () => {
    const shell = createGameShell(cfg(mount));
    const root = mount.querySelector('#__ge-game-shell__') as HTMLElement;
    Object.defineProperty(root, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(root, 'clientHeight', { value: 600, configurable: true });
    root.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, toJSON: () => ({}) }) as DOMRect;
    const burger = q(mount, '[data-ge="menu"]')!;
    burger.getBoundingClientRect = () => ({ x: 20, y: 540, left: 20, top: 540, width: 40, height: 40, right: 60, bottom: 580, toJSON: () => ({}) }) as DOMRect;
    shell.openMenu();
    const card = q(mount, '[data-ge="menu-card"]')!;
    expect(parseFloat(card.style.left)).toBe(20);
    expect(parseFloat(card.style.top)).toBeLessThan(540);
  });

  // Regression: HtmlRenderer's ResizeObserver calls renderBar() (which does barHost.innerHTML = ''
  // and rebuilds the bottom bar — a brand-new burger element) BEFORE re-calling position(). A
  // popover that captured its anchor once would already be pointing at a detached element by then,
  // silently recentring with its arrow hidden on every resize. createPopover must re-resolve an
  // anchor FUNCTION on every position() call instead of tracking a fixed reference.
  it('re-resolves a function anchor on every position() call, tracking a rebuilt element', () => {
    const surface = document.createElement('div');
    document.body.appendChild(surface);
    surface.getBoundingClientRect = () => rect(0, 0, 1000, 600);

    let current = document.createElement('button');
    current.getBoundingClientRect = () => rect(20, 540, 40, 40);

    const pop = createPopover({ ge: 'x', surface, anchor: () => current, onClose: () => {} });
    document.body.appendChild(pop.root);
    pop.position();
    expect(parseFloat(pop.card.style.left)).toBe(20);

    // Simulate renderBar(): the old burger is discarded; a brand-new one takes its place at a
    // different position — exactly what a barHost rebuild does to the real `[data-ge="menu"]` node.
    current = document.createElement('button');
    current.getBoundingClientRect = () => rect(300, 540, 40, 40);
    pop.position();

    expect(parseFloat(pop.card.style.left)).toBe(300); // tracks the NEW element, not the stale one
    const arrow = pop.card.querySelector('.ge-pop-arrow') as HTMLElement;
    expect(arrow.style.display).not.toBe('none'); // still anchored — arrow stays visible, not centred
  });
});
