import { describe, it, expect } from 'vitest';
import { genGameScene } from '../src/codegen/gameScene';

describe('genGameScene', () => {
  it('cascade/cluster uses CascadeController + the normalizer-driven host play + primitives', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
    expect(s).toContain('implements SlotSceneController<SpinData>');
    expect(s).toContain('bindHost(');
    expect(s).toContain("this.host.play('spin', bet)");
    expect(s).toContain('FreeSpinsSession');
    expect(s).toContain('MultiplierAccumulator');
    expect(s).toContain('CascadeController');
    expect(s).not.toContain('platformSession');         // no direct SDK access
    expect(s).not.toContain('result.data.cascades');    // consumes the normalizer, not raw
  });
  it('ways/lines uses ReelSpinController', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: true, cascades: false });
    expect(s).toContain('ReelSpinController');
    expect(s).not.toContain('CascadeController');
  });
});
