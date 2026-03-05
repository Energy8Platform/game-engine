import { Container, Graphics, NineSliceSprite, Texture } from 'pixi.js';

export interface PanelConfig {
  /** Width */
  width?: number;
  /** Height */
  height?: number;
  /** Background color (for Graphics-based panel) */
  backgroundColor?: number;
  /** Background alpha */
  backgroundAlpha?: number;
  /** Corner radius */
  borderRadius?: number;
  /** Border color */
  borderColor?: number;
  /** Border width */
  borderWidth?: number;
  /** 9-slice texture (if provided, uses NineSliceSprite instead of Graphics) */
  nineSliceTexture?: string | Texture;
  /** 9-slice borders [left, top, right, bottom] */
  nineSliceBorders?: [number, number, number, number];
  /** Padding inside the panel */
  padding?: number;
}

/**
 * Background panel that can use either Graphics or 9-slice sprite.
 *
 * @example
 * ```ts
 * // Simple colored panel
 * const panel = new Panel({ width: 400, height: 300, backgroundColor: 0x222222, borderRadius: 12 });
 *
 * // 9-slice panel (texture-based)
 * const panel = new Panel({
 *   nineSliceTexture: 'panel-bg',
 *   nineSliceBorders: [20, 20, 20, 20],
 *   width: 400, height: 300,
 * });
 * ```
 */
export class Panel extends Container {
  private _bg: Graphics | NineSliceSprite;
  private _content: Container;
  private _config: Required<
    Pick<PanelConfig, 'width' | 'height' | 'padding' | 'backgroundAlpha'>
  > & PanelConfig;

  constructor(config: PanelConfig = {}) {
    super();

    this._config = {
      width: 400,
      height: 300,
      padding: 16,
      backgroundAlpha: 1,
      ...config,
    };

    // Create background
    if (config.nineSliceTexture) {
      const texture =
        typeof config.nineSliceTexture === 'string'
          ? Texture.from(config.nineSliceTexture)
          : config.nineSliceTexture;

      const [left, top, right, bottom] = config.nineSliceBorders ?? [10, 10, 10, 10];

      this._bg = new NineSliceSprite({
        texture,
        leftWidth: left,
        topHeight: top,
        rightWidth: right,
        bottomHeight: bottom,
      });
      (this._bg as NineSliceSprite).width = this._config.width;
      (this._bg as NineSliceSprite).height = this._config.height;
    } else {
      this._bg = new Graphics();
      this.drawGraphicsBg();
    }

    this._bg.alpha = this._config.backgroundAlpha;
    this.addChild(this._bg);

    // Content container with padding
    this._content = new Container();
    this._content.x = this._config.padding;
    this._content.y = this._config.padding;
    this.addChild(this._content);
  }

  /** Content container — add children here */
  get content(): Container {
    return this._content;
  }

  /** Resize the panel */
  setSize(width: number, height: number): void {
    this._config.width = width;
    this._config.height = height;

    if (this._bg instanceof Graphics) {
      this.drawGraphicsBg();
    } else {
      this._bg.width = width;
      this._bg.height = height;
    }
  }

  private drawGraphicsBg(): void {
    const bg = this._bg as Graphics;
    const {
      width, height, backgroundColor, borderRadius, borderColor, borderWidth,
    } = this._config;

    bg.clear();
    bg.roundRect(0, 0, width!, height!, borderRadius ?? 0).fill(backgroundColor ?? 0x1a1a2e);

    if (borderColor !== undefined && borderWidth) {
      bg.roundRect(0, 0, width!, height!, borderRadius ?? 0)
        .stroke({ color: borderColor, width: borderWidth });
    }
  }
}
