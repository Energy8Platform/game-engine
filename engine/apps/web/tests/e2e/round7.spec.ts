/**
 * Round 7's browser proof: five small, independent claims from Tasks 1–4
 * of the paper-duel round-7 slice, each played out on `first-slot` — the
 * real project the dev host serves, not a unit-level fake.
 *
 *  1. **Pose before show** (F16): a `load` flow node fetches a document's
 *     assets ahead of `show`; a `prop` node poses it in between; `show`
 *     finds nothing left to load, so the pose survives — the FIRST frame
 *     the document is visible already reads the posed value, not a
 *     default one a stray refresh put back.
 *  2. **Nested tween** (F15): `outer` statically embeds `inner` (a `scene`
 *     node); once `outer` is shown, a `tween` targeting `inner/dot`
 *     resolves through `scenes.view()` to the copy embedded IN `outer` —
 *     the one actually on screen — and animates that one.
 *  3. **Composed web font** (F19): `scenes1.fonts` loads a real `.woff2`
 *     before the first document mounts; `document.fonts.check(...)`
 *     proves the face is usable, and a `text` node naming that family
 *     renders in it.
 *  4. **Hidden bar, fitted caption** (F20): `shell { visible: 'false' }`
 *     zeroes the bar's height and bottom inset; the scenes runtime re-fits
 *     on its own next tick (no resize event), so the design's fitted scale
 *     grows — and `visible: 'true'` puts it back to exactly what it was.
 *  5. **fitWidth**: a text node's laid-out width never exceeds `fitWidth`.
 *
 * Each scenario gets its OWN project copy and dev host (per the SDD
 * controller's ruling 3) and its own minimal `flow.yml` — same idiom as
 * `fx.spec.ts`/`text.spec.ts`: a flow written into the copy BEFORE
 * `startDevHost`, read on `host.gameUrl` directly (no IDE chrome needed
 * for any of these five — `features.spec.ts`'s pattern, not
 * `flow.spec.ts`'s Preview iframe one). `window.__e8` hooks do the
 * reading; `nodeFontFamily` is the one hook this file adds (in BOTH
 * `main.ts` copies, byte-identical) — nothing existing reads a text
 * node's `style.fontFamily`.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { dump, load } from 'js-yaml';
import {
  bootStatus,
  EXAMPLES,
  gameBooted,
  projectCopy,
  startDevHost,
  type DevHost,
} from './project-fixture';

/** `packages/shell`'s own font — read/copied, never edited (`EXAMPLES` is `<root>/engine/examples`, two levels above `<root>`). */
const FONT_SRC = join(EXAMPLES, '..', '..', 'packages', 'shell', 'fonts', 'clash-regular.woff2');

let dir: string;
let host: DevHost;

test.beforeEach(() => {
  dir = projectCopy();
});

test.afterEach(async () => {
  if (host) await host.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** The game's own page, booted to `ready` — no IDE involved, same as `features.spec.ts`. */
async function readyPage(page: Page): Promise<void> {
  await page.goto(host.gameUrl);
  await gameBooted(page);
  expect(await bootStatus(page)).toBe('ready');
}

interface PatchDoc {
  rows: { id: string; name?: string; config?: Record<string, unknown> }[];
}

/** Merges `fonts` into the copy's existing `scenes1` patch row — appended alongside `design`/`portrait`, never replacing them (same `load`/`dump` idiom as `features.spec.ts`'s `probeFixture`). */
function addFontsToPatch(projectDir: string, fonts: { family: string; src: string }[]): void {
  const patchFile = join(projectDir, 'e8.patch.yml');
  const patch = load(readFileSync(patchFile, 'utf8')) as PatchDoc;
  const scenesRow = patch.rows.find((r) => r.id === 'scenes1')!;
  scenesRow.config = { ...scenesRow.config, fonts };
  writeFileSync(patchFile, dump(patch, { noRefs: true }));
}

test('a pose set between load and show survives — the first visible frame already reads it', async ({
  page,
}) => {
  writeFileSync(
    join(dir, 'scenes', 'posed.scene.yml'),
    `id: posed
nodes:
  - id: img
    type: image
    props: { src: assets/logo.png, x: 0, y: 0 }
`,
  );
  writeFileSync(
    join(dir, 'flow.yml'),
    `version: 1
nodes:
  - { id: start,     kind: boot, ui: { x: 40,  y: 80 } }
  - { id: loadPosed, kind: load, props: { scene: posed }, ui: { x: 220, y: 80 } }
  - { id: setX,      kind: prop, props: { target: posed/img, prop: x, value: '7' }, ui: { x: 400, y: 80 } }
  - { id: showPosed, kind: show, props: { scene: posed }, ui: { x: 580, y: 80 } }
edges:
  - { from: start,     to: loadPosed }
  - { from: loadPosed, to: setX }
  - { from: setX,      to: showPosed }
`,
  );
  host = await startDevHost(dir);
  await readyPage(page);

  // Ruling 2: poll INSIDE the page (a rAF loop) until `posed` is visible,
  // and read `img.x` at that SAME tick — not a later frame a separate
  // `page.evaluate` round trip could land on, after some other code had a
  // chance to touch it.
  const firstX = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const deadline = Date.now() + 10_000;
        const tick = () => {
          const api = (window as any).__e8;
          if ((api.scenesVisible() as string[]).includes('posed')) {
            resolve(api.nodeProps('posed', 'img').x);
            return;
          }
          if (Date.now() > deadline) {
            reject(new Error('posed never became visible'));
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(firstX).toBe(7);
});

test('a tween on a nested target animates the copy embedded in the shown host', async ({
  page,
}) => {
  writeFileSync(
    join(dir, 'scenes', 'inner.scene.yml'),
    `id: inner
nodes:
  - id: dot
    type: container
    props: { x: 0, y: 0 }
`,
  );
  writeFileSync(
    join(dir, 'scenes', 'outer.scene.yml'),
    `id: outer
nodes:
  - id: dot_holder
    type: scene
    props: { scene: inner }
`,
  );
  writeFileSync(
    join(dir, 'flow.yml'),
    `version: 1
nodes:
  - { id: start,     kind: boot,  ui: { x: 40,  y: 80 } }
  - { id: showOuter, kind: show,  props: { scene: outer }, ui: { x: 220, y: 80 } }
  - { id: moveDot,   kind: tween, props: { target: 'inner/dot', x: 200, ms: 200 }, ui: { x: 400, y: 80 } }
edges:
  - { from: start,     to: showOuter }
  - { from: showOuter, to: moveDot }
`,
  );
  host = await startDevHost(dir);
  await readyPage(page);

  await expect
    .poll(() => page.evaluate(() => (window as any).__e8.nodeProps('inner', 'dot')?.x), {
      timeout: 10_000,
    })
    .toBe(200);
});

test('scenes1.fonts loads a real web font before the first mount; a text node renders in it', async ({
  page,
}) => {
  mkdirSync(join(dir, 'assets', 'fonts'), { recursive: true });
  cpSync(FONT_SRC, join(dir, 'assets', 'fonts', 'clash-regular.woff2'));
  addFontsToPatch(dir, [{ family: 'E8Test', src: 'assets/fonts/clash-regular.woff2' }]);
  writeFileSync(
    join(dir, 'scenes', 'fontdoc.scene.yml'),
    `id: fontdoc
nodes:
  - id: label
    type: text
    props: { text: Hi, family: E8Test, size: 24, x: 0, y: 0 }
`,
  );
  writeFileSync(
    join(dir, 'flow.yml'),
    `version: 1
nodes:
  - { id: start, kind: boot, ui: { x: 40,  y: 80 } }
  - { id: base,  kind: show, props: { scene: fontdoc }, ui: { x: 220, y: 80 } }
edges:
  - { from: start, to: base }
`,
  );
  host = await startDevHost(dir);
  await readyPage(page);

  await expect
    .poll(() => page.evaluate(() => document.fonts.check('24px "E8Test"')), { timeout: 10_000 })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as any).__e8.nodeFontFamily('fontdoc', 'label')), {
      timeout: 10_000,
    })
    .toBe('E8Test');
});

test('shell { visible: false } grows the fitted design box; visible: true puts it back', async ({
  page,
}) => {
  writeFileSync(
    join(dir, 'flow.yml'),
    `version: 1
nodes:
  - { id: start,   kind: boot,  ui: { x: 40,  y: 80 } }
  - { id: gate1,   kind: wait,  props: { event: ui.tap }, ui: { x: 220, y: 80 } }
  - { id: hideBar, kind: shell, props: { visible: 'false' }, ui: { x: 400, y: 80 } }
  - { id: gate2,   kind: wait,  props: { event: ui.tap }, ui: { x: 580, y: 80 } }
  - { id: showBar, kind: shell, props: { visible: 'true' }, ui: { x: 760, y: 80 } }
  - { id: gate3,   kind: wait,  props: { event: ui.tap }, ui: { x: 940, y: 80 } }
edges:
  - { from: start,   to: gate1 }
  - { from: gate1,   to: hideBar }
  - { from: hideBar, to: gate2 }
  - { from: gate2,   to: showBar }
  - { from: showBar, to: gate3 }
`,
  );
  host = await startDevHost(dir);
  await readyPage(page);

  const enteredNull = (node: string) =>
    expect
      .poll(() => page.evaluate(() => (window as any).__e8.flowTrace()), { timeout: 10_000 })
      .toEqual(expect.arrayContaining([expect.objectContaining({ node, out: null })]));
  const fit = () => page.evaluate(() => (window as any).__e8.fit());

  // `gate1`: entered, not yet left — the bar is still up at its default height.
  await enteredNull('gate1');
  const shown = (await fit()) as { scale: number };

  // The re-fit lands on the scenes ticker's NEXT frame after the inset
  // actually changes (`runtime.ts`'s `scenes:insets` check) — a single read
  // right after the trace shows `gate2` entered can still catch the OLD
  // (shown) fit, one tick early. Poll, like every other asynchronously-
  // landing claim in this suite.
  await page.locator('canvas').click();
  await enteredNull('gate2');
  // The safe area lost its bottom inset (the bar's height), so more of the
  // viewport is available to fit the same design into — `first-slot`'s own
  // 480×288 design against Playwright's default 1280×720 viewport is
  // height-bound (`scaleY < scaleX`), so a taller safe area alone raises
  // the fitted scale.
  await expect
    .poll(async () => (await fit()).scale, { timeout: 10_000 })
    .toBeGreaterThan(shown.scale);

  await page.locator('canvas').click();
  await enteredNull('gate3');
  await expect.poll(fit, { timeout: 10_000 }).toEqual(shown);
});

test('fitWidth shrinks a long text node until its measured width fits', async ({ page }) => {
  writeFileSync(
    join(dir, 'scenes', 'fitdoc.scene.yml'),
    `id: fitdoc
nodes:
  - id: long
    type: text
    props: { text: 'this caption is far too long to fit in a two hundred pixel wide box as written', size: 32, fitWidth: 200, x: 0, y: 0 }
`,
  );
  writeFileSync(
    join(dir, 'flow.yml'),
    `version: 1
nodes:
  - { id: start, kind: boot, ui: { x: 40,  y: 80 } }
  - { id: base,  kind: show, props: { scene: fitdoc }, ui: { x: 220, y: 80 } }
edges:
  - { from: start, to: base }
`,
  );
  host = await startDevHost(dir);
  await readyPage(page);

  await expect
    .poll(() => page.evaluate(() => (window as any).__e8.nodeProps('fitdoc', 'long')?.width), {
      timeout: 10_000,
    })
    .toBeLessThanOrEqual(200);
});
