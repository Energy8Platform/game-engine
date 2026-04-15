import { Container, Graphics, Text } from 'pixi.js';
import { Tween } from '../animation/Tween';
import { Easing } from '../animation/Easing';
import { resolveView } from './view';
import type { ViewInput } from './view';

export type ButtonState = 'default' | 'hover' | 'pressed' | 'disabled';

export interface ButtonConfig {
  /** Custom view for default state (string texture name, Texture, or Container) */
  defaultView?: ViewInput;
  /** Custom view for hover state */
  hoverView?: ViewInput;
  /** Custom view for pressed state */
  pressedView?: ViewInput;
  /** Custom view for disabled state */
  disabledView?: ViewInput;

  /** Width (for Graphics-based button, ignored when custom views provided) */
  width?: number;
  /** Height (for Graphics-based button) */
  height?: number;
  /** Corner radius (for Graphics-based button) */
  borderRadius?: number;
  /** Colors for each state (for Graphics-based button) */
  colors?: Partial<Record<ButtonState, number>>;

  /** Scale on press */
  pressScale?: number;
  /** Scale animation duration (ms) */
  animationDuration?: number;
  /** Start disabled */
  disabled?: boolean;
  /** Button text (rendered on top of the view) */
  text?: string;
  /** Button text style */
  textStyle?: Record<string, unknown>;
  /** Press callback */
  onPress?: () => void;
}

const DEFAULT_COLORS: Record<ButtonState, number> = {
  default: 0xffd700,
  hover: 0xffe44d,
  pressed: 0xccac00,
  disabled: 0x666666,
};

function makeGraphicsView(
  w: number, h: number, radius: number, color: number,
): Graphics {
  const g = new Graphics();
  g.roundRect(-w / 2, -h / 2, w, h, radius).fill(color);
  return g;
}

/**
 * Interactive button with per-state custom views and animations.
 *
 * Each visual state accepts a `ViewInput`: texture name, Texture, or any Container
 * (Sprite, NineSliceSprite, AnimatedSprite, custom artwork, etc).
 * Falls back to colored Graphics when no custom view is provided.
 *
 * @example
 * ```ts
 * // Graphics-based (quick prototyping)
 * const btn = new Button({
 *   width: 200, height: 60, borderRadius: 12,
 *   colors: { default: 0x22aa22, hover: 0x33cc33 },
 *   text: 'SPIN',
 *   onPress: () => spin(),
 * });
 *
 * // Asset-based (production art)
 * const btn = new Button({
 *   defaultView: 'btn-idle',
 *   hoverView: 'btn-hover',
 *   pressedView: 'btn-pressed',
 *   disabledView: 'btn-disabled',
 *   text: 'SPIN',
 *   onPress: () => spin(),
 * });
 *
 * // Custom Container view
 * const btn = new Button({
 *   defaultView: myAnimatedSprite,
 *   text: 'SPIN',
 * });
 * ```
 */
export class Button extends Container {
  readonly __uiComponent = true as const;

  private _views: Map<ButtonState, Container> = new Map();
  private _state: ButtonState = 'default';
  private _enabled = true;
  private _config: Required<
    Pick<ButtonConfig, 'width' | 'height' | 'borderRadius' | 'pressScale' | 'animationDuration'>
  > & ButtonConfig;
  private _textObj: Text | null = null;

  /** Press callback */
  public onPress?: () => void;

  constructor(config: ButtonConfig = {}) {
    super();

    this._config = {
      width: config.width ?? 200,
      height: config.height ?? 60,
      borderRadius: config.borderRadius ?? 8,
      pressScale: config.pressScale ?? 0.95,
      animationDuration: config.animationDuration ?? 100,
      ...config,
    };

    this.onPress = config.onPress;
    this._buildViews(config);

    // Text
    if (config.text) {
      this._textObj = new Text({
        text: config.text,
        style: {
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: 20,
          fill: 0xffffff,
          fontWeight: 'bold',
          ...config.textStyle,
        },
      });
      this._textObj.anchor.set(0.5);
      this.addChild(this._textObj);
    }

    // Interaction
    this.eventMode = 'static';
    this.cursor = 'pointer';

    this.on('pointerover', this._onPointerOver, this);
    this.on('pointerout', this._onPointerOut, this);
    this.on('pointerdown', this._onPointerDown, this);
    this.on('pointerup', this._onPointerUp, this);
    this.on('pointerupoutside', this._onPointerUpOutside, this);

    if (config.disabled) {
      this.enabled = false;
    }
  }

  /** Current button state */
  get state(): ButtonState {
    return this._state;
  }

  /** Enable the button */
  enable(): void {
    this.enabled = true;
  }

  /** Disable the button */
  disable(): void {
    this.enabled = false;
  }

  /** Whether the button is enabled */
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.cursor = value ? 'pointer' : 'default';
    this.eventMode = value ? 'static' : 'none';
    this._setState(value ? 'default' : 'disabled');
  }

  /** Whether the button is disabled */
  get disabled(): boolean {
    return !this._enabled;
  }

  /** Update button text */
  set text(value: string) {
    if (this._textObj) {
      this._textObj.text = value;
    }
  }

  // ─── View building ──────────────────────────────────

  private _buildViews(config: ButtonConfig): void {
    const colorMap = { ...DEFAULT_COLORS, ...config.colors };
    const { width, height, borderRadius } = this._config;
    const stateViews: Record<ButtonState, ViewInput | undefined> = {
      default: config.defaultView,
      hover: config.hoverView,
      pressed: config.pressedView,
      disabled: config.disabledView,
    };

    const states: ButtonState[] = ['default', 'hover', 'pressed', 'disabled'];

    for (const state of states) {
      const customView = resolveView(stateViews[state]);
      const view = customView ?? makeGraphicsView(width, height, borderRadius, colorMap[state]);
      view.visible = state === 'default';
      this._views.set(state, view);
      this.addChild(view);
    }
  }

  private _rebuildViews(): void {
    for (const [, view] of this._views) {
      this.removeChild(view);
      view.destroy();
    }
    this._views.clear();

    this._buildViews(this._config);

    // Re-insert views before text
    if (this._textObj && this._textObj.parent === this) {
      this.setChildIndex(this._textObj, this.children.length - 1);
    }
  }

  // ─── State management ───────────────────────────────

  private _setState(state: ButtonState): void {
    if (this._state === state) return;
    this._state = state;

    for (const [s, view] of this._views) {
      view.visible = s === state;
    }
  }

  private _onPointerOver(): void {
    if (!this._enabled) return;
    this._setState('hover');
    Tween.killTweensOf(this);
    Tween.to(this, { 'scale.x': 1.03, 'scale.y': 1.03 }, this._config.animationDuration, Easing.easeOutQuad);
  }

  private _onPointerOut(): void {
    if (!this._enabled) return;
    this._setState('default');
    Tween.killTweensOf(this);
    Tween.to(this, { 'scale.x': 1, 'scale.y': 1 }, this._config.animationDuration, Easing.easeOutQuad);
  }

  private _onPointerDown(): void {
    if (!this._enabled) return;
    this._setState('pressed');
    Tween.killTweensOf(this);
    const s = this._config.pressScale;
    Tween.to(this, { 'scale.x': s, 'scale.y': s }, this._config.animationDuration, Easing.easeOutQuad);
  }

  private _onPointerUp(): void {
    if (!this._enabled) return;
    this._setState('hover');
    Tween.killTweensOf(this);
    Tween.to(this, { 'scale.x': 1.03, 'scale.y': 1.03 }, this._config.animationDuration, Easing.easeOutQuad);
    this.onPress?.();
  }

  private _onPointerUpOutside(): void {
    if (!this._enabled) return;
    this._setState('default');
    Tween.killTweensOf(this);
    Tween.to(this, { 'scale.x': 1, 'scale.y': 1 }, this._config.animationDuration, Easing.easeOutQuad);
  }

  /** React reconciler update hook */
  updateConfig(changed: Record<string, any>): void {
    if ('text' in changed && this._textObj) this._textObj.text = changed.text;
    if ('disabled' in changed) this.enabled = !changed.disabled;
    if ('onPress' in changed) this.onPress = changed.onPress;

    const structural = [
      'colors', 'width', 'height', 'borderRadius', 'textStyle',
      'defaultView', 'hoverView', 'pressedView', 'disabledView',
    ];
    const needsRebuild = structural.some((k) => k in changed);
    if (needsRebuild) {
      Object.assign(this._config, changed);
      this._rebuildViews();
    }
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; textureSource?: boolean }): void {
    Tween.killTweensOf(this);
    this.off('pointerover', this._onPointerOver, this);
    this.off('pointerout', this._onPointerOut, this);
    this.off('pointerdown', this._onPointerDown, this);
    this.off('pointerup', this._onPointerUp, this);
    this.off('pointerupoutside', this._onPointerUpOutside, this);
    this._views.clear();
    this._textObj = null;
    super.destroy(options);
  }
}
