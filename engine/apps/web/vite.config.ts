import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const HOST = 'http://127.0.0.1:5679';

export default defineConfig({
  plugins: [react()],
  // `main.tsx` uses top-level await (Task 12, Ruling 2 — `createIdeClient`
  // is async and Vite serves the entry as a native ES module). Vite's
  // default production target list (a baseline of widely-available
  // browsers) predates top-level-await support in esbuild's transform, so
  // `vite build` fails on it without this; the dev server has no such
  // restriction since it transforms per-module against `esnext`.
  build: { target: 'es2022' },
  // This config used to carry a `resolve.alias` standing in for
  // `node:fs`/`node:url`, worked around a Node-only half of
  // `@energy8platform/harness` that `PreviewWall` (Task 6) briefly imported
  // directly for `SCREEN_PRESETS`/`LANGS`. Withdrawn: `PreviewWall` now
  // reads a pinned, checked COPY of that data instead
  // (`@energy8engine/ide-client/src/screens/screenPresets.ts`/`langs.ts`),
  // so this app's build never touches the package at all any more, and the
  // alias — which fixed the symptom in exactly one app's config, not the
  // coupling itself — has nothing left to stand in for. See that copy's
  // own doc, and `tests/screen-presets-sync.test.ts`, for the full account.
  //
  // Nothing here for Monaco either, on purpose. `monaco-editor` needs a web
  // worker and its own chunking, and both are settled where the editor is
  // wrapped (`ide-client`'s `editor/Monaco.tsx`): the worker arrives
  // through a `?worker` import that vite bundles as its own asset, and the
  // editor itself through a dynamic import that vite splits into a lazy
  // chunk — so `main.tsx` stays small and Monaco is fetched the first time
  // a screen mounts it. Measured against `vite build` and a real browser,
  // dev server and `vite preview` alike, before anything was built on it.
  server: {
    // Explicit, not left to default resolution: Vite's default dev host is
    // the string `'localhost'`, which Node resolves via DNS and binds to a
    // single address — on a machine where the resolver orders `::1` before
    // `127.0.0.1` (Node 17+ preserves OS resolver order), the server ends up
    // reachable only over IPv6. Everything else here — the proxy target
    // above, this app's Playwright config — already hardcodes `127.0.0.1`,
    // so the dev server needs to actually listen there.
    host: '127.0.0.1',
    port: 5680,
    // The host's cross-origin allowlist names this port; a silent move to
    // 5681+ would leave every write from the dev IDE refused with a 403.
    strictPort: true,
    proxy: {
      '/api': HOST,
      '/plugin-client': HOST,
      // No `/plugin-runtime` proxy. Nothing on 5680 imports a runtime
      // half: this document is the IDE, and the only thing that loads
      // runtime halves is the GAME, which lives in the preview iframe on
      // the PREVIEW server's own origin (`WorkspaceState.previewUrl`,
      // 5681 by default) where the import is same-origin already. The
      // proxy existed by symmetry with `/plugin-client`
      // above, which the IDE genuinely does need — that one loads the
      // EDITOR's client halves into this document.
      '/ide': { target: HOST, ws: true },
    },
  },
});
