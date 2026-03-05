import { Container, Text, TextStyle } from 'pixi.js';

export interface LabelConfig {
  text?: string;
  style?: Partial<TextStyle>;
  /** Maximum width — text will be scaled down to fit */
  maxWidth?: number;
  /** Auto-fit: scale text to fit maxWidth */
  autoFit?: boolean;
}

/**
 * Enhanced text label with auto-fit scaling and currency formatting.
 *
 * @example
 * ```ts
 * const label = new Label({
 *   text: 'BALANCE',
 *   style: { fontSize: 24, fill: 0xffd700 },
 *   maxWidth: 200,
 *   autoFit: true,
 * });
 * ```
 */
export class Label extends Container {
  private _text: Text;
  private _maxWidth: number;
  private _autoFit: boolean;

  constructor(config: LabelConfig = {}) {
    super();

    this._maxWidth = config.maxWidth ?? Infinity;
    this._autoFit = config.autoFit ?? false;

    this._text = new Text({
      text: config.text ?? '',
      style: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 24,
        fill: 0xffffff,
        ...config.style,
      },
    });
    this._text.anchor.set(0.5);
    this.addChild(this._text);

    this.fitText();
  }

  /** Get/set the displayed text */
  get text(): string {
    return this._text.text;
  }

  set text(value: string) {
    this._text.text = value;
    this.fitText();
  }

  /** Get/set the text style */
  get style(): TextStyle {
    return this._text.style as TextStyle;
  }

  /** Set max width constraint */
  set maxWidth(value: number) {
    this._maxWidth = value;
    this.fitText();
  }

  /**
   * Format and display a number as currency.
   *
   * @param amount - The numeric amount
   * @param currency - Currency code (e.g., 'USD', 'EUR')
   * @param locale - Locale string (default: 'en-US')
   */
  setCurrency(amount: number, currency: string, locale = 'en-US'): void {
    try {
      this.text = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      this.text = `${amount.toFixed(2)} ${currency}`;
    }
  }

  /**
   * Format a number with thousands separators.
   */
  setNumber(value: number, decimals = 0, locale = 'en-US'): void {
    this.text = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  private fitText(): void {
    if (!this._autoFit || this._maxWidth === Infinity) return;

    this._text.scale.set(1);
    if (this._text.width > this._maxWidth) {
      const scale = this._maxWidth / this._text.width;
      this._text.scale.set(scale);
    }
  }
}
