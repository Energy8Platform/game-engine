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
      // The game runs on the host's own port (`HOST`, 5679), and the
      // preview iframe shares that origin, so an ordinary same-origin
      // `import()` there needs no proxy. This app's own top-level document
      // lives on 5680 and cannot reach 5679 without one — see
      // `plugin-client`'s identical need above, and `runtime-assets.ts`'s
      // doc comment for what this route serves.
      '/plugin-runtime': HOST,
      '/ide': { target: HOST, ws: true },
    },
  },
});
