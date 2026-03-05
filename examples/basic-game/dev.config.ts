import type { DevBridgeConfig } from '@energy8platform/game-engine/debug';

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
  networkDelay: 300,
  debug: true,
  onPlay: ({ action, bet }) => {
    // Generate random result
    const isWin = Math.random() > 0.4;
    const multiplier = isWin ? 1 + Math.random() * 15 : 0;
    const totalWin = Math.round(bet * multiplier * 100) / 100;

    return {
      totalWin,
      data: {
        // Example slot result
        matrix: [
          [1, 3, 5, 2, 4],
          [2, 1, 3, 5, 1],
          [4, 5, 1, 3, 2],
        ],
        multiplier: isWin ? multiplier : 0,
      },
      nextActions: ['spin'],
    };
  },
};

export default config;
