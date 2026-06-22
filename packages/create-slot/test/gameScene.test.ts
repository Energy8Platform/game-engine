import { describe, it, expect } from 'vitest';
import { genGameScene } from '../src/codegen/gameScene';

describe('genGameScene', () => {
  it('uses CascadeController for cascade mechanic', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'cascade', grid: { cols: 6, rows: 6 }, stake: true });
    expect(s).toContain('CascadeController');
    expect(s).not.toContain('ReelSpinController');
    expect(s).toContain('implements SlotSceneController');
    expect(s).toContain('async spin(');
  });
  it('uses ReelSpinController for lines/ways', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: true });
    expect(s).toContain('ReelSpinController');
    expect(s).not.toContain('CascadeController');
  });
});
