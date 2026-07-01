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
    // Cascade renders via the reel system's tumble path.
    expect(s).toContain('createReelSystem');
    expect(s).toContain('this.system.cascade(result.steps');
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
  it('ways/lines renders via system.spin(targetGrid)', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: true, cascades: false });
    expect(s).toContain('createReelSystem');
    expect(s).toContain('this.system.spin(result.targetGrid');
    expect(s).not.toContain('this.system.cascade(');
  });
  it('wires the dev reel bridge for the harness Reels sidebar (torn down in onDestroy)', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: true, cascades: false });
    expect(s).toContain('mountReelDevBridge({ system: this.system })');
    expect(s).toContain("from '../slot/reelConfig'");
    expect(s).toContain('onDestroy()');
    expect(s).toContain('this.bridge?.dispose()');
    expect(s).toContain('this.system?.destroy()');
  });
  it('generated scene implements onResize and a layout helper for centering', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: true, cascades: false });
    expect(s).toContain('onResize(width: number, height: number)');
    expect(s).toContain('private layout(');
    expect(s).toContain('this.system.view.x =');
    expect(s).toContain('this.system.view.y =');
    // layout is called from both onEnter and onResize
    expect(s).toMatch(/onEnter[\s\S]*?this\.layout\(/);
    expect(s).toMatch(/onResize[\s\S]*?this\.layout\(/);
  });
  it('layout scales the reel view to fit the viewport (scale.set, guarded)', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: true, cascades: false });
    expect(s).toContain('if (!this.system) return');
    expect(s).toContain('this.system.view.scale.set(fit)');
  });
  it('big wins render on the host overlay (api.overlay), not an in-scene overlay field', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: true, cascades: false });
    expect(s).toContain('this.api.overlay.show(');
    expect(s).toContain('pickTier(this.winTiers');
    expect(s).toContain('BigWinOverlay');
    expect(s).not.toContain('private overlay!:');
    expect(s).not.toContain('this.container.addChild(this.overlay)');
  });
});
