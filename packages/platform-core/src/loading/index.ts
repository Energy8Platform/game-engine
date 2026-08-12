export {
  createCSSPreloader,
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
  removeCSSPreloader,
} from './CSSPreloader';
/**
 * A game-supplied overlay covering the gap before the engine's own loading
 * screen paints (Artube's branded loader). Deliberately NOT part of
 * `CSSPreloader.ts`: the built-in preloader must have no branch for it.
 */
export {
  adoptExternalOverlay,
  advanceExternalOverlay,
  externalOverlayHold,
  releaseExternalOverlay,
  hasExternalOverlay,
  DEFAULT_EXTERNAL_MIN_DISPLAY_MS,
} from './ExternalOverlay';
export { buildLogoSVG, LOADER_BAR_MAX_WIDTH } from './logo';
export { VARIANTS, DEFAULT_VARIANT_NAME } from './variants';
export type {
  PreloaderVariant,
  PreloaderVariantHandle,
  PreloaderVariantName,
} from './variants';
export type {
  LoadingScreenConfig,
  ExternalLoadingOverlay,
  AssetManifest,
  AssetBundle,
  AssetEntry,
} from '../types';
