import { Container, type ColorSource } from 'pixi.js';
import { ScrollBox as PixiScrollBox } from '@pixi/ui';
import type { ScrollBoxOptions } from '@pixi/ui';

// ─── Types ───────────────────────────────────────────────

export type ScrollDirection = 'vertical' | 'horizontal' | 'both';

export interface ScrollContainerConfig {
  /** Visible viewport width */
  width: number;

  /** Visible viewport height */
  height: number;

  /** Scroll direction (default: 'vertical') */
  direction?: ScrollDirection;

  /** Background color (undefined = transparent) */
  backgroundColor?: ColorSource;

  /** Border radius for the mask (default: 0) */
  borderRadius?: number;

  /** Gap between items (default: 0) */
  elementsMargin?: number;

  /** Padding */
  padding?: number;

  /** Disable dynamic rendering (render all items even when offscreen) */
  disableDynamicRendering?: boolean;

  /** Disable easing/inertia */
  disableEasing?: boolean;

  /** Global scroll — scroll even when mouse is not over the component */
  globalScroll?: boolean;
}

const DIRECTION_MAP: Record<ScrollDirection, 'vertical' | 'horizontal' | 'bidirectional'> = {
  vertical: 'vertical',
  horizontal: 'horizontal',
  both: 'bidirectional',
};

/**
 * Scrollable container powered by `@pixi/ui` ScrollBox.
 *
 * Provides touch/drag scrolling, mouse wheel support, inertia, and
 * dynamic rendering optimization for off-screen items.
 *
 * @example
 * ```ts
 * const scroll = new ScrollContainer({
 *   width: 600,
 *   height: 400,
 *   direction: 'vertical',
 *   elementsMargin: 8,
 * });
 *
 * for (let i = 0; i < 50; i++) {
 *   scroll.addItem(createRow(i));
 * }
 *
 * scene.container.addChild(scroll);
 * ```
 */
export class ScrollContainer extends PixiScrollBox {
  private _scrollConfig: ScrollContainerConfig;

  constructor(config: ScrollContainerConfig) {
    const options: ScrollBoxOptions = {
      width: config.width,
      height: config.height,
      type: DIRECTION_MAP[config.direction ?? 'vertical'],
      radius: config.borderRadius ?? 0,
      elementsMargin: config.elementsMargin ?? 0,
      padding: config.padding ?? 0,
      disableDynamicRendering: config.disableDynamicRendering ?? false,
      disableEasing: config.disableEasing ?? false,
      globalScroll: config.globalScroll ?? true,
    };

    if (config.backgroundColor !== undefined) {
      options.background = config.backgroundColor;
    }

    super(options);

    this._scrollConfig = config;
  }

  /** Set scrollable content. Replaces any existing content. */
  setContent(content: Container): void {
    // Remove existing items
    const existing = this.items;
    if (existing.length > 0) {
      for (let i = existing.length - 1; i >= 0; i--) {
        this.removeItem(i);
      }
    }

    // Add all children from the content container
    const children = [...content.children] as Container[];
    if (children.length > 0) {
      this.addItems(children);
    }
  }

  /** Add a single item */
  addItem(...items: Container[]): Container {
    this.addItems(items);
    return items[0];
  }

  /** Scroll to make a specific item/child visible */
  scrollToItem(index: number): void {
    this.scrollTo(index);
  }

  /** Current scroll position */
  get scrollPosition(): { x: number; y: number } {
    return { x: this.scrollX, y: this.scrollY };
  }
}
