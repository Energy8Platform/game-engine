import { Container, Graphics, NineSliceSprite, Texture } from 'pixi.js';
import { FlexContainer } from './FlexContainer';
import type { FlexContainerConfig } from './FlexContainer';

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
  /** Flex layout config for content */
  layout?: Partial<FlexContainerConfig>;
}

/**
 * Background panel with optional flexbox content layout.
 *
 * Supports both Graphics-based (color + border) and 9-slice sprite backgrounds.
 * Children added via `addContent()` participate in flex layout automatically.
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
  readonly __uiComponent = true as const;

  private _bg: Container;
  private _content: FlexContainer;
  private _internalSetup = true;
  private _panelConfig: Required<
    Pick<PanelConfig, 'width' | 'height' | 'padding' | 'backgroundAlpha'>
  > & PanelConfig;

  constructor(config: PanelConfig = {}) {
    super();

    const resolvedConfig = {
      width: config.width ?? 400,
      height: config.height ?? 300,
      padding: config.padding ?? 16,
      backgroundAlpha: config.backgroundAlpha ?? 1,
      ...config,
    };

    this._panelConfig = resolvedConfig;

    // Create background
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
      this._bg = nineSlice;
    } else {
      const g = new Graphics();
      const bgColor = config.backgroundColor ?? 0x1a1a2e;
      const radius = config.borderRadius ?? 0;
      g.roundRect(0, 0, resolvedConfig.width, resolvedConfig.height, radius).fill(bgColor);
      if (config.borderColor !== undefined && config.borderWidth) {
        g.roundRect(0, 0, resolvedConfig.width, resolvedConfig.height, radius)
          .stroke({ color: config.borderColor, width: config.borderWidth });
      }
      g.alpha = resolvedConfig.backgroundAlpha;
      this._bg = g;
    }
    this.addChild(this._bg);

    // Create content flex container
    this._content = new FlexContainer({
      ...config.layout,
      direction: config.layout?.direction ?? 'column',
      justifyContent: config.layout?.justifyContent ?? 'start',
      alignItems: config.layout?.alignItems ?? 'start',
      gap: config.layout?.gap ?? 0,
      padding: resolvedConfig.padding,
      width: resolvedConfig.width,
      height: resolvedConfig.height,
    });
    this.addChild(this._content);
    this._internalSetup = false;
  }

  /** Access the content flex container — add children here for layout */
  get content(): FlexContainer {
    return this._content;
  }

  /** Convenience: add a child to the content layout */
  addContent(child: Container): this {
    this._content.addFlexChild(child);
    this._content.updateLayout();
    return this;
  }

  /** Resize the panel */
  setSize(width: number, height: number): void {
    this._panelConfig.width = width;
    this._panelConfig.height = height;

    // Resize background
    if (this._bg instanceof NineSliceSprite) {
      this._bg.width = width;
      this._bg.height = height;
    } else if (this._bg instanceof Graphics) {
      const radius = this._panelConfig.borderRadius ?? 0;
      const bgColor = this._panelConfig.backgroundColor ?? 0x1a1a2e;
      this._bg.clear();
      (this._bg as Graphics).roundRect(0, 0, width, height, radius).fill(bgColor);
      if (this._panelConfig.borderColor !== undefined && this._panelConfig.borderWidth) {
        (this._bg as Graphics).roundRect(0, 0, width, height, radius)
          .stroke({ color: this._panelConfig.borderColor, width: this._panelConfig.borderWidth });
      }
      this._bg.alpha = this._panelConfig.backgroundAlpha;
    }

    this._content.resize(width, height);
  }

  /**
   * Override addChild so external children are routed to content FlexContainer.
   * Enables `<panel><label /><button /></panel>` in React JSX.
   */
  override addChild<T extends Container>(...children: T[]): T {
    if (this._internalSetup) {
      return super.addChild(...children);
    }
    for (const child of children) {
      this._content.addFlexChild(child as any);
    }
    this._content.updateLayout();
    return children[0];
  }

  override removeChild<T extends Container>(...children: T[]): T {
    if (this._internalSetup) {
      return super.removeChild(...children);
    }
    for (const child of children) {
      this._content.removeFlexChild(child as any);
    }
    return children[0];
  }

  /** React reconciler update hook */
  updateConfig(changed: Record<string, any>): void {
    if ('width' in changed || 'height' in changed) {
      this.setSize(changed.width ?? this._panelConfig.width, changed.height ?? this._panelConfig.height);
    }
    if ('backgroundAlpha' in changed) {
      this._panelConfig.backgroundAlpha = changed.backgroundAlpha;
      this._bg.alpha = changed.backgroundAlpha;
    }
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; textureSource?: boolean }): void {
    super.destroy(options);
  }
}
