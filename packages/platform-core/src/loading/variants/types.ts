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
  /**
   * `false` skips the platform's "POWERED BY ENERGY8 ENGINE" pre-roll for this
   * identity. Deliberately a property of the variant, not of
   * `LoadingScreenConfig`: a game cannot opt out of the attribution, only the
   * registry can. Default `true`.
   */
  splash?: boolean;
  /**
   * How long the variant's own intro animation runs after mount, in ms. The
   * brand gate keeps the preloader up until it has played (plus the brand
   * floor), so a fast boot can't cut it short. Default 0.
   */
  introMs?: number;
  /**
   * Fixed overlay background for this identity (any CSS `background` value).
   * Overrides the game's `backgroundColor` / `backgroundGradient` — for
   * artwork that only reads on one backdrop.
   */
  background?: string;
}
