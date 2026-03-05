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
 * with a smooth countup/countdown effect.
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
  private _prefixLabel: Label | null = null;
  private _valueLabel: Label;
  private _config: Required<Pick<BalanceDisplayConfig, 'currency' | 'locale' | 'animated' | 'animationDuration'>>;
  private _currentValue = 0;
  private _displayedValue = 0;
  private _animating = false;
  private _animationCancelled = false;

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

  private async animateValue(from: number, to: number): Promise<void> {
    // Cancel any ongoing animation
    if (this._animating) {
      this._animationCancelled = true;
    }

    this._animating = true;
    this._animationCancelled = false;
    const duration = this._config.animationDuration;
    const startTime = Date.now();

    return new Promise<void>((resolve) => {
      const tick = () => {
        // If cancelled by a newer animation, stop immediately
        if (this._animationCancelled) {
          this._animating = false;
          resolve();
          return;
        }

        const elapsed = Date.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = Easing.easeOutCubic(t);

        this._displayedValue = from + (to - from) * eased;
        this.updateDisplay();

        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          this._displayedValue = to;
          this.updateDisplay();
          this._animating = false;
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
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
}
