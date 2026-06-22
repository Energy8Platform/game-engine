import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, BigWinOverlay } from '@energy8platform/game-engine/slot';
import { model } from './game.spec';
import { resolveSymbol } from './slot/symbols';

export class GameScene extends Scene {
  async onEnter(): Promise<void> {
    const { cols, rows } = model.spec.grid;
    const grid = new ReelGrid({ cols, rows, cellSize: 96, gap: 6, resolve: resolveSymbol });
    this.container.addChild(grid);

    const overlay = new BigWinOverlay({
      tiers: [{ id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0xffd24a }],
      formatMoney: (v) => `€${v.toFixed(2)}`,
      width: 1920,
      height: 1080,
    });
    this.container.addChild(overlay);
  }
}
