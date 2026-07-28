// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import { PACKAGE_VERSION } from '@/core/version';
import type { ShellConfig, GameInfoSection } from '@/core/types';

const pkgStamp = PACKAGE_VERSION.replaceAll('.', '');

function cfg(mount: HTMLElement, sections?: GameInfoSection[]): ShellConfig {
  return {
    mount,
    gameInfo: {
      sections: sections ?? [
        { type: 'paytable', rows: [{ symbol: { text: 'Wild' }, wins: [{ count: '5', multiplier: 250 }] }] },
        { type: 'controls' },
        { type: 'modes', modes: [{ title: 'Base game', rtp: 96.5, maxWin: '5,000×' }] },
        { type: 'wins', kind: 'classic', grid: { cols: 5, rows: 3 }, lines: [[1, 1, 1, 1, 1], [0, 1, 2, 1, 0]] },
        { type: 'custom', title: 'Rules', html: '<p>Match left to right.</p>' },
      ],
    },
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 2, autoplay: {}, buyBonus: false },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;
const qa = (m: HTMLElement, s: string) => [...m.querySelectorAll(s)] as HTMLElement[];

describe('GameInfo', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('renders each preset section type', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    expect(q(modal, '[data-ge="info-modes"]')!.textContent).toContain('Base game');
    expect(q(modal, '[data-ge="info-paytable"]')!.textContent).toContain('Wild');
    expect(q(modal, '[data-ge="info-paytable"]')!.textContent).toContain('x250');
    expect(qa(q(modal, '[data-ge="info-wins"]')!, '.ge-gi-pl-item')).toHaveLength(2);
    expect(q(modal, '[data-ge="info-wins"]')!.querySelector('.ge-gi-pl-line')).toBeNull(); // no connecting line
    expect(q(modal, '[data-ge="info-custom"]')!.textContent).toContain('Match left to right.');
  });

  it('localizes the paytable heading and the host-built custom DISCLAIMER heading', () => {
    const shell = createGameShell({
      ...cfg(mount, [
        { type: 'paytable', rows: [{ symbol: { text: 'Wild' }, wins: [{ count: '5', multiplier: 10 }] }] },
        { type: 'custom', title: 'DISCLAIMER', html: '<p>Legal text stays verbatim.</p>' },
      ]),
      language: 'de',
    });
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    // 'Paytable' heading localizes via the shell's translating fallback (host no longer sets a literal title).
    expect(q(modal, '[data-ge="info-paytable"]')!.textContent).toContain('Gewinntabelle');
    // Custom DISCLAIMER heading is translated; the legal body stays verbatim.
    const custom = q(modal, '[data-ge="info-custom"]')!;
    expect(custom.textContent).toContain('Haftungsausschluss');
    expect(custom.textContent).toContain('Legal text stays verbatim.');
  });

  it('wins kind "shapes" renders a row per named shape (grid + name + description)', () => {
    const shell = createGameShell(cfg(mount, [
      { type: 'wins', kind: 'shapes', grid: { cols: 5, rows: 3 }, shapes: [
        { cells: [[0, 0], [1, 1], [2, 2]], name: 'Diagonal', description: 'Top-left to bottom-right.' },
        { cells: [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]], name: 'Middle row' },
      ] },
    ]));
    shell.openInfo();
    const wins = q(mount, '[data-ge="info-wins"]')!;
    expect(qa(wins, '.ge-gi-shape')).toHaveLength(2);          // one row per shape
    expect(qa(wins, '.ge-gi-shape .ge-gi-pl-svg')).toHaveLength(2); // each row has the grid illustration
    expect(wins.textContent).toContain('Diagonal');            // name
    expect(wins.textContent).toContain('Top-left to bottom-right.'); // description
    expect(wins.textContent).toContain('Middle row');          // description optional
  });

  it('controls section splits into two blocks, with bet as separate raise/lower rows', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    const controls = q(mount, '[data-ge="info-controls"]')!;
    expect(controls.querySelectorAll('.ge-gi-ctl-block')).toHaveLength(2); // Game / Menu & info
    expect(controls.textContent).not.toContain('RTP'); // rtp removed entirely
    expect(controls.textContent).toContain('Raise bet'); // bet split into two rows
    expect(controls.textContent).toContain('Lower bet');
    expect(controls.textContent).toContain('Autoplay'); // autoplay enabled
    expect(controls.textContent).toContain('Turbo'); // turbo > 0
    expect(controls.textContent).not.toContain('Buy bonus'); // buyBonus: false
    // menu & info block documents the menu/overlay chrome
    expect(controls.textContent).toContain('Sound');
    expect(controls.textContent).toContain('Game info');
    expect(controls.textContent).toContain('Close');
  });

  it('renders cluster/anywhere with a min badge and ways with two grids', () => {
    const shell = createGameShell(cfg(mount, [
      { type: 'wins', kind: 'cluster', grid: { cols: 6, rows: 5 }, minCount: 5, description: 'connect 5+' },
      { type: 'wins', kind: 'ways', grid: { cols: 5, rows: 4 } },
    ]));
    shell.openInfo();
    const wins = qa(mount, '[data-ge="info-wins"]');
    expect(wins[0].querySelector('.ge-gi-win-badge')!.textContent).toBe('min 5');
    expect(wins[0].textContent).toContain('connect 5+');
    expect(wins[0].querySelectorAll('.ge-gi-pl-on').length).toBeGreaterThanOrEqual(5); // ≥ minCount filled
    expect(wins[1].querySelectorAll('.ge-gi-pl-svg')).toHaveLength(2); // wins + no-win grids
  });

  it('controls draws the real buy-bonus button when buy bonus is enabled', () => {
    const c = cfg(mount);
    c.features = { ...c.features, buyBonus: [{ id: 'b', name: 'B', description: 'd', priceMultiplier: 100 }] };
    const shell = createGameShell(c);
    shell.openInfo();
    const controls = q(mount, '[data-ge="info-controls"]')!;
    expect(controls.textContent).toContain('Buy bonus');
    expect(q(controls, '.ge-gi-ctl-ic .ge-shell-buybonus')).toBeTruthy();
  });

  it('socialises modes labels — Price → Play in social mode', () => {
    const c = cfg(mount, [{ type: 'modes', modes: [{ title: 'Bonus mode', price: '€100', rtp: 96 }] }]);
    c.isSocial = true;
    const shell = createGameShell(c);
    shell.openInfo();
    const modes = q(mount, '[data-ge="info-modes"]')!;
    expect(modes.textContent).toContain('Play');   // "Price" label → "Play"
    expect(modes.textContent).not.toContain('Price');
  });

  it('orders modes first, controls second by default', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    const order = qa(mount, '[data-ge="info-modal"] .ge-gi-sec').map((s) => s.dataset.ge);
    expect(order.slice(0, 2)).toEqual(['info-modes', 'info-controls']);
  });

  it('respects an explicit order', () => {
    const shell = createGameShell(cfg(mount, [
      { type: 'modes', order: 10, modes: [{ title: 'Base' }] },
      { type: 'custom', order: -10, html: '<p>first</p>' },
      { type: 'controls' },
    ]));
    shell.openInfo();
    const order = qa(mount, '[data-ge="info-modal"] .ge-gi-sec').map((s) => s.dataset.ge);
    // Auto-injected hotkeys section (default order -0.5) sits between controls (-1) and modes (10).
    expect(order).toEqual(['info-custom', 'info-controls', 'info-hotkeys', 'info-modes']);
  });

  it('opens with no sections provided — auto-injects hotkeys only', () => {
    const c = cfg(mount); c.gameInfo = {};
    const shell = createGameShell(c);
    shell.openInfo();
    expect(q(mount, '[data-ge="info-modal"]')).toBeTruthy();
    // The hotkeys section is always auto-injected (features.hotkeys is not false by default).
    expect(qa(mount, '[data-ge="info-modal"] .ge-gi-sec')).toHaveLength(1);
    expect(q(mount, '[data-ge="info-hotkeys"]')).toBeTruthy();
  });

  it('stamps the version footer at the very bottom: {version|1.0.0}.{engine no dots}', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const ver = q(modal, '[data-ge="info-version"]')!;
    expect(ver).toBeTruthy();
    expect(ver.textContent).toContain(`1.0.0.${pkgStamp}`); // default game version 1.0.0
    expect(q(modal, '.ge-ov-body')!.lastElementChild).toBe(ver); // very bottom of the content
  });

  it('version footer uses config.version when provided', () => {
    const c = cfg(mount); c.version = '2.3.1';
    const shell = createGameShell(c);
    shell.openInfo();
    const ver = q(mount, '[data-ge="info-version"]')!;
    expect(ver.textContent).toContain(`2.3.1.${pkgStamp}`);
  });

  it('has a back control that returns to the bar menu', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    q(mount, '[data-ge="info-back"]')!.click();
    expect(q(mount, '[data-ge="menu-popover"]')).toBeTruthy();
  });

  // Regression: Back used to call actions.openSettings() — the deprecated alias — so ordinary
  // back-navigation emitted the deprecated `settingsOpen` event on every trip through Game info.
  // It must go through the current openMenu() path instead.
  it('Back emits menuOpen, not the deprecated settingsOpen', () => {
    const shell = createGameShell(cfg(mount));
    const menuOpen = vi.fn();
    const settingsOpen = vi.fn();
    shell.on('menuOpen', menuOpen);
    shell.on('settingsOpen', settingsOpen);
    shell.openInfo();
    q(mount, '[data-ge="info-back"]')!.click();
    expect(menuOpen).toHaveBeenCalledOnce();
    expect(settingsOpen).not.toHaveBeenCalled();
  });
});
