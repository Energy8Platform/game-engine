import type { Answers } from '../answers';

export function genGameScene(a: Answers): string {
  const cascade = a.mechanic === 'cascade';
  const ctrl = cascade ? 'CascadeController' : 'ReelSpinController';
  const runBlock = cascade
    ? `    // cascade: animate each step the Lua returned
    for (const step of (result.data.cascades ?? [])) {
      await this.controller.run({
        winningCells: step.winning ?? [], removedCells: step.removed ?? [],
        newCells: step.new ?? [], settledGrid: step.grid ?? [],
      } as any);
    }`
    : `    // lines/ways: spin the reels onto the result matrix, then present wins
    await this.controller.run({ targetGrid: (result.data.matrix ?? []) as any });`;
  return `import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, ${ctrl}, BigWinOverlay } from '@energy8platform/game-engine/slot';
import type { SlotSceneController } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { resolveSymbol } from './slot/symbols';

export class GameScene extends Scene implements SlotSceneController {
  private grid!: ReelGrid;
  private controller!: ${ctrl};
  private overlay!: BigWinOverlay;
  private bet = model.spec.defaultBet ?? model.spec.betLevels[0];

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

  setBet(bet: number): void { this.bet = bet; }

  async spin(bet: number): Promise<void> {
    const ps = (this as unknown as { __engineApp?: { platformSession?: { play(p: unknown): Promise<{ totalWin: number; data: any }> } } }).__engineApp?.platformSession;
    if (!ps) return;
    const result = await ps.play({ action: 'spin', bet });
${runBlock}
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, bet);
  }
}
`;
}
