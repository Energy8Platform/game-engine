import type { Answers } from '../answers';

export function genGameScene(a: Answers): string {
  const cascade = a.mechanic === 'cascade' || a.mechanic === 'cluster' || a.cascades === true;
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

  return `import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, ${ctrl}, BigWinOverlay, FreeSpinsSession, MultiplierAccumulator } from '@energy8platform/game-engine/slot';
import type { SlotSceneController, SlotHostApi } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { resolveSymbol } from './slot/symbols';
import type { SpinData } from './game/normalize';

export class GameScene extends Scene implements SlotSceneController<SpinData> {
  private grid!: ReelGrid;
  private controller!: ${ctrl};
  private overlay!: BigWinOverlay;
  private readonly multiplier = new MultiplierAccumulator({ policy: 'session' });
  private host?: SlotHostApi<SpinData>;
  private bet = model.spec.defaultBet ?? model.spec.betLevels[0];

  bindHost(api: SlotHostApi<SpinData>): void { this.host = api; }
  setBet(bet: number): void { this.bet = bet; }

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
  }

  async spin(bet: number): Promise<void> {
    if (!this.host) return;
    const result = await this.host.play('spin', bet);
    await this.present(result, bet);
    if ((result.freeSpins?.awarded ?? 0) > 0) await this.runFreeSpins(result, bet);
  }

  /** Drive the free-spins session: replay 'free_spin' until it completes. */
  private async runFreeSpins(trigger: SpinData, bet: number): Promise<void> {
    const fs = new FreeSpinsSession({ initialSpins: trigger.freeSpins?.total ?? trigger.freeSpins?.awarded ?? 0 });
    while (!fs.isComplete) {
      const r = await this.host!.play('free_spin', bet);
      await this.present(r, bet);
      fs.addWin(r.totalWin);
      fs.award(r.freeSpins?.awarded ?? 0); // retrigger
      fs.consume();
    }
  }

${present}
}
`;
}
