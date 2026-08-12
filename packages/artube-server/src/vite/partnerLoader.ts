/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VENDORED THIRD-PARTY CODE — NOT WRITTEN BY ENERGY8. DO NOT EDIT AS IF IT WERE.
 *
 *   Upstream package : @artube/loader
 *   Upstream version : 2.1.0
 *   Obtained from    : https://gitlab.com/api/v4/projects/81086971/packages/npm/
 *                      (Artube's private, token-gated GitLab npm registry;
 *                      `publishConfig.access: restricted`)
 *   Vendored on      : 2026-08-12
 *   License          : NONE STATED. The upstream `package.json` declares no
 *                      `license`, no `author` and no `repository` field, and the
 *                      tarball ships no LICENSE file. This code is redistributed
 *                      inside `@energy8platform/artube-server` on Artube's
 *                      instruction so that studios building Artube games need no
 *                      account on that registry. It is Artube's code, not ours.
 *   Upstream shape   : 11 KB of built (minified) ESM in `dist/index.js`. There is
 *                      no published source. The code below is that bundle
 *                      transcribed back into readable TypeScript; the CSS, the
 *                      markup and the logo SVG are copied BYTE-FOR-BYTE, and the
 *                      control flow is preserved statement for statement.
 *
 *   RE-VENDOR when Artube ships a new `@artube/loader`. Nothing here updates
 *   itself, and a game consuming us will silently keep the 2.1.0 look. The
 *   procedure is in `docs/vendored-artube-loader.md`.
 *
 *   The browser half of the same upstream package (`LoaderViewController`) is
 *   vendored separately in `@energy8platform/artube-bridge/loader` — it must not
 *   live here, because this package pulls in grpc and ws. The two halves share
 *   only the element ids below; both files name them and point at each other.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Plugin } from 'vite';

/**
 * The element ids the injected markup defines and
 * `@energy8platform/artube-bridge/loader`'s `LoaderViewController` looks up.
 * Duplicated there on purpose: a Node-side package must never become a
 * dependency of the game's browser bundle just to share five strings.
 */
export const ARTUBE_LOADER_ELEMENT_IDS = [
  'loader',
  'loader-partner',
  'loader-artube',
  'progress-container',
  'progress-bar',
] as const;

export interface PartnerLoaderOptions {
  /** 'fullscreen' (default): covers entire viewport, fades to black.
   *  'contained': mounts inside a container element, fades to transparent. */
  mode?: 'fullscreen' | 'contained';
  /** CSS selector of the container to mount in (contained mode only).
   *  The container must have position: relative/absolute/fixed.
   *  Loader fills it with position: absolute + inset: 0. */
  container?: string;
  /** Include the partner (phase 1) screen. `true` (default) emits both phases;
   *  `false` emits only the Artube-branded phase. */
  useArtubePreloader?: boolean;
}

/** Artube's wordmark, as shipped upstream. */
const ARTUBE_LOGO_SVG = `<svg width="600" height="110" viewBox="0 0 600 110" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M37.1445 7.17969C16.6303 7.17969 0 23.7809 0 44.2594V70.6815C0 91.8488 12.1167 109.992 45.4378 109.992C63.2529 109.992 73.7339 100.578 79.3446 92.8232C80.1119 91.7648 81.7881 92.2957 81.7881 93.6027V107.718H106.022V7.17969H37.1445ZM81.7881 84.2891C81.7881 88.4654 68.904 91.8488 53.0108 91.8488C37.1176 91.8488 24.2335 88.4654 24.2335 84.2891V39.3372C28.0974 41.8671 35.3473 43.8092 44.1859 44.5954C46.6058 44.8104 48.467 46.823 48.467 49.2488V64.6337C48.467 67.2108 50.6178 69.2838 53.2263 69.1629C55.6732 69.052 57.5546 66.9487 57.5546 64.5061V47.6932C57.5546 46.1308 58.763 44.8306 60.3246 44.7163L60.3852 44.713C62.1288 44.5853 63.613 45.9595 63.613 47.7033V54.0501C63.613 56.6271 65.7637 58.7002 68.3722 58.5792C70.8191 58.4683 72.7005 56.3651 72.7005 53.9224V46.403C72.7005 44.3669 74.0266 42.5761 75.9654 41.9511C78.3349 41.1884 80.3105 40.3082 81.7881 39.3405L81.7881 84.2891ZM53.0108 37.4187C37.1177 37.4187 24.2335 34.7106 24.2335 31.3709C24.2335 28.0311 37.1177 25.3231 53.0108 25.3231C68.9038 25.3231 81.7881 28.0311 81.7881 31.3709C81.7881 34.7106 68.904 37.4187 53.0108 37.4187Z" fill="#DCFA43"/>
<path d="M368.222 74.9885H368.282C368.282 79.2078 368.671 82.8891 369.421 86.061C370.29 89.1132 371.759 91.5673 373.888 93.3926C376.107 95.1278 379.254 95.9654 383.39 95.9654C387.047 95.9654 390.524 94.9183 393.882 92.7937C397.328 90.5794 400.116 87.3771 402.215 83.1579C404.433 78.849 405.511 73.5223 405.511 67.2085V27.2906H421.759V107.725H405.511V94.35C404.642 96.4143 403.505 98.4192 402.065 100.394C399.967 103.177 397.029 105.481 393.281 107.277C389.535 109.102 384.799 110 379.043 110C373.857 110 369.211 108.953 365.075 106.828C361.058 104.734 357.82 101.232 355.422 96.3548C353.114 91.4772 351.974 84.9538 351.974 76.8147V27.2906H368.222V74.9885ZM452.185 38.9311C454.553 34.8913 457.61 31.6592 461.389 29.2953C465.795 26.4228 471.219 24.9864 477.634 24.9864C485.128 24.9864 491.543 26.8119 496.909 30.4326C502.364 34.0834 506.562 39.1109 509.439 45.5147C512.408 51.9181 513.905 59.3091 513.906 67.6274C513.906 75.9459 512.408 83.1876 509.439 89.5911C506.562 95.9949 502.394 101.022 496.909 104.673C491.543 108.204 485.098 110 477.634 110C470.74 110 465.075 108.564 460.668 105.691C457.192 103.297 454.343 100.215 452.185 96.4447V107.725H435.938V0H452.185V38.9311ZM562.858 25.0159C568.343 25.0159 573.47 26.0939 578.266 28.3084C583.062 30.403 587.198 33.5154 590.644 37.6446C594.182 41.774 596.79 46.8006 598.409 52.7253V52.7857C600.027 58.7405 600.417 65.4735 599.548 73.0441H538.975C539.646 79.5268 541.952 84.8529 545.861 89.0527C549.788 93.2719 555.453 95.3664 562.826 95.3664C568.193 95.3664 572.449 94.1105 575.627 91.6268C578.894 89.0534 581.142 85.8806 582.401 82.1402H599.518C598.379 87.7057 596.1 92.5841 592.744 96.8032C589.385 100.933 585.158 104.165 580.092 106.559C575.117 108.862 569.361 110 562.826 110C555.153 110 548.348 108.474 542.383 105.392C536.539 102.22 531.832 97.8802 528.295 92.3143C524.847 86.7487 522.719 80.2856 521.97 72.9246H538.935L538.965 72.9542C538.965 72.9583 538.967 72.9623 538.967 72.9663V59.3989H583.511C583.271 56.8254 582.672 54.4015 581.683 52.0674C580.244 48.3269 577.965 45.3644 574.788 43.15C571.64 40.846 567.653 39.7085 562.858 39.7085C556.023 39.7085 550.417 41.8032 546.011 46.0222C542.474 49.4036 539.836 53.8634 538.967 59.3693H522.359C523.32 53.1153 525.267 47.5786 528.325 42.8506C532.073 37.1055 536.928 32.6765 542.864 29.6242C548.799 26.5422 555.483 25.0159 562.858 25.0159ZM289.235 41.2043L289.265 41.2353C283.599 41.2353 278.773 42.0134 274.727 43.5394C270.8 44.9757 267.772 47.4592 265.674 51.0201C263.576 54.5509 262.496 59.5481 262.496 65.9516V107.755H246.249V27.2906H262.496V40.6363C263.185 38.9306 264.025 37.2548 265.074 35.6091C266.993 32.557 269.87 30.0138 273.707 28.0089C277.634 26.004 282.82 24.9864 289.235 24.9864L289.235 41.2043ZM236.806 107.725H219.54L212.376 84.7437H173.347L166.303 107.725H149.037L181.29 7.18116H204.012L236.806 107.725ZM342.082 93.9311V107.725H323.528V93.9311H342.082ZM475.357 39.6494C470.171 39.6494 465.854 40.9054 462.407 43.3891C459.048 45.783 456.502 49.0755 454.792 53.2947C453.054 57.5136 452.214 62.3011 452.214 67.657C452.214 73.0133 453.084 77.6523 454.792 81.8716C456.532 86.0008 459.05 89.2922 462.407 91.7759C465.854 94.1698 470.171 95.3664 475.357 95.3664C479.973 95.3663 483.9 94.2302 487.167 91.9263C490.434 89.5324 492.923 86.2704 494.661 82.171C496.4 77.9518 497.24 73.1331 497.24 67.657C497.24 62.1809 496.369 57.2143 494.661 52.9952C492.923 48.7761 490.434 45.5141 487.167 43.24C483.9 40.8462 479.973 39.6495 475.357 39.6494ZM323.528 27.2906H339.775V41.0849H323.528V93.9311H307.28V41.0849H295.619V27.2906H307.28V7.18116H323.528V27.2906ZM177.754 70.3801H207.91L192.682 21.6052L177.754 70.3801Z" fill="white"/>
</svg>
`;

const ARTUBE_LOGO_URL = `data:image/svg+xml,${encodeURIComponent(ARTUBE_LOGO_SVG)}`;

const LOADER_CSS = `
/* Fullscreen mode (default) — covers entire viewport, fades to black */
.loader {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 9999;
}

/* Contained mode — fills parent container, fades to transparent */
.loader.loader-contained {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.loader-phase {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 0.5s ease;
  pointer-events: none;
}

.loader-phase.active {
  opacity: 1;
}

/* Phase 1: Partner logo slot (defaults to Artube logo if no partner logo configured) */
.loader-partner {
  background: #0a0a0f;
}

/* Phase 2: Artube branding — vertical linear gradient matching design (black → olive → lime).
   Stops are proportionally identical in portrait and landscape, so one definition covers both.
   The final stop sits past 100% on purpose: the viewport bottom shows the interpolated lime. */
.loader-artube-gradient {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    180deg,
    #000904 0%,
    #000904 54%,
    #223400 72%,
    #91aa17 95%,
    #daf72d 111%
  );
  z-index: 0;
}

/* Contained mode: fade to transparent at the top so the host view shows through */
.loader-contained .loader-artube-gradient {
  background: linear-gradient(
    180deg,
    rgba(0, 9, 4, 0) 0%,
    rgba(0, 9, 4, 0) 45%,
    #223400 72%,
    #91aa17 95%,
    #daf72d 111%
  );
}

.loader-contained .progress-bg {
  height: 14px;
  min-height: 10px;
}

.loader-contained .progress-container {
  bottom: 18%;
}

.loader-contained .loader-partner {
  background: transparent;
}

/* Logo lockup — shared by both phases so the crossfade has no jump.
   Width tracks the progress bar (600px @ the 1080/1920 design reference).
   Partners override --partner-logo-url to swap in their own branding on phase 1. */
.loader-artube-logo,
.loader-partner-logo {
  position: absolute;
  width: 100%;
  height: 100%;
  background-repeat: no-repeat;
  background-position: center 41%;
  background-size: min(55%, 600px) auto;
}

.loader-artube-logo {
  z-index: 1;
  background-image: url("${ARTUBE_LOGO_URL}");
}

.loader-partner-logo {
  background-image: var(--partner-logo-url, url("${ARTUBE_LOGO_URL}"));
}

@media screen and (orientation: landscape) {
  .loader-artube-logo,
  .loader-partner-logo {
    background-position-y: 42%;
    background-size: min(31.25%, 600px) auto;
  }
}

/* Progress bar */
.progress-container {
  position: absolute;
  display: flex;
  justify-content: center;
  bottom: 21.6%;
  width: 100%;
  height: auto;
  z-index: 2;
}

@media screen and (orientation: landscape) {
  .progress-container {
    bottom: 22%;
  }
}

.progress-bg {
  width: 55%;
  max-width: 600px;
  height: 1.9vh;
  min-height: 12px;
  max-height: 35px;
  border-radius: 70cqh;
  background: #ffffff;
  overflow: hidden;
}

@media screen and (orientation: landscape) {
  .progress-bg {
    width: 31.25%;
    height: 3.25vh;
  }
}

.progress-bar {
  width: 0;
  height: 100%;
  border-radius: 70cqh;
  background: #dcfa43;
  transition: width 0.3s ease;
}

.hidden-progress {
  opacity: 0;
}

.hidden-loader {
  opacity: 1;
  animation: 0.3s hideLoader forwards;
}

@keyframes hideLoader {
  0% { opacity: 1; }
  100% { opacity: 0; }
}
`;

/** Both phases: the partner screen crossfading into the Artube-branded one. */
const LOADER_HTML_WITH_PARTNER = `
<div id="loader" class="loader">
  <div id="loader-partner" class="loader-phase loader-partner active">
    <div class="loader-partner-logo"></div>
  </div>
  <div id="loader-artube" class="loader-phase loader-artube">
    <div class="loader-artube-gradient"></div>
    <div class="loader-artube-logo"></div>
    <div id="progress-container" class="progress-container hidden-progress">
      <div class="progress-bg">
        <div id="progress-bar" class="progress-bar"></div>
      </div>
    </div>
  </div>
</div>
`;

/** Artube-branded phase only (`useArtubePreloader: false`). */
const LOADER_HTML_ARTUBE_ONLY = `
<div id="loader" class="loader">
  <div id="loader-artube" class="loader-phase loader-artube">
    <div class="loader-artube-gradient"></div>
    <div class="loader-artube-logo"></div>
    <div id="progress-container" class="progress-container hidden-progress">
      <div class="progress-bg">
        <div id="progress-bar" class="progress-bar"></div>
      </div>
    </div>
  </div>
</div>
`;

/**
 * Artube's branded loading screen, injected into `index.html` at transform time.
 *
 * The point of doing it in HTML rather than from the game bundle is that the
 * screen is painted by the browser before a single byte of the game's JavaScript
 * has run — it covers the gap the game itself cannot cover.
 *
 * `@energy8platform/artube-bridge/loader`'s `LoaderViewController` drives what
 * this injects.
 */
export function artubePartnerLoader(options?: PartnerLoaderOptions): Plugin {
  const mode = options?.mode ?? 'fullscreen';
  const container = options?.container ?? '#game-container';
  const html = (options?.useArtubePreloader ?? true)
    ? LOADER_HTML_WITH_PARTNER
    : LOADER_HTML_ARTUBE_ONLY;

  return {
    name: 'artube-partner-loader',
    transformIndexHtml(source: string): string {
      if (mode === 'contained') {
        const contained = html.replace('class="loader"', 'class="loader loader-contained"');
        return source
          .replace('</head>', `<style>${LOADER_CSS}</style>\n</head>`)
          .replace(
            new RegExp(`(<[^>]*id=["']${container.replace('#', '')}["'][^>]*>)`),
            `$1\n${contained}`,
          );
      }
      return source
        .replace('</head>', `<style>${LOADER_CSS}</style>\n</head>`)
        .replace(/<body(.*)>/i, `<body$1>\n${html}`);
    },
  };
}

/**
 * @deprecated Use {@link artubePartnerLoader} instead.
 * Kept for backward compatibility — delegates to the two-phase loader in fullscreen mode.
 */
export function artubeLoader(): Plugin {
  return artubePartnerLoader({ mode: 'fullscreen' });
}
