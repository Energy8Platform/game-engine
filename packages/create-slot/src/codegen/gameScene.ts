import type { Answers } from '../answers';

export function genGameScene(a: Answers): string {
  const cascade = a.cascades === true;

  const present = cascade
    ? `  /** Render one normalized result (a spin, or one free spin of a bonus). */
  async onSpin(result: SpinData, ctx: RenderContext): Promise<void> {
    const turbo = ctx.turbo > 0;
    // CascadeStepData is structurally a TumbleStep (extra fields optional) — pass through.
    // The running win multiplier is driven by reelConfig.cascade.multiplier (tune it in the sidebar).
    let paid = 0; // this segment's win so far — the bar's WIN climbs with the cascade
    await this.system.cascade(result.steps, {
      turbo,
      onStep: (_i, step) => {
        paid += step.win;
        this.api.shell.reportWin(paid, { durationMs: turbo ? 200 : 380 });
      },
    });
    if (result.totalWin > 0) await this.showBigWin(result.totalWin, ctx);
  }`
    : `  /** Render one normalized result (one spin, or one free spin of a bonus). */
  async onSpin(result: SpinData, ctx: RenderContext): Promise<void> {
    const turbo = ctx.turbo > 0;
    await this.system.spin(result.targetGrid, { turbo });
    if (result.totalWin > 0) await this.showBigWin(result.totalWin, ctx);
  }`;

  return `import { Scene } from '@energy8platform/game-engine/core';
import { createReelSystem, BigWinOverlay, pickTier } from '@energy8platform/game-engine/slot';
import type { ReelSystem, WinTier } from '@energy8platform/game-engine/slot';
import { mountReelDevBridge } from '@energy8platform/game-engine/devtools';
import type { ReelDevBridge } from '@energy8platform/game-engine/devtools';
import type { SlotSceneController, RenderContext, SceneApi } from '@energy8platform/game-engine/host';
import { resolveSymbol } from '../slot/symbols';
import { reelConfig } from '../slot/reelConfig';
import type { SpinData } from '../game/normalize';

/**
 * The host owns the play loop (play -> onSpin -> ack -> drain). This scene only RENDERS:
 *  - onSpin(result, ctx): draw ONE segment (a spin, or one free spin). Put all pacing here.
 *  - onEnterMode(trigger, ctx): fires right before the first free spin (bonus intro).
 *  - onExitMode(last, ctx): fires after the last free spin (bonus summary).
 * ctx gives you { bet, action, mode, formatAmount(value), turbo } — turbo is live (0..3).
 *
 * The reels are the configurable ReelSystem, driven by src/slot/reelConfig.ts. In the dev
 * harness (\`npm run stake\`) the "Reels" sidebar tunes that config LIVE via mountReelDevBridge.
 *
 * Two distinct "overlay" layers, don't mix them up:
 *  - this.container        — the scene's own display list (the reels live here, UNDER the shell).
 *  - api.overlay (SceneApi) — a host-owned modal layer mounted ABOVE the shell (big wins, dialogs).
 */
export class GameScene extends Scene implements SlotSceneController<SpinData> {
  private system!: ReelSystem;
  private bridge?: ReelDevBridge;
  private api!: SceneApi;

  private _vw = 1920;
  private _vh = 1080;

  /** Tiers for the big-win celebration. Below the lowest minMultiplier, no overlay is shown. */
  private readonly winTiers: WinTier[] = [
    { id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0xffd24a },
    { id: 'mega', minMultiplier: 50, title: 'MEGA WIN', accentColor: 0x7ad7ff },
  ];

  async onEnter(): Promise<void> {
    this.system = createReelSystem({ resolve: resolveSymbol, config: reelConfig });
    this.container.addChild(this.system.view);
    // Dev-only: lets the harness "Reels" sidebar tune the reels live (no-op in production / outside the harness).
    this.bridge = mountReelDevBridge({ system: this.system });
    this.layout(this._vw, this._vh);
  }

  /** Injected once, before the first round — grab audio / overlay / safe-area off \`api\` here. */
  onCreate(api: SceneApi): void {
    this.api = api; // e.g. this.sfx = api.audio
  }

  /** Player pressed spin (before the network result) — kick off anticipation here. */
  onSpinStart(): void {}

${present}

  /**
   * Celebrate a win on the host overlay (api.overlay) — a layer ABOVE the shell, so the backdrop
   * covers the control bar. BigWinOverlay paints its own dim, so we pass dim: 0. Resolves when the
   * count-up finishes, or earlier if the player taps to skip (closeOn: 'tap').
   */
  private async showBigWin(win: number, ctx: RenderContext): Promise<void> {
    if (!pickTier(this.winTiers, win, ctx.bet)) return; // below the lowest tier — nothing to show
    await this.api.overlay.show({
      closeOn: 'tap',
      dim: 0,
      build: (layer, size) => {
        const big = new BigWinOverlay({
          tiers: this.winTiers,
          formatMoney: ctx.formatAmount,
          width: size.width,
          height: size.height,
        });
        layer.addChild(big);
        void big.show(win, ctx.bet, ctx.formatAmount).then(() => this.api.overlay.close());
      },
    });
  }

  /** Bonus starting — show an intro. trigger.freeSpins?.total = how many free spins were awarded. */
  async onEnterMode(trigger: SpinData, _ctx: RenderContext): Promise<void> {
    // TODO: show a bonus intro (e.g. "10 FREE SPINS") via api.overlay. Defaults to nothing.
    void trigger;
  }

  /** Bonus finished — show a summary. ctx.formatAmount(last.totalWin) = the bonus total win. */
  async onExitMode(last: SpinData, ctx: RenderContext): Promise<void> {
    // TODO: show a bonus summary via api.overlay. Defaults to nothing.
    void last; void ctx;
  }

  /** Round fully drained — controls are unlocked; settle back to idle here. */
  onSpinEnd(_result: SpinData, _ctx: RenderContext): void {}

  onResize(width: number, height: number): void {
    this._vw = width;
    this._vh = height;
    this.layout(width, height);
  }

  /** Tear down the reel system + dev bridge with the scene. */
  onDestroy(): void {
    this.bridge?.dispose();
    this.system?.destroy();
  }

  private layout(w: number, h: number): void {
    this._vw = w; this._vh = h;
    if (!this.system) return;
    const { cols, rows, cellSize, gap } = reelConfig.grid;
    const gridW = cols * cellSize + (cols - 1) * gap;
    const gridH = rows * cellSize + (rows - 1) * gap;
    const fit = Math.min((w * 0.92) / gridW, (h * 0.78) / gridH);
    this.system.view.scale.set(fit);
    this.system.view.x = Math.round((w - gridW * fit) / 2);
    this.system.view.y = Math.round((h - gridH * fit) / 2);
  }
}
`;
}
