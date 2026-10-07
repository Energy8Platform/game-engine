import { buildLogoSVG, LOADER_BAR_MAX_WIDTH } from '../logo';
import { SPLASH_DURATION_MS } from '../splash';
import type { PreloaderVariant, PreloaderVariantHandle } from './types';

/** Element ids the lifecycle handle binds to (also asserted by tests). */
const RECT_ID = 'ge-pl-loader-rect';
const TEXT_ID = 'ge-pl-loader-text';

const LOGO_SVG = buildLogoSVG({
  idPrefix: 'pl',
  svgClass: 'ge-logo-svg',
  clipRectClass: 'ge-clip-rect',
  clipRectId: RECT_ID,
  textClass: 'ge-preloader-svg-text',
  textId: TEXT_ID,
});

/**
 * Length of the logo's own intro, from its start: the "e" and the "8" fade in
 * side by side (0–500ms), then the "8" slides out to its place uncovering the
 * letters between them (600–1400ms), then the loader bar rises in under the
 * gap (1500–1900ms).
 */
const LOGO_INTRO_MS = 1900;

/**
 * Brand-gate length from mount. The intro waits for the powered-by splash —
 * the variant content is mounted under it from the first frame, so an intro
 * starting at mount would play unseen behind the splash's black backdrop.
 */
export const ENERGY8_INTRO_MS = SPLASH_DURATION_MS + LOGO_INTRO_MS;

/** How far (SVG units) the "8" starts left of its place: tucked in next to the "e". */
const EIGHT_SHIFT = 238;
/** How far (SVG units) the whole word starts right, so the opening "E8" pair sits centred. */
const WORD_SHIFT = 119;

/** Keyframe offset (%) of a moment `ms` into the intro. */
const at = (ms: number) => `${+((ms / LOGO_INTRO_MS) * 100).toFixed(2)}%`;

/** The energy8 preloader: a black screen, the "E8" opening into "energy8", a thin white loader bar. */
export const energy8Variant: PreloaderVariant = {
  introMs: ENERGY8_INTRO_MS,
  background: '#000',

  buildContentHTML() {
    return `
    <div class="ge-preloader-content">
      ${LOGO_SVG}
    </div>
  `;
  },

  css: `
    .ge-preloader-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 70%;
      max-width: 520px;
    }

    .ge-logo-svg {
      width: 100%;
      height: auto;
    }

    /* ── Intro: one ${LOGO_INTRO_MS}ms timeline, started once the splash has lifted ── */
    .ge-logo-svg .ge-e8-word,
    .ge-logo-svg .ge-e8-e,
    .ge-logo-svg .ge-e8-8,
    .ge-logo-svg .ge-e8-mid,
    .ge-logo-svg .ge-e8-loader {
      animation-duration: ${LOGO_INTRO_MS}ms;
      animation-delay: ${SPLASH_DURATION_MS}ms;
      animation-fill-mode: both;
    }

    .ge-logo-svg .ge-e8-e,
    .ge-logo-svg .ge-e8-8 {
      transform-box: fill-box;
      transform-origin: center;
    }

    /* The word starts shifted so the "E8" pair is centred, and drifts back as the 8 opens it. */
    .ge-logo-svg .ge-e8-word { animation-name: ge-e8-word; }
    @keyframes ge-e8-word {
      0%, ${at(600)} { transform: translateX(${WORD_SHIFT}px); animation-timing-function: ease-in-out; }
      ${at(1400)}, 100% { transform: translateX(0); }
    }

    .ge-logo-svg .ge-e8-e { animation-name: ge-e8-e; }
    @keyframes ge-e8-e {
      0% { opacity: 0; transform: scale(.85); animation-timing-function: ease-in; }
      ${at(500)}, 100% { opacity: 1; transform: scale(1); }
    }

    .ge-logo-svg .ge-e8-8 { animation-name: ge-e8-8; }
    @keyframes ge-e8-8 {
      0% { opacity: 0; transform: translateX(-${EIGHT_SHIFT}px) scale(.85); animation-timing-function: ease-in; }
      ${at(500)} { opacity: 1; transform: translateX(-${EIGHT_SHIFT}px) scale(1); }
      ${at(600)} { transform: translateX(-${EIGHT_SHIFT}px) scale(1); animation-timing-function: ease-in-out; }
      ${at(1400)}, 100% { opacity: 1; transform: translateX(0) scale(1); }
    }

    /* The letters are uncovered from under the 8: a clip whose right edge
       follows the 8's left edge (same span, same easing). */
    .ge-logo-svg .ge-e8-mid { animation-name: ge-e8-mid; }
    @keyframes ge-e8-mid {
      0%, ${at(600)} { -webkit-clip-path: inset(0 100% 0 0); clip-path: inset(0 100% 0 0); animation-timing-function: ease-in-out; }
      ${at(1400)}, 100% { -webkit-clip-path: inset(0 0 0 0); clip-path: inset(0 0 0 0); }
    }

    /* The bar rises in under the gap once the whole word is out. */
    .ge-logo-svg .ge-e8-loader { animation-name: ge-e8-loader; }
    @keyframes ge-e8-loader {
      0%, ${at(1500)} { opacity: 0; transform: translateY(8px); animation-timing-function: ease-out; }
      100% { opacity: 1; transform: translateY(0); }
    }

    /* Shimmer the loader clip-rect while waiting */
    .ge-clip-rect {
      animation: ge-loader-fill 2s ease-in-out infinite;
    }

    @keyframes ge-loader-fill {
      0%   { width: 0; }
      50%  { width: ${LOADER_BAR_MAX_WIDTH}px; }
      100% { width: 0; }
    }

    /* Animate the SVG text opacity */
    .ge-preloader-svg-text {
      animation: ge-pulse 1.5s ease-in-out infinite;
    }

    @keyframes ge-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    /* Stop shimmer once JS-driven progress takes over. */
    .ge-clip-rect.driven {
      animation: none;
    }

    /* Tap-to-start CTA pulse. Compound selector outweighs the ambient
       .ge-preloader-svg-text rule, swapping the animation cleanly. */
    .ge-preloader-svg-text.ge-svg-pulse {
      animation: ge-tap-pulse 1.2s ease-in-out infinite;
    }

    @keyframes ge-tap-pulse {
      0%, 100% { opacity: 0.5; }
      50%      { opacity: 1; }
    }

    /* Last so it outranks the intro rules above: the settled logo, bar up at once. */
    @media (prefers-reduced-motion: reduce) {
      .ge-logo-svg .ge-e8-word,
      .ge-logo-svg .ge-e8-e,
      .ge-logo-svg .ge-e8-8,
      .ge-logo-svg .ge-e8-mid,
      .ge-logo-svg .ge-e8-loader { animation: none; }
    }
  `,

  mount(overlay): PreloaderVariantHandle | null {
    const rectEl = overlay.querySelector(`#${RECT_ID}`) as SVGRectElement | null;
    const textEl = overlay.querySelector(`#${TEXT_ID}`) as SVGTextElement | null;
    // Custom HTML mode (or missing logo) — no progress target; lifecycle inert.
    if (!rectEl || !textEl) return null;

    let driven = false;

    return {
      setProgress(p, showPercentage) {
        if (!driven) {
          rectEl.classList.add('driven');
          driven = true;
        }
        rectEl.setAttribute('width', String(p * LOADER_BAR_MAX_WIDTH));
        if (showPercentage) {
          textEl.textContent = `${Math.round(p * 100)}%`;
        }
      },
      showTapText(text) {
        textEl.textContent = text;
        textEl.classList.add('ge-svg-pulse');
      },
    };
  },
};
