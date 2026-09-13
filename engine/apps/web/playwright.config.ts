import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  // Every spec file in this suite boots its own `createIdeHost` on the
  // SAME fixed port (5679 — the port `vite.config.ts`'s own dev-server
  // proxy hardcodes as its target, so a host on any other port would leave
  // `/api`, `/plugin-client` and `/ide` unreachable from this app). Two
  // spec files running in parallel workers would race that one port
  // (EADDRINUSE) — Playwright's default is to run different test FILES
  // across parallel workers even without `fullyParallel`, so this needs to
  // be explicit now that a second spec file (`runtime.spec.ts`) exists
  // alongside `skeleton.spec.ts`. `workers: 1` makes the whole suite
  // serial, which trades away parallelism this suite was never actually
  // using for speed (each spec already spawns real, heavy processes —
  // vite, `e8-server`) for the simple guarantee that only one fixed-port
  // host is ever up at a time.
  workers: 1,
  // `vite build` once, for the one spec that reads `dist` through the host (workspace.spec.ts).
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: 'http://127.0.0.1:5680' },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5680',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
