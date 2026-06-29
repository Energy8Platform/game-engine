// examples/reel-lab/src/customFeatures.ts
//
// Demonstrates that games can register their OWN ReelFeature mechanics — these are NOT built into
// the engine. They use only the public FeatureContext primitives (grid geometry, the fx overlay,
// resolve, Tween) and are registered via `createReelSystem({ features: [...] })`.

import { Container, Graphics } from 'pixi.js';
import { Tween, Easing } from '@energy8platform/game-engine/animation';
import type { ReelFeature, FeatureContext } from '@energy8platform/game-engine/slot';

/** hot-ross style: highlight a whole reel (column) with a pulsing frame. */
export const ReelHighlight: ReelFeature = {
  key: 'custom:reelHighlight',
  label: '★ Reel highlight (custom)',
  enabled: () => true, // custom features manage their own gating
  async demo(ctx: FeatureContext) {
    const col = Math.floor(ctx.grid.cols / 2);
    const cs = ctx.grid.cellSize;
    const rows = ctx.grid.rowsOf(col);
    const top = ctx.grid.cellPosition(col, 0);
    ctx.log?.(`(custom) Reel highlight on reel ${col}`);
    const g = new Graphics()
      .roundRect(top.x - cs / 2 - 2, top.y - cs / 2 - 2, cs + 4, rows * cs + 4, 12)
      .stroke({ color: 0xffea3a, width: 4, alpha: 0.95 });
    ctx.fx.addChild(g);
    for (let i = 0; i < 3; i++) {
      await Tween.to(g, { alpha: 0.3 }, 260, Easing.easeInOutSine);
      await Tween.to(g, { alpha: 1 }, 260, Easing.easeInOutSine);
    }
    g.destroy();
  },
};

/** stone-rush style: a wild flies from a random cell to the grid centre, then lands. */
export const FlyingWild: ReelFeature = {
  key: 'custom:flyingWild',
  label: '★ Flying wild (custom)',
  enabled: () => true,
  async demo(ctx: FeatureContext) {
    const col = ctx.grid.cols - 1;
    const row = Math.floor(ctx.grid.rowsOf(col) / 2);
    const from = ctx.grid.cellPosition(col, row);
    const cx = ((ctx.grid.cols - 1) * ctx.grid.cellSize) / 2;
    const cy = ((ctx.grid.rows - 1) * ctx.grid.cellSize) / 2;

    const view = ctx.resolve('wild');
    if (!view) return;
    const flyer = new Container();
    view.resize?.(ctx.grid.cellSize);
    flyer.addChild(view);
    flyer.position.set(from.x, from.y);
    ctx.fx.addChild(flyer);
    ctx.log?.('(custom) Flying wild → centre');

    await Tween.to(flyer, { 'scale.x': 1.6, 'scale.y': 1.6 }, 180, Easing.easeOutBack);
    await Tween.to(flyer, { 'position.x': cx, 'position.y': cy }, 640, Easing.easeInOutQuad);
    // land: drop the wild onto the centre cell
    const cc = Math.floor(ctx.grid.cols / 2);
    const cr = Math.floor(ctx.grid.rowsOf(cc) / 2);
    ctx.grid.getCell(cc, cr).setData({ symbol: 'wild' });
    await Tween.to(flyer, { 'scale.x': 0.2, 'scale.y': 0.2, alpha: 0 }, 200, Easing.easeInBack);
    flyer.destroy();
  },
};

export const CUSTOM_FEATURES: ReelFeature[] = [ReelHighlight, FlyingWild];
