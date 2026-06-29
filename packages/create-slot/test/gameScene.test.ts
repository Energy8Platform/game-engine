import { describe, it, expect } from 'vitest';
import { genGameScene } from '../src/codegen/gameScene';

describe('genGameScene', () => {
  it('cascade/cluster: slim render contract (onSpin + mode hooks), no play/ack/host', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
    expect(s).toContain('implements SlotSceneController<SpinData>');
    expect(s).toContain('async onSpin(result: SpinData, ctx: RenderContext)');
    expect(s).toContain('async onEnterMode(');
    expect(s).toContain('async onExitMode(');
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
  it('layout scales the grid to fit the viewport (scale.set, no persistent overlay)', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: true, cascades: false });
    // Should guard for grid not yet created
    expect(s).toContain('if (!this.grid) return');
    // Should scale via scale.set rather than fixed position
    expect(s).toContain('this.grid.scale.set(fit)');
  });
  it('big wins render on the host overlay (api.overlay), not an in-scene overlay field', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: true, cascades: false });
    // Celebration goes through the host overlay layer (above the shell), guarded by tier:
    expect(s).toContain('this.api.overlay.show(');
    expect(s).toContain('pickTier(this.winTiers');
    expect(s).toContain('BigWinOverlay');
    // The old, confusing in-scene `overlay` field (collided with api.overlay) is gone:
    expect(s).not.toContain('private overlay!:');
    expect(s).not.toContain('this.container.addChild(this.overlay)');
    expect(s).not.toContain('this.overlay?.resize?.(w, h)');
  });
});
