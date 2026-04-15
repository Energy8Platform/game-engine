import { Container, Sprite, Texture } from 'pixi.js';

/**
 * Universal view input type for UI component visual slots.
 *
 * - `string` — texture name, resolved via `Sprite.from()`
 * - `Texture` — wrapped in a `Sprite`
 * - `Container` — used as-is (Sprite, Graphics, NineSliceSprite, AnimatedSprite, custom...)
 */
export type ViewInput = string | Texture | Container;

/**
 * Resolve a ViewInput to a Container instance.
 *
 * @example
 * ```ts
 * resolveView('btn-idle')          // → Sprite.from('btn-idle')
 * resolveView(someTexture)         // → new Sprite(someTexture)
 * resolveView(myCustomContainer)   // → myCustomContainer (as-is)
 * resolveView(undefined)           // → null
 * ```
 */
export function resolveView(input: ViewInput | undefined | null): Container | null {
  if (input == null) return null;
  if (typeof input === 'string') return Sprite.from(input);
  if (input instanceof Texture) return new Sprite(input);
  return input;
}
