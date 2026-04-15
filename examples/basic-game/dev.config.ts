import type { DevBridgeConfig } from '@energy8platform/game-engine/debug';
import luaScript from './game.lua?raw';

const gameDefinition = {
  id: 'basic-demo',
  type: 'SLOT',
  actions: {
    spin: {
      stage: 'base_game',
      debit: 'bet',
      credit: 'win',
      transitions: [
        {
          condition: 'free_spins_awarded > 0',
          creates_session: true,
          credit_override: 'defer',
          next_actions: ['free_spin'],
          session_config: {
            total_spins_var: 'free_spins_awarded',
          },
        },
        { condition: 'always', next_actions: ['spin'] },
      ],
    },
    free_spin: {
      stage: 'free_spins',
      debit: 'none',
      requires_session: true,
      transitions: [
        { condition: 'always', next_actions: ['free_spin'] },
      ],
    },
  },
  bet_levels: [0.2, 0.5, 1, 2, 5, 10, 20],
  max_win: { multiplier: 5000 },
};

const config: DevBridgeConfig = {
  balance: 5000,
  currency: 'USD',
  gameConfig: {
    id: 'basic-demo',
    type: 'slot',
    version: '1.0.0',
    viewport: { width: 1920, height: 1080 },
    betLevels: [0.2, 0.5, 1, 2, 5, 10, 20],
  },
  assetsUrl: '/assets/',
  networkDelay: 100,
  debug: true,
  luaScript,
  gameDefinition: gameDefinition as any,
};

export default config;
