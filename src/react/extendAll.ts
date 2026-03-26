import {
  Container,
  Sprite,
  Graphics,
  Text,
  AnimatedSprite,
  NineSliceSprite,
  TilingSprite,
  Mesh,
  MeshPlane,
  MeshRope,
  MeshSimple,
  BitmapText,
  HTMLText,
} from 'pixi.js';
import { extend } from './catalogue';

/**
 * Register all standard PixiJS display objects for JSX use.
 * Call once at app startup before rendering any React scenes.
 */
export function extendPixiElements(): void {
  extend({
    Container,
    Sprite,
    Graphics,
    Text,
    AnimatedSprite,
    NineSliceSprite,
    TilingSprite,
    Mesh,
    MeshPlane,
    MeshRope,
    MeshSimple,
    BitmapText,
    HTMLText,
  });
}

/**
 * Register @pixi/layout components for JSX use.
 * Pass the dynamically imported module:
 *
 * ```ts
 * const layout = await import('@pixi/layout/components');
 * extendLayoutElements(layout);
 * ```
 */
export function extendLayoutElements(layoutModule: Record<string, any>): void {
  extend(layoutModule);
}
