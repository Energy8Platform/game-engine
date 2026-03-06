import { Container, Graphics } from 'pixi.js';
import { ProgressBar as PixiProgressBar } from '@pixi/ui';
import type { ProgressBarOptions } from '@pixi/ui';

export interface ProgressBarConfig {
  width?: number;
  height?: number;
  borderRadius?: number;
  fillColor?: number;
  trackColor?: number;
  borderColor?: number;
  borderWidth?: number;
  /** Animated fill (smoothly interpolate) */
  animated?: boolean;
  /** Animation speed (0..1 per frame, default: 0.1) */
  animationSpeed?: number;
}

function makeBarGraphics(
  w: number, h: number, radius: number, color: number,
): Graphics {
  return new Graphics().roundRect(0, 0, w, h, radius).fill(color);
}

/**
 * Horizontal progress bar powered by `@pixi/ui` ProgressBar.
 *
 * Provides optional smooth animated fill via per-frame `update()`.
 *
 * @example
 * ```ts
 * const bar = new ProgressBar({ width: 300, height: 20, fillColor: 0x22cc22 });
 * scene.container.addChild(bar);
 * bar.progress = 0.5; // 50%
 * ```
 */
export class ProgressBar extends Container {
  private _bar: PixiProgressBar;
  private _borderGfx: Graphics;
  private _config: Required<ProgressBarConfig>;
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

    const bgGraphics = makeBarGraphics(width, height, borderRadius, trackColor);
    const fillGraphics = makeBarGraphics(width - borderWidth * 2, height - borderWidth * 2, Math.max(0, borderRadius - 1), fillColor);

    const options: ProgressBarOptions = {
      bg: bgGraphics,
      fill: fillGraphics,
      fillPaddings: {
        top: borderWidth,
        right: borderWidth,
        bottom: borderWidth,
        left: borderWidth,
      },
      progress: 0,
    };

    this._bar = new PixiProgressBar(options);
    this.addChild(this._bar);

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
      this._bar.progress = this._displayedProgress * 100;
    }
  }

  /**
   * Call each frame if animated is true.
   */
  update(_dt: number): void {
    if (!this._config.animated) return;
    if (Math.abs(this._displayedProgress - this._progress) < 0.001) {
      this._displayedProgress = this._progress;
      return;
    }

    this._displayedProgress +=
      (this._progress - this._displayedProgress) * this._config.animationSpeed;
    this._bar.progress = this._displayedProgress * 100;
  }
}
