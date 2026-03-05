/**
 * Shared Energy8 SVG logo with an embedded loader bar.
 *
 * The loader bar fill is controlled via a `<clipPath>` whose `<rect>` width
 * is animatable. Different consumers customise gradient IDs and the clip
 * element's ID/class to avoid collisions when both CSSPreloader and
 * LoadingScene appear in the same DOM.
 */

/** SVG path data for the Energy8 wordmark — reused across loaders */
const WORDMARK_PATHS = `
  <path d="m241 81.75h-19.28c-1.77 0-6.73 4.98-7.43 6.99l-4.36 12.22c-0.49 1.37 0.05 2.92 1.06 4.32-2.07 1.19-3.69 3.08-4.36 5.43l-3.25 10.41c-0.86 2.89 2.39 6.63 4.31 6.63h19.28c1.96 0 7.4-5.56 7.96-7.51l2.96-10.22c0.63-2.25 0.1-3.98-1.22-4.99 2.55-1.56 3.86-4.14 4.55-6.31l2.77-9.31c0.74-2.57-1.37-7.66-2.99-7.66zm-13.36 28.31-2.27 7.03h-8.28l2.58-8.28h8.28l-0.31 1.25zm4.06-16.97-2.11 6.7h-7.04l2.25-7.34h7.26l-0.36 0.64z" fill="url(#GID0)"/>
  <path d="m202.5 81.75-9.31 14.97-2.32-14.97h-11.82l4.32 25.15-0.57 4.91-8.64 26.44 15.31-12.76 5.63-16.48 19.96-27.26h-12.56z" fill="url(#GID1)"/>
  <path d="m174.2 81.75h-19.78l-5.75 5.16-10.79 33.2c-0.77 2.53 2.48 6.93 4.87 6.93h17.38c2.63 0 7.85-5.34 8.32-6.83l5.37-18.14h-15.17l-2.2 7.64h3.78l-2.25 7.2h-8.01l7.1-25.52h7.58l-1.48 8.4 12.78-5.98c1.28-0.63 1.97-3.99 1.61-6.61-0.36-2.34-1.64-5.45-3.36-5.45z" fill="url(#GID2)"/>
  <path d="m140.6 81.75h-70.6l-5.36 19.37-4.26-19.37h-46.76l2.95 5.88-10.58 39.28h26.84l2.95-9.52-15.63-0.13 2.55-8.34h8.74l8.47-9.81h-14.61l2.11-7.3h15.47l2.54-8.71 2.58 4.74-11.4 39.07h11.05l6.46-21.49 8.84 36.33 19.18-55.67-1.83-3.36 3.68 4.09-12.07 40.1h28.18l3.39-10.31h-17.01l2.67-8.03h9.98l7.58-9.52h-14.28l1.93-6.6h14.61l3.25-9.73 2.81 5.12-11.3 38.89h11.05l5.23-17.81h1.62l1.48 17.6h10.69l-1.48-16.81c4.75-1.28 7.52-5.9 8.64-9.81l2.95-11.3c0.86-2.73-1.43-6.85-3.3-6.85zm-9.8 17.3h-8.69l2.54-7.84h8.35l-2.2 7.84z" fill="url(#GID3)"/>
  <path d="m205.9 148.9h-122.6l-2.61-3.12h-32.4l-2.51 3.12h-1.59c-5.34 0-7.94 4.88-7.94 7.65v0.03c0 4.2 3.55 7.6 7.74 7.6h103.6l2.11 3.12h36.09l1.82-3.12h18.3c5.25 0 6.64-5.3 6.64-7.35v-0.25c0-4.23-2.9-7.68-6.64-7.68zm-0.7 12.83h-160.6c-3.69 0-6.11-2.58-6.11-5.47v-0.03c0-2.89 2.1-5.47 5.61-5.47h161.1c3.45 0 4.89 3.12 4.89 5.65v0.17c0 2.57-2.11 5.15-4.89 5.15z" fill="url(#GID4)"/>`;

/** Gradient definitions template (gradient IDs are replaced per-consumer) */
const GRADIENT_DEFS = `
    <linearGradient id="GID0" x1="223.7" x2="223.7" y1="81.75" y2="127.8" gradientUnits="userSpaceOnUse">
      <stop stop-color="#663BA6"/><stop stop-color="#7939C2" offset=".349"/><stop stop-color="#8A2FC0" offset=".6615"/><stop stop-color="#791BA3" offset="1"/>
    </linearGradient>
    <linearGradient id="GID1" x1="194.6" x2="194.6" y1="81.75" y2="138.3" gradientUnits="userSpaceOnUse">
      <stop stop-color="#663BA6"/><stop stop-color="#7939C2" offset=".349"/><stop stop-color="#8A2FC0" offset=".6615"/><stop stop-color="#791BA3" offset="1"/>
    </linearGradient>
    <linearGradient id="GID2" x1="157.8" x2="157.8" y1="81.75" y2="127" gradientUnits="userSpaceOnUse">
      <stop stop-color="#663BA6"/><stop stop-color="#7939C2" offset=".349"/><stop stop-color="#8A2FC0" offset=".6615"/><stop stop-color="#791BA3" offset="1"/>
    </linearGradient>
    <linearGradient id="GID3" x1="79.96" x2="79.96" y1="81.75" y2="141.8" gradientUnits="userSpaceOnUse">
      <stop stop-color="#663BA6"/><stop stop-color="#7939C2" offset=".349"/><stop stop-color="#8A2FC0" offset=".6615"/><stop stop-color="#791BA3" offset="1"/>
    </linearGradient>
    <linearGradient id="GID4" x1="36.18" x2="212.5" y1="156.6" y2="156.6" gradientUnits="userSpaceOnUse">
      <stop stop-color="#316FB0"/><stop stop-color="#1FCDE6" offset=".5"/><stop stop-color="#29FEE7" offset="1"/>
    </linearGradient>
    <linearGradient id="GID5" x1="40.27" x2="208.2" y1="156.4" y2="156.4" gradientUnits="userSpaceOnUse">
      <stop stop-color="#316FB0"/><stop stop-color="#1FCDE6" offset=".5"/><stop stop-color="#29FEE7" offset="1"/>
    </linearGradient>`;

/** Max width of the loader bar in SVG units */
export const LOADER_BAR_MAX_WIDTH = 174;

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

  // Replace gradient ID placeholders with prefixed versions
  const paths = WORDMARK_PATHS.replace(/GID(\d)/g, `${idPrefix}$1`);
  const defs = GRADIENT_DEFS.replace(/GID(\d)/g, `${idPrefix}$1`);

  const clipId = `${idPrefix}-loader-clip`;
  const fillGradientId = `${idPrefix}5`;

  const classAttr = svgClass ? ` class="${svgClass}"` : '';
  const styleAttr = svgStyle ? ` style="${svgStyle}"` : '';
  const rectClassAttr = clipRectClass ? ` class="${clipRectClass}"` : '';
  const rectIdAttr = clipRectId ? ` id="${clipRectId}"` : '';
  const txtIdAttr = textId ? ` id="${textId}"` : '';
  const txtClassAttr = textClass ? ` class="${textClass}"` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 200" fill="none"${classAttr}${styleAttr}>
${paths}
  <clipPath id="${clipId}">
    <rect${rectIdAttr} x="37" y="148" width="0" height="20"${rectClassAttr}/>
  </clipPath>
  <path d="m204.5 152.6h-159.8c-2.78 0-4.45 1.69-4.45 3.99v0.11c0 2.04 1.42 3.43 3.64 3.43h160.6c2.88 0 3.67-2.07 3.67-3.43v-0.25c0-2.04-1.48-3.85-3.67-3.85z" fill="url(#${fillGradientId})" clip-path="url(#${clipId})"/>
  <text${txtIdAttr} x="125" y="196" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="8" font-weight="600" letter-spacing="1.5"${txtClassAttr}>${textContent ?? 'Loading...'}</text>
  <defs>
${defs}
  </defs>
</svg>`;
}
