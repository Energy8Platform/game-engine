import { describe, it, expect } from 'vitest';
import { genGameScene } from '../src/codegen/gameScene';

describe('genGameScene', () => {
  it('cascade/cluster uses CascadeController + the normalizer-driven host play + primitives', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
    expect(s).toContain('implements SlotSceneController<SpinData>');
    expect(s).toContain('bindHost(');
    expect(s).toContain("this.host.play('spin', bet)");
    // The bonus is one round drained segment-by-segment (roundId), not a separate FreeSpinsSession.
    expect(s).toContain('drainRound');
    expect(s).toContain('r.roundId');
    expect(s).not.toContain('FreeSpinsSession');
    expect(s).toContain('MultiplierAccumulator');
    expect(s).toContain('CascadeController');
    expect(s).not.toContain('platformSession');         // no direct SDK access
    expect(s).not.toContain('result.data.cascades');    // consumes the normalizer, not raw
    expect(s).toContain('async buyBonus(');
    expect(s).toContain('this.host.play(actionId');
  });
  it('ways/lines uses ReelSpinController', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: true, cascades: false });
    expect(s).toContain('ReelSpinController');
    expect(s).not.toContain('CascadeController');
  });
  it('generated scene implements onResize and a layout helper for centering', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: true, cascades: false });
    expect(s).toContain('onResize(width: number, height: number)');
    expect(s).toContain('private layout(');
    expect(s).toContain('this.grid.x =');
    expect(s).toContain('this.grid.y =');
    // layout is called from both onEnter and onResize
    expect(s).toMatch(/onEnter[\s\S]*?this\.layout\(/);
    expect(s).toMatch(/onResize[\s\S]*?this\.layout\(/);
  });
  it('layout scales the grid to fit the viewport (scale.set + overlay.resize)', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: true, cascades: false });
    // Should guard for grid not yet created
    expect(s).toContain('if (!this.grid) return');
    // Should scale via scale.set rather than fixed position
    expect(s).toContain('this.grid.scale.set(fit)');
    // Should resize overlay
    expect(s).toContain('this.overlay?.resize?.(w, h)');
  });
});
