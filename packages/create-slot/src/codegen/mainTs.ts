import type { Answers } from '../answers';

export function genMainTs(a: Answers): string {
  const stakeImport = a.stake ? `import adapter from './stake/adapter';\n` : '';
  const stakeOpt = a.stake ? `  stake: { adapter },\n` : '';
  return `import { createSlotGame } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { GameScene } from './scenes/GameScene';
import { IntroScene } from './scenes/IntroScene';
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
  intro: { scene: IntroScene },
${stakeOpt}  shell: {}, // buy/ante cards + currency derive from the spec + initData
}).catch((err) => { console.error('[${a.id}] failed to start', err); });
`;
}
