import { describe, it, expect } from 'vitest';
import { genGameScene } from '../src/codegen/gameScene';

describe('genGameScene', () => {
  it('cascade/cluster: slim render contract (present + bonus hooks), no play/ack/host', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
    expect(s).toContain('implements SlotSceneController<SpinData>');
    expect(s).toContain('async present(result: SpinData, ctx: RenderContext)');
    expect(s).toContain('async onBonusEnter(');
    expect(s).toContain('async onBonusExit(');
    expect(s).toContain('ctx.formatAmount');
    expect(s).toContain('ctx.turbo');
    expect(s).toContain('MultiplierAccumulator');
    expect(s).toContain('CascadeController');
    // The game no longer touches the play protocol:
    expect(s).not.toContain('bindHost');
    expect(s).not.toContain('SlotHostApi');
    expect(s).not.toContain('this.host');
    expect(s).not.toContain('drainRound');
    expect(s).not.toContain('FreeSpinsSession');
    expect(s).not.toContain('async spin(');
    expect(s).not.toContain('async buyBonus(');
    expect(s).not.toContain('platformSession');
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
