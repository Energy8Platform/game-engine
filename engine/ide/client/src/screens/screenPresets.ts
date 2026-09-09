/**
 * A pinned COPY of `@energy8platform/harness`'s `SCREEN_PRESETS` — not a
 * re-export, and not read from that package at all. `PreviewWall.tsx`
 * imports THIS file.
 *
 * The ruling this reverses: importing the data directly from
 * `@energy8platform/harness` was tried first, on the theory that one
 * dependency on pure data beats two sources of truth. The premise turned
 * out to be false. `packages/harness/package.json` ships `files:
 * ["dist", "README.md"]` — `src/screens.ts` is not published at all, and
 * is reachable here only through a workspace symlink, an implementation
 * detail of this monorepo rather than a contract. Its `exports` map has
 * exactly `"."` and `"./panel"` — no data-only subpath — and `"."`'s built
 * output (`dist/harness.esm.js`) opens with `import { readFileSync } from
 * 'node:fs'` and `import { fileURLToPath } from 'node:url'`, unconditional,
 * before any of the data: the Node half (`createHarness`, a dev-only vite
 * plugin) and the browser-safe half are welded together at the package
 * boundary. Importing that entry from `PreviewWall.tsx` — code this app
 * actually bundles for a browser — took the WHOLE app down at boot in a
 * real browser (confirmed with Playwright) and broke `vite build`, because
 * Vite's stand-in for a node builtin in browser code THROWS the instant
 * `readFileSync`/`fileURLToPath` are read off it, not merely when called.
 * `packages/*` is legacy and read-only, so there is no fixing the package's
 * own boundary from here.
 *
 * So: a copy, checked rather than trusted. `tests/screen-presets-sync.
 * test.ts` imports the REAL `@energy8platform/harness` — safe there, since
 * vitest runs on real Node and the `node:fs`/`node:url` imports simply
 * resolve — and asserts this array still matches it on exactly the fields
 * `PreviewWall` reads (`name`/`w`/`h`). Drift becomes possible, but it is
 * caught by `npm test`, not only by a real build or a real browser.
 */

export interface ScreenPreset {
  name: string;
  w: number;
  h: number;
}

/** The 7 screen presets, in bar order — see the module doc for why this is a copy. */
export const SCREEN_PRESETS: ScreenPreset[] = [
  { name: 'Desktop', w: 1200, h: 675 },
  { name: 'Laptop', w: 1024, h: 576 },
  { name: 'Popout S', w: 400, h: 225 },
  { name: 'Popout L', w: 800, h: 450 },
  { name: 'Mobile L', w: 425, h: 812 },
  { name: 'Mobile M', w: 375, h: 667 },
  { name: 'Mobile S', w: 320, h: 568 },
];

/** Look up a screen preset by name. `undefined` for unknown names. */
export function screenPreset(name: string): ScreenPreset | undefined {
  return SCREEN_PRESETS.find((p) => p.name === name);
}
