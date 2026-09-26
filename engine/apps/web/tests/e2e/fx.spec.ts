/**
 * `tween` and `sound` as flow node kinds, proven in a real browser (Task 9):
 * a `tween` node moves a scene node's props over time, wired into
 * `flow.yml` exactly like any other node kind; the example's own flow
 * already uses `sound` for its `click` node (spec §6: no preload, `wait:
 * false` by default); and the flow palette lists both kinds once the game
 * has reported them.
 *
 * Same fixture and idioms as `flow.spec.ts`: a private `projectCopy()`
 * served by `startDevHost`, the Preview document's game frame
 * (`iframe[title="game preview"]`) and the game's own `window.__e8`.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import {
  bootStatus,
  gameBooted,
  previewFrame,
  projectCopy,
  spinOnce,
  startDevHost,
  type DevHost,
} from './project-fixture';

const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;

/**
 * `start(boot) → base(show base_game) → move(tween base_game/logo, x:100,
 * ms:200) → idle(on ui.spin) → spin → draw(present) → idle` — same style
 * as the example's own `flow.yml`. Written into the project copy BEFORE
 * `startDevHost`, so it's what `e8 dev` boots with; `tween`'s `wait`
 * defaults to `true`, so the boot chain does not reach `idle` until the
 * move finishes.
 */
const TWEEN_FLOW = `version: 1
nodes:
  - { id: start, kind: boot,    ui: { x: 40,  y: 80 } }
  - { id: base,  kind: show,    props: { scene: base_game }, ui: { x: 220, y: 80 } }
  - { id: move,  kind: tween,   props: { target: base_game/logo, x: 100, ms: 200 }, ui: { x: 400, y: 80 } }
  - { id: idle,  kind: on,      props: { event: ui.spin },   ui: { x: 580, y: 80 } }
  - { id: spin,  kind: spin,    ui: { x: 760, y: 80 } }
  - { id: draw,  kind: present, ui: { x: 940, y: 80 } }
edges:
  - { from: start, to: base }
  - { from: base,  to: move }
  - { from: move,  to: idle }
  - { from: idle,  to: spin }
  - { from: spin,  to: draw }
  - { from: draw,  to: idle }
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

/** The Preview's game, booted to `ready` — same reader as `flow.spec.ts`'s `readyFrame`. */
async function readyFrame(page: Page): Promise<Frame> {
  const frame = await previewFrame(page);
  await gameBooted(frame);
  expect(await bootStatus(frame)).toBe('ready');
  return frame;
}

test('a tween node moves a scene node, driven by flow.yml alone', async ({ page }) => {
  writeFileSync(join(dir, 'flow.yml'), TWEEN_FLOW);
  host = await startDevHost(dir);

  await page.goto(IDE_URL);
  const frame = await readyFrame(page);
  // `logo` starts at x:240 (`scenes/base_game.scene.yml`); the boot chain's
  // own `move` node tweens it to x:100 with no `ui.spin` needed.
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.nodeProps('base_game', 'logo')?.x), {
      timeout: 5000,
    })
    .toBe(100);
});

test('the example flow: click leaves by next through a sound node, and the palette lists tween and sound', async ({
  page,
}) => {
  host = await startDevHost(dir);

  // The game reports its flow-node kinds to the host the moment it boots
  // (`flow1`/`fx1` rows, both in `e8-base`) — a direct visit before the
  // IDE, same idiom as `flow.spec.ts`'s `openComposition`.
  await page.goto(host.gameUrl);
  await gameBooted(page);
  await page.goto(IDE_URL);

  const frame = await readyFrame(page);
  expect(await spinOnce(frame)).toBe('done');
  const trace = (await frame.evaluate(() => (window as any).__e8.flowTrace())) as {
    node: string;
    out: string | null;
  }[];
  expect(trace).toContainEqual(expect.objectContaining({ node: 'click', out: 'next' }));

  await page.getByTestId('activity-flow').click();
  await expect(page.getByTestId('flow-screen')).toBeVisible();
  const palette = page.getByTestId('flow-palette');
  await expect(palette.getByTestId('flow-add-tween')).toBeVisible({ timeout: 10_000 });
  await expect(palette.getByTestId('flow-add-sound')).toBeVisible();
});
