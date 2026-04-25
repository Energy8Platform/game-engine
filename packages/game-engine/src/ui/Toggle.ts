import { Container, Graphics } from 'pixi.js';
import { Tween } from '../animation/Tween';
import { resolveView } from './view';
import type { ViewInput } from './view';

export interface ToggleConfig {
  /** Initial state (default: false) */
  value?: boolean;
  /** Custom view for the ON state */
  onView?: ViewInput;
  /** Custom view for the OFF state */
  offView?: ViewInput;
  /** Width (for Graphics-based toggle, default: 52) */
  width?: number;
  /** Height (for Graphics-based toggle, default: 28) */
  height?: number;
  /** Track color when ON (ignored when custom views provided) */
  onColor?: number;
  /** Track color when OFF (ignored when custom views provided) */
  offColor?: number;
  /** Handle color (for Graphics-based toggle) */
  handleColor?: number;
  /** Handle radius (for Graphics-based toggle, default: auto) */
  handleRadius?: number;
  /** Animation duration in ms (default: 200) */
  animationDuration?: number;

  /** Called when value changes */
  onChange?: (value: boolean) => void;
}

/**
 * Toggle switch with two states.
 *
 * Supports custom ON/OFF views or auto-generated Graphics-based toggle.
 * Click to toggle, or use `forceSwitch(value)` programmatically.
 *
 * @example
 * ```ts
 * const mute = new Toggle({
 *   value: false,
 *   onColor: 0x22cc22,
 *   onChange: (on) => audioManager.mute(!on),
 * });
 * ```
 */
export class Toggle extends Container {
  readonly __uiComponent = true as const;

  private _value: boolean;
  private _onView: Container | null = null;
  private _offView: Container | null = null;
  private _handle: Container | null = null;
  private _trackGfx: Graphics | null = null;
  private _config: Required<Pick<ToggleConfig, 'width' | 'height' | 'onColor' | 'offColor' | 'handleColor' | 'handleRadius' | 'animationDuration'>>;
  private _useCustomViews: boolean;

  onChange: ((value: boolean) => void) | null = null;

  constructor(config: ToggleConfig = {}) {
    super();

    this._config = {
      width: config.width ?? 52,
      height: config.height ?? 28,
      onColor: config.onColor ?? 0x22cc22,
      offColor: config.offColor ?? 0x666666,
      handleColor: config.handleColor ?? 0xffffff,
      handleRadius: config.handleRadius ?? 0, // 0 = auto
      animationDuration: config.animationDuration ?? 200,
    };

    this._value = config.value ?? false;
    this.onChange = config.onChange ?? null;

    const customOn = resolveView(config.onView);
    const customOff = resolveView(config.offView);
    this._useCustomViews = !!(customOn || customOff);

    if (this._useCustomViews) {
      // Custom view mode: show/hide ON and OFF views
      if (customOn) {
        this._onView = customOn;
        this._onView.visible = this._value;
        this.addChild(this._onView);
      }
      if (customOff) {
        this._offView = customOff;
        this._offView.visible = !this._value;
        this.addChild(this._offView);
      }
    } else {
      // Graphics mode: track + sliding handle
      const { width, height, handleColor } = this._config;
      const handleRadius = this._config.handleRadius || (height / 2 - 3);
      this._config.handleRadius = handleRadius;

      this._trackGfx = new Graphics();
      this.addChild(this._trackGfx);
      this._drawTrack();

      const handle = new Graphics();
      handle.circle(0, 0, handleRadius).fill(handleColor);
      handle.y = height / 2;
      handle.x = this._value ? width - handleRadius - 3 : handleRadius + 3;
      this._handle = handle;
      this.addChild(handle);
    }

    // Interaction
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', this._onTap, this);
  }

  /** Current toggle state */
  get value(): boolean {
    return this._value;
  }

  set value(v: boolean) {
    if (v === this._value) return;
    this.forceSwitch(v);
  }

  /** Programmatically switch to a specific state with animation */
  forceSwitch(value: boolean): void {
    this._value = value;
    this._animateToState();
  }

  /** React reconciler update hook */
  updateConfig(changed: Record<string, any>): void {
    if ('value' in changed) this.value = changed.value;
    if ('onChange' in changed) this.onChange = changed.onChange;
    if ('animationDuration' in changed) this._config.animationDuration = changed.animationDuration;
  }

  private _onTap(): void {
    this._value = !this._value;
    this._animateToState();
    this.onChange?.(this._value);
  }

  private _animateToState(): void {
    const duration = this._config.animationDuration;

    if (this._useCustomViews) {
      // Custom views: crossfade
      if (this._onView) {
        Tween.killTweensOf(this._onView);
        if (this._value) {
          this._onView.visible = true;
          Tween.to(this._onView, { alpha: 1 }, duration);
        } else {
          Tween.to(this._onView, { alpha: 0 }, duration).then(() => {
            if (this._onView) this._onView.visible = false;
          });
        }
      }
      if (this._offView) {
        Tween.killTweensOf(this._offView);
        if (!this._value) {
          this._offView.visible = true;
          Tween.to(this._offView, { alpha: 1 }, duration);
        } else {
          Tween.to(this._offView, { alpha: 0 }, duration).then(() => {
            if (this._offView) this._offView.visible = false;
          });
        }
      }
    } else {
      // Graphics mode: slide handle + recolor track
      this._drawTrack();
      if (this._handle) {
        const { width } = this._config;
        const handleRadius = this._config.handleRadius;
        const targetX = this._value ? width - handleRadius - 3 : handleRadius + 3;
        Tween.killTweensOf(this._handle);
        Tween.to(this._handle, { x: targetX }, duration);
      }
    }
  }

  private _drawTrack(): void {
    if (!this._trackGfx) return;
    const { width, height, onColor, offColor } = this._config;
    const radius = height / 2;
    this._trackGfx.clear();
    this._trackGfx.roundRect(0, 0, width, height, radius).fill(this._value ? onColor : offColor);
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; textureSource?: boolean }): void {
    this.off('pointertap', this._onTap, this);
    if (this._handle) Tween.killTweensOf(this._handle);
    if (this._onView) Tween.killTweensOf(this._onView);
    if (this._offView) Tween.killTweensOf(this._offView);
    this.onChange = null;
    super.destroy(options);
  }
}
