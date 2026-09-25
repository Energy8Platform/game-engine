import { defineConfig } from 'vitest/config';

// jsdom, not 'node': `@pixi/sound`'s entry module reads `document` at
// import time (`lib/utils/supported.mjs`'s format probe) — a plain-node
// environment throws `document is not defined` before any test runs.
// `tween.ts`'s `pixi.js`/`@energy8engine/tween` imports
// are Node-safe either way, so the package as a whole takes jsdom.
export default defineConfig({
  test: { globals: true, environment: 'jsdom', include: ['tests/**/*.test.ts'] },
});
