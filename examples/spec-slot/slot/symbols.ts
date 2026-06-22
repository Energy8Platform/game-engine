import { Texture } from 'pixi.js';
import { AnimatedSymbol, type SymbolResolver } from '@energy8platform/game-engine/slot';

/** Toy resolver: every symbol is an AnimatedSymbol over a blank texture (no real art in the demo). */
export const resolveSymbol: SymbolResolver = (id: string) =>
  new AnimatedSymbol({ textures: { base: id ? Texture.WHITE : Texture.EMPTY }, size: 96 });
