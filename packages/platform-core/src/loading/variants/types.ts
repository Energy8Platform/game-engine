import type { LoadingScreenConfig } from '../../types';

/**
 * A live binding between the CSS preloader's lifecycle API
 * (`setCSSPreloaderProgress` / `waitCSSPreloaderTap`) and the variant's own
 * DOM. Returned by {@link PreloaderVariant.mount}; `null` when the variant has
 * no progress target (e.g. a custom-HTML override), which makes the lifecycle
 * inert.
 */
export interface PreloaderVariantHandle {
  /** Drive the progress indicator. `p` is already clamped to [0, 1]. */
  setProgress(p: number, showPercentage: boolean): void;
  /** Swap the waiting indicator to the tap-to-start cue. */
  showTapText(text: string): void;
}

/**
 * A selectable visual identity for the CSS preloader. Encapsulates the markup,
 * its scoped CSS (animations + logo styling), and how progress/tap are driven —
 * everything `CSSPreloader.ts` does NOT own (it keeps overlay/background/fade
 * infrastructure and the shared tap-listener machinery).
 */
export interface PreloaderVariant {
  /** Inner HTML for the overlay (including the variant's own content wrapper). */
  buildContentHTML(config?: LoadingScreenConfig): string;
  /** Variant-specific CSS appended after the shared base styles. */
  css: string;
  /**
   * Bind to the freshly-mounted overlay and return a handle, or `null` if the
   * variant's progress target is absent (lifecycle then becomes inert).
   */
  mount(
    overlay: HTMLElement,
    config?: LoadingScreenConfig,
  ): PreloaderVariantHandle | null;
}
