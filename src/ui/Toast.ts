import { Container, Graphics, Text } from 'pixi.js';
import { Tween } from '../animation/Tween';
import { Easing } from '../animation/Easing';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastConfig {
  /** Auto-dismiss after this many ms (0 = manual dismiss only) */
  duration?: number;
  /** Toast position from bottom */
  bottomOffset?: number;
}

const TOAST_COLORS: Record<ToastType, number> = {
  info: 0x3498db,
  success: 0x27ae60,
  warning: 0xf39c12,
  error: 0xe74c3c,
};

/**
 * Toast notification component for displaying transient messages.
 *
 * @example
 * ```ts
 * const toast = new Toast();
 * scene.container.addChild(toast);
 * await toast.show('Connection lost', 'error', 1920, 1080);
 * ```
 */
export class Toast extends Container {
  private _bg: Graphics;
  private _text: Text;
  private _config: Required<ToastConfig>;
  private _dismissTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ToastConfig = {}) {
    super();

    this._config = {
      duration: 3000,
      bottomOffset: 60,
      ...config,
    };

    this._bg = new Graphics();
    this.addChild(this._bg);

    this._text = new Text({
      text: '',
      style: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 16,
        fill: 0xffffff,
      },
    });
    this._text.anchor.set(0.5);
    this.addChild(this._text);

    this.visible = false;
  }

  /**
   * Show a toast message.
   */
  async show(
    message: string,
    type: ToastType = 'info',
    viewWidth?: number,
    viewHeight?: number,
  ): Promise<void> {
    // Clear previous dismiss
    if (this._dismissTimeout) {
      clearTimeout(this._dismissTimeout);
    }

    this._text.text = message;

    const padding = 20;
    const width = Math.max(200, this._text.width + padding * 2);
    const height = 44;
    const radius = 8;

    this._bg.clear();
    this._bg.roundRect(-width / 2, -height / 2, width, height, radius).fill(TOAST_COLORS[type]);
    this._bg.roundRect(-width / 2, -height / 2, width, height, radius)
      .fill({ color: 0x000000, alpha: 0.2 });

    // Position
    if (viewWidth && viewHeight) {
      this.x = viewWidth / 2;
      this.y = viewHeight - this._config.bottomOffset;
    }

    this.visible = true;
    this.alpha = 0;
    this.y += 20;

    // Animate in
    await Tween.to(this, { alpha: 1, y: this.y - 20 }, 300, Easing.easeOutCubic);

    // Auto-dismiss
    if (this._config.duration > 0) {
      this._dismissTimeout = setTimeout(() => {
        this.dismiss();
      }, this._config.duration);
    }
  }

  /**
   * Dismiss the toast.
   */
  async dismiss(): Promise<void> {
    if (!this.visible) return;

    if (this._dismissTimeout) {
      clearTimeout(this._dismissTimeout);
      this._dismissTimeout = null;
    }

    await Tween.to(this, { alpha: 0, y: this.y + 20 }, 200, Easing.easeInCubic);
    this.visible = false;
  }
}
