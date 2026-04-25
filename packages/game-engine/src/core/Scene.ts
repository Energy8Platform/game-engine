import { Container } from 'pixi.js';
import type { IScene } from '../types';

/**
 * Base class for all scenes.
 * Provides a root PixiJS Container and lifecycle hooks.
 *
 * @example
 * ```ts
 * class MenuScene extends Scene {
 *   async onEnter() {
 *     const bg = Sprite.from('menu-bg');
 *     this.container.addChild(bg);
 *   }
 *
 *   onUpdate(dt: number) {
 *     // per-frame logic
 *   }
 *
 *   onResize(width: number, height: number) {
 *     // reposition UI
 *   }
 * }
 * ```
 */
export abstract class Scene implements IScene {
  public readonly container: Container;

  constructor() {
    this.container = new Container();
    this.container.label = this.constructor.name;
  }

  /** Called when this scene becomes active. Override in subclass. */
  onEnter?(data?: unknown): Promise<void> | void;

  /** Called when this scene is deactivated. Override in subclass. */
  onExit?(): Promise<void> | void;

  /** Called every frame with delta time (in seconds). Override in subclass. */
  onUpdate?(dt: number): void;

  /** Called when the viewport resizes. Override in subclass. */
  onResize?(width: number, height: number): void;

  /** Cleanup — called when the scene is permanently removed. */
  onDestroy?(): void;
}
