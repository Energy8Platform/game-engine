import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { Container, Graphics, Text } from 'pixi.js';
import { IconView } from '@/ui/pixi-hb/pixi-icon';
import { openSMenu } from '@/ui/pixi-s/components/Menu';
import { openSGameInfo } from '@/ui/pixi-s/components/GameInfo';
import { openSBuyBonus } from '@/ui/pixi-s/components/BuyBonus';
import { openSBetPicker } from '@/ui/pixi-s/components/pickers';
import { buildSReplayModal } from '@/ui/pixi-s/components/ReplayModal';
import { makeContext, defaultConfig } from '../pixi/_host';

/** Every shape and stroke drawn under `root`, skipping glyphs (SVG paths in IconView / sIcon). */
function offenders(root: Container): string[] {
  const out: string[] = [];
  const walk = (n: Container, path: string): void => {
    if (n instanceof IconView || n.label === 's-glyph') return;
    if (n instanceof Graphics) {
      for (const ins of n.context.instructions) {
        if (ins.action === 'stroke') out.push(`${path}: stroke`);
        const prims = (ins.data as { path?: { shapePath: { shapePrimitives: Array<{ shape: { type: string; radius?: number } }> } } }).path?.shapePath.shapePrimitives ?? [];
        for (const p of prims) {
          const t = p.shape.type;
          if (t === 'circle' || t === 'ellipse') out.push(`${path}: ${t}`);
          if (t === 'roundedRectangle' && (p.shape.radius ?? 0) > 0) out.push(`${path}: roundRect r=${p.shape.radius}`);
        }
      }
    }
    if (n instanceof Text && n.style.stroke != null) out.push(`${path}: text stroke "${n.text}"`);
    n.children.forEach((c, i) => walk(c as Container, `${path}/${c.label || c.constructor.name}#${i}`));
  };
  walk(root, root.constructor.name);
  return out;
}

const CFG = defaultConfig({
  balance: 1000,
  gameInfo: {
    sections: [
      { type: 'modes', modes: [{ title: 'Base', price: '1×', rtp: 96.5, maxWin: '5,000×', description: 'd' }] },
      { type: 'controls' },
      { type: 'paytable', rows: [{ symbol: { text: 'A' }, wins: [{ count: '5', multiplier: 10 }] }] },
      { type: 'wins', kind: 'classic', grid: { cols: 5, rows: 3 }, lines: [[1, 1, 1, 1, 1]] },
      { type: 'wins', kind: 'cluster', grid: { cols: 6, rows: 5 }, minCount: 5 },
      { type: 'custom', title: 'Rules', html: '<p>Rules</p>' },
    ],
  },
  features: {
    turbo: 2,
    autoplay: {},
    buyBonus: [
      { id: 'f', type: 'feature', title: 'Ante', description: 'x', priceMultiplier: 1.25, volatility: 2 },
      { id: 'b', type: 'bonus', title: 'FS', description: 'y', priceMultiplier: 10, volatility: 5 },
    ],
  },
});

describe('S overlays: no rounding and no outlines anywhere', () => {
  const host = () => makeContext({ screenW: 1280, screenH: 720, config: CFG });
  it('menu', () => {
    expect(offenders(openSMenu(host(), () => ({ x: 16, y: 540, w: 64, h: 40 }), () => null, () => 1))).toEqual([]);
  });
  it('game info', () => {
    expect(offenders(openSGameInfo(host()))).toEqual([]);
  });
  it('buy bonus (with its confirm open)', () => {
    const p = openSBuyBonus(host())!;
    (p as unknown as { ctas: Array<{ emit(e: string, a: unknown): void }> }).ctas[1].emit('pointertap', {});
    expect(offenders(p)).toEqual([]);
  });
  it('bet picker and replay modal', () => {
    expect(offenders(openSBetPicker(host()))).toEqual([]);
    expect(offenders(buildSReplayModal(host(), { bonusId: 'b', bet: 1, payoutMultiplier: 2, onReplay: () => {} }, () => {}))).toEqual([]);
  });
});
