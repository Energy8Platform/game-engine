/**
 * `artubePartnerLoader` — Artube's branded loading screen, VENDORED from
 * `@artube/loader` 2.1.0 (see the provenance header in `src/vite/partnerLoader.ts`).
 *
 * What is worth asserting about vendored code is not its internals — we did not
 * design them — but the two contracts a re-vendoring could silently break:
 *
 *  1. The screen is in the HTML *before any script runs*. That is the whole
 *     reason the loader is a Vite plugin and not a module the game imports, and
 *     the reason the engine can hand the pre-first-frame gap to it at all.
 *  2. The markup defines exactly the element ids the browser half
 *     (`@energy8platform/artube-bridge/loader`) looks up. The two live in
 *     different packages on purpose — this file and `ARTUBE_LOADER_ELEMENT_IDS`
 *     are what keeps them honest without a dependency between them.
 */
import { describe, it, expect } from 'vitest';
import type { Plugin } from 'vite';
import {
  artubePartnerLoader,
  artubeLoader,
  ARTUBE_LOADER_ELEMENT_IDS,
} from '../src/vite/index.js';

/** A realistic `index.html`: one tag per line, as every scaffolded game has it. */
const HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
  </head>
  <body class="game">
    <div id="game-container"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>`;

/** `transformIndexHtml` is declared as a hook object|function; here it is a plain function. */
function transform(plugin: Plugin, html = HTML): string {
  const hook = plugin.transformIndexHtml as unknown as (h: string) => string;
  return hook(html);
}

describe('artubePartnerLoader (vendored @artube/loader 2.1.0)', () => {
  it('injects its CSS into <head> and its markup right after <body>', () => {
    const out = transform(artubePartnerLoader());
    expect(out).toContain('<style>');
    expect(out.indexOf('<style>')).toBeLessThan(out.indexOf('</head>'));
    // Right after the opening body tag: the browser paints it before it has even
    // seen the module script at the end of the document.
    expect(out).toMatch(/<body class="game">\s*\n?\s*<div id="loader"/);
    expect(out.indexOf('id="loader"')).toBeLessThan(out.indexOf('src="/src/main.ts"'));
  });

  it('defines every element id the browser-side controller binds to', () => {
    const out = transform(artubePartnerLoader());
    for (const id of ARTUBE_LOADER_ELEMENT_IDS) {
      expect(out).toContain(`id="${id}"`);
    }
  });

  it('starts on the partner phase, with the progress bar hidden', () => {
    const out = transform(artubePartnerLoader());
    expect(out).toContain('class="loader-phase loader-partner active"');
    expect(out).toContain('class="loader-phase loader-artube"'); // not active yet
    expect(out).toContain('class="progress-container hidden-progress"');
  });

  it('useArtubePreloader:false drops the partner phase entirely', () => {
    const out = transform(artubePartnerLoader({ useArtubePreloader: false }));
    expect(out).not.toContain('id="loader-partner"');
    expect(out).toContain('id="loader-artube"');
  });

  it('contained mode mounts inside the container and marks the loader contained', () => {
    const out = transform(artubePartnerLoader({ mode: 'contained' }));
    expect(out).toContain('class="loader loader-contained"');
    expect(out).toMatch(/<div id="game-container">\s*\n?\s*<div id="loader"/);
  });

  it('contained mode honours a custom container selector', () => {
    const html = '<html><head></head><body><div id="stage"></div></body></html>';
    const out = transform(artubePartnerLoader({ mode: 'contained', container: '#stage' }), html);
    expect(out).toMatch(/<div id="stage">\s*\n?\s*<div id="loader"/);
  });

  /**
   * Recorded, not endorsed: upstream matches `/<body(.*)>/i`, and `.*` is greedy.
   * On a MINIFIED single-line document that captures everything up to the last
   * `>` in the file, so the loader lands at the END of the body instead of the
   * start. Harmless for a real `index.html` (one tag per line, so `.` cannot
   * cross the newline) and for Vite, which does not minify HTML structure — but
   * anyone who pre-minifies their `index.html` before this plugin runs gets a
   * loader that paints after the rest of the body. Kept byte-for-byte on
   * purpose; fixing it here would be a silent fork of Artube's screen.
   */
  it('KNOWN UPSTREAM QUIRK: a single-line document places the loader last', () => {
    const oneLine = '<html><head></head><body><div id="app"></div></body></html>';
    const out = transform(artubePartnerLoader(), oneLine);
    expect(out.indexOf('id="loader"')).toBeGreaterThan(out.indexOf('id="app"'));
  });

  it('ships the Artube wordmark inline — no network request on the first paint', () => {
    const out = transform(artubePartnerLoader());
    expect(out).toContain('data:image/svg+xml,');
    expect(out).not.toMatch(/background-image:\s*url\("https?:/);
  });

  it('lets a partner override phase 1 with --partner-logo-url', () => {
    expect(transform(artubePartnerLoader())).toContain('var(--partner-logo-url');
  });

  it('artubeLoader() is the deprecated fullscreen alias, byte-for-byte', () => {
    expect(transform(artubeLoader())).toBe(transform(artubePartnerLoader({ mode: 'fullscreen' })));
  });

  it('keeps the upstream plugin name (games may reference it in vite config)', () => {
    expect(artubePartnerLoader().name).toBe('artube-partner-loader');
  });
});
