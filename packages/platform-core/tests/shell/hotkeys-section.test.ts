// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig, GameInfoSection } from '@/shell/types';

function cfg(mount: HTMLElement, sections?: GameInfoSection[], featureOverrides: Partial<ShellConfig['features']> = {}): ShellConfig {
  return {
    mount,
    gameInfo: { sections },
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: {
      turbo: 0,
      autoplay: {},
      buyBonus: [{ id: 'fs', title: 'Free Spins', description: '10 free spins', priceMultiplier: 100 }],
      ...featureOverrides,
    },
  };
}

const q = (root: HTMLElement, sel: string) => root.querySelector(sel) as HTMLElement | null;
const qa = (root: HTMLElement, sel: string) => [...root.querySelectorAll(sel)] as HTMLElement[];

describe('Hotkeys section — DOM shell', () => {
  let mount: HTMLElement;

  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('auto-injects a Hotkeys block when features.hotkeys is not set (default)', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }]));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]');
    expect(hotkeys).toBeTruthy();
  });

  it('Hotkeys block contains Spin row', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }]));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]')!;
    expect(hotkeys.textContent).toContain('Spin');
  });

  it('Hotkeys block contains Raise bet row', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }]));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]')!;
    expect(hotkeys.textContent).toContain('Raise bet');
    expect(hotkeys.textContent).toContain('Lower bet');
  });

  it('Hotkeys block contains Game info row', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }]));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]')!;
    expect(hotkeys.textContent).toContain('Game info');
  });

  it('omits Turbo row when turbo === 0', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }], { turbo: 0 }));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]')!;
    expect(hotkeys.textContent).not.toContain('Turbo');
  });

  it('includes Turbo row when turbo > 0', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }], { turbo: 2 }));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]')!;
    expect(hotkeys.textContent).toContain('Turbo');
  });

  it('omits Autoplay row when features.autoplay is null/omitted', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }], { autoplay: null }));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]')!;
    expect(hotkeys.textContent).not.toContain('Autoplay');
  });

  it('includes Autoplay row when features.autoplay is set', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }], { autoplay: {} }));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]')!;
    expect(hotkeys.textContent).toContain('Autoplay');
  });

  it('omits Buy bonus row when features.buyBonus === false', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }], { buyBonus: false }));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]')!;
    expect(hotkeys.textContent).not.toContain('Buy bonus');
  });

  it('includes Buy bonus row when features.buyBonus is enabled', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }]));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]')!;
    expect(hotkeys.textContent).toContain('Buy bonus');
  });

  it('does NOT inject a Hotkeys block when features.hotkeys === false', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }], { hotkeys: false }));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]');
    expect(hotkeys).toBeNull();
  });

  it('does not double-inject when game already supplies a hotkeys section', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }, { type: 'hotkeys' }]));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeySections = qa(modal, '[data-ge="info-hotkeys"]');
    expect(hotkeySections).toHaveLength(1);
  });

  it('respects custom title on a game-supplied hotkeys section', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'hotkeys', title: 'Keyboard shortcuts' }]));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]')!;
    expect(hotkeys.textContent).toContain('Keyboard shortcuts');
  });

  it('renders keycap chips (Space for Spin)', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'controls' }]));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]')!;
    const chips = qa(hotkeys, '.ge-gi-hk-chip');
    expect(chips.length).toBeGreaterThan(0);
    const chipTexts = chips.map((c) => c.textContent ?? '');
    expect(chipTexts.some((t) => t.includes('Space'))).toBe(true);
  });

  it('auto-injected hotkeys appears after controls in section order', () => {
    const shell = createGameShell(cfg(mount, [{ type: 'modes', modes: [{ title: 'Base' }] }, { type: 'controls' }]));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const sections = qa(modal, '.ge-gi-sec').map((s) => s.dataset.ge);
    const ctlIdx = sections.indexOf('info-controls');
    const hkIdx = sections.indexOf('info-hotkeys');
    expect(ctlIdx).toBeGreaterThanOrEqual(0);
    expect(hkIdx).toBeGreaterThan(ctlIdx);
  });

  it('no sections provided — auto-injects hotkeys block (default features)', () => {
    const shell = createGameShell(cfg(mount, undefined));
    shell.openInfo();
    const modal = q(mount, '[data-ge="info-modal"]')!;
    const hotkeys = q(modal, '[data-ge="info-hotkeys"]');
    expect(hotkeys).toBeTruthy();
  });
});
