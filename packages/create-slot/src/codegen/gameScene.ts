import type { Answers } from '../answers';

export function genGameScene(a: Answers): string {
  const cascade = a.cascades === true;
  const ctrl = cascade ? 'CascadeController' : 'ReelSpinController';

  const present = cascade
    ? `  /** Render one normalized result. Tune MultiplierAccumulator policy/reset() to your mechanic. */
  async onSpin(result: SpinData, ctx: RenderContext): Promise<void> {
    const turbo = ctx.turbo > 0;
    if (typeof result.multiplier === 'number') this.multiplier.set(result.multiplier);
    for (const step of result.steps) await this.controller.run(step, { turbo });
    if (result.totalWin > 0) await this.showBigWin(result.totalWin, ctx);
  }`
    : `  /** Render one normalized result (one spin, or one free spin of a bonus). */
  async onSpin(result: SpinData, ctx: RenderContext): Promise<void> {
    const turbo = ctx.turbo > 0;
    await this.controller.run({ targetGrid: result.targetGrid }, { turbo });
    if (result.totalWin > 0) await this.showBigWin(result.totalWin, ctx);
  }`;

  const multiplierImport = cascade ? ', MultiplierAccumulator' : '';
  const multiplierField = cascade
    ? `  private readonly multiplier = new MultiplierAccumulator({ policy: 'session' });\n` : '';

  return `import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, ${ctrl}, BigWinOverlay, pickTier${multiplierImport} } from '@energy8platform/game-engine/slot';
import type { WinTier } from '@energy8platform/game-engine/slot';
import type { SlotSceneController, RenderContext, SceneApi } from '@energy8platform/game-engine/host';
import { model } from '../game.spec';
import { resolveSymbol } from '../slot/symbols';
import type { SpinData } from '../game/normalize';

/**
 * The host owns the play loop (play -> onSpin -> ack -> drain). This scene only RENDERS:
 *  - onSpin(result, ctx): draw ONE segment (a spin, or one free spin). Put all pacing here.
 *  - onEnterMode(trigger, ctx): fires right before the first free spin (bonus intro).
 *  - onExitMode(last, ctx): fires after the last free spin (bonus summary).
 * ctx gives you { bet, action, mode, formatAmount(value), turbo } — turbo is live (0..3).
 *
 * Two distinct "overlay" layers, don't mix them up:
 *  - this.container        — the scene's own display list (the grid lives here, UNDER the shell).
 *  - api.overlay (SceneApi) — a host-owned modal layer mounted ABOVE the shell. Big wins, bonus
 *    intros/summaries and dialogs go here so their dim actually covers the control bar.
 */
export class GameScene extends Scene implements SlotSceneController<SpinData> {
  private grid!: ReelGrid;
  private controller!: ${ctrl};
  private api!: SceneApi;
${multiplierField}
  private _vw = 1920;
  private _vh = 1080;

  /** Tiers for the big-win celebration. Below the lowest minMultiplier, no overlay is shown. */
  private readonly winTiers: WinTier[] = [
    { id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0xffd24a },
    { id: 'mega', minMultiplier: 50, title: 'MEGA WIN', accentColor: 0x7ad7ff },
  ];

  async onEnter(): Promise<void> {
    const { cols, rows } = model.spec.grid;
    this.grid = new ReelGrid({ cols, rows, cellSize: 110, gap: 6, resolve: resolveSymbol });
    this.container.addChild(this.grid);
    this.controller = new ${ctrl}(this.grid);
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

  private layout(w: number, h: number): void {
    this._vw = w; this._vh = h;
    if (!this.grid) return;
    const cols = model.spec.grid.cols, rows = model.spec.grid.rows;
    const cellSize = 110, gap = 6;            // must match the ReelGrid constructor above
    const gridW = cols * cellSize + (cols - 1) * gap;
    const gridH = rows * cellSize + (rows - 1) * gap;
    const fit = Math.min((w * 0.92) / gridW, (h * 0.78) / gridH);
    this.grid.scale.set(fit);
    this.grid.x = Math.round((w - gridW * fit) / 2);
    this.grid.y = Math.round((h - gridH * fit) / 2);
  }
}
`;
}
