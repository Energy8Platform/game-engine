import { Application, Assets, Container, Ticker } from 'pixi.js';
import type { CasinoGameSDK } from '@energy8platform/game-sdk';
import type { InitData, GameConfigData, SessionData } from '@energy8platform/game-sdk';
import { createPlatformSession, type PlatformSession } from '@energy8platform/platform-core';
import type { GameApplicationConfig, GameEngineEvents, AssetManifest } from '../types';
import { ScaleMode, Orientation, TransitionType } from '../types';
import { EventEmitter } from './EventEmitter';
import { SceneManager } from './SceneManager';
import { AssetManager } from '../assets/AssetManager';
import { AudioManager } from '../audio/AudioManager';
import { InputManager } from '../input/InputManager';
import { ViewportManager } from '../viewport/ViewportManager';
import { LoadingScene } from '../loading/LoadingScene';
import { createCSSPreloader, removeCSSPreloader } from '@energy8platform/platform-core/loading';
import { FPSOverlay } from '../debug/FPSOverlay';

/**
 * The main entry point for a game built on @energy8platform/game-engine.
 *
 * Orchestrates the full lifecycle:
 * 1. Create PixiJS Application
 * 2. Initialize SDK (or run offline)
 * 3. Show CSS preloader → Canvas loading screen with progress bar
 * 4. Load asset manifest
 * 5. Transition to the first game scene
 *
 * @example
 * ```ts
 * import { GameApplication, ScaleMode } from '@energy8platform/game-engine';
 * import { GameScene } from './scenes/GameScene';
 *
 * const game = new GameApplication({
 *   container: '#game',
 *   designWidth: 1920,
 *   designHeight: 1080,
 *   scaleMode: ScaleMode.FIT,
 *   manifest: { bundles: [
 *     { name: 'preload', assets: [{ alias: 'logo', src: 'logo.png' }] },
 *     { name: 'game', assets: [{ alias: 'bg', src: 'background.png' }] },
 *   ]},
 *   loading: { tapToStart: true },
 * });
 *
 * game.scenes.register('game', GameScene);
 * await game.start('game');
 * ```
 */
export class GameApplication extends EventEmitter<GameEngineEvents> {
  // ─── Public references ──────────────────────────────────

  /** PixiJS Application instance */
  public app!: Application;

  /** Scene manager */
  public scenes!: SceneManager;

  /** Asset manager */
  public assets!: AssetManager;

  /** Audio manager */
  public audio!: AudioManager;

  /** Input manager */
  public input!: InputManager;

  /** Viewport manager */
  public viewport!: ViewportManager;

  /** Scaled world root (holds scenes). Transformed by the ViewportManager to fit the design
   *  resolution; lives below the UI layer on app.stage. */
  public worldRoot!: Container;

  /** Unscaled, screen-space UI layer. Sits above {@link worldRoot} and is NOT touched by the
   *  viewport transform — children fill the real screen (e.g. the host's shell + overlay). */
  public uiLayer!: Container;

  /** SDK instance (null in offline mode) */
  public sdk: CasinoGameSDK | null = null;

  /** FPS overlay instance (only when debug: true) */
  public fpsOverlay: FPSOverlay | null = null;

  /** Data received from SDK initialization */
  public initData: InitData | null = null;

  /** Platform session (SDK + optional DevBridge). null until start() runs. */
  public platformSession: PlatformSession | null = null;

  /** Branded game shell (only when config.shell is set). */
  public shell?: import('@energy8platform/shell/html').GameShell;

  /** Configuration */
  public readonly config: GameApplicationConfig;

  // ─── Private state ──────────────────────────────────────

  private _running = false;
  private _destroyed = false;
  private _container: HTMLElement | null = null;

  constructor(config: GameApplicationConfig = {}) {
    super();
    this.config = {
      designWidth: 1920,
      designHeight: 1080,
      scaleMode: ScaleMode.FIT,
      orientation: Orientation.ANY,
      debug: false,
      ...config,
    };

    // Create SceneManager early so scenes can be registered before start()
    this.scenes = new SceneManager();
  }

  // ─── Public getters ─────────────────────────────────────

  /** Current game config from SDK (or null in offline mode) */
  get gameConfig(): GameConfigData | null {
    return this.initData?.config ?? null;
  }

  /** Current session data */
  get session(): SessionData | null {
    return this.initData?.session ?? null;
  }

  /** Current balance */
  get balance(): number {
    return this.sdk?.balance ?? 0;
  }

  /** Current currency */
  get currency(): string {
    return this.sdk?.currency ?? 'USD';
  }

  /** Whether the engine is running */
  get isRunning(): boolean {
    return this._running;
  }

  // ─── Lifecycle ──────────────────────────────────────────

  /**
   * Start the game engine. This is the main entry point.
   *
   * @param firstScene - Key of the first scene to show after loading (must be registered)
   * @param sceneData - Optional data to pass to the first scene's onEnter
   */
  async start(firstScene: string, sceneData?: unknown): Promise<void> {
    if (this._running) {
      console.warn('[GameEngine] Already running');
      return;
    }

    try {
      // 1. Resolve container element
      this._container = this.resolveContainer();

      // 2. Show CSS preloader immediately (before PixiJS)
      createCSSPreloader(this._container, this.config.loading);

      // 3. Initialize PixiJS
      await this.initPixi();

      // 4. Initialize SDK (if enabled)
      await this.initSDK();

      // 4b. Mount the branded game shell after the SDK handshake (optional)
      if (this.config.shell) {
        const { createGameShell } = await import('@energy8platform/shell/html');
        this.shell = createGameShell(this.config.shell);
      }

      // 5. Merge design dimensions from SDK config
      this.applySDKConfig();

      // 6. Initialize sub-systems
      this.initSubSystems();

      this.emit('initialized');

      // 7. Load assets. The CSS preloader stays on screen — LoadingScene drives
      //    its progress/tap and removes it before entering the game, so there's
      //    a single continuous overlay from boot to gameplay (no logo flash).
      await this.loadAssets(firstScene, sceneData);

      this.emit('loaded');

      // 8. Start the game loop
      this._running = true;
      this.emit('started');
    } catch (err) {
      console.error('[GameEngine] Failed to start:', err);
      // Tear down the preloader so a failure doesn't strand the brand frame.
      if (this._container) removeCSSPreloader(this._container);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  /**
   * Destroy the engine and free all resources.
   */
  async destroy(): Promise<void> {
    if (this._destroyed) return;
    this._destroyed = true;
    this._running = false;

    if (this.shell) {
      const { removeGameShell } = await import('@energy8platform/shell/html');
      await removeGameShell();
      this.shell = undefined;
    }

    this.scenes?.destroy();
    this.input?.destroy();
    this.audio?.destroy();
    this.viewport?.destroy();
    this.platformSession?.destroy();
    this.app?.destroy(true, { children: true, texture: true });

    this.emit('destroyed');
    this.removeAllListeners();
  }

  // ─── Private initialization steps ──────────────────────

  private resolveContainer(): HTMLElement {
    if (typeof this.config.container === 'string') {
      const el = document.querySelector<HTMLElement>(this.config.container);
      if (!el) throw new Error(`[GameEngine] Container "${this.config.container}" not found`);
      return el;
    }
    return this.config.container ?? document.body;
  }

  private async initPixi(): Promise<void> {
    this.app = new Application();

    const pixiOpts = {
      preference: 'webgl' as const,
      background:
        typeof this.config.loading?.backgroundColor === 'number'
          ? this.config.loading.backgroundColor
          : 0x000000,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
      ...this.config.pixi,
    };

    await this.app.init(pixiOpts);

    // Append canvas to container
    this._container!.appendChild(this.app.canvas);

    // Set canvas style
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = '100%';
  }

  private async initSDK(): Promise<void> {
    // Delegate the SDK handshake (and any optional in-process DevBridge
    // wiring) to platform-core. The session forwards SDK events upward.
    this.platformSession = await createPlatformSession({ sdk: this.config.sdk });
    this.sdk = this.platformSession.sdk;
    this.initData = this.platformSession.initData;

    this.platformSession.on('error', (err) => {
      this.emit('error', err);
    });
    this.platformSession.on('balanceUpdate', (data) => {
      this.emit('balanceUpdate', data);
    });
  }

  private applySDKConfig(): void {
    // If SDK provides viewport dimensions, use them as design reference
    if (this.initData?.config?.viewport) {
      const vp = this.initData.config.viewport;
      if (!this.config.designWidth) this.config.designWidth = vp.width;
      if (!this.config.designHeight) this.config.designHeight = vp.height;
    }
  }

  private initSubSystems(): void {
    // Asset Manager. Base defaults to '/' (site root) when the bridge sends no assetsUrl — the
    // asset folder lives in the manifest paths, not the base, so it needn't be named `assets`.
    const basePath = this.initData?.assetsUrl ?? '/';
    this.assets = new AssetManager(basePath, this.config.manifest);

    // Audio Manager
    this.audio = new AudioManager(this.config.audio);

    // Input Manager
    this.input = new InputManager(this.app.canvas as HTMLCanvasElement);

    // Stage layers: a scaled world root (scenes, transformed to design resolution by the
    // viewport) below an unscaled UI layer (screen space). app.stage itself stays identity.
    this.worldRoot = new Container();
    this.worldRoot.label = 'world';
    this.uiLayer = new Container();
    this.uiLayer.label = 'ui';
    this.app.stage.addChild(this.worldRoot, this.uiLayer);

    // Viewport Manager — scales worldRoot (NOT app.stage), so the UI layer is unscaled.
    this.viewport = new ViewportManager(
      this.app,
      this._container!,
      {
        designWidth: this.config.designWidth!,
        designHeight: this.config.designHeight!,
        scaleMode: this.config.scaleMode!,
        orientation: this.config.orientation!,
      },
      this.worldRoot,
    );

    // Wire SceneManager to the scaled world root
    this.scenes.setRoot(this.worldRoot);
    this.scenes.setApp(this);

    // Wire viewport resize → scene manager + input manager
    this.viewport.on('resize', ({ width, height, scale }) => {
      this.scenes.resize(width, height);
      this.input.setViewportTransform(scale, this.worldRoot.x, this.worldRoot.y);
      this.emit('resize', { width, height });
    });

    this.viewport.on('orientationChange', (orientation) => {
      this.emit('orientationChange', orientation);
    });

    // Wire scene changes → engine event
    this.scenes.on('change', ({ from, to }) => {
      this.emit('sceneChange', { from, to });
    });

    // Connect ticker → scene updates
    this.app.ticker.add((ticker) => {
      // Always update scenes (loading screen needs onUpdate before _running=true)
      this.scenes.update(ticker.deltaTime / 60); // convert to seconds
    });

    // Trigger initial resize
    this.viewport.refresh();

    // Enable FPS overlay in debug mode
    if (this.config.debug) {
      this.fpsOverlay = new FPSOverlay(this.app);
      this.fpsOverlay.show();
    }
  }

  private async loadAssets(firstScene: string, sceneData?: unknown): Promise<void> {
    // Register built-in loading scene
    this.scenes.register('__loading__', LoadingScene);

    // Enter loading scene
    await this.scenes.goto('__loading__', {
      engine: this,
      targetScene: firstScene,
      targetData: sceneData,
    });
  }
}
