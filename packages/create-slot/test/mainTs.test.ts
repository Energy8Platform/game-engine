import { describe, it, expect } from 'vitest';
import { genMainTs } from '../src/codegen/mainTs';
describe('genMainTs', () => {
  it('registers all scenes and starts the intro', () => {
    const s = genMainTs({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: false, cascades: true });
    expect(s).toContain("import { GameScene } from './scenes/GameScene'");
    expect(s).toContain("import { IntroScene } from './scenes/IntroScene'");
    expect(s).toContain("{ key: 'intro', scene: IntroScene }");
    expect(s).toContain("{ key: 'game', scene: GameScene }");
    expect(s).toContain("startScene: 'intro'");
    expect(s).not.toContain('intro:');
    expect(s).not.toContain('scene: { key:');
  });
  it('imports ScaleMode and passes ScaleMode.FILL to createSlotGame', () => {
    const s = genMainTs({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: false, cascades: false });
    expect(s).toContain("import { ScaleMode } from '@energy8platform/game-engine'");
    expect(s).toContain('scaleMode: ScaleMode.FILL');
  });
});
