// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createGameShell, removeGameShell } from '@energy8platform/platform-core/shell';
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
    const cfg = buildShellConfig({}, model, { balance: 12345, mode: 'base', currency });
    const shell = createGameShell(cfg);
    shell.render();
    const text = document.body.innerText || document.body.textContent || '';
    expect(text).not.toContain('EUR');
    expect(text).toContain('€');
  });
});
