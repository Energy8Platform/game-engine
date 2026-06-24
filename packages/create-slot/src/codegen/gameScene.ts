import type { Answers } from '../answers';

export function genGameScene(a: Answers): string {
  const cascade = a.cascades === true;
  const ctrl = cascade ? 'CascadeController' : 'ReelSpinController';

  const present = cascade
    ? `  /** Render one normalized result. Tune MultiplierAccumulator policy/reset() to your mechanic. */
  async present(result: SpinData, ctx: RenderContext): Promise<void> {
    const turbo = ctx.turbo > 0;
    if (typeof result.multiplier === 'number') this.multiplier.set(result.multiplier);
    for (const step of result.steps) await this.controller.run(step, { turbo });
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, ctx.bet, ctx.formatAmount);
  }`
    : `  /** Render one normalized result (one spin, or one free spin of a bonus). */
  async present(result: SpinData, ctx: RenderContext): Promise<void> {
    const turbo = ctx.turbo > 0;
    await this.controller.run({ targetGrid: result.targetGrid }, { turbo });
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, ctx.bet, ctx.formatAmount);
  }`;

  const multiplierImport = cascade ? ', MultiplierAccumulator' : '';
  const multiplierField = cascade
    ? `  private readonly multiplier = new MultiplierAccumulator({ policy: 'session' });\n` : '';

  return `import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, ${ctrl}, BigWinOverlay${multiplierImport} } from '@energy8platform/game-engine/slot';
import type { SlotSceneController, RenderContext } from '@energy8platform/game-engine/host';
import { model } from '../game.spec';
import { resolveSymbol } from '../slot/symbols';
import type { SpinData } from '../game/normalize';

/**
 * The host owns the play loop (play -> present -> ack -> drain). This scene only RENDERS:
 *  - present(result, ctx): draw ONE segment (a spin, or one free spin). Put all pacing here.
 *  - onBonusEnter(trigger, ctx): fires right before the first free spin (bonus intro).
 *  - onBonusExit(last, ctx): fires after the last free spin (bonus summary).
 * ctx gives you { bet, action, mode, formatAmount(value), turbo } — turbo is live (0..3).
 */
export class GameScene extends Scene implements SlotSceneController<SpinData> {
  private grid!: ReelGrid;
  private controller!: ${ctrl};
  private overlay!: BigWinOverlay;
${multiplierField}
  private _vw = 1920;
  private _vh = 1080;

  async onEnter(): Promise<void> {
    const { cols, rows } = model.spec.grid;
    this.grid = new ReelGrid({ cols, rows, cellSize: 110, gap: 6, resolve: resolveSymbol });
    this.container.addChild(this.grid);
    this.controller = new ${ctrl}(this.grid);
    this.overlay = new BigWinOverlay({
      tiers: [
        { id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0xffd24a },
        { id: 'mega', minMultiplier: 50, title: 'MEGA WIN', accentColor: 0x7ad7ff },
      ],
      formatMoney: (v) => v.toFixed(2),
      width: 1920, height: 1080,
    });
    this.container.addChild(this.overlay);
    this.layout(this._vw, this._vh);
  }

${present}

  /** Bonus starting — show an intro. trigger.freeSpins?.total = how many free spins were awarded. */
  async onBonusEnter(trigger: SpinData, _ctx: RenderContext): Promise<void> {
    // TODO: show a bonus intro (e.g. "10 FREE SPINS"). Defaults to nothing.
    void trigger;
  }

  /** Bonus finished — show a summary. ctx.formatAmount(last.totalWin) = the bonus total win. */
  async onBonusExit(last: SpinData, ctx: RenderContext): Promise<void> {
    // TODO: show a bonus summary. Defaults to nothing.
    void last; void ctx;
  }

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
    this.overlay?.resize?.(w, h);
  }
}
`;
}
