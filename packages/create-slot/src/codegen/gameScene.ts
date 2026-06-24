import type { Answers } from '../answers';

export function genGameScene(a: Answers): string {
  const cascade = a.cascades === true;
  const ctrl = cascade ? 'CascadeController' : 'ReelSpinController';

  const present = cascade
    ? `  /** Animate one normalized result. Tune MultiplierAccumulator policy/reset() to your mechanic. */
  private async present(result: SpinData, bet: number): Promise<void> {
    if (typeof result.multiplier === 'number') this.multiplier.set(result.multiplier);
    for (const step of result.steps) await this.controller.run(step);
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, bet);
  }`
    : `  private async present(result: SpinData, bet: number): Promise<void> {
    await this.controller.run({ targetGrid: result.targetGrid });
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, bet);
  }`;

  const multiplierImport = cascade ? ', MultiplierAccumulator' : '';
  const multiplierField = cascade
    ? `  private readonly multiplier = new MultiplierAccumulator({ policy: 'session' });\n` : '';

  return `import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, ${ctrl}, BigWinOverlay${multiplierImport} } from '@energy8platform/game-engine/slot';
import type { SlotSceneController, SlotHostApi } from '@energy8platform/game-engine/host';
import { model } from '../game.spec';
import { resolveSymbol } from '../slot/symbols';
import type { SpinData } from '../game/normalize';

export class GameScene extends Scene implements SlotSceneController<SpinData> {
  private grid!: ReelGrid;
  private controller!: ${ctrl};
  private overlay!: BigWinOverlay;
${multiplierField}  private host?: SlotHostApi<SpinData>;
  private bet = model.spec.defaultBet ?? model.spec.betLevels[0];

  bindHost(api: SlotHostApi<SpinData>): void { this.host = api; }
  setBet(bet: number): void { this.bet = bet; }

  async buyBonus(actionId: string, bet: number): Promise<void> {
    if (!this.host) return;
    const result = await this.host.play(actionId, bet);
    await this.present(result, bet);
    this.host.ack(); // settle this segment (post-animation) before the next
    await this.drainRound(result, bet); // play out the bonus free spins (same round, by roundId)
  }

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

  onResize(width: number, height: number): void {
    this._vw = width;
    this._vh = height;
    this.layout(width, height);
  }

  private layout(w: number, h: number): void {
    this._vw = w; this._vh = h;
    if (!this.grid) return;
    const cols = model.spec.grid.cols, rows = model.spec.grid.rows;
    const cellSize = 110, gap = 6;            // must match the ReelGrid constructor below
    const gridW = cols * cellSize + (cols - 1) * gap;
    const gridH = rows * cellSize + (rows - 1) * gap;
    const fit = Math.min((w * 0.92) / gridW, (h * 0.78) / gridH);
    this.grid.scale.set(fit);
    this.grid.x = Math.round((w - gridW * fit) / 2);
    this.grid.y = Math.round((h - gridH * fit) / 2);
    this.overlay?.resize?.(w, h);
  }

  async spin(bet: number): Promise<void> {
    if (!this.host) return;
    const result = await this.host.play('spin', bet);
    await this.present(result, bet);
    this.host.ack(); // settle this segment (post-animation) before the next
    await this.drainRound(result, bet); // play out any free spins (same round, by roundId)
  }

  /** Replay a round recovered on reload (host "Continue"). Present only — the host settles it. */
  async resume(result: SpinData): Promise<void> {
    await this.present(result, this.bet);
  }

  /**
   * Drain the remaining segments of an in-flight round. A bonus is ONE Stake round whose
   * \`events\` are the trigger + every free spin; the bridge streams them one segment per play of
   * the SAME \`roundId\`. We replay \`nextActions[0]\` until the round reports \`complete\`. A plain
   * spin with no bonus is already \`complete\`, so this is a no-op.
   */
  private async drainRound(result: SpinData, bet: number): Promise<void> {
    let r = result;
    while (!r.complete && r.nextActions && r.nextActions.length > 0) {
      r = await this.host!.play(r.nextActions[0], bet, r.roundId);
      await this.present(r, bet);
      this.host!.ack(); // settle each free spin before the next
    }
  }

${present}
}
`;
}
