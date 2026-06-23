import type { Answers } from '../answers';

export function genMainTs(a: Answers): string {
  const stakeImport = a.stake ? `import adapter from './stake/adapter';\n` : '';
  const stakeOpt = a.stake ? `  stake: { adapter },\n` : '';
  return `import { createSlotGame } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { GameScene } from './GameScene';
import { normalize } from './game/normalize';
${stakeImport}
createSlotGame({
  model,
  normalize,
  scene: { key: 'game', scene: GameScene },
  manifest: { bundles: [] },
  design: { width: 1920, height: 1080 },
  fonts: ['400 24px "Inter"'],
  textureDefaults: true,
  dev: (import.meta as any).env?.DEV ?? false,
${stakeOpt}  shell: {
    currency: { symbol: '€', position: 'left' }, // EUR default — set symbol/position for your currency
    gameInfo: { sections: [] } as any,
    buyBonus: [{ id: 'buy_bonus', title: 'BUY BONUS', description: 'Buy the feature', priceMultiplier: 100 }],
  },
}).catch((err) => { console.error('[${a.id}] failed to start', err); });
`;
}
