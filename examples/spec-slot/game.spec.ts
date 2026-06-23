import { defineGame, type GameSpec } from '@energy8platform/platform-core/game-spec';

export const spec: GameSpec = {
  id: 'spec-slot',
  type: 'slot',
  grid: { cols: 3, rows: 3 },
  betLevels: [0.1, 0.2, 0.5, 1, 2, 5],
  defaultBet: 1,
  maxWin: 1000,
  currency: 'EUR',
  symbols: [
    { id: 'A', name: 'Diamond', kind: 'high', pay: { 3: 10 } },
    { id: 'B', name: 'Bell', kind: 'high', pay: { 3: 5 } },
    { id: 'C', name: 'Cherry', kind: 'low', pay: { 3: 2 } },
    { id: 'WILD', name: 'Wild', kind: 'wild' },
    { id: 'SCATTER', name: 'Scatter', kind: 'scatter' },
  ],
  actions: {
    spin: { role: 'base' },
    ante: { role: 'feature', cost: 1.5, title: 'ANTE BET', description: 'Boosted chance' },
    free_spin: { role: 'free' },
    buy_bonus: { role: 'buy', cost: 100, title: 'BUY BONUS', description: 'Buy the feature', feature: { spins: 10 } },
  },
};

export const model = defineGame(spec);
