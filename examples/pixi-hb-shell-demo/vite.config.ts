import { defineConfig } from 'vite';

// Pixi + @energy8platform/shell (/pixi) demo. The shell renders into a transparent Pixi canvas that
// fills the #game viewport, so this is a plain Pixi app (no DevBridge/SDK plumbing needed).
// `esnext` target so top-level await (await app.init(...)) is allowed.
export default defineConfig({
  base: '/',
  build: { target: 'esnext' },
  esbuild: { target: 'esnext' },
});
