import { describe, it, expect } from 'vitest';
import { createShell, ShellController } from '@/core';
import { FakeRenderer } from './FakeRenderer';

describe('createShell', () => {
  it('returns a ShellController wired to the given renderer', () => {
    const r = new FakeRenderer();
    const shell = createShell({
      renderer: r, language: 'en', currency: { symbol: '€', position: 'left' },
      availableBets: [1, 2], defaultBet: 1, currentBet: null, balance: 100, win: 0,
      mode: 'base', gameInfo: { sections: [] }, features: { turbo: 0 },
    });
    expect(shell).toBeInstanceOf(ShellController);
    expect(r.host).toBe(shell);
  });
});
