import { Container, Text } from 'pixi.js';
import { LayoutContainer } from '@pixi/layout/components';
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
 * Uses `@pixi/layout` LayoutContainer for auto-sized background.
 *
 * @example
 * ```ts
 * const toast = new Toast();
 * scene.container.addChild(toast);
 * await toast.show('Connection lost', 'error', 1920, 1080);
 * ```
 */
export class Toast extends Container {
  private _bg: LayoutContainer;
  private _text: Text;
  private _config: Required<ToastConfig>;
  private _dismissTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ToastConfig = {}) {
    super();

    this._config = {
      duration: config.duration ?? 3000,
      bottomOffset: config.bottomOffset ?? 60,
    };

    this._bg = new LayoutContainer();
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
    if (this._dismissTimeout) {
      clearTimeout(this._dismissTimeout);
    }

    this._text.text = message;

    const padding = 20;
    const width = Math.max(200, this._text.width + padding * 2);
    const height = 44;
    const radius = 8;

    // Style the background
    this._bg.layout = {
      width,
      height,
      borderRadius: radius,
      backgroundColor: TOAST_COLORS[type],
    };

    // Center the bg around origin
    this._bg.x = -width / 2;
    this._bg.y = -height / 2;

    // Position
    if (viewWidth && viewHeight) {
      this.x = viewWidth / 2;
      this.y = viewHeight - this._config.bottomOffset;
    }

    this.visible = true;
    this.alpha = 0;
    this.y += 20;

    await Tween.to(this, { alpha: 1, y: this.y - 20 }, 300, Easing.easeOutCubic);

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
