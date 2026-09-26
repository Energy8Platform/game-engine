import { describe, expect, it } from 'vitest';
import {
  LANGS as HARNESS_LANGS,
  SCREEN_PRESETS as HARNESS_SCREEN_PRESETS,
} from '@energy8platform/harness';
import { LANGS } from '../src/screens/langs';
import { SCREEN_PRESETS } from '../src/screens/screenPresets';

/**
 * `Preview` reads `./screenPresets`/`./langs` — pinned COPIES of
 * `@energy8platform/harness`'s `SCREEN_PRESETS`/`LANGS`, not that package
 * itself (see `screenPresets.ts`'s own doc for why: its only public entry
 * welds this data to a Node-only dev plugin at the module boundary, which
 * broke this app in a real browser and broke `vite build`).
 *
 * Importing the REAL package here, in a TEST, is exactly the safe half of
 * that same boundary: vitest runs on real Node, so `createHarness`'s
 * `node:fs`/`node:url` imports simply resolve — nothing here is a browser,
 * and nothing here ships. This is the guarantee that makes a copy an
 * acceptable answer instead of a silent liability: if the copy drifts from
 * the original, `npm test` says so, in the one command this repo's whole
 * discipline already leans on, rather than only a real build or a real
 * browser ever finding out.
 *
 * Compared on exactly the fields `Preview` actually reads —
 * `name`/`w`/`h` for a preset, `code`/`label` for a language — not the
 * whole object, so a field the upstream package adds tomorrow that
 * `Preview` never looks at cannot fail this test for a reason nobody here
 * can act on.
 */
describe('the local preset/language copy stays in sync with @energy8platform/harness', () => {
  it('SCREEN_PRESETS matches on name/w/h', () => {
    expect(SCREEN_PRESETS.map(({ name, w, h }) => ({ name, w, h }))).toEqual(
      HARNESS_SCREEN_PRESETS.map(({ name, w, h }) => ({ name, w, h })),
    );
  });

  it('LANGS matches on code/label', () => {
    expect(LANGS.map(({ code, label }) => ({ code, label }))).toEqual(
      HARNESS_LANGS.map(({ code, label }) => ({ code, label })),
    );
  });
});
