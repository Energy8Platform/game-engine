import type { Application } from 'pixi.js';
import { EventEmitter } from '../core/EventEmitter';
import { ScaleMode, Orientation } from '../types';

interface ViewportConfig {
  designWidth: number;
  designHeight: number;
  scaleMode: ScaleMode;
  orientation: Orientation;
}

interface ViewportEvents {
  resize: { width: number; height: number; scale: number };
  orientationChange: Orientation;
}

/**
 * Manages responsive scaling of the game canvas to fit its container.
 *
 * Supports three scale modes:
 * - **FIT** — letterbox/pillarbox to maintain aspect ratio (industry standard)
 * - **FILL** — fill container, crop edges
 * - **STRETCH** — stretch to fill (distorts)
 *
 * Also handles:
 * - Orientation detection (landscape/portrait)
 * - Safe areas (mobile notch)
 * - ResizeObserver for smooth container resizing
 *
 * @example
 * ```ts
 * const viewport = new ViewportManager(app, container, {
 *   designWidth: 1920,
 *   designHeight: 1080,
 *   scaleMode: ScaleMode.FIT,
 *   orientation: Orientation.LANDSCAPE,
 * });
 *
 * viewport.on('resize', ({ width, height, scale }) => {
 *   console.log(`New size: ${width}x${height} @ ${scale}x`);
 * });
 * ```
 */
export class ViewportManager extends EventEmitter<ViewportEvents> {
  private _app: Application;
  private _container: HTMLElement;
  private _config: ViewportConfig;
  private _resizeObserver: ResizeObserver | null = null;
  private _currentOrientation: Orientation = Orientation.LANDSCAPE;
  private _currentWidth = 0;
  private _currentHeight = 0;
  private _currentScale = 1;
  private _destroyed = false;
  private _resizeTimeout: number | null = null;

  constructor(app: Application, container: HTMLElement, config: ViewportConfig) {
    super();
    this._app = app;
    this._container = container;
    this._config = config;

    this.setupObserver();
  }

  /** Current canvas width in game units */
  get width(): number {
    return this._currentWidth;
  }

  /** Current canvas height in game units */
  get height(): number {
    return this._currentHeight;
  }

  /** Current scale factor */
  get scale(): number {
    return this._currentScale;
  }

  /** Current orientation */
  get orientation(): Orientation {
    return this._currentOrientation;
  }

  /** Design reference width */
  get designWidth(): number {
    return this._config.designWidth;
  }

  /** Design reference height */
  get designHeight(): number {
    return this._config.designHeight;
  }

  /**
   * Force a resize calculation. Called automatically on container size change.
   */
  refresh(): void {
    if (this._destroyed) return;

    const containerWidth = this._container.clientWidth || window.innerWidth;
    const containerHeight = this._container.clientHeight || window.innerHeight;

    if (containerWidth === 0 || containerHeight === 0) return;

    const { designWidth, designHeight, scaleMode } = this._config;
    const designRatio = designWidth / designHeight;
    const containerRatio = containerWidth / containerHeight;

    let gameWidth: number;
    let gameHeight: number;
    let scale: number;

    switch (scaleMode) {
      case ScaleMode.FIT: {
        if (containerRatio > designRatio) {
          // Container is wider → pillarbox
          scale = containerHeight / designHeight;
          gameWidth = designWidth;
          gameHeight = designHeight;
        } else {
          // Container is taller → letterbox
          scale = containerWidth / designWidth;
          gameWidth = designWidth;
          gameHeight = designHeight;
        }
        break;
      }

      case ScaleMode.FILL: {
        if (containerRatio > designRatio) {
          // Container is wider → crop top/bottom
          scale = containerWidth / designWidth;
        } else {
          // Container is taller → crop left/right
          scale = containerHeight / designHeight;
        }
        gameWidth = containerWidth / scale;
        gameHeight = containerHeight / scale;
        break;
      }

      case ScaleMode.STRETCH: {
        gameWidth = designWidth;
        gameHeight = designHeight;
        scale = 1; // stretch is handled by CSS
        break;
      }

      default:
        gameWidth = designWidth;
        gameHeight = designHeight;
        scale = 1;
    }

    // Resize the renderer
    this._app.renderer.resize(
      Math.round(containerWidth),
      Math.round(containerHeight),
    );

    // Scale the stage
    const stageScale = scaleMode === ScaleMode.STRETCH
      ? Math.min(containerWidth / designWidth, containerHeight / designHeight)
      : scale;

    this._app.stage.scale.set(stageScale);

    // Center the stage for FIT mode
    if (scaleMode === ScaleMode.FIT) {
      this._app.stage.x = Math.round((containerWidth - designWidth * stageScale) / 2);
      this._app.stage.y = Math.round((containerHeight - designHeight * stageScale) / 2);
    } else if (scaleMode === ScaleMode.FILL) {
      this._app.stage.x = Math.round((containerWidth - gameWidth * stageScale) / 2);
      this._app.stage.y = Math.round((containerHeight - gameHeight * stageScale) / 2);
    } else {
      this._app.stage.x = 0;
      this._app.stage.y = 0;
    }

    this._currentWidth = gameWidth;
    this._currentHeight = gameHeight;
    this._currentScale = stageScale;

    // Check orientation
    const newOrientation =
      containerWidth >= containerHeight ? Orientation.LANDSCAPE : Orientation.PORTRAIT;

    if (newOrientation !== this._currentOrientation) {
      this._currentOrientation = newOrientation;
      this.emit('orientationChange', newOrientation);
    }

    this.emit('resize', {
      width: gameWidth,
      height: gameHeight,
      scale: stageScale,
    });
  }

  /**
   * Destroy the viewport manager.
   */
  destroy(): void {
    this._destroyed = true;
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    // Remove fallback window resize listener if it was used
    window.removeEventListener('resize', this.onWindowResize);
    if (this._resizeTimeout !== null) {
      clearTimeout(this._resizeTimeout);
    }
    this.removeAllListeners();
  }

  // ─── Private ───────────────────────────────────────────

  private setupObserver(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        this.debouncedRefresh();
      });
      this._resizeObserver.observe(this._container);
    } else {
      // Fallback for older browsers
      window.addEventListener('resize', this.onWindowResize);
    }
  }

  private onWindowResize = (): void => {
    this.debouncedRefresh();
  };

  private debouncedRefresh(): void {
    if (this._resizeTimeout !== null) {
      clearTimeout(this._resizeTimeout);
    }
    this._resizeTimeout = window.setTimeout(() => {
      this.refresh();
      this._resizeTimeout = null;
    }, 16); // ~1 frame
  }
}
