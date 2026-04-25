import { Container, Graphics, Text } from 'pixi.js';
import { Tween } from '../animation/Tween';
import { Easing } from '../animation/Easing';
import { resolveView } from './view';
import type { ViewInput } from './view';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastConfig {
  /** Auto-dismiss after this many ms (0 = manual dismiss only) */
  duration?: number;
  /** Toast position from bottom */
  bottomOffset?: number;
  /** Custom background view (string texture name, Texture, or Container). Sized to fit text. */
  backgroundView?: ViewInput;
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
  readonly __uiComponent = true as const;

  private _bg: Container;
  private _customBg: boolean;
  private _text: Text;
  private _config: Required<Pick<ToastConfig, 'duration' | 'bottomOffset'>>;
  private _dismissPending = false;

  constructor(config: ToastConfig = {}) {
    super();

    this._config = {
      duration: config.duration ?? 3000,
      bottomOffset: config.bottomOffset ?? 60,
    };

    const customBg = resolveView(config.backgroundView);
    this._customBg = !!customBg;
    this._bg = customBg ?? new Graphics();
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
    // Cancel any pending dismiss
    Tween.killTweensOf(this);
    this._dismissPending = false;

    this._text.text = message;

    const padding = 20;
    const width = Math.max(200, this._text.width + padding * 2);
    const height = 44;
    const radius = 8;

    // Draw the background
    if (this._customBg) {
      this._bg.width = width;
      this._bg.height = height;
      this._bg.x = -width / 2;
      this._bg.y = -height / 2;
    } else {
      const g = this._bg as Graphics;
      g.clear();
      g.roundRect(-width / 2, -height / 2, width, height, radius);
      g.fill(TOAST_COLORS[type]);
    }

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
      this._dismissPending = true;
      await Tween.delay(this._config.duration);
      if (this._dismissPending) {
        this._dismissPending = false;
        await this.dismiss();
      }
    }
  }

  /**
   * Dismiss the toast.
   */
  async dismiss(): Promise<void> {
    if (!this.visible) return;

    this._dismissPending = false;
    Tween.killTweensOf(this);

    await Tween.to(this, { alpha: 0, y: this.y + 20 }, 200, Easing.easeInCubic);
    this.visible = false;
  }

  /** React reconciler update hook */
  updateConfig(changed: Record<string, any>): void {
    if ('duration' in changed) this._config.duration = changed.duration;
    if ('bottomOffset' in changed) this._config.bottomOffset = changed.bottomOffset;
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; textureSource?: boolean }): void {
    this._dismissPending = false;
    Tween.killTweensOf(this);
    super.destroy(options);
  }
}
