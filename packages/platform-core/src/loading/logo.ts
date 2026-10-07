/**
 * Shared Energy8 SVG logo with a loader bar underneath.
 *
 * The wordmark is the 2026-10 "energy8" artwork (Illustrator export, e82.svg),
 * paths copied verbatim, painted white for the black preloader screen. Fill is
 * an attribute on the root rather than the export's `<style>` block: inlining
 * that would leak rules for its generic `.cls-*` selectors into the host page.
 *
 * The letters are grouped for the energy8 preloader's intro (see
 * variants/energy8.ts): `.ge-e8-e` (the leading "e"), `.ge-e8-mid` ("nergy",
 * x 59.6..301) and `.ge-e8-8` (the "8", drawn last so it sits on top of the
 * letters it uncovers), all inside `.ge-e8-word`. Without the variant's CSS the
 * markup is just the static logo.
 *
 * The loader bar is NOT part of the artwork — a thin bar under the gap between
 * the "e" and the "8", the fill controlled via a `<clipPath>` whose `<rect>`
 * width is animatable. Consumers customise the clip element's ID/class to avoid
 * collisions when the logo appears more than once in the same DOM.
 */

/** Width of the artwork in SVG units. */
const LOGO_WIDTH = 376.09;
/**
 * Loader bar geometry, in SVG units. It spans the gap between the "e" (right
 * edge 60.5) and the "8" (left edge 304.5), below the "g"/"y" descenders
 * (bottom 110). Thickness matches the hellbuddha bar relative to its wordmark.
 */
const BAR_X = 60.5;
const BAR_Y = 126;
const BAR_H = 3.5;

/** The "e" — the brand's leading letter, half of the "E8" the intro opens on. */
const E_PATH = 'M0,96.51l4.13-16.96-.42-53.19c0-3.93,1.27-7.76,3.63-10.9h0c2.54-3.39,6.19-5.78,10.3-6.77L60.52,0l-8.48,19.72-25.9,5.96v11.46l26.81-3.79-5.49,17.02-21.32,4.65.23,11.69,31.87-3.9-5.52,18.61L0,96.51Z';

/** The letters between them, in reading order: n e r g y. */
const MID_PATHS = [
  'M59.56,84.46l1.06-49.15c0-3.82,2.67-5.88,6.09-7.57l12.38-1.38v7.57s19.26-18.11,28.43,1.38c3.69,7.84,3.44,42.41,3.44,42.41l-19.03,6.42.08-33.77c-.04-3.18-2.63-5.74-5.81-5.74h0c-3.18,0-5.76,2.55-5.81,5.72l-.84,27.36-19.99,6.74Z',
  'M127.7,28.42c-9.93,2.81-24.45,30.42-8.03,48.15,6.39,6.89,19.72,10.31,37.6,0v-14.45c-25.91,10.09-25.91-.91-25.91-.91,0,0,25.55-1.18,28.97-14.4,3.92-15.12-5.5-26.05-32.63-18.39ZM144.17,43.2c-.52,5.73-13.76,8.76-13.76,8.76,0,0,1.18-10.26,8.09-12.2,4.47-1.26,5.82,1.78,5.67,3.44Z',
  'M163.19,84.21s-.87-45.59.49-50.13c2.75-9.2,18.34-7.86,18.34-7.86l.05,5.97c4.99-7.99,18.83-5.92,18.83-5.92l-6.23,17.16s-9.25-1.53-12.08,5.44l-.31,29.41-19.09,5.93Z',
  'M247.16,29.1c-36.28-12.21-47.63,10.14-47.63,10.14,0,0-10.26,18.47-1.32,30.15,11.81,15.41,30.09-.06,30.09-.06,0,0,4.76,22.87-28.94,12.21l-7.39,16.68s43.15,21.14,55.19-18.92c0,0,1-49.86,0-50.2ZM227.73,54.5s-14.5,12.64-13.76-2.54c.52-10.48,13.76-12.2,13.76-12.2v14.74Z',
  'M250.08,26.27h18.91l2.01,26.82c.27,2.87,2.67,5.06,5.55,5.06h0c3.08,0,5.58-2.5,5.58-5.58l-.08-26.3h18.91l-1.08,45.98c-.99,31.55-55.83,37.66-55.83,37.66l10.66-21.84c28.54-2.75,26.48-18.23,26.48-18.23,0,0-13.75,13.24-23.56.52-3.38-4.39-7.57-44.09-7.57-44.09Z',
];

/** The "8". */
const EIGHT_PATH = 'M341.83,53.63l15.82-9.63s22.21,8.49,17.88,26.48c-4.47,18.57-31.41,20.63-31.41,20.63,0,0-33.48,4.47-39.2-21.09-3.21-14.33,12.26-21.55,12.26-21.55,0,0,30.19-17.24,31.01-18.47,8.3-12.36-16.11-14.2-17.26-4.55-.7,5.86,5.62,8.46,5.62,8.46l-16.62,8.83s-19.69-16.35.57-32.09c16.96-13.18,36.68-2.62,37.37-2.29,2.51,1.19,20.4,17.1,3.44,29.8l-34.39,21.55s-7.09,6.56-.34,12.04c12.15,9.86,25.33,0,25.33,0,10.66-10.66-10.09-18.11-10.09-18.11Z';

const WORDMARK = `<g class="ge-e8-word">
    <path class="ge-e8-e" d="${E_PATH}"/>
    <g class="ge-e8-mid">${MID_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>
    <path class="ge-e8-8" d="${EIGHT_PATH}"/>
  </g>`;

/** Max width of the loader bar in SVG units — from the "e" to the "8". */
export const LOADER_BAR_MAX_WIDTH = 244;

interface LogoSVGOptions {
  /** Prefix for gradient/clip IDs to avoid collisions (e.g. 'pl' or 'ls') */
  idPrefix: string;
  /** Optional CSS class on the root <svg> */
  svgClass?: string;
  /** Optional inline style on the root <svg> */
  svgStyle?: string;
  /** Optional CSS class on the clip <rect> */
  clipRectClass?: string;
  /** Optional id on the clip <rect> (for JS access) */
  clipRectId?: string;
  /** Optional id on the percentage <text> */
  textId?: string;
  /** Default text content */
  textContent?: string;
  /** Optional CSS class on the <text> */
  textClass?: string;
}

/**
 * Build the Energy8 SVG logo with a loader bar, using unique IDs.
 *
 * @param opts - Configuration to avoid element ID collisions
 * @returns SVG markup string
 */
export function buildLogoSVG(opts: LogoSVGOptions): string {
  const { idPrefix, svgClass, svgStyle, clipRectClass, clipRectId, textId, textContent, textClass } = opts;

  const clipId = `${idPrefix}-loader-clip`;

  const classAttr = svgClass ? ` class="${svgClass}"` : '';
  const styleAttr = svgStyle ? ` style="${svgStyle}"` : '';
  const rectClassAttr = clipRectClass ? ` class="${clipRectClass}"` : '';
  const rectIdAttr = clipRectId ? ` id="${clipRectId}"` : '';
  const txtIdAttr = textId ? ` id="${textId}"` : '';
  const txtClassAttr = textClass ? ` class="${textClass}"` : '';

  const bar = `x="${BAR_X}" y="${BAR_Y}" width="${LOADER_BAR_MAX_WIDTH}" height="${BAR_H}"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_WIDTH} 166" fill="#fff"${classAttr}${styleAttr} role="img" aria-label="energy8">
  ${WORDMARK}
  <g class="ge-e8-loader">
    <clipPath id="${clipId}">
      <rect${rectIdAttr} x="${BAR_X}" y="${BAR_Y}" width="0" height="${BAR_H}"${rectClassAttr}/>
    </clipPath>
    <rect ${bar} opacity=".15"/>
    <rect ${bar} clip-path="url(#${clipId})"/>
    <text${txtIdAttr} x="${BAR_X + LOADER_BAR_MAX_WIDTH / 2}" y="156" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="10" font-weight="600" letter-spacing="2"${txtClassAttr}>${textContent ?? 'Loading...'}</text>
  </g>
</svg>`;
}
