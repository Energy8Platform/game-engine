import { Container } from 'pixi.js';
import { Label } from './Label';
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
 * scale pop effect — typical of slot games.
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
  private _label: Label;
  private _config: Required<Pick<WinDisplayConfig, 'currency' | 'locale' | 'countupDuration' | 'popScale'>>;
  private _cancelCountup = false;

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
    this._cancelCountup = false;
    this.alpha = 1;

    const duration = this._config.countupDuration;
    const startTime = Date.now();

    // Scale pop
    this.scale.set(0.5);

    return new Promise<void>((resolve) => {
      const tick = () => {
        if (this._cancelCountup) {
          this.displayAmount(amount);
          resolve();
          return;
        }

        const elapsed = Date.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = Easing.easeOutCubic(t);

        // Countup
        const current = amount * eased;
        this.displayAmount(current);

        // Scale animation
        const scaleT = Math.min(elapsed / 300, 1);
        const scaleEased = Easing.easeOutBack(scaleT);
        const targetScale = 1;
        this.scale.set(0.5 + (targetScale - 0.5) * scaleEased);

        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          this.displayAmount(amount);
          this.scale.set(1);
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  /**
   * Skip the countup animation and show the final amount immediately.
   */
  skipCountup(amount: number): void {
    this._cancelCountup = true;
    this.displayAmount(amount);
    this.scale.set(1);
  }

  /**
   * Hide the win display.
   */
  hide(): void {
    this.visible = false;
    this._label.text = '';
  }

  private displayAmount(amount: number): void {
    this._label.setCurrency(amount, this._config.currency, this._config.locale);
  }
}
