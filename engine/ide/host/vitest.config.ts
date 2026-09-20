import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `plugins/spec.ts` is the host's only import of `@energy8platform/platform-core`,
 * and the package's `exports` map points at `dist/` — so without this these
 * tests would need `npm run build -w @energy8platform/platform-core` to have
 * run first. The alias sends that one sub-path at the package's SOURCE
 * instead; `src/game-spec` imports nothing outside itself but types, so
 * vite has nothing to transform that a build would have resolved
 * differently. Types still come from `dist/game-spec.d.ts` (tsc does not
 * read this file), which is what `npm run typecheck` checks against.
 */
const GAME_SPEC_SRC = fileURLToPath(
  new URL('../../../packages/platform-core/src/game-spec/index.ts', import.meta.url),
);

export default defineConfig({
  resolve: { alias: { '@energy8platform/platform-core/game-spec': GAME_SPEC_SRC } },
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
});
