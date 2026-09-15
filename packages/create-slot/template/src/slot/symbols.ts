import { Texture } from 'pixi.js';
import { AnimatedSymbol, type SymbolResolver } from '@energy8platform/game-engine/slot';
import { loadRigs, RigSymbol, type Rig } from '@energy8platform/game-engine/golem';

const SIZE = 110;

/**
 * Symbols with a golem rig in public/assets/rigs/<id>/rig.json — animated skeletons instead of sprites.
 * Author them with `npm run rigs` (the editor; `new` creates a folder here). List them explicitly: a rig
 * the game names must exist, the loader does not probe for 404s.
 */
const RIGGED: string[] = [];
let rigs: Record<string, Rig> = {};

/** Call once before the first resolveSymbol (GameScene.onEnter does). */
export async function loadSymbolRigs(): Promise<void> {
  rigs = await loadRigs(Object.fromEntries(RIGGED.map((id) => [id, `assets/rigs/${id}/rig.json`])));
}

// Placeholder resolver: every symbol is a blank tile. Swap in real textures from public/assets/symbols.
export const resolveSymbol: SymbolResolver = (id: string) =>
  rigs[id]
    ? new RigSymbol(rigs[id].doc, rigs[id].textures, { size: SIZE })
    : new AnimatedSymbol({ textures: { base: id ? Texture.WHITE : Texture.EMPTY }, size: SIZE });
