/**
 * `@energy8platform/game-engine/golem` — golem rigs (`@energy8platform/golem`) in a game.
 *
 * Optional peer, like Spine: only games with rigs import this entry. A rig is a `rig.json` plus the PNGs
 * beside it under `public/`; `loadRig` fetches both through pixi `Assets`, and the result instantiates as a
 * `RigSymbol` in a reel cell (it IS a `SymbolView`, checked below) or a `RigPlayer` anywhere on stage.
 *
 * @example
 * ```ts
 * const rigs = await loadRigs({ h1: 'assets/rigs/h1/rig.json' });
 * const resolveSymbol: SymbolResolver = (id) =>
 *   rigs[id] ? new RigSymbol(rigs[id].doc, rigs[id].textures, { size: 110 }) : new AnimatedSymbol(...);
 * ```
 */
import { Assets, type Texture } from 'pixi.js';
import { RigSymbol, createTextures, parse, type RigDocument } from '@energy8platform/golem/runtime';
import type { SymbolView } from '../slot/grid/SymbolView';

export { RigPlayer, RigSymbol, AnimationState, createTextures, parse } from '@energy8platform/golem/runtime';
export type { RigDocument, RigSymbolOptions, SymbolSize, PlayOptions } from '@energy8platform/golem/runtime';

/** A rig ready to instantiate: the parsed document and one Texture per asset. */
export interface Rig {
  doc: RigDocument;
  textures: Map<string, Texture>;
}

/** Load `url` (a rig.json) and every asset beside it through pixi Assets (cached by URL, so repeats are free). */
export async function loadRig(url: string): Promise<Rig> {
  const doc = parse(await Assets.load<unknown>(url));
  const dir = url.slice(0, url.lastIndexOf('/') + 1);
  const textures = await createTextures(doc, (src) => Assets.load<Texture>(dir + src));
  return { doc, textures };
}

/** `loadRig` for each entry, keyed the same way. A missing file rejects — a rig the game names must exist. */
export async function loadRigs<K extends string>(urls: Record<K, string>): Promise<Record<K, Rig>> {
  const entries = await Promise.all(
    (Object.entries(urls) as [K, string][]).map(async ([key, url]) => [key, await loadRig(url)] as const),
  );
  return Object.fromEntries(entries) as Record<K, Rig>;
}

// compile-time contract: a RigSymbol IS a SymbolView. A drift in either interface fails `npm run typecheck`
// here, in the engine, instead of in a game at runtime. The lifecycle is restated as function PROPERTIES:
// method signatures compare bivariantly, so a plain `const c: SymbolView = rigSymbol` would accept a
// `resize(size: number)` that the cell then calls with `{ width, height }`.
type Lifecycle = {
  [K in 'playIdle' | 'playWin' | 'showStatic' | 'resize']-?: NonNullable<SymbolView[K]> extends (
    ...a: infer A
  ) => infer R
    ? (...a: A) => R
    : never;
};
const _contract: Lifecycle & SymbolView = null as unknown as RigSymbol;
void _contract;
