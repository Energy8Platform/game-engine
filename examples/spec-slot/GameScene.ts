import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, BigWinOverlay } from '@energy8platform/game-engine/slot';
import type { SlotSceneController } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { resolveSymbol } from './slot/symbols';

export class GameScene extends Scene implements SlotSceneController {
  private grid!: ReelGrid;
  private overlay!: BigWinOverlay;
  private bet = model.spec.defaultBet ?? model.spec.betLevels[0];

  async onEnter(): Promise<void> {
    const { cols, rows } = model.spec.grid;
    this.grid = new ReelGrid({ cols, rows, cellSize: 96, gap: 6, resolve: resolveSymbol });
    this.container.addChild(this.grid);
    this.overlay = new BigWinOverlay({
      tiers: [{ id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0xffd24a }],
      formatMoney: (v) => `€${v.toFixed(2)}`,
      width: 1920, height: 1080,
    });
    this.container.addChild(this.overlay);
  }

  setBet(bet: number): void { this.bet = bet; }

  async spin(bet: number): Promise<void> {
    const ps = (this as unknown as { __engineApp?: { platformSession?: { play(p: unknown): Promise<{ totalWin: number }> } } }).__engineApp?.platformSession;
    if (!ps) return;
    const result = await ps.play({ action: 'spin', bet });
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, bet);
  }
}
