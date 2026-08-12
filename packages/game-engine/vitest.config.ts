import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Host-selection tests exercise the REAL launch classifier. Point at the sibling package's
      // SOURCE so the test can't pass (or fail) on a stale `artube-bridge/dist` build.
      '@energy8platform/artube-bridge/detect': resolve(__dirname, '../artube-bridge/src/detect.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts', 'src/vite/**'],
    },
  },
});
