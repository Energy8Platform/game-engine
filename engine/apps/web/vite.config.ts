import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const HOST = 'http://127.0.0.1:5679';

// `@energy8engine/ide-client`'s `PreviewWall` (Task 6) reads `SCREEN_PRESETS`/
// `LANGS` from `@energy8platform/harness`'s "." entry — its only public one
// that exports them. That SAME entry also re-exports `createHarness`, a
// Node-only dev plugin that imports `readFileSync`/`fileURLToPath` at its
// top; see `src/shims/node-builtins.ts`'s own doc for what happens to this
// app's WHOLE module graph, in both dev and `vite build`, without the alias
// below standing in for them.
const nodeBuiltinStub = fileURLToPath(new URL('./src/shims/node-builtins.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // `main.tsx` uses top-level await (Task 12, Ruling 2 — `createIdeClient`
  // is async and Vite serves the entry as a native ES module). Vite's
  // default production target list (a baseline of widely-available
  // browsers) predates top-level-await support in esbuild's transform, so
  // `vite build` fails on it without this; the dev server has no such
  // restriction since it transforms per-module against `esnext`.
  build: { target: 'es2022' },
  resolve: {
    alias: {
      'node:fs': nodeBuiltinStub,
      'node:url': nodeBuiltinStub,
    },
  },
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
    proxy: {
      '/api': HOST,
      '/plugin-client': HOST,
      // No `/plugin-runtime` proxy. Nothing on 5680 imports a runtime
      // half: this document is the IDE, and the only thing that loads
      // runtime halves is the GAME, which lives in the preview iframe on
      // the host's own origin (5679) where the import is same-origin
      // already. The proxy existed by symmetry with `/plugin-client`
      // above, which the IDE genuinely does need — that one loads the
      // EDITOR's client halves into this document.
      '/ide': { target: HOST, ws: true },
    },
  },
});
