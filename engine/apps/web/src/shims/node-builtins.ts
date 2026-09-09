/**
 * A browser-safe stand-in for the two Node builtins `@energy8platform/harness`'s
 * "." entry imports — aliased onto `node:fs`/`node:url` for this app's OWN
 * build only, in `vite.config.ts`.
 *
 * `PreviewWall` (`@energy8engine/ide-client`) reads `SCREEN_PRESETS`/`LANGS`
 * from that entry — the package's only public one that exports them
 * (`package.json`'s `exports` map has no third, data-only subpath, and
 * `packages/*` is legacy and read-only, so there is nothing here to fix
 * upstream). The SAME entry also re-exports `createHarness`, a Node-only
 * dev-server plugin (`packages/harness/src/plugin.ts`'s own doc: "Never
 * pulled into a browser bundle") that imports `readFileSync`/
 * `fileURLToPath` at its top, unconditionally.
 *
 * Leaving those two imports unresolved is not a quiet no-op. Vite's default
 * handling of a node-builtin import in browser code substitutes a stub that
 * THROWS the instant `readFileSync`/`fileURLToPath` are so much as read off
 * it — not called, read — which happens at module-evaluation time, before
 * `createHarness` is ever reached, and takes the WHOLE import graph down
 * with it: measured against a real browser (Playwright, this app's own dev
 * server), the app failed to boot at all — not even the composition
 * screen, which imports nothing from `harness` — and `vite build` fails the
 * same way for the same reason, at bind time, before Rollup gets to
 * tree-shake the unused function away. Neither `readFileSync` nor
 * `fileURLToPath` is ever actually CALLED from this app — `createHarness`
 * is never imported by anything this app renders — so real functions that
 * exist only to be found by the resolver, and say so plainly if they are
 * ever actually reached, are enough.
 */
export function readFileSync(): never {
  throw new Error(
    'readFileSync: browser stub for node:fs — @energy8platform/harness’s createHarness is Node-only and must never run in this app',
  );
}

export function fileURLToPath(): never {
  throw new Error(
    'fileURLToPath: browser stub for node:url — @energy8platform/harness’s createHarness is Node-only and must never run in this app',
  );
}
