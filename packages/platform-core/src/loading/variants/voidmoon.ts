import type { PreloaderVariant, PreloaderVariantHandle } from './types';

/** Element ids the lifecycle handle binds to. */
const RECT_ID = 'ge-vm-loader-rect';
const TEXT_ID = 'ge-vm-loader-text';

/** Max width (SVG units) of the voidmoon loader bar fill. Spans the first 'o' → end of the crescent. */
const LOADER_BAR_MAX_WIDTH = 751;

/**
 * "voidmoon" wordmark — the official logo, embedded verbatim as SVG outlines:
 * thin white letters with the final "o" of "moon" rendered as a purple crescent
 * (#9D63FE). The glyphs live in a flipped group (`translate(0,941) scale(1,-1)`)
 * exactly as exported; the loader bar + status text are added beneath it in the
 * outer (un-flipped) viewBox space.
 */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="301 339 1075 335" class="ge-vm-logo-svg" style="overflow:visible" role="img">
  <title>voidmoon</title>
  <g transform="translate(0,941) scale(1,-1)">
    <g fill="#ffffff" fill-rule="evenodd">
      <path d="M627 562 c-4 -2 -7 -6 -7 -12 0 -13 14 -18 23 -10 3 3 3 5 4 9 0 7 -2 11 -7 13 -5 2 -9 2 -13 0z"/>
      <path d="M780 531 l0 -31 -6 5 c-14 14 -35 17 -56 10 -24 -8 -40 -28 -42 -53 0 -11 1 -19 6 -30 8 -16 22 -27 40 -32 8 -2 23 -2 31 0 18 4 34 17 42 33 2 5 4 11 5 14 1 3 1 24 1 61 l0 55 -10 0 -11 0 0 -32z m-24 -38 c20 -10 28 -31 20 -50 -3 -6 -13 -16 -19 -19 -21 -10 -45 -2 -56 18 -2 4 -2 7 -3 14 -1 14 4 24 15 33 8 6 15 8 27 8 9 -1 10 -1 16 -4z"/>
      <path d="M520 518 c-26 -6 -45 -25 -50 -51 -1 -9 -1 -11 0 -19 3 -12 7 -21 15 -30 8 -8 16 -13 28 -17 6 -2 9 -2 19 -2 10 0 13 0 20 2 21 8 36 24 41 46 1 8 1 13 0 22 -5 23 -21 40 -44 47 -6 2 -23 3 -29 2z m29 -25 c9 -4 16 -11 20 -19 2 -5 3 -6 3 -15 0 -10 -1 -11 -3 -16 -8 -15 -23 -24 -40 -23 -9 1 -15 3 -22 8 -22 15 -21 48 2 63 7 4 14 6 24 6 8 -1 10 -1 16 -4z"/>
      <path d="M869 518 c-21 -4 -35 -18 -40 -38 -1 -6 -1 -14 -1 -43 l1 -35 10 0 11 0 0 37 c0 33 1 38 2 41 3 7 7 11 13 14 5 2 8 3 13 3 11 0 20 -5 25 -16 l3 -5 0 -37 1 -37 10 0 10 0 0 37 c0 35 1 37 3 42 5 10 14 16 26 16 11 0 21 -7 25 -17 2 -5 2 -7 2 -41 0 -19 0 -36 1 -37 0 -1 3 -1 11 -1 l10 1 0 35 c0 23 0 38 -1 42 -2 9 -8 21 -14 27 -20 17 -51 17 -68 -1 l-5 -5 -5 5 c-9 9 -19 13 -31 14 -5 0 -10 0 -12 -1z"/>
      <path d="M1077 517 c-9 -1 -20 -7 -27 -12 -7 -6 -14 -16 -18 -25 -4 -11 -5 -25 -3 -35 5 -21 21 -37 42 -44 38 -12 78 14 81 53 1 15 -4 31 -14 43 -14 17 -38 25 -61 20z m25 -22 c19 -5 31 -24 28 -42 -4 -26 -34 -41 -59 -29 -20 10 -27 32 -17 52 8 16 29 25 48 19z"/>
      <path d="M1282 516 c-18 -5 -34 -21 -38 -39 -1 -4 -1 -18 -1 -40 l1 -35 10 -1 10 0 0 32 c0 20 0 35 1 38 2 11 8 18 18 23 7 3 18 3 26 0 6 -3 12 -9 15 -16 2 -4 3 -6 3 -40 l1 -36 10 0 11 0 0 33 c0 38 0 43 -6 54 -7 14 -19 24 -34 28 -7 1 -20 1 -27 -1z"/>
      <path d="M329 515 c0 -1 2 -5 4 -9 2 -5 13 -28 24 -53 12 -24 21 -45 22 -46 2 -4 10 -7 15 -7 4 0 11 3 13 6 3 2 50 105 50 108 0 1 -3 1 -11 1 l-11 0 -7 -14 c-3 -8 -12 -28 -20 -45 -7 -17 -13 -31 -14 -31 -1 -1 -3 5 -17 35 -19 43 -23 53 -24 54 -1 1 -5 1 -13 1 -6 0 -11 0 -11 0z"/>
      <path d="M623 514 c0 -1 0 -26 0 -57 l1 -55 10 0 10 0 0 56 0 57 -10 0 c-7 0 -10 0 -11 -1z"/>
    </g>
    <g fill="#9D63FE" fill-rule="evenodd">
      <path d="M1150 515 c-3 0 -6 -1 -6 -1 0 -1 2 -2 5 -2 10 -4 26 -17 31 -27 11 -21 8 -44 -7 -62 -5 -7 -17 -16 -24 -18 -3 -1 -5 -2 -4 -2 0 -2 16 -3 24 -3 35 3 59 40 49 74 -2 8 -7 18 -13 24 -5 6 -15 13 -23 16 -8 3 -24 4 -32 1z"/>
    </g>
  </g>

  <rect x="469" y="600" width="751" height="9" rx="4.5" fill="rgba(255,255,255,0.12)"/>
  <clipPath id="vm-loader-clip">
    <rect id="${RECT_ID}" x="469" y="600" width="0" height="9" rx="4.5" class="ge-vm-clip-rect"/>
  </clipPath>
  <rect x="469" y="600" width="751" height="9" rx="4.5" fill="#9D63FE" clip-path="url(#vm-loader-clip)"/>

  <text id="${TEXT_ID}" x="844.5" y="650" text-anchor="middle" class="ge-vm-text">Loading...</text>
</svg>`;

export const voidmoonVariant: PreloaderVariant = {
  buildContentHTML() {
    return `
    <div class="ge-vm-content">
      ${LOGO_SVG}
    </div>
  `;
  },

  css: `
    .ge-vm-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 82%;
      max-width: 680px;
    }

    .ge-vm-logo-svg {
      width: 100%;
      height: auto;
      filter: drop-shadow(0 0 26px rgba(157, 99, 254, 0.3));
    }

    /* Shimmer the loader bar while waiting */
    .ge-vm-clip-rect {
      animation: ge-vm-fill 2s ease-in-out infinite;
    }

    @keyframes ge-vm-fill {
      0%   { width: 0; }
      50%  { width: 751; }
      100% { width: 0; }
    }

    /* Stop shimmer once JS-driven progress takes over. */
    .ge-vm-clip-rect.driven {
      animation: none;
    }

    .ge-vm-text {
      fill: rgba(255, 255, 255, 0.6);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 20px;
      font-weight: 600;
      letter-spacing: 3px;
      animation: ge-vm-pulse 1.5s ease-in-out infinite;
    }

    @keyframes ge-vm-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    /* Tap-to-start CTA pulse. Compound selector outweighs the ambient
       .ge-vm-text rule, swapping the animation cleanly. */
    .ge-vm-text.ge-vm-tap-pulse {
      animation: ge-vm-tap 1.2s ease-in-out infinite;
    }

    @keyframes ge-vm-tap {
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
        textEl.classList.add('ge-vm-tap-pulse');
      },
    };
  },
};
