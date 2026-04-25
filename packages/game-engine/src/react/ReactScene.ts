import { createElement } from 'react';
import type { ReactElement } from 'react';
import { Scene } from '../core/Scene';
import { createPixiRoot } from './createPixiRoot';
import type { PixiRoot } from './createPixiRoot';
import { EngineContext } from './EngineContext';
import type { EngineContextValue } from './EngineContext';
import type { GameApplication } from '../core/GameApplication';
import { Orientation } from '../types';

export abstract class ReactScene extends Scene {
  private _pixiRoot: PixiRoot | null = null;
  private _contextValue: EngineContextValue | null = null;

  /** Subclasses implement this to return their React element tree. */
  abstract render(): ReactElement;

  /** Access the GameApplication instance. */
  protected getApp(): GameApplication {
    const app = (this as any).__engineApp;
    if (!app) {
      throw new Error(
        '[ReactScene] No GameApplication reference. ' +
        'Ensure this scene is managed by SceneManager (not instantiated manually).',
      );
    }
    return app;
  }

  override async onEnter(data?: unknown): Promise<void> {
    const app = this.getApp();

    this._contextValue = {
      app,
      sdk: app.sdk,
      audio: app.audio,
      input: app.input,
      viewport: app.viewport,
      gameConfig: app.gameConfig,
      screen: {
        width: app.viewport.width,
        height: app.viewport.height,
        scale: app.viewport.scale,
      },
      isPortrait: app.viewport.orientation === Orientation.PORTRAIT,
    };

    this._pixiRoot = createPixiRoot(this.container);
    this._mountReactTree();
  }

  override async onExit(): Promise<void> {
    this._pixiRoot?.unmount();
    this._pixiRoot = null;
    this._contextValue = null;
  }

  override onResize(width: number, height: number): void {
    if (!this._contextValue) return;
    const app = this.getApp();

    this._contextValue = {
      ...this._contextValue,
      screen: { width, height, scale: app.viewport.scale },
      isPortrait: height > width,
    };

    this._mountReactTree();
  }

  override onDestroy(): void {
    this._pixiRoot?.unmount();
    this._pixiRoot = null;
    this._contextValue = null;
  }

  private _mountReactTree(): void {
    if (!this._pixiRoot || !this._contextValue) return;

    this._pixiRoot.render(
      createElement(
        EngineContext.Provider,
        { value: this._contextValue },
        this.render(),
      ),
    );
  }
}
