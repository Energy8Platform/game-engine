import { defineConfig } from 'vite';

// Standalone visual lab for the configurable reel system. Plain Pixi app — no SDK/DevBridge.
export default defineConfig({
  base: './',
  build: { target: 'esnext' },
  esbuild: { target: 'esnext' },
  server: { port: 5179 },
});
