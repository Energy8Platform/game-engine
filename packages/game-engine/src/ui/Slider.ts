import { Container, Graphics, FederatedPointerEvent } from 'pixi.js';
import { resolveView } from './view';
import type { ViewInput } from './view';

export interface SliderConfig {
  /** Minimum value (default: 0) */
  min?: number;
  /** Maximum value (default: 1) */
  max?: number;
  /** Step increment (0 = continuous, default: 0) */
  step?: number;
  /** Initial value (default: min) */
  value?: number;
  /** Track width in pixels (default: 200) */
  width?: number;
  /** Track height in pixels (default: 8) */
  height?: number;
  /** Corner radius for Graphics-based track/fill (default: 4) */
  borderRadius?: number;
  /** Track background color (ignored when trackView provided) */
  trackColor?: number;
  /** Fill bar color (ignored when fillView provided) */
  fillColor?: number;
  /** Handle radius (for Graphics-based handle, default: 12) */
  handleRadius?: number;
  /** Handle color (for Graphics-based handle, ignored when handleView provided) */
  handleColor?: number;

  /** Custom track background view */
  trackView?: ViewInput;
  /** Custom fill bar view */
  fillView?: ViewInput;
  /** Custom handle view */
  handleView?: ViewInput;

  /** Called when value changes during drag */
  onUpdate?: (value: number) => void;
  /** Called when drag ends */
  onChange?: (value: number) => void;
}

/**
 * Draggable slider with customizable track, fill, and handle views.
 *
 * @example
 * ```ts
 * const volume = new Slider({
 *   min: 0, max: 1, value: 0.5,
 *   width: 200, height: 8,
 *   fillColor: 0xffd700,
 *   onUpdate: (v) => console.log('Volume:', v),
 * });
 * ```
 */
export class Slider extends Container {
  readonly __uiComponent = true as const;

  private _track: Container;
  private _fill: Container;
  private _fillMask: Graphics;
  private _handle: Container;
  private _config: Required<Pick<SliderConfig, 'min' | 'max' | 'step' | 'width' | 'height' | 'borderRadius' | 'trackColor' | 'fillColor' | 'handleRadius' | 'handleColor'>>;
  private _value: number;
  private _dragging = false;

  onUpdate: ((value: number) => void) | null = null;
  onChange: ((value: number) => void) | null = null;

  constructor(config: SliderConfig = {}) {
    super();

    this._config = {
      min: config.min ?? 0,
      max: config.max ?? 1,
      step: config.step ?? 0,
      width: config.width ?? 200,
      height: config.height ?? 8,
      borderRadius: config.borderRadius ?? 4,
      trackColor: config.trackColor ?? 0x333333,
      fillColor: config.fillColor ?? 0xffd700,
      handleRadius: config.handleRadius ?? 12,
      handleColor: config.handleColor ?? 0xffffff,
    };

    this._value = config.value ?? this._config.min;
    this.onUpdate = config.onUpdate ?? null;
    this.onChange = config.onChange ?? null;

    const { width, height, borderRadius, trackColor, fillColor, handleRadius, handleColor } = this._config;

    // Track
    const customTrack = resolveView(config.trackView);
    if (customTrack) {
      customTrack.width = width;
      customTrack.height = height;
      this._track = customTrack;
    } else {
      const g = new Graphics();
      g.roundRect(0, 0, width, height, borderRadius).fill(trackColor);
      this._track = g;
    }
    this.addChild(this._track);

    // Fill
    const customFill = resolveView(config.fillView);
    if (customFill) {
      customFill.width = width;
      customFill.height = height;
      this._fill = customFill;
    } else {
      const g = new Graphics();
      g.roundRect(0, 0, width, height, borderRadius).fill(fillColor);
      this._fill = g;
    }
    this.addChild(this._fill);

    // Fill mask
    this._fillMask = new Graphics();
    this.addChild(this._fillMask);
    this._fill.mask = this._fillMask;

    // Handle
    const customHandle = resolveView(config.handleView);
    if (customHandle) {
      this._handle = customHandle;
    } else {
      const g = new Graphics();
      g.circle(0, 0, handleRadius).fill(handleColor);
      this._handle = g;
    }
    this._handle.y = height / 2;
    this.addChild(this._handle);

    // Interaction
    this.eventMode = 'static';
    this.cursor = 'pointer';

    // Hit area covers track + handle overflow
    const hitPad = Math.max(handleRadius - height / 2, 0);
    this.hitArea = { contains: (x: number, y: number) => x >= -hitPad && x <= width + hitPad && y >= -hitPad && y <= height + hitPad };

    this.on('pointerdown', this._onPointerDown, this);
    this.on('globalpointermove', this._onPointerMove, this);
    this.on('pointerup', this._onPointerUp, this);
    this.on('pointerupoutside', this._onPointerUp, this);

    this._updateVisuals();
  }

  /** Current value */
  get value(): number {
    return this._value;
  }

  set value(v: number) {
    const clamped = this._applyStep(Math.max(this._config.min, Math.min(this._config.max, v)));
    if (clamped === this._value) return;
    this._value = clamped;
    this._updateVisuals();
  }

  get min(): number { return this._config.min; }
  get max(): number { return this._config.max; }

  /** React reconciler update hook */
  updateConfig(changed: Record<string, any>): void {
    if ('value' in changed) this.value = changed.value;
    if ('min' in changed) { this._config.min = changed.min; this._updateVisuals(); }
    if ('max' in changed) { this._config.max = changed.max; this._updateVisuals(); }
    if ('step' in changed) this._config.step = changed.step;
    if ('onUpdate' in changed) this.onUpdate = changed.onUpdate;
    if ('onChange' in changed) this.onChange = changed.onChange;
  }

  private _fraction(): number {
    const { min, max } = this._config;
    return max === min ? 0 : (this._value - min) / (max - min);
  }

  private _applyStep(v: number): number {
    const { step, min } = this._config;
    if (step <= 0) return v;
    return min + Math.round((v - min) / step) * step;
  }

  private _updateVisuals(): void {
    const frac = this._fraction();
    const w = this._config.width;
    const h = this._config.height;

    // Update fill mask
    this._fillMask.clear();
    this._fillMask.rect(0, 0, w * frac, h).fill(0xffffff);

    // Update handle position
    this._handle.x = w * frac;
  }

  private _valueFromPointer(e: FederatedPointerEvent): number {
    const local = this.toLocal(e.global);
    const frac = Math.max(0, Math.min(1, local.x / this._config.width));
    const { min, max } = this._config;
    return this._applyStep(min + frac * (max - min));
  }

  private _onPointerDown(e: FederatedPointerEvent): void {
    this._dragging = true;
    const newValue = this._valueFromPointer(e);
    if (newValue !== this._value) {
      this._value = newValue;
      this._updateVisuals();
      this.onUpdate?.(this._value);
    }
  }

  private _onPointerMove(e: FederatedPointerEvent): void {
    if (!this._dragging) return;
    const newValue = this._valueFromPointer(e);
    if (newValue !== this._value) {
      this._value = newValue;
      this._updateVisuals();
      this.onUpdate?.(this._value);
    }
  }

  private _onPointerUp(_e: FederatedPointerEvent): void {
    if (!this._dragging) return;
    this._dragging = false;
    this.onChange?.(this._value);
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; textureSource?: boolean }): void {
    this.off('pointerdown', this._onPointerDown, this);
    this.off('globalpointermove', this._onPointerMove, this);
    this.off('pointerup', this._onPointerUp, this);
    this.off('pointerupoutside', this._onPointerUp, this);
    this.onUpdate = null;
    this.onChange = null;
    super.destroy(options);
  }
}
