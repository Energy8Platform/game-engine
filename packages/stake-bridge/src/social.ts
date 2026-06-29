/**
 * Social-mode (sweepstakes) text replacements.
 *
 * The dictionary + matcher now live in the shared, canonical module
 * `@energy8platform/game-sdk/social` so the bridge, the DOM shell and the Pixi shell all stay in
 * lock-step (they used to drift between three hand-maintained copies). This file just re-exports it
 * to keep `@energy8platform/stake-bridge`'s public surface stable.
 *
 * Games still call `applySocialReplacements()` on their own user-visible strings when
 * `INIT.config.socialMode === true`.
 */
export {
  SOCIAL_REPLACEMENTS,
  applySocialReplacements,
  type SocialReplacementRule,
} from '@energy8platform/game-sdk/social';
