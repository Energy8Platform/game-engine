// examples/spec-slot/GameScene.ts
import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, CascadeController, BigWinOverlay, MultiplierAccumulator } from '@energy8platform/game-engine/slot';
import type { SlotSceneController, RenderContext, SceneApi } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { resolveSymbol } from './slot/symbols';
import type { SpinData } from './normalize';

/**
 * The host owns the play loop (play -> onSpin -> ack -> drain). This scene only RENDERS:
 *  - onSpin(result, ctx): draw ONE segment (a spin, or one free spin). Put all pacing here.
 *  - onEnterMode(trigger, ctx): fires right before the first free spin (bonus intro).
 *  - onExitMode(last, ctx): fires after the last free spin (bonus summary).
 * ctx gives you { bet, action, mode, formatAmount(value), turbo } — turbo is live (0..3).
 */
export class GameScene extends Scene implements SlotSceneController<SpinData> {
  private grid!: ReelGrid;
  private controller!: CascadeController;
  private overlay!: BigWinOverlay;
  private readonly multiplier = new MultiplierAccumulator({ policy: 'session' });

  private _vw = 1920;
  private _vh = 1080;

  async onEnter(): Promise<void> {
    const { cols, rows } = model.spec.grid;
    this.grid = new ReelGrid({ cols, rows, cellSize: 96, gap: 6, resolve: resolveSymbol });
    this.container.addChild(this.grid);
    this.controller = new CascadeController(this.grid);
    this.overlay = new BigWinOverlay({
      tiers: [{ id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0xffd24a }],
      formatMoney: (v) => `€${v.toFixed(2)}`,
      width: 1920, height: 1080,
    });
    this.container.addChild(this.overlay);
    this.layout(this._vw, this._vh);
  }

  /** Injected once, before the first round — grab audio / overlay / safe-area off `api` here. */
  onCreate(_api: SceneApi): void {
    // e.g. this.sfx = _api.audio; this.overlay = _api.overlay;
  }

  /** Player pressed spin (before the network result) — kick off anticipation here. */
  onSpinStart(): void {}

  /** Render one normalized result (one spin, or one free spin of a bonus). */
  async onSpin(result: SpinData, ctx: RenderContext): Promise<void> {
    const turbo = ctx.turbo > 0;
    if (typeof result.multiplier === 'number') this.multiplier.set(result.multiplier);
    for (const step of result.steps) await this.controller.run(step, { turbo });
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, ctx.bet, ctx.formatAmount);
  }

  /** Bonus starting — show an intro. trigger.freeSpins?.total = how many free spins were awarded. */
  async onEnterMode(trigger: SpinData, _ctx: RenderContext): Promise<void> {
    // TODO: show a bonus intro. Defaults to nothing.
    void trigger;
  }

  /** Bonus finished — show a summary. ctx.formatAmount(last.totalWin) = the bonus total win. */
  async onExitMode(last: SpinData, ctx: RenderContext): Promise<void> {
    // TODO: show a bonus summary. Defaults to nothing.
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
    const cellSize = 96, gap = 6;            // must match the ReelGrid constructor above
    const gridW = cols * cellSize + (cols - 1) * gap;
    const gridH = rows * cellSize + (rows - 1) * gap;
    const fit = Math.min((w * 0.92) / gridW, (h * 0.78) / gridH);
    this.grid.scale.set(fit);
    this.grid.x = Math.round((w - gridW * fit) / 2);
    this.grid.y = Math.round((h - gridH * fit) / 2);
    this.overlay?.resize?.(w, h);
  }
}
