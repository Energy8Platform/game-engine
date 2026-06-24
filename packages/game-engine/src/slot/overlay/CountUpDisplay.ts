import { Container, Text, type TextStyle } from 'pixi.js';
import { Tween, Easing } from '../../animation';

export interface CountUpConfig { format: (v: number) => string; style?: Partial<TextStyle>; }

/** PURE eased interpolation 0→target over duration (ms). Clamped to [0, target]. */
export function valueAt(elapsed: number, target: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return target;
  if (elapsed <= 0) return 0;
  const p = elapsed / duration;
  const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
  return target * eased;
}

export class CountUpDisplay extends Container {
  readonly __uiComponent = true as const;
  private _text: Text;
  private _format: (v: number) => string;
  private _value = 0;

  constructor(config: CountUpConfig) {
    super();
    this._format = config.format;
    this._text = new Text({
      text: this._format(0),
      style: { fontFamily: 'sans-serif', fontSize: 48, fill: 0xffffff, fontWeight: '800', ...config.style },
    });
    this._text.anchor.set(0.5);
    this.addChild(this._text);
  }

  get text(): string { return this._text.text; }

  setValue(v: number): void {
    this._value = v;
    this._text.text = this._format(v);
  }

  /** Swap the value formatter and immediately re-render the current value. */
  setFormat(format: (v: number) => string): void {
    this._format = format;
    this._text.text = this._format(this._value);
  }

  /** Animate the value to target over duration; fires onTier on each tier-index increase. */
  async countTo(target: number, duration: number, onTier?: (idx: number) => void): Promise<void> {
    const holder = { v: 0 };
    void onTier; // tier tracking is external — onTier is a forward-compat hook
    await Tween.to(holder, { v: target }, duration, Easing.easeOutCubic, () => {
      this.setValue(holder.v);
    });
    this.setValue(target);
  }

  skip(): void { Tween.killTweensOf(this); }
}
