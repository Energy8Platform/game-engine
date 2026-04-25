import { Container } from 'pixi.js';
import { Label } from './Label';
import { Tween } from '../animation/Tween';
import { Easing } from '../animation/Easing';

export interface BalanceDisplayConfig {
  /** Label prefix (e.g., "BALANCE") */
  prefix?: string;
  /** Text style overrides */
  style?: Record<string, unknown>;
  /** Currency code */
  currency?: string;
  /** Locale for number formatting */
  locale?: string;
  /** Max width */
  maxWidth?: number;
  /** Animate value changes */
  animated?: boolean;
  /** Animation duration in ms */
  animationDuration?: number;
}

/**
 * Reactive balance display component.
 *
 * Automatically formats currency and can animate value changes
 * with a smooth countup/countdown effect using engine Tween.
 *
 * @example
 * ```ts
 * const balance = new BalanceDisplay({ currency: 'USD', animated: true });
 * balance.setValue(1000);
 *
 * // Wire to SDK
 * sdk.on('balanceUpdate', ({ balance: val }) => balance.setValue(val));
 * ```
 */
export class BalanceDisplay extends Container {
  readonly __uiComponent = true as const;

  private _prefixLabel: Label | null = null;
  private _valueLabel: Label;
  private _config: Required<Pick<BalanceDisplayConfig, 'currency' | 'locale' | 'animated' | 'animationDuration'>>;
  private _currentValue = 0;
  private _displayedValue = 0;
  /** Internal target for Tween animation */
  private _tweenTarget = { value: 0 };

  constructor(config: BalanceDisplayConfig = {}) {
    super();

    this._config = {
      currency: config.currency ?? 'USD',
      locale: config.locale ?? 'en-US',
      animated: config.animated ?? true,
      animationDuration: config.animationDuration ?? 500,
    };

    // Prefix label
    if (config.prefix) {
      this._prefixLabel = new Label({
        text: config.prefix,
        style: {
          fontSize: 16,
          fill: 0xaaaaaa,
          ...(config.style as any),
        },
      });
      this.addChild(this._prefixLabel);
    }

    // Value label
    this._valueLabel = new Label({
      text: '0.00',
      style: {
        fontSize: 28,
        fontWeight: 'bold',
        fill: 0xffffff,
        ...(config.style as any),
      },
      maxWidth: config.maxWidth,
      autoFit: !!config.maxWidth,
    });
    this.addChild(this._valueLabel);

    this.layoutLabels();
  }

  /** Current displayed value */
  get value(): number {
    return this._currentValue;
  }

  /**
   * Set the balance value. If animated, smoothly counts to the new value.
   */
  setValue(value: number): void {
    const oldValue = this._currentValue;
    this._currentValue = value;

    if (this._config.animated && oldValue !== value) {
      this.animateValue(oldValue, value);
    } else {
      this._displayedValue = value;
      this.updateDisplay();
    }
  }

  /**
   * Set the currency code.
   */
  setCurrency(currency: string): void {
    this._config.currency = currency;
    this.updateDisplay();
  }

  private animateValue(from: number, to: number): void {
    // Cancel any running animation
    Tween.killTweensOf(this._tweenTarget);

    this._tweenTarget.value = from;
    Tween.to(
      this._tweenTarget,
      { value: to },
      this._config.animationDuration,
      Easing.easeOutCubic,
      () => {
        this._displayedValue = this._tweenTarget.value;
        this.updateDisplay();
      },
    );
  }

  private updateDisplay(): void {
    this._valueLabel.setCurrency(
      this._displayedValue,
      this._config.currency,
      this._config.locale,
    );
  }

  private layoutLabels(): void {
    if (this._prefixLabel) {
      this._prefixLabel.y = -14;
      this._valueLabel.y = 14;
    }
  }

  /** React reconciler update hook */
  updateConfig(changed: Record<string, any>): void {
    if ('value' in changed) this.setValue(changed.value);
    if ('currency' in changed) this.setCurrency(changed.currency);
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; textureSource?: boolean }): void {
    Tween.killTweensOf(this._tweenTarget);
    super.destroy(options);
  }
}
