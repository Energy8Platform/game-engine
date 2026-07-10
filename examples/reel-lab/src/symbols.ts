// examples/reel-lab/src/symbols.ts
//
// A purely procedural symbol set (no art assets) so the lab is self-contained. Each symbol id
// maps to a coloured rounded tile with a glyph. Implements the engine's SymbolView lifecycle.

import { Container, Graphics, Text } from 'pixi.js';
import { Tween, Easing } from '@energy8platform/game-engine/animation';
import type { SymbolResolver, SymbolView } from '@energy8platform/game-engine/slot';

interface SymbolDef {
  glyph: string;
  color: number;
  kind: 'high' | 'low' | 'wild' | 'scatter' | 'special';
}

export const SYMBOLS: Record<string, SymbolDef> = {
  wild: { glyph: 'W', color: 0xffd24a, kind: 'wild' },
  scatter: { glyph: '★', color: 0xff4d8d, kind: 'scatter' },
  coin: { glyph: '$', color: 0xffcf5c, kind: 'special' },
  mystery: { glyph: '?', color: 0x8b5cf6, kind: 'special' },
  split: { glyph: '✂', color: 0x9b5cff, kind: 'special' },
  h1: { glyph: '◆', color: 0xff5a5a, kind: 'high' },
  h2: { glyph: '⬢', color: 0x4dd0ff, kind: 'high' },
  h3: { glyph: '⬣', color: 0x6ad55a, kind: 'high' },
  l1: { glyph: 'A', color: 0xc97f5a, kind: 'low' },
  l2: { glyph: 'K', color: 0x7f9bc9, kind: 'low' },
  l3: { glyph: 'Q', color: 0xc95a9b, kind: 'low' },
  l4: { glyph: 'J', color: 0x5ac9a0, kind: 'low' },
  l5: { glyph: '10', color: 0x9b9bc9, kind: 'low' },
};

export const SYMBOL_IDS = Object.keys(SYMBOLS);
export const LOW_IDS = SYMBOL_IDS.filter((id) => SYMBOLS[id].kind === 'low');
export const HIGH_IDS = SYMBOL_IDS.filter((id) => SYMBOLS[id].kind === 'high');
/** Symbols used to fill a normal random board. */
export const PAY_IDS = [...HIGH_IDS, ...LOW_IDS];

class TileSymbol extends Container implements SymbolView {
  private _bg = new Graphics();
  private _label: Text;
  private _w = 64;
  private _h = 64;
  private _idle: { kill: boolean } | null = null;
  constructor(private def: SymbolDef) {
    super();
    this.addChild(this._bg);
    this._label = new Text({
      text: def.glyph,
      style: { fontSize: 28, fill: 0x0b1020, fontWeight: '800' },
    });
    this._label.anchor.set(0.5);
    this.addChild(this._label);
    this.resize({ width: this._w, height: this._h });
  }
  // The engine passes a rectangular {width,height} (per-strip geometry); accept a scalar too.
  resize(size: number | { width: number; height: number }): void {
    const { width, height } = typeof size === 'number' ? { width: size, height: size } : size;
    this._w = width;
    this._h = height;
    // fill the whole cell so the grid `gap` is the only spacing — at gap:0 tiles sit flush
    const r = Math.max(4, Math.min(width, height) * 0.12);
    this._bg.clear();
    this._bg.roundRect(-width / 2, -height / 2, width, height, r).fill({ color: this.def.color });
    this._bg
      .roundRect(-width / 2, -height / 2, width, height, r)
      .stroke({ color: 0x0b1020, width: 2, alpha: 0.5 });
    this._label.style.fontSize = Math.round(Math.min(width, height) * 0.42);
  }
  playWin(): Promise<void> {
    return Tween.to(this, { 'scale.x': 1.18, 'scale.y': 1.18 }, 150, Easing.easeOutBack).then(() =>
      Tween.to(this, { 'scale.x': 1, 'scale.y': 1 }, 130, Easing.easeOutQuad),
    );
  }
  playIdle(): void {
    // gentle breathe for high/wild/scatter symbols
    if (this.def.kind === 'low') return;
    const loop = async () => {
      while (this._idle && !this._idle.kill) {
        await Tween.to(this, { 'scale.x': 1.04, 'scale.y': 1.04 }, 900, Easing.easeInOutSine);
        if (!this._idle || this._idle.kill) break;
        await Tween.to(this, { 'scale.x': 1, 'scale.y': 1 }, 900, Easing.easeInOutSine);
      }
    };
    this._idle = { kill: false };
    void loop();
  }
  showStatic(): void {
    if (this._idle) this._idle.kill = true;
    this._idle = null;
    this.scale.set(1);
  }
  destroy(): void {
    this.showStatic();
    super.destroy();
  }
}

export function createResolver(): SymbolResolver {
  return (id: string): SymbolView | null => {
    const def = SYMBOLS[id] ?? { glyph: id.slice(0, 2), color: 0x556070, kind: 'low' as const };
    return new TileSymbol(def);
  };
}
