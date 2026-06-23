// examples/spec-slot/GameScene.ts
import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, CascadeController, BigWinOverlay, FreeSpinsSession, MultiplierAccumulator } from '@energy8platform/game-engine/slot';
import type { SlotSceneController, SlotHostApi } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { resolveSymbol } from './slot/symbols';
import type { SpinData } from './normalize';

export class GameScene extends Scene implements SlotSceneController<SpinData> {
  private grid!: ReelGrid;
  private controller!: CascadeController;
  private overlay!: BigWinOverlay;
  private readonly multiplier = new MultiplierAccumulator({ policy: 'session' });
  private host?: SlotHostApi<SpinData>;
  private bet = model.spec.defaultBet ?? model.spec.betLevels[0];

  bindHost(api: SlotHostApi<SpinData>): void { this.host = api; }
  setBet(bet: number): void { this.bet = bet; }

  async buyBonus(actionId: string, bet: number): Promise<void> {
    if (!this.host) return;
    const result = await this.host.play(actionId, bet);
    if (typeof result.multiplier === 'number') this.multiplier.set(result.multiplier);
    for (const step of result.steps) await this.controller.run(step);
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, bet);
    if ((result.freeSpins?.awarded ?? 0) > 0) {
      const fs = new FreeSpinsSession({ initialSpins: result.freeSpins?.total ?? result.freeSpins?.awarded ?? 0 });
      while (!fs.isComplete) {
        const r = await this.host.play('free_spin', bet);
        for (const step of r.steps) await this.controller.run(step);
        if (r.totalWin > 0) await this.overlay.show(r.totalWin, bet);
        fs.addWin(r.totalWin); fs.award(r.freeSpins?.awarded ?? 0); fs.consume();
      }
    }
  }

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
  }

  async spin(bet: number): Promise<void> {
    if (!this.host) return;
    const result = await this.host.play('spin', bet);
    if (typeof result.multiplier === 'number') this.multiplier.set(result.multiplier);
    for (const step of result.steps) await this.controller.run(step);
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, bet);
    if ((result.freeSpins?.awarded ?? 0) > 0) {
      const fs = new FreeSpinsSession({ initialSpins: result.freeSpins?.total ?? result.freeSpins?.awarded ?? 0 });
      while (!fs.isComplete) {
        const r = await this.host.play('free_spin', bet);
        for (const step of r.steps) await this.controller.run(step);
        if (r.totalWin > 0) await this.overlay.show(r.totalWin, bet);
        fs.addWin(r.totalWin); fs.award(r.freeSpins?.awarded ?? 0); fs.consume();
      }
    }
  }
}
