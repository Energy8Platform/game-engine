import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { IDE_HMR_PORT, IDE_HOST_PORT, IDE_WEB_PORT } from './e2e-ports';

// The IDE host this dev server proxies to. `IDE_HOST_PORT` (from
// `./e2e-ports.ts`, which has no imports of its own — a vite config cannot
// import a Playwright fixture) resolves `E8_E2E_HOST_PORT` with the same
// default `tests/e2e/project-fixture.ts` re-exports it with, so the two
// can no longer drift apart. Unset, this is the fixed 5679 it always was —
// the env var exists for the one case the fixed port cannot serve: a
// developer whose own `e8 dev` already holds 5679 while the suite runs.
const HOST = `http://127.0.0.1:${IDE_HOST_PORT}`;

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
  // `@energy8platform/harness` that `Preview` (née `PreviewWall`, Task 6)
  // briefly imported directly for `SCREEN_PRESETS`/`LANGS`. Withdrawn:
  // `Preview` now reads a pinned, checked COPY of that data instead
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
    port: IDE_WEB_PORT,
    // The host's cross-origin allowlist names this port; a silent move to
    // 5681+ would leave every write from the dev IDE refused with a 403.
    strictPort: true,
    // Vite's default HMR websocket port (24678) is shared machine-wide, not
    // per-project — a second vite anywhere on the box (another `e8 dev`)
    // holds it first and this one's HMR client fails silently. IDE_HMR_PORT
    // (5690) sits alongside this app's other fixed ports (5679-5682) instead.
    hmr: { port: IDE_HMR_PORT },
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
