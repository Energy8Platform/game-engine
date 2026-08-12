// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createGameShell, removeGameShell } from '@energy8platform/shell/html';
import { buildShellConfig, resolveCurrency } from '@/host/shellConfig';
import type { GameModel } from '@energy8platform/platform-core/game-spec';

const model = {
  spec: {
    id: 'g', betLevels: [1, 2, 5], defaultBet: 1, maxWin: 5000, currency: 'EUR',
    grid: { cols: 5, rows: 3 }, mechanic: 'lines',
    symbols: [{ id: 'H1', name: 'H1', kind: 'high', pay: { 3: 10 } }],
    actions: { spin: { role: 'base' }, buy_bonus: { role: 'buy', cost: 100, title: 'BUY BONUS' } },
  },
  paytable: { symbols: [{ id: 'H1', name: 'H1', pay: { 3: 10 } }] },
  modeMap: { spin: 'BASE' },
} as unknown as GameModel;

afterEach(async () => { await removeGameShell(); });

describe('currency renders as symbol, not code', () => {
  it('balance shows € not EUR when initData.config.currency is the EUR meta', () => {
    const meta = { code: 'EUR', symbol: '€', decimals: 2 };
    const currency = resolveCurrency(meta, 'EUR');
    expect(currency.symbol).toBe('€');
    // buildShellConfig is now shell-agnostic (no mount — the pixi host adds `app` at the call
    // site); supply the DOM shell's mount here to render and assert the currency output.
    const cfg = buildShellConfig({}, model, { balance: 12345, mode: 'base', currency });
    const shell = createGameShell({ ...cfg, mount: document.body });
    // new ShellController auto-renders on construction via HtmlRenderer.mount()
    const text = document.body.innerText || document.body.textContent || '';
    expect(text).not.toContain('EUR');
    expect(text).toContain('€');
  });

  it('a small win (0.0041) shows up to 4 decimals; balance stays at 2', () => {
    const currency = resolveCurrency({ code: 'EUR', symbol: '€', decimals: 2 }, 'EUR');
    const cfg = buildShellConfig({}, model, { balance: 500, mode: 'base', currency });
    const shell = createGameShell({ ...cfg, mount: document.body });
    // setWin synchronously patches the DOM (ShellController auto-renders on construction and
    // on each setter call — no explicit shell.render() needed after the initial mount).
    shell.setWin(0.0041); // tiny win on a small bet
    const text = document.body.innerText || document.body.textContent || '';
    expect(text).toContain('0.0041'); // win keeps significant digits, not rounded to 0.00
    expect(text).toContain('500.00'); // balance stays at the currency's 2 decimals
  });
});
