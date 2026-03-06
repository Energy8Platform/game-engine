import { Graphics, Texture } from 'pixi.js';
import { FancyButton } from '@pixi/ui';
import type { ButtonOptions } from '@pixi/ui';

export type ButtonState = 'default' | 'hover' | 'pressed' | 'disabled';

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
  /** Button text */
  text?: string;
  /** Button text style */
  textStyle?: Record<string, unknown>;
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
  g.roundRect(0, 0, w, h, radius).fill(color);
  // Highlight overlay
  g.roundRect(2, 2, w - 4, h * 0.45, radius).fill({ color: 0xffffff, alpha: 0.1 });
  return g;
}

/**
 * Interactive button component powered by `@pixi/ui` FancyButton.
 *
 * Supports both texture-based and Graphics-based rendering with
 * per-state views, press animation, and text.
 *
 * @example
 * ```ts
 * const btn = new Button({
 *   width: 200, height: 60, borderRadius: 12,
 *   colors: { default: 0x22aa22, hover: 0x33cc33 },
 *   text: 'SPIN',
 * });
 *
 * btn.onPress.connect(() => console.log('Clicked!'));
 * scene.container.addChild(btn);
 * ```
 */
export class Button extends FancyButton {
  private _buttonConfig: Required<
    Pick<ButtonConfig, 'width' | 'height' | 'borderRadius' | 'pressScale' | 'animationDuration'>
  > & ButtonConfig;

  constructor(config: ButtonConfig = {}) {
    const resolvedConfig = {
      width: config.width ?? 200,
      height: config.height ?? 60,
      borderRadius: config.borderRadius ?? 8,
      pressScale: config.pressScale ?? 0.95,
      animationDuration: config.animationDuration ?? 100,
      ...config,
    };

    const colorMap = { ...DEFAULT_COLORS, ...config.colors };
    const { width, height, borderRadius } = resolvedConfig;

    // Build FancyButton options
    const options: ButtonOptions = {
      anchor: 0.5,
      animations: {
        hover: {
          props: { scale: { x: 1.03, y: 1.03 } },
          duration: resolvedConfig.animationDuration,
        },
        pressed: {
          props: { scale: { x: resolvedConfig.pressScale, y: resolvedConfig.pressScale } },
          duration: resolvedConfig.animationDuration,
        },
      },
    };

    // Texture-based views
    if (config.textures) {
      if (config.textures.default) options.defaultView = config.textures.default as any;
      if (config.textures.hover) options.hoverView = config.textures.hover as any;
      if (config.textures.pressed) options.pressedView = config.textures.pressed as any;
      if (config.textures.disabled) options.disabledView = config.textures.disabled as any;
    } else {
      // Graphics-based views
      options.defaultView = makeGraphicsView(width, height, borderRadius, colorMap.default);
      options.hoverView = makeGraphicsView(width, height, borderRadius, colorMap.hover);
      options.pressedView = makeGraphicsView(width, height, borderRadius, colorMap.pressed);
      options.disabledView = makeGraphicsView(width, height, borderRadius, colorMap.disabled);
    }

    // Text
    if (config.text) {
      options.text = config.text;
    }

    super(options);

    this._buttonConfig = resolvedConfig;

    if (config.disabled) {
      this.enabled = false;
    }
  }

  /** Enable the button */
  enable(): void {
    this.enabled = true;
  }

  /** Disable the button */
  disable(): void {
    this.enabled = false;
  }

  /** Whether the button is disabled */
  get disabled(): boolean {
    return !this.enabled;
  }
}
