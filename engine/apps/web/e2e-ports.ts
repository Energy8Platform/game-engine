/**
 * The e2e suite's fixed ports, in one place. `vite.config.ts` (the dev
 * server's proxy target) and `tests/e2e/project-fixture.ts` (every spec's
 * `createIdeHost` call) both read this file instead of each re-reading
 * `process.env` with their own copy of the same default, which is how the
 * two used to drift apart unnoticed. Deliberately NO imports of its own —
 * a vite config cannot import a Playwright fixture, and the fixture must
 * not drag vite in, so this is the one module both may depend on without
 * either depending on the other.
 */

/** Resolves the IDE host's e2e port from an env record — pulled out so a test can call it without spawning a process. */
export function resolveHostPort(env: Record<string, string | undefined>): number {
  return Number(env.E8_E2E_HOST_PORT ?? 5679);
}

/**
 * The port every in-process IDE host in the e2e suite binds, and the one
 * `vite.config.ts`'s dev-server proxy targets. `E8_E2E_HOST_PORT` moves it
 * — for the one case the fixed default cannot serve: a developer whose own
 * `e8 dev` already holds 5679 while the suite runs. Unset, this is the same
 * fixed 5679 it always was.
 */
export const IDE_HOST_PORT = resolveHostPort(process.env);

/** The IDE app's own vite dev server (`vite.config.ts`'s `server.port`, `strictPort: true`). */
export const IDE_WEB_PORT = 5680;

/** Vite's HMR websocket port (`vite.config.ts`'s `server.hmr.port`) — off the machine-shared default 24678. */
export const IDE_HMR_PORT = 5690;
