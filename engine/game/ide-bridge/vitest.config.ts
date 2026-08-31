import { defineConfig } from 'vitest/config';

// 'node', not 'jsdom': every test injects its own fake `mechanics` service
// and its own fake `socketFactory` (mirroring `engine/ide/client/src
// /plugins/connection.ts`'s own test seam) — nothing here needs a DOM, and
// the one branch that reads `location`/opens a real `WebSocket` is
// exercised through those fakes, never the real globals.
export default defineConfig({
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
});
