import { defineConfig } from 'vitest/config';

// jsdom, not 'node': `compose.test.ts` composes the game the way a real
// caller would (with a `mount` in hand), and it needs to observe the exact
// failure mode a real browser-less/WebGL-less environment produces —
// `renderer-pixi` measured that jsdom's `document` exists but its canvas
// getContext() does not, which is the "renderer absent" case the brief
// asks this suite to prove degrades to a diagnostic instead of a hang or
// a throw. `mechanics.test.ts` doesn't touch the DOM either way — jsdom is
// a strict superset for it.
export default defineConfig({
  test: { globals: true, environment: 'jsdom', include: ['tests/**/*.test.ts'] },
});
