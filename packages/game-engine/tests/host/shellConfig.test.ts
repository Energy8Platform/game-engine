// packages/game-engine/tests/host/shellConfig.test.ts
import { describe, it, expect } from 'vitest';
import { buildShellConfig } from '../../src/host/shellConfig';
import type { GameModel } from '@energy8platform/platform-core/game-spec';

const model = { spec: { betLevels: [0.1, 1, 5], defaultBet: 1 } } as unknown as GameModel;
const mount = {} as HTMLElement;

describe('buildShellConfig', () => {
  it('maps model bet levels + balance + mode into a ShellConfig', () => {
    const c = buildShellConfig(
      { mount, currency: { code: 'EUR' } as any, gameInfo: { sections: [] } as any },
      model, 1000, 'base',
    );
    expect(c.availableBets).toEqual([0.1, 1, 5]);
    expect(c.defaultBet).toBe(1);
    expect(c.balance).toBe(1000);
    expect(c.win).toBe(0);
    expect(c.mode).toBe('base');
    expect(c.mount).toBe(mount);
  });
  it('passes buyBonus options through to features', () => {
    const buyBonus = [{ id: 'buy_bonus', title: 'BUY', description: '', priceMultiplier: 50 }];
    const c = buildShellConfig(
      { mount, currency: { code: 'EUR' } as any, gameInfo: { sections: [] } as any, buyBonus: buyBonus as any },
      model, 0, 'replay',
    );
    expect(c.mode).toBe('replay');
    expect(c.features.buyBonus).toEqual(buyBonus);
  });
});
