import { buildLogoSVG, LOADER_BAR_MAX_WIDTH } from '../logo';
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

/** The default Energy8-branded preloader: animated wordmark + shimmering loader bar. */
export const energy8Variant: PreloaderVariant = {
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
      width: 80%;
      max-width: 700px;
    }

    .ge-logo-svg {
      width: 100%;
      height: auto;
      filter: drop-shadow(0 0 30px rgba(121, 57, 194, 0.4));
    }

    /* Animate the loader clip-rect to shimmer while waiting */
    .ge-clip-rect {
      animation: ge-loader-fill 2s ease-in-out infinite;
    }

    @keyframes ge-loader-fill {
      0%   { width: 0; }
      50%  { width: 174; }
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
