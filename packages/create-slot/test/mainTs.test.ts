import { describe, it, expect } from 'vitest';
import { genMainTs } from '../src/codegen/mainTs';
describe('genMainTs', () => {
  it('wires the generated IntroScene class as the intro', () => {
    const s = genMainTs({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: false, cascades: true });
    expect(s).toContain("import { IntroScene } from './scenes/IntroScene'");
    expect(s).toContain('intro: { scene: IntroScene }');
  });
});
