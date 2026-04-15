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
import {
  Button, Label, Panel, FlexContainer, ProgressBar,
  ScrollContainer, Modal, Toast, BalanceDisplay, WinDisplay, Layout,
} from '../ui';

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
 * Register all engine UI components for JSX use.
 * Call once at app startup before rendering React scenes that use UI components.
 *
 * @example
 * ```ts
 * extendPixiElements();
 * extendUIElements();
 *
 * // Now you can use:
 * // <button text="SPIN" onPress={handler} />
 * // <flexContainer direction="row" gap={16}>...</flexContainer>
 * // <label text="Hello" style-fontSize={24} />
 * ```
 */
export function extendUIElements(): void {
  extend({
    Button, Label, Panel, FlexContainer, ProgressBar,
    ScrollContainer, Modal, Toast, BalanceDisplay, WinDisplay, Layout,
  });
}

/**
 * Register additional custom components for JSX use.
 * Pass an object mapping component names to their constructors.
 */
export function extendCustomElements(components: Record<string, any>): void {
  extend(components);
}
