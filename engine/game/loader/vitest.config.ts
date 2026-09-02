import { defineConfig } from 'vitest/config';

// 'node', not 'jsdom': this package's own code touches no DOM. Its default
// `origin` fallback reads the global `location` when present (a real
// browser always has one), but every test injects `fetchFn`/`importModule`
// and most also pass `origin` implicitly via the fake fetch's own URL
// handling, so nothing here needs a DOM to exercise.
export default defineConfig({
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
});
