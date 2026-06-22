import { Texture } from 'pixi.js';
import { AnimatedSymbol, type SymbolResolver } from '@energy8platform/game-engine/slot';

// Placeholder resolver: every symbol is a blank tile. Swap in real textures from public/assets/symbols.
export const resolveSymbol: SymbolResolver = (id: string) =>
  new AnimatedSymbol({ textures: { base: id ? Texture.WHITE : Texture.EMPTY }, size: 110 });
