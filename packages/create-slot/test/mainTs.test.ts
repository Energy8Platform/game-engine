import { describe, it, expect } from 'vitest';
import { genMainTs } from '../src/codegen/mainTs';
describe('genMainTs', () => {
  it('registers all scenes; intro is the start scene and is skipped on replay', () => {
    const s = genMainTs({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: false, cascades: true });
    expect(s).toContain("import { GameScene } from './scenes/GameScene'");
    expect(s).toContain("import { IntroScene } from './scenes/IntroScene'");
    // Unified scenes list: intro is first (→ start scene) and flagged skipOnReplay.
    expect(s).toContain("{ key: 'intro', scene: IntroScene, skipOnReplay: true }");
    expect(s).toContain("{ key: 'game', scene: GameScene }");
    // startScene is no longer passed — the first eligible scene wins.
    expect(s).not.toContain('startScene:');
    expect(s).not.toContain('intro:');
    expect(s).not.toContain('scene: { key:');
  });
  it('imports ScaleMode and passes ScaleMode.FILL to createSlotGame', () => {
    const s = genMainTs({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: false, cascades: false });
    expect(s).toContain("import { ScaleMode } from '@energy8platform/game-engine'");
    expect(s).toContain('scaleMode: ScaleMode.FILL');
  });
});
