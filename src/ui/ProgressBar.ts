import { Container, Graphics } from 'pixi.js';

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

/**
 * Horizontal progress bar with optional smooth fill animation.
 *
 * @example
 * ```ts
 * const bar = new ProgressBar({ width: 300, height: 20, fillColor: 0x22cc22 });
 * scene.container.addChild(bar);
 * bar.progress = 0.5; // 50%
 * ```
 */
export class ProgressBar extends Container {
  private _track: Graphics;
  private _fill: Graphics;
  private _border: Graphics;
  private _config: Required<ProgressBarConfig>;
  private _progress = 0;
  private _displayedProgress = 0;

  constructor(config: ProgressBarConfig = {}) {
    super();

    this._config = {
      width: 300,
      height: 16,
      borderRadius: 8,
      fillColor: 0xffd700,
      trackColor: 0x333333,
      borderColor: 0x555555,
      borderWidth: 1,
      animated: true,
      animationSpeed: 0.1,
      ...config,
    };

    this._track = new Graphics();
    this._fill = new Graphics();
    this._border = new Graphics();

    this.addChild(this._track, this._fill, this._border);
    this.drawTrack();
    this.drawBorder();
    this.drawFill(0);
  }

  /** Get/set progress (0..1) */
  get progress(): number {
    return this._progress;
  }

  set progress(value: number) {
    this._progress = Math.max(0, Math.min(1, value));
    if (!this._config.animated) {
      this._displayedProgress = this._progress;
      this.drawFill(this._displayedProgress);
    }
  }

  /**
   * Call each frame if animated is true.
   */
  update(dt: number): void {
    if (!this._config.animated) return;
    if (Math.abs(this._displayedProgress - this._progress) < 0.001) {
      this._displayedProgress = this._progress;
      return;
    }

    this._displayedProgress +=
      (this._progress - this._displayedProgress) * this._config.animationSpeed;
    this.drawFill(this._displayedProgress);
  }

  private drawTrack(): void {
    const { width, height, borderRadius, trackColor } = this._config;
    this._track.clear();
    this._track.roundRect(0, 0, width, height, borderRadius).fill(trackColor);
  }

  private drawBorder(): void {
    const { width, height, borderRadius, borderColor, borderWidth } = this._config;
    this._border.clear();
    this._border
      .roundRect(0, 0, width, height, borderRadius)
      .stroke({ color: borderColor, width: borderWidth });
  }

  private drawFill(progress: number): void {
    const { width, height, borderRadius, fillColor, borderWidth } = this._config;
    const innerWidth = width - borderWidth * 2;
    const innerHeight = height - borderWidth * 2;
    const fillWidth = Math.max(0, innerWidth * progress);

    this._fill.clear();
    if (fillWidth > 0) {
      this._fill.x = borderWidth;
      this._fill.y = borderWidth;
      this._fill.roundRect(0, 0, fillWidth, innerHeight, borderRadius - 1).fill(fillColor);

      // Highlight
      this._fill
        .roundRect(0, 0, fillWidth, innerHeight * 0.4, borderRadius - 1)
        .fill({ color: 0xffffff, alpha: 0.15 });
    }
  }
}
