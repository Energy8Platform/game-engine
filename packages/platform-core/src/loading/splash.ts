/**
 * The "POWERED BY ENERGY8 ENGINE" pre-roll shown at the very start of every
 * boot, above whatever preloader variant the game selected.
 *
 * This is deliberately NOT configurable: it is the platform's attribution and
 * plays for every game, on every boot. `CSSPreloader` mounts it as a layer
 * inside the same overlay it already owns, so there is still exactly one
 * element to tear down and no gap where the page shows through.
 */

/** Total splash length: logo fades in, holds, fades out, then the black backdrop lifts. */
export const SPLASH_DURATION_MS = 2000;

/**
 * How long the game's own brand must remain readable once the splash has
 * lifted. Without this a fast boot would swap straight from the splash into
 * the game and the game's logo would never be seen.
 */
export const BRAND_FLOOR_MS = 1000;

/** Class on the splash layer — also the hook tests assert against. */
export const SPLASH_CLASS = 'ge-splash';

/**
 * The official artwork as vector outlines. Three groups, in the source's own
 * order: the ENERGY8 wordmark, the "POWERED BY" line above it, and "ENGINE"
 * below. Two deviations from the export:
 *
 * - Every shape is forced to #fff. The source paints `.st0 { fill: #02020a }`
 *   and leaves the two text groups with no fill at all (so they default to
 *   black) — on a black splash the whole logo would be invisible. Colours are
 *   set as attributes rather than a `<style>` block on purpose: inlining the
 *   export's `<style>` would leak a rule for the very generic `.st0` selector
 *   into the host page.
 * - Ten zero-area `<path d="M…h0Z"/>` stubs are dropped (Illustrator artifacts).
 */
const SPLASH_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 792.22 250.81" class="ge-splash-logo" role="img">
  <title>Powered by Energy8 Engine</title>
  <g fill="#fff" stroke="#fff" stroke-miterlimit="10">
    <polygon points="126.9 47.45 33.24 47.45 .62 199.67 94.28 199.72 101.83 164.51 43.28 164.54 48.29 141.12 83.41 141.15 90.96 105.92 55.8 106.02 60.85 82.55 119.38 82.61 126.9 47.45"/>
    <polygon points="337.67 47.45 243.99 47.45 211.39 199.65 305.06 199.63 312.59 164.42 254.06 164.43 259.05 141.1 294.18 141.08 301.73 105.87 266.58 105.98 271.61 82.48 330.14 82.59 337.67 47.45"/>
    <path d="M431.33,47.45h-81.96c-10.92,50.92-21.7,101.3-32.62,152.21h35.13l12.53-58.53h11.71l-.83,58.54,35.14-.04.83-58.52,14.21-11.71,15.06-70.26-9.21-11.69h0ZM395.37,106l-23.41-.03c1.67-7.78,5.86-27.35,7.53-35.13l23.43-.06-7.55,35.22h0Z"/>
    <polygon points="433.85 199.67 432.18 152.81 452.26 59.09 466.46 47.45 548.43 47.45 557.67 58.98 550.11 94.29 514.96 94.32 517.48 82.54 482.35 82.57 464.79 164.51 499.92 164.52 504.93 141.12 493.23 141.1 498.23 117.71 545.09 117.67 530.05 187.92 515.8 199.73 433.85 199.67"/>
    <path d="M791.83,59.16l-9.23-11.71h-70.25l-14.21,11.7-12.52,58.52,15.05,6.34-17.56,5.4-12.54,58.53,9.2,11.71h70.25l14.22-11.73,12.53-58.51-17.56-5.45,20.07-6.25,12.54-58.56h0ZM731.61,176.28l-23.41-.04c1.67-7.78,5.86-27.34,7.53-35.11h23.42l-7.54,35.15ZM746.67,105.99l-23.41-.02c1.67-7.77,5.86-27.33,7.52-35.1l23.42-.02-7.53,35.14Z"/>
    <polygon points="194.71 222.91 167.33 223.06 156.18 129.4 141.1 199.94 105.93 199.9 138.61 47.45 173.74 47.45 182.11 117.71 197.16 47.45 232.29 47.45 194.71 222.91"/>
    <polygon points="591.92 117.71 571.85 47.45 606.98 47.45 620.38 94.19 653.81 47.45 688.94 47.45 622.04 141.1 609.51 199.64 569.37 223.06 591.92 117.71"/>
  </g>
  <g fill="#fff">
    <path d="M154.59,6.63c3.65-.3,8.87-.56,16.66-.56,7.19,0,12.27.79,15.59,2.14,3.22,1.27,5.54,3.46,5.54,6.13,0,2.46-1.54,4.7-4.59,6.13-4.04,1.95-9.94,2.85-17.29,2.85-1.75,0-3.29-.07-4.41-.17v9.2h-11.5V6.63ZM166.09,18.44c1.06.13,2.42.19,4.39.19,6.26,0,10.4-1.5,10.4-4.21,0-2.44-3.54-3.74-9.53-3.74-2.62,0-4.38.1-5.26.2v7.57Z"/>
    <path d="M251.53,19.13c0,8.12-10.78,13.68-26.82,13.68s-25.68-5.71-25.68-13.23c0-8.01,10.82-13.75,26.48-13.75s26.02,5.67,26.02,13.29ZM211.37,19.41c0,4.83,5.36,8.62,13.95,8.62s13.88-3.72,13.88-8.72c0-4.73-5.14-8.7-13.89-8.7s-13.94,3.91-13.94,8.8Z"/>
    <path d="M268.79,32.35l-12.71-26.05h12.55l4.18,10.84c1.17,3.14,2.39,6.65,3.24,9.1h.15c.82-2.7,2.04-5.91,3.35-9.19l4.44-10.75h13.15l4.15,11.23c1.1,3.08,1.93,5.82,2.67,8.53h.15c.82-2.74,2-5.84,3.23-9l4.5-10.76h11.94l-14.01,26.05h-12.69l-4.61-12.11c-1.04-2.66-1.82-4.96-2.43-7.83h-.15c-.82,2.86-1.6,5.19-2.83,7.85l-5.16,12.1h-13.1Z"/>
    <path d="M363.08,21.48h-20.37v5.91h22.73v4.97h-34.35V6.3h33.22v4.97h-21.61v5.24h20.37v4.97Z"/>
    <path d="M374.75,6.65c3.75-.32,9.54-.58,16.2-.58,7.97,0,13.21.65,16.83,2.11,2.92,1.17,4.76,3.03,4.76,5.48,0,3.47-5.07,5.71-9.04,6.37v.14c3.43.73,5.42,2.49,6.76,4.75,1.71,2.97,3.25,6.42,4.24,7.45h-11.84c-.8-.76-2.07-2.68-3.68-6.02-1.55-3.26-3.77-4.12-8.81-4.16h-3.93v10.18h-11.5V6.65ZM386.25,17.8h5.22c5.96,0,9.57-1.39,9.57-3.65,0-2.44-3.55-3.54-8.9-3.54-3.26,0-5.03.11-5.89.21v6.98Z"/>
    <path d="M454.32,21.48h-20.37v5.91h22.73v4.97h-34.35V6.3h33.22v4.97h-21.61v5.24h20.37v4.97Z"/>
    <path d="M465.99,6.65c4.66-.37,10.58-.58,16.73-.58,10.36,0,17.04.96,22.27,2.96,5.4,2.02,8.95,5.11,8.95,9.57,0,4.9-3.69,8.25-8.56,10.39-5.77,2.48-14.71,3.66-25.2,3.66-6.69,0-11.17-.19-14.19-.42V6.65ZM477.6,27.78c1.12.1,2.96.11,4.59.11,11.88.06,19.36-3.07,19.36-8.98.03-5.43-7.06-8.14-17.86-8.14-3.01,0-4.97.14-6.09.26v16.76Z"/>
    <path d="M540.25,6.65c2.93-.29,9.45-.58,15.49-.58,7.51,0,11.56.37,15.23,1.34,3.71.9,6.57,2.69,6.57,5.27,0,2.28-2.62,4.42-8.38,5.49v.09c5.58.75,10.14,2.95,10.14,6.44,0,2.46-2.32,4.38-5.61,5.67-3.83,1.48-10.07,2.28-20.37,2.28-6.09,0-10.46-.22-13.05-.42V6.65ZM551.75,16.51h4.12c6.69,0,9.91-1.21,9.91-3.09,0-2-3.21-2.9-8.6-2.9-2.89,0-4.42.09-5.43.19v5.8ZM551.75,28.02c1.22.1,2.74.11,4.97.11,5.43,0,10.28-.95,10.28-3.73,0-2.6-4.75-3.54-10.88-3.54h-4.37v7.17Z"/>
    <path d="M598.63,32.35v-10.92l-17.08-15.13h13.56l5.55,6.29c1.7,1.93,2.83,3.15,4.19,4.81h.15c1.26-1.54,2.57-2.94,4.17-4.78l5.64-6.32h13.39l-17.95,14.94v11.12h-11.62Z"/>
  </g>
  <g fill="#fff">
    <path d="M257.81,230.46l-25.46.08.02,5.72,28.41-.09v4.82s-42.91.13-42.91.13l-.08-25.25,41.52-.13.02,4.81-27,.08.02,5.08,25.46-.08v4.82Z"/>
    <path d="M272.41,240.96l-.08-25.25,17.91-.05,13.87,9c4.29,2.87,8.09,5.99,11.21,9.06l.25-.02c-1.01-3.57-1.11-6.62-1.12-10.17l-.02-7.96,13.49-.04.08,25.25-15.73.05-14.47-9.72c-4.19-2.91-8.65-6.15-12.16-9.33l-.34.02c.47,3.61.57,7.08.58,10.88l.02,8.23-13.49.04Z"/>
    <path d="M399.35,239.23c-4.86.69-13.79,1.64-23.09,1.67-12.61.04-21.62-1.2-27.82-3.6-5.76-2.2-8.94-5.33-8.95-8.83-.02-8.13,15.56-13.28,38.01-13.35,9.02-.03,16,.65,19.42,1.3l-3.17,4.7c-3.95-.67-8.69-1.21-16.7-1.19-12.73.04-22.3,2.87-22.29,8,.01,4.93,8.78,8.24,22.08,8.2,3.82-.01,6.95-.21,8.26-.45l-.02-5.05-10.82.03v-4.6s25.04-.08,25.04-.08l.04,13.24Z"/>
    <path d="M427.02,215.23l.08,25.25-14.52.04-.08-25.25,14.52-.04Z"/>
    <path d="M441.45,240.44l-.08-25.25,17.91-.06,13.87,9c4.29,2.87,8.09,5.99,11.21,9.06l.25-.02c-1.01-3.57-1.11-6.62-1.12-10.17l-.02-7.96,13.49-.04.08,25.25-15.73.05-14.47-9.72c-4.2-2.91-8.65-6.15-12.16-9.33l-.35.02c.47,3.61.57,7.08.58,10.88l.03,8.23-13.49.04Z"/>
    <path d="M551.33,229.56l-25.46.08.02,5.72,28.41-.09v4.82s-42.91.13-42.91.13l-.08-25.25,41.52-.13v4.81s-26.99.08-26.99.08l.02,5.08,25.46-.08v4.82Z"/>
  </g>
</svg>`;

/** Markup for the splash layer — a black backdrop over the overlay's content. */
export function buildSplashHTML(): string {
  return `<div class="${SPLASH_CLASS}">${SPLASH_LOGO_SVG}</div>`;
}

/**
 * The whole timeline is CSS. JS only removes the layer once it has played, so
 * a stalled main thread can't strand the splash half-faded on screen.
 *
 * Percentages map onto SPLASH_DURATION_MS: logo in by 500ms, held to 1400ms,
 * gone by 1700ms; the backdrop then lifts over the last 300ms, revealing the
 * game's own background and brand from black.
 */
export const SPLASH_CSS = `
    .${SPLASH_CLASS} {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
      /* Never swallow the tap — the overlay's own pointerdown gate sits below. */
      pointer-events: none;
      animation: ge-splash-backdrop ${SPLASH_DURATION_MS}ms linear forwards;
    }

    @keyframes ge-splash-backdrop {
      0%, 85% { opacity: 1; }
      100%    { opacity: 0; }
    }

    .ge-splash-logo {
      width: 62%;
      max-width: 520px;
      height: auto;
      animation: ge-splash-logo ${SPLASH_DURATION_MS}ms ease-in-out forwards;
    }

    @keyframes ge-splash-logo {
      0%   { opacity: 0; }
      25%  { opacity: 1; }
      70%  { opacity: 1; }
      85%  { opacity: 0; }
      100% { opacity: 0; }
    }
`;
