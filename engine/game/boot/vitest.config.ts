import { defineConfig } from 'vitest/config';

// jsdom, not 'node': `renderBootFailure` is DOM by design (see the module
// doc in src/index.ts) — the whole point of this package is that a broken
// renderer can still report itself, which only means something if the
// report path itself does not depend on a renderer either.
export default defineConfig({
  test: { globals: true, environment: 'jsdom', include: ['tests/**/*.test.ts'] },
});
