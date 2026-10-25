import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Bad Manners shell + intro demo. The package is aliased to its SOURCE so edits show without a build;
// shell / platform-core come from their built dist (rebuild them after changing their src).
const src = (p: string) => fileURLToPath(new URL(`../../packages/bad-manners/src/${p}`, import.meta.url));

export default defineConfig({
  base: '/',
  resolve: {
    alias: {
      '@energy8platform/bad-manners/shell': src('shell/index.ts'),
      '@energy8platform/bad-manners/preloader': src('preloader/index.ts'),
    },
  },
  build: { target: 'esnext' },
  esbuild: { target: 'esnext' },
});
