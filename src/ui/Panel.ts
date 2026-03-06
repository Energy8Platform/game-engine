import { Container, NineSliceSprite, Texture } from 'pixi.js';
import { LayoutContainer } from '@pixi/layout/components';
import type { LayoutStyles } from '@pixi/layout';

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
 * Background panel powered by `@pixi/layout` LayoutContainer.
 *
 * Supports both Graphics-based (color + border) and 9-slice sprite backgrounds.
 * Children added to `content` participate in flexbox layout automatically.
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
export class Panel extends LayoutContainer {
  private _panelConfig: Required<
    Pick<PanelConfig, 'width' | 'height' | 'padding' | 'backgroundAlpha'>
  > & PanelConfig;

  constructor(config: PanelConfig = {}) {
    const resolvedConfig = {
      width: config.width ?? 400,
      height: config.height ?? 300,
      padding: config.padding ?? 16,
      backgroundAlpha: config.backgroundAlpha ?? 1,
      ...config,
    };

    // If using a 9-slice texture, pass it as a custom background
    let customBackground: Container | undefined;
    if (config.nineSliceTexture) {
      const texture =
        typeof config.nineSliceTexture === 'string'
          ? Texture.from(config.nineSliceTexture)
          : config.nineSliceTexture;
      const [left, top, right, bottom] = config.nineSliceBorders ?? [10, 10, 10, 10];
      const nineSlice = new NineSliceSprite({
        texture,
        leftWidth: left,
        topHeight: top,
        rightWidth: right,
        bottomHeight: bottom,
      });
      nineSlice.width = resolvedConfig.width;
      nineSlice.height = resolvedConfig.height;
      nineSlice.alpha = resolvedConfig.backgroundAlpha;
      customBackground = nineSlice;
    }

    super(customBackground ? { background: customBackground } : undefined);

    this._panelConfig = resolvedConfig;

    // Apply layout styles
    const layoutStyles: LayoutStyles = {
      width: resolvedConfig.width,
      height: resolvedConfig.height,
      padding: resolvedConfig.padding,
      flexDirection: 'column',
    };

    // Graphics-based background via layout styles
    if (!config.nineSliceTexture) {
      layoutStyles.backgroundColor = config.backgroundColor ?? 0x1a1a2e;
      layoutStyles.borderRadius = config.borderRadius ?? 0;
      if (config.borderColor !== undefined && config.borderWidth) {
        layoutStyles.borderColor = config.borderColor;
        layoutStyles.borderWidth = config.borderWidth;
      }
    }

    this.layout = layoutStyles;

    if (!config.nineSliceTexture) {
      this.background.alpha = resolvedConfig.backgroundAlpha;
    }
  }

  /** Access the content container (children added here participate in layout) */
  get content(): Container {
    return this.overflowContainer;
  }

  /** Resize the panel */
  setSize(width: number, height: number): void {
    this._panelConfig.width = width;
    this._panelConfig.height = height;
    this._layout?.setStyle({ width, height });
  }
}
