/** Mutable catalogue: PascalCase name -> PixiJS constructor */
export const catalogue: Record<string, any> = {};

/**
 * Register PixiJS classes for use as JSX elements.
 * Keys must be PascalCase; JSX uses the camelCase equivalent.
 *
 * @example
 * ```ts
 * import { Container, Sprite, Text } from 'pixi.js';
 * extend({ Container, Sprite, Text });
 * // Now <container>, <sprite>, <text> work in JSX
 * ```
 */
export function extend(components: Record<string, any>): void {
  Object.assign(catalogue, components);
}
