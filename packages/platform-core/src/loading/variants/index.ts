import { energy8Variant } from './energy8';
import { slottechVariant } from './slottech';
import { voidmoonVariant } from './voidmoon';

/**
 * Registry of selectable preloader variants. Add a new variant by writing a
 * file in this folder and adding one entry here — `PreloaderVariantName` and
 * `LoadingScreenConfig.preloaderVariant` widen automatically.
 */
export const VARIANTS = {
  energy8: energy8Variant,
  slottech: slottechVariant,
  voidmoon: voidmoonVariant,
} as const;

/** Default variant used when `preloaderVariant` is omitted or unknown. */
export const DEFAULT_VARIANT_NAME = 'energy8';

export type PreloaderVariantName = keyof typeof VARIANTS;

export type { PreloaderVariant, PreloaderVariantHandle } from './types';
