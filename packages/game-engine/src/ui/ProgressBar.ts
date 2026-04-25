import { Container, Graphics } from 'pixi.js';
import { resolveView } from './view';
import type { ViewInput } from './view';

export interface ProgressBarConfig {
  /** Width of the bar */
  width?: number;
  /** Height of the bar */
  height?: number;
  /** Corner radius (for Graphics-based bar) */
  borderRadius?: number;
  /** Fill color (for Graphics-based bar, ignored when fillView provided) */
  fillColor?: number;
  /** Track background color (for Graphics-based bar, ignored when trackView provided) */
  trackColor?: number;
  /** Border color */
  borderColor?: number;
  /** Border width */
  borderWidth?: number;
  /** Animated fill (smoothly interpolate) */
  animated?: boolean;
  /** Animation speed (0..1 per frame, default: 0.1) */
  animationSpeed?: number;

  /** Custom track background (string texture name, Texture, or Container) */
  trackView?: ViewInput;
  /** Custom fill bar (string texture name, Texture, or Container) */
  fillView?: ViewInput;
}

/**
 * Horizontal progress bar with optional custom track/fill views.
 *
 * Supports asset-based skinning: provide `trackView` and/or `fillView`
 * as texture names, Textures, or any Container (NineSliceSprite, custom artwork, etc).
 * Falls back to colored Graphics when no custom views are provided.
 *
 * @example
 * ```ts
 * // Graphics-based (quick prototyping)
 * const bar = new ProgressBar({ width: 300, height: 20, fillColor: 0x22cc22 });
 * bar.progress = 0.5;
 *
 * // Asset-based (production art)
 * const bar = new ProgressBar({
 *   width: 300, height: 20,
 *   trackView: 'bar-track',
 *   fillView: new NineSliceSprite({ texture: 'bar-fill', ... }),
 * });
 * bar.progress = 0.75;
 * ```
 */
export class ProgressBar extends Container {
  readonly __uiComponent = true as const;

  private _track: Container;
  private _fill: Container;
  private _fillMask: Graphics;
  private _borderGfx: Graphics;
  private _config: Required<Pick<ProgressBarConfig, 'width' | 'height' | 'borderRadius' | 'fillColor' | 'trackColor' | 'borderColor' | 'borderWidth' | 'animated' | 'animationSpeed'>>;
  private _progress = 0;
  private _displayedProgress = 0;

  constructor(config: ProgressBarConfig = {}) {
    super();

    this._config = {
      width: config.width ?? 300,
      height: config.height ?? 16,
      borderRadius: config.borderRadius ?? 8,
      fillColor: config.fillColor ?? 0xffd700,
      trackColor: config.trackColor ?? 0x333333,
      borderColor: config.borderColor ?? 0x555555,
      borderWidth: config.borderWidth ?? 1,
      animated: config.animated ?? true,
      animationSpeed: config.animationSpeed ?? 0.1,
    };

    const { width, height, borderRadius, fillColor, trackColor, borderColor, borderWidth } = this._config;

    // Track background — custom view or Graphics
    const customTrack = resolveView(config.trackView);
    if (customTrack) {
      customTrack.width = width;
      customTrack.height = height;
      this._track = customTrack;
    } else {
      const g = new Graphics();
      g.roundRect(0, 0, width, height, borderRadius).fill(trackColor);
      this._track = g;
    }
    this.addChild(this._track);

    // Fill bar — custom view or Graphics
    const customFill = resolveView(config.fillView);
    if (customFill) {
      customFill.x = borderWidth;
      customFill.y = borderWidth;
      customFill.width = width - borderWidth * 2;
      customFill.height = height - borderWidth * 2;
      this._fill = customFill;
    } else {
      const g = new Graphics();
      g.roundRect(
        borderWidth, borderWidth,
        width - borderWidth * 2, height - borderWidth * 2,
        Math.max(0, borderRadius - 1),
      ).fill(fillColor);
      this._fill = g;
    }
    this.addChild(this._fill);

    // Mask for the fill (controls visible width)
    this._fillMask = new Graphics();
    this._fillMask.rect(0, 0, 0, height).fill(0xffffff);
    this.addChild(this._fillMask);
    this._fill.mask = this._fillMask;

    // Border overlay
    this._borderGfx = new Graphics();
    if (borderColor !== undefined && borderWidth > 0) {
      this._borderGfx
        .roundRect(0, 0, width, height, borderRadius)
        .stroke({ color: borderColor, width: borderWidth });
    }
    this.addChild(this._borderGfx);
  }

  /** Get/set progress (0..1) */
  get progress(): number {
    return this._progress;
  }

  set progress(value: number) {
    this._progress = Math.max(0, Math.min(1, value));
    if (!this._config.animated) {
      this._displayedProgress = this._progress;
      this.updateMask();
    }
  }

  /**
   * Call each frame if animated is true.
   */
  update(_dt: number): void {
    if (!this._config.animated) return;
    if (Math.abs(this._displayedProgress - this._progress) < 0.001) {
      this._displayedProgress = this._progress;
      this.updateMask();
      return;
    }

    this._displayedProgress +=
      (this._progress - this._displayedProgress) * this._config.animationSpeed;
    this.updateMask();
  }

  /** React reconciler update hook */
  updateConfig(changed: Record<string, any>): void {
    if ('progress' in changed) this.progress = changed.progress;
    if ('animated' in changed) this._config.animated = changed.animated;
    if ('animationSpeed' in changed) this._config.animationSpeed = changed.animationSpeed;
  }

  private updateMask(): void {
    const w = this._config.width * this._displayedProgress;
    this._fillMask.clear();
    this._fillMask.rect(0, 0, w, this._config.height).fill(0xffffff);
  }
}
