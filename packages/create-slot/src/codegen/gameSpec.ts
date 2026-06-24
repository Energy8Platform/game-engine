import type { Answers } from '../answers';

/** Emit a game.spec.ts with a sensible default symbol set + actions; author edits it. */
export function genGameSpec(a: Answers): string {
  return `import { defineGame, type GameSpec } from '@energy8platform/platform-core/game-spec';

// Single source of truth. Edit symbols / paytable / bet levels / actions to design your game.
export const spec: GameSpec = {
  id: '${a.id}',
  type: 'slot',
  mechanic: '${a.mechanic}',
  grid: { cols: ${a.grid.cols}, rows: ${a.grid.rows} },
  betLevels: [0.01, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 10000, 100000, 1000000],
  defaultBet: 1,
  maxWin: 5000,
  currency: 'EUR',
  symbols: [
    { id: 'H1', name: 'High 1', kind: 'high', pay: { 3: 10, 4: 25, 5: 100 } },
    { id: 'H2', name: 'High 2', kind: 'high', pay: { 3: 8, 4: 20, 5: 80 } },
    { id: 'H3', name: 'High 3', kind: 'high', pay: { 3: 6, 4: 15, 5: 60 } },
    { id: 'H4', name: 'High 4', kind: 'high', pay: { 3: 5, 4: 12, 5: 50 } },
    { id: 'L1', name: 'Low 1', kind: 'low', pay: { 3: 1, 4: 2, 5: 5 } },
    { id: 'L2', name: 'Low 2', kind: 'low', pay: { 3: 0.8, 4: 1.5, 5: 4 } },
    { id: 'L3', name: 'Low 3', kind: 'low', pay: { 3: 0.6, 4: 1.2, 5: 3 } },
    { id: 'L4', name: 'Low 4', kind: 'low', pay: { 3: 0.5, 4: 1, 5: 2.5 } },
    { id: 'WILD', name: 'Wild', kind: 'wild' },
    { id: 'SCATTER', name: 'Scatter', kind: 'scatter' },
  ],
  // Action titles/descriptions are player-facing: in social mode the shell socializes this copy
  // automatically (e.g. 'BUY BONUS' → 'GET BONUS', 'Pay more…' → 'Win more…'), so you can write
  // normal casino wording here and it stays compliant in social builds.
  actions: {
    spin: { role: 'base' },
    ante: { role: 'feature', cost: 1.5, title: 'ANTE BET', description: 'Pay more for a boosted chance' },
    free_spin: { role: 'free' },
    buy_bonus: { role: 'buy', cost: 100, title: 'BUY BONUS', description: 'Buy the feature', feature: { spins: 10 } },
  },
};

export const model = defineGame(spec);
`;
}
