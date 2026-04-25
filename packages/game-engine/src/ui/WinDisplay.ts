import { Container } from 'pixi.js';
import { Label } from './Label';
import { Tween } from '../animation/Tween';
import { Easing } from '../animation/Easing';

export interface WinDisplayConfig {
  /** Text style overrides */
  style?: Record<string, unknown>;
  /** Currency code */
  currency?: string;
  /** Locale for number formatting */
  locale?: string;
  /** Countup duration in ms */
  countupDuration?: number;
  /** Scale pop animation on win */
  popScale?: number;
}

/**
 * Win amount display with countup animation.
 *
 * Shows a dramatic countup from 0 to the win amount, with optional
 * scale pop effect — typical of slot games. Uses engine Tween system.
 *
 * @example
 * ```ts
 * const winDisplay = new WinDisplay({ currency: 'USD' });
 * scene.container.addChild(winDisplay);
 * await winDisplay.showWin(150.50); // countup animation
 * winDisplay.hide();
 * ```
 */
export class WinDisplay extends Container {
  readonly __uiComponent = true as const;

  private _label: Label;
  private _config: Required<Pick<WinDisplayConfig, 'currency' | 'locale' | 'countupDuration' | 'popScale'>>;
  /** Internal target for Tween countup */
  private _tweenTarget = { value: 0 };

  constructor(config: WinDisplayConfig = {}) {
    super();

    this._config = {
      currency: config.currency ?? 'USD',
      locale: config.locale ?? 'en-US',
      countupDuration: config.countupDuration ?? 1500,
      popScale: config.popScale ?? 1.2,
    };

    this._label = new Label({
      text: '',
      style: {
        fontSize: 48,
        fontWeight: 'bold',
        fill: 0xffd700,
        stroke: { color: 0x000000, width: 3 },
        ...(config.style as any),
      },
    });
    this.addChild(this._label);

    this.visible = false;
  }

  /**
   * Show a win with countup animation.
   *
   * @param amount - Win amount
   * @returns Promise that resolves when the animation completes
   */
  async showWin(amount: number): Promise<void> {
    this.visible = true;
    this.alpha = 1;

    // Cancel any running animation
    Tween.killTweensOf(this._tweenTarget);
    Tween.killTweensOf(this);

    // Setup countup
    this._tweenTarget.value = 0;
    this.scale.set(0.5);

    // Scale pop animation
    const scalePromise = Tween.to(
      this,
      { 'scale.x': 1, 'scale.y': 1 },
      300,
      Easing.easeOutBack,
    );

    // Countup animation
    const countupPromise = Tween.to(
      this._tweenTarget,
      { value: amount },
      this._config.countupDuration,
      Easing.easeOutCubic,
      () => {
        this.displayAmount(this._tweenTarget.value);
      },
    );

    await Promise.all([scalePromise, countupPromise]);

    // Ensure final value is exact
    this.displayAmount(amount);
    this.scale.set(1);
  }

  /**
   * Skip the countup animation and show the final amount immediately.
   */
  skipCountup(amount: number): void {
    Tween.killTweensOf(this._tweenTarget);
    Tween.killTweensOf(this);
    this.displayAmount(amount);
    this.scale.set(1);
  }

  /**
   * Hide the win display.
   */
  hide(): void {
    Tween.killTweensOf(this._tweenTarget);
    Tween.killTweensOf(this);
    this.visible = false;
    this._label.text = '';
  }

  private displayAmount(amount: number): void {
    this._label.setCurrency(amount, this._config.currency, this._config.locale);
  }

  /** React reconciler update hook */
  updateConfig(changed: Record<string, any>): void {
    if ('currency' in changed) this._config.currency = changed.currency;
    if ('locale' in changed) this._config.locale = changed.locale;
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; textureSource?: boolean }): void {
    Tween.killTweensOf(this._tweenTarget);
    Tween.killTweensOf(this);
    super.destroy(options);
  }
}
