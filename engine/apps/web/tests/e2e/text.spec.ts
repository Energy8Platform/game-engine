/**
 * `text` nodes, live props and a tap on the stage, proven in a real
 * browser (spec §9, Task 4 of the text-and-props slice):
 *
 *  1. The example's own `win` node (`scenes/base_game.scene.yml`) and its
 *     `show_win` flow node (`flow.yml`: `draw → show_win → done`, kind
 *     `prop`, `target: base_game/win`, `prop: text`, `value: $result.win`)
 *     — empty at boot, the last spin's credited amount after one.
 *  2. `ui.tap` reaching a flow: a `wait { event: ui.tap }` node holds until
 *     a click on the preview canvas, then a `prop` node with a LITERAL
 *     value sets the same `win` node's text.
 *  3. A scene document's own `text` node mounts with a real `width` — the
 *     `nodeProps`/`nodeText` pair, off one extra node in a scene copy.
 *
 * Same fixture and idioms as `fx.spec.ts`/`contract.spec.ts`: a private
 * `projectCopy()`, its `flow.yml`/`scenes/base_game.scene.yml` rewritten
 * BEFORE `startDevHost` for cases 2/3 (the running host reads them once,
 * at boot), the composition document's `Preview`
 * (`iframe[title="game preview"]`) and the game's own `window.__e8` — here
 * `nodeText(scene, node)` (Task 4's own hook), `spin()` and `spins()`.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = 'http://127.0.0.1:5680/';
const PREVIEW = 'iframe[title="game preview"]';

/**
 * `start(boot) → base(show base_game) → hold(wait ui.tap) → mark(prop
 * base_game/win.text = 'tapped')` — same one-node-per-line style as the
 * example's own `flow.yml` and `fx.spec.ts`'s `TWEEN_FLOW`. `mark`'s
 * `value` is a LITERAL ('tapped', already a string), unlike the example's
 * own `$result.win` — this flow proves the tap reaches the flow at all,
 * not the numeric-`$path`-into-a-string-prop coercion case 1 already
 * covers through the real example.
 */
const TAP_FLOW = `version: 1
nodes:
  - { id: start, kind: boot, ui: { x: 40,  y: 80 } }
  - { id: base,  kind: show, props: { scene: base_game }, ui: { x: 220, y: 80 } }
  - { id: hold,  kind: wait, props: { event: ui.tap }, ui: { x: 400, y: 80 } }
  - { id: mark,  kind: prop, props: { target: base_game/win, prop: text, value: tapped }, ui: { x: 580, y: 80 } }
edges:
  - { from: start, to: base }
  - { from: base,  to: hold }
  - { from: hold,  to: mark }
`;

let dir: string;
let host: DevHost;

test.beforeEach(() => {
  dir = projectCopy();
});

test.afterEach(async () => {
  if (host) await host.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.locator(PREVIEW).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('preview iframe has no content frame');
  return frame;
}

/** The composition's preview, booted to `ready` — same reader as `fx.spec.ts`/`scenes.spec.ts`. */
async function readyFrame(page: Page): Promise<Frame> {
  const frame = await gameFrame(page);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 20_000 })
    .toBe('ready');
  return frame;
}

test("the example's win text is empty at boot and the last spin's credited amount after one", async ({
  page,
}) => {
  host = await startDevHost(dir);

  await page.goto(`${IDE_URL}#/doc/composition`);
  const frame = await readyFrame(page);
  // `#status` reads `ready` before the boot GET (`scenes.ready`) has
  // necessarily answered — same race `flow.spec.ts`'s `scenesVisible()`
  // poll guards against right after `readyFrame` — so this is a poll, not
  // a single read, even though the awaited value never changes once
  // `base_game` (and its `win` node) is actually up.
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.nodeText('base_game', 'win')), {
      timeout: 10_000,
    })
    .toBe('');

  expect(await frame.evaluate(() => (window as any).__e8.spin())).toEqual({ out: 'next' });

  const spins = (await frame.evaluate(() => (window as any).__e8.spins())) as {
    result: { win: number };
  }[];
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.nodeText('base_game', 'win')), {
      timeout: 10_000,
    })
    .toBe(String(spins.at(-1)!.result.win));
});

test('a tap on the stage reaches a wait node, and a prop node after it sets the text', async ({
  page,
}) => {
  writeFileSync(join(dir, 'flow.yml'), TAP_FLOW);
  host = await startDevHost(dir);

  await page.goto(`${IDE_URL}#/doc/composition`);
  const frame = await readyFrame(page);

  // `hold` is a `wait` node with no `ms` — it does not settle on its own,
  // so the flow really is stuck there until the tap. Polling the trace for
  // `hold` HAVING ENTERED (`out: null`, not yet left) is the honest wait
  // for "the flow is now blocked on the tap", rather than a fixed sleep —
  // and once that is true, the text is proven to stay empty at that point
  // in time, not merely "on the first tick".
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.flowTrace()), { timeout: 10_000 })
    .toEqual(
      expect.arrayContaining([expect.objectContaining({ node: 'hold', out: null })]),
    );
  expect(await frame.evaluate(() => (window as any).__e8.nodeText('base_game', 'win'))).toBe('');

  // The preview's own canvas, centre click — `ui.tap` is emitted by the
  // scenes runtime off the stage's `pointerdown`, in design units; any
  // point on the canvas fires it, `hold`'s `event: ui.tap` does not filter
  // by position.
  await frame.locator('canvas').click();

  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.nodeText('base_game', 'win')), {
      timeout: 10_000,
    })
    .toBe('tapped');
});

test("a scene document's own text node mounts with real text and a real width", async ({
  page,
}) => {
  const sceneFile = join(dir, 'scenes', 'base_game.scene.yml');
  writeFileSync(
    sceneFile,
    `id: base_game
nodes:
  - id: board
    type: reels
    props: { row: reels1 }
  - id: logo
    type: image
    props: { src: assets/logo.png, x: 240, y: 40, anchor: 0.5 }
  - id: coin
    type: spritesheet
    props: { sheet: assets/coin.json, x: 40, y: 40, fps: 8, anchor: 0.5 }
  - id: win
    type: text
    props: { text: '', size: 28, fill: '#ffd166', x: 240, y: 260, anchor: 0.5, align: center }
  - id: big_win
    type: scene
    props: { scene: big_win, visible: false }
  - id: hello
    type: text
    props: { text: hello, size: 40, x: 100, y: 100 }
`,
  );
  host = await startDevHost(dir);

  await page.goto(`${IDE_URL}#/doc/composition`);
  const frame = await readyFrame(page);

  expect(await frame.evaluate(() => (window as any).__e8.nodeText('base_game', 'hello'))).toBe(
    'hello',
  );
  expect(
    (await frame.evaluate(() => (window as any).__e8.nodeProps('base_game', 'hello')))?.width,
  ).toBeGreaterThan(0);
});
