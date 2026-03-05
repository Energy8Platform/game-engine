import { Container } from 'pixi.js';
import type { IScene, SceneConstructor, TransitionConfig, TransitionType } from '../types';
import { TransitionType as TT } from '../types';
import { Tween } from '../animation/Tween';
import { EventEmitter } from './EventEmitter';

interface SceneEntry {
  scene: IScene;
  key: string;
}

interface SceneManagerEvents {
  change: { from: string | null; to: string };
}

/**
 * Manages the scene stack and transitions between scenes.
 *
 * @example
 * ```ts
 * const scenes = new SceneManager(app.stage);
 * scenes.register('loading', LoadingScene);
 * scenes.register('game', GameScene);
 * await scenes.goto('loading');
 * ```
 */
export class SceneManager extends EventEmitter<SceneManagerEvents> {
  /** Root container that scenes are added to */
  public root!: Container;

  private registry = new Map<string, SceneConstructor>();
  private stack: SceneEntry[] = [];
  private _transitioning = false;

  /** Current viewport dimensions — set by ViewportManager */
  private _width = 0;
  private _height = 0;

  constructor(root?: Container) {
    super();
    if (root) this.root = root;
  }

  /** @internal Set the root container (called by GameApplication after PixiJS init) */
  setRoot(root: Container): void {
    this.root = root;
  }

  /** Register a scene class by key */
  register(key: string, ctor: SceneConstructor): this {
    this.registry.set(key, ctor);
    return this;
  }

  /** Get the current (topmost) scene entry */
  get current(): SceneEntry | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  }

  /** Get the current scene key */
  get currentKey(): string | null {
    return this.current?.key ?? null;
  }

  /** Whether a scene transition is in progress */
  get isTransitioning(): boolean {
    return this._transitioning;
  }

  /**
   * Navigate to a scene, replacing the entire stack.
   */
  async goto(
    key: string,
    data?: unknown,
    transition?: TransitionConfig,
  ): Promise<void> {
    const prevKey = this.currentKey;

    // Exit all current scenes
    while (this.stack.length > 0) {
      await this.popInternal(false);
    }

    // Enter new scene
    await this.pushInternal(key, data, transition);
    this.emit('change', { from: prevKey, to: key });
  }

  /**
   * Push a scene onto the stack (the previous scene stays underneath).
   * Useful for overlays, modals, pause screens.
   */
  async push(
    key: string,
    data?: unknown,
    transition?: TransitionConfig,
  ): Promise<void> {
    const prevKey = this.currentKey;
    await this.pushInternal(key, data, transition);
    this.emit('change', { from: prevKey, to: key });
  }

  /**
   * Pop the top scene from the stack.
   */
  async pop(transition?: TransitionConfig): Promise<void> {
    if (this.stack.length <= 1) {
      console.warn('[SceneManager] Cannot pop the last scene');
      return;
    }
    const prevKey = this.currentKey;
    await this.popInternal(true, transition);
    this.emit('change', { from: prevKey, to: this.currentKey! });
  }

  /**
   * Replace the top scene with a new one.
   */
  async replace(
    key: string,
    data?: unknown,
    transition?: TransitionConfig,
  ): Promise<void> {
    const prevKey = this.currentKey;
    await this.popInternal(false);
    await this.pushInternal(key, data, transition);
    this.emit('change', { from: prevKey, to: key });
  }

  /**
   * Called every frame by GameApplication.
   */
  update(dt: number): void {
    // Update only the top scene
    this.current?.scene.onUpdate?.(dt);
  }

  /**
   * Called on viewport resize.
   */
  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;

    // Notify all scenes in the stack
    for (const entry of this.stack) {
      entry.scene.onResize?.(width, height);
    }
  }

  /**
   * Destroy all scenes and clear the manager.
   */
  destroy(): void {
    for (const entry of this.stack) {
      entry.scene.onDestroy?.();
      entry.scene.container.destroy({ children: true });
    }
    this.stack.length = 0;
    this.registry.clear();
    this.removeAllListeners();
  }

  // ─── Internal ──────────────────────────────────────────

  private createScene(key: string): IScene {
    const Ctor = this.registry.get(key);
    if (!Ctor) {
      throw new Error(`[SceneManager] Scene "${key}" is not registered`);
    }
    return new Ctor();
  }

  private async pushInternal(
    key: string,
    data?: unknown,
    transition?: TransitionConfig,
  ): Promise<void> {
    this._transitioning = true;

    const scene = this.createScene(key);
    this.root.addChild(scene.container);

    // Set initial size
    if (this._width && this._height) {
      scene.onResize?.(this._width, this._height);
    }

    // Transition in
    await this.transitionIn(scene.container, transition);

    // Push to stack BEFORE onEnter so currentKey is correct during initialization
    this.stack.push({ scene, key });

    await scene.onEnter?.(data);

    this._transitioning = false;
  }

  private async popInternal(
    showTransition: boolean,
    transition?: TransitionConfig,
  ): Promise<void> {
    const entry = this.stack.pop();
    if (!entry) return;

    this._transitioning = true;

    await entry.scene.onExit?.();

    if (showTransition) {
      await this.transitionOut(entry.scene.container, transition);
    }

    entry.scene.onDestroy?.();
    entry.scene.container.destroy({ children: true });

    this._transitioning = false;
  }

  private async transitionIn(
    container: Container,
    config?: TransitionConfig,
  ): Promise<void> {
    const type = config?.type ?? TT.NONE;
    const duration = config?.duration ?? 300;

    if (type === TT.NONE || duration <= 0) return;

    if (type === TT.FADE) {
      container.alpha = 0;
      await Tween.to(container, { alpha: 1 }, duration, config?.easing);
    } else if (type === TT.SLIDE_LEFT) {
      container.x = this._width;
      await Tween.to(container, { x: 0 }, duration, config?.easing);
    } else if (type === TT.SLIDE_RIGHT) {
      container.x = -this._width;
      await Tween.to(container, { x: 0 }, duration, config?.easing);
    }
  }

  private async transitionOut(
    container: Container,
    config?: TransitionConfig,
  ): Promise<void> {
    const type = config?.type ?? TT.FADE;
    const duration = config?.duration ?? 300;

    if (type === TT.NONE || duration <= 0) return;

    if (type === TT.FADE) {
      await Tween.to(container, { alpha: 0 }, duration, config?.easing);
    } else if (type === TT.SLIDE_LEFT) {
      await Tween.to(container, { x: -this._width }, duration, config?.easing);
    } else if (type === TT.SLIDE_RIGHT) {
      await Tween.to(container, { x: this._width }, duration, config?.easing);
    }
  }
}
