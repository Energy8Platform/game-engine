import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { Tween } from '../animation/Tween';
import { Easing } from '../animation/Easing';

export type ButtonState = 'normal' | 'hover' | 'pressed' | 'disabled';

export interface ButtonConfig {
  /** Default texture/sprite for each state (optional — uses Graphics if not provided) */
  textures?: Partial<Record<ButtonState, string | Texture>>;
  /** Width (for Graphics-based button) */
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
}

const DEFAULT_COLORS: Record<ButtonState, number> = {
  normal: 0xffd700,
  hover: 0xffe44d,
  pressed: 0xccac00,
  disabled: 0x666666,
};

/**
 * Interactive button component with state management and animation.
 *
 * Supports both texture-based and Graphics-based rendering.
 *
 * @example
 * ```ts
 * const btn = new Button({
 *   width: 200, height: 60, borderRadius: 12,
 *   colors: { normal: 0x22aa22, hover: 0x33cc33 },
 * });
 *
 * btn.onTap = () => console.log('Clicked!');
 * scene.container.addChild(btn);
 * ```
 */
export class Button extends Container {
  private _state: ButtonState = 'normal';
  private _bg: Graphics;
  private _sprites: Partial<Record<ButtonState, Sprite>> = {};
  private _config: Required<
    Pick<ButtonConfig, 'width' | 'height' | 'borderRadius' | 'pressScale' | 'animationDuration'>
  > & ButtonConfig;

  /** Called when the button is tapped/clicked */
  public onTap?: () => void;

  /** Called when the button state changes */
  public onStateChange?: (state: ButtonState) => void;

  constructor(config: ButtonConfig = {}) {
    super();

    this._config = {
      width: 200,
      height: 60,
      borderRadius: 8,
      pressScale: 0.95,
      animationDuration: 100,
      ...config,
    };

    // Create Graphics background
    this._bg = new Graphics();
    this.addChild(this._bg);

    // Create texture sprites if provided
    if (config.textures) {
      for (const [state, tex] of Object.entries(config.textures)) {
        const texture = typeof tex === 'string' ? Texture.from(tex) : tex;
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.visible = state === 'normal';
        this._sprites[state as ButtonState] = sprite;
        this.addChild(sprite);
      }
    }

    // Make interactive
    this.eventMode = 'static';
    this.cursor = 'pointer';

    // Set up hit area for Graphics-based
    this.pivot.set(this._config.width / 2, this._config.height / 2);

    // Bind events
    this.on('pointerover', this.onPointerOver);
    this.on('pointerout', this.onPointerOut);
    this.on('pointerdown', this.onPointerDown);
    this.on('pointerup', this.onPointerUp);
    this.on('pointertap', this.onPointerTap);

    // Initial render
    this.setState('normal');

    if (config.disabled) {
      this.disable();
    }
  }

  /** Current button state */
  get state(): ButtonState {
    return this._state;
  }

  /** Enable the button */
  enable(): void {
    if (this._state === 'disabled') {
      this.setState('normal');
      this.eventMode = 'static';
      this.cursor = 'pointer';
    }
  }

  /** Disable the button */
  disable(): void {
    this.setState('disabled');
    this.eventMode = 'none';
    this.cursor = 'default';
  }

  /** Whether the button is disabled */
  get disabled(): boolean {
    return this._state === 'disabled';
  }

  private setState(state: ButtonState): void {
    if (this._state === state) return;
    this._state = state;
    this.render();
    this.onStateChange?.(state);
  }

  private render(): void {
    const { width, height, borderRadius, colors } = this._config;
    const colorMap = { ...DEFAULT_COLORS, ...colors };

    // Update Graphics
    this._bg.clear();
    this._bg.roundRect(0, 0, width, height, borderRadius).fill(colorMap[this._state]);

    // Add highlight for normal/hover
    if (this._state === 'normal' || this._state === 'hover') {
      this._bg
        .roundRect(2, 2, width - 4, height * 0.45, borderRadius)
        .fill({ color: 0xffffff, alpha: 0.1 });
    }

    // Update sprite visibility
    for (const [state, sprite] of Object.entries(this._sprites)) {
      if (sprite) sprite.visible = state === this._state;
    }
    // Fall back to normal sprite if state sprite doesn't exist
    if (!this._sprites[this._state] && this._sprites.normal) {
      this._sprites.normal.visible = true;
    }
  }

  private onPointerOver = (): void => {
    if (this._state === 'disabled') return;
    this.setState('hover');
  };

  private onPointerOut = (): void => {
    if (this._state === 'disabled') return;
    this.setState('normal');
    Tween.to(this.scale, { x: 1, y: 1 }, this._config.animationDuration);
  };

  private onPointerDown = (): void => {
    if (this._state === 'disabled') return;
    this.setState('pressed');
    const s = this._config.pressScale;
    Tween.to(this.scale, { x: s, y: s }, this._config.animationDuration, Easing.easeOutQuad);
  };

  private onPointerUp = (): void => {
    if (this._state === 'disabled') return;
    this.setState('hover');
    Tween.to(this.scale, { x: 1, y: 1 }, this._config.animationDuration, Easing.easeOutBack);
  };

  private onPointerTap = (): void => {
    if (this._state === 'disabled') return;
    this.onTap?.();
  };
}
