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
    port: 5680,
    proxy: {
      '/api': HOST,
      '/plugin-client': HOST,
      '/ide': { target: HOST, ws: true },
    },
  },
});
