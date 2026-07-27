import type { PreloaderVariant, PreloaderVariantHandle } from './types';

/** Element ids the lifecycle handle binds to. */
const RECT_ID = 'ge-st-loader-rect';
const TEXT_ID = 'ge-st-loader-text';

/** Max width (SVG units) of the slottech loader bar fill — spans the artwork's full width. */
const LOADER_BAR_MAX_WIDTH = 841.89;

/** Flat wordmark fill, straight from the official artwork (no gradient). */
const LOGO_FILL = '#f5f5f5';
/** Ambient glow tint, keyed off the fill. */
const GLOW = 'rgba(245, 245, 245, 0.22)';

/**
 * "SlotTech" wordmark — the official logo embedded verbatim as vector outlines
 * (the "ST" monogram above, "SLOTTECH" lettering below). The artwork ends at
 * y=426.32; the loader bar and status text are added beneath it in the extended
 * viewBox.
 *
 * The one deviation from the export: the "O" of SLOTTECH ships as two separate
 * filled paths (outer + counter), which would paint a solid slab. They are
 * merged into a single `fill-rule="evenodd"` path so the counter stays a hole.
 */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 841.89 520" class="ge-st-logo-svg" role="img">
  <title>SlotTech</title>
  <g fill="${LOGO_FILL}">
    <path d="M147.7,289.83l37.26-55.73c1.75-2.61,4.67-4.18,7.81-4.17,19.91.04,120.3-.2,161.37-.13,15.28.03,27.67-12.36,27.65-27.64h0c-.02-15.26-12.4-27.6-27.66-27.57-.9,0-82.45.49-83.44.49-48.78.09-88.18-39.8-87.46-88.58h0C183.93,38.8,222.81.49,270.52.49l421.66-.49-40.64,56.9c-3.88,4.36-9.44,6.86-15.28,6.87-49.38.03-293.63-.02-365.45.13-12.9.03-23.36,10.42-23.49,23.31h0c-.13,13,10.29,23.64,23.28,23.78,25.44.28,80.28.99,88.33,1.19,48.36,1.24,86.86,40.91,86.6,89.28h0c-.26,48.88-39.96,88.37-88.84,88.37h-209Z"/>
    <path d="M431.26,289.83h76.99l35.07-165.93c1.19-6.22-.72-12.63-5.11-17.19h0c-3.55-3.69-8.4-5.84-13.52-5.98l-102.5-.23c-3.34-.04-5.26,3.79-3.23,6.44,62.27,45.72,62.12,111.86,22.04,167.08-.68.94-1.49,1.79-2.38,2.52l-9.97,8.24c-1.5,2.12.01,5.04,2.61,5.04Z"/>
    <path d="M66.01,376.51v-11.84l-47.67-.13C8.22,364.52,0,372.72,0,382.84h0c0,10.08,8.15,18.26,18.23,18.29l33.07-.16c3.7.01,6.69,3.02,6.69,6.72h0c0,3.71-3.01,6.72-6.72,6.72l-50.07.25v11.5l50.17.16c10.26,0,18.55-8.37,18.45-18.63h0c-.1-10.06-8.23-18.19-18.3-18.28l-34.94.03c-3.38-.03-6.11-2.76-6.16-6.14h0c-.05-3.46,2.74-6.3,6.2-6.31l49.36-.48Z"/>
    <polygon points="107.82 426.32 176.27 426.32 176.27 414.31 120.71 414.31 120.71 364.55 107.82 364.55 107.82 426.32"/>
    <path fill-rule="evenodd" d="M288.1,381.64v27.6c0,9.44-7.66,17.08-17.1,17.08h-40.89c-9.44,0-17.08-7.64-17.08-17.08v-27.6c0-9.44,7.64-17.1,17.08-17.1h40.89c9.44,0,17.1,7.66,17.1,17.1ZM274.68,382.63v24.86c0,3.58-2.89,6.48-6.46,6.48h-35.5c-3.56,0-6.46-2.9-6.46-6.48v-24.86c0-3.57,2.9-6.46,6.46-6.46h35.5c3.57,0,6.46,2.89,6.46,6.46Z"/>
    <polygon points="368.74 426.32 368.91 376.17 400.44 376.17 400.44 364.55 324.84 364.55 324.84 376.17 356.19 376.17 356.19 426.32 368.74 426.32"/>
    <polygon points="482.21 425.95 482.39 375.8 513.91 375.8 513.91 364.18 438.32 364.18 438.32 375.8 469.67 375.8 469.67 425.95 482.21 425.95"/>
    <rect x="554.23" y="364.55" width="71.41" height="11.97"/>
    <rect x="554.23" y="389.26" width="71.41" height="11.97"/>
    <rect x="554.23" y="413.98" width="71.41" height="11.97"/>
    <path d="M733.29,376.51v-11.97h-49.5c-9.79,0-17.73,7.94-17.73,17.73v25.95c0,9.79,7.94,17.73,17.73,17.73h49.5v-11.97h-48.67c-3.52,0-6.37-2.85-6.37-6.37v-24.72c0-3.52,2.85-6.37,6.37-6.37h48.67Z"/>
    <polygon points="773.52 425.95 785.8 425.95 785.98 401.16 829.26 400.99 829.26 425.95 841.89 425.95 841.89 364.55 829.35 364.55 829.35 389.49 786.15 389.49 786.15 364.55 773.52 364.55 773.52 425.95"/>
  </g>

  <rect x="0" y="460" width="841.89" height="12" rx="6" fill="rgba(255,255,255,0.12)"/>
  <clipPath id="ge-st-loader-clip">
    <rect id="${RECT_ID}" x="0" y="460" width="0" height="12" rx="6" class="ge-st-clip-rect"/>
  </clipPath>
  <rect x="0" y="460" width="841.89" height="12" rx="6" fill="${LOGO_FILL}" clip-path="url(#ge-st-loader-clip)"/>

  <text id="${TEXT_ID}" x="420.95" y="510" text-anchor="middle" class="ge-st-text">Loading...</text>
</svg>`;

export const slottechVariant: PreloaderVariant = {
  buildContentHTML() {
    return `
    <div class="ge-st-content">
      ${LOGO_SVG}
    </div>
  `;
  },

  css: `
    .ge-st-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 78%;
      max-width: 620px;
    }

    .ge-st-logo-svg {
      width: 100%;
      height: auto;
      filter: drop-shadow(0 0 26px ${GLOW});
    }

    /* Shimmer the loader bar while waiting */
    .ge-st-clip-rect {
      animation: ge-st-fill 2s ease-in-out infinite;
    }

    @keyframes ge-st-fill {
      0%   { width: 0; }
      50%  { width: 841.89; }
      100% { width: 0; }
    }

    /* Stop shimmer once JS-driven progress takes over. */
    .ge-st-clip-rect.driven {
      animation: none;
    }

    .ge-st-text {
      fill: rgba(255, 255, 255, 0.6);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 3px;
      animation: ge-st-pulse 1.5s ease-in-out infinite;
    }

    @keyframes ge-st-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    /* Tap-to-start CTA pulse. Compound selector outweighs the ambient
       .ge-st-text rule, swapping the animation cleanly. */
    .ge-st-text.ge-st-tap-pulse {
      animation: ge-st-tap 1.2s ease-in-out infinite;
    }

    @keyframes ge-st-tap {
      0%, 100% { opacity: 0.5; }
      50%      { opacity: 1; }
    }
  `,

  mount(overlay): PreloaderVariantHandle | null {
    const rectEl = overlay.querySelector(`#${RECT_ID}`) as SVGRectElement | null;
    const textEl = overlay.querySelector(`#${TEXT_ID}`) as SVGTextElement | null;
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
        textEl.classList.add('ge-st-tap-pulse');
      },
    };
  },
};
