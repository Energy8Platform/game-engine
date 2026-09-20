/**
 * The flow editor, proven in a real browser (flow editor spec, Task 10):
 * the Flow document draws `flow.yml`'s ten nodes; the palette adds a
 * node, a drag between two handles adds an edge, `Delete` on a selected
 * node takes it and its edges out — each landing in the file; and the
 * Preview's game is DRIVEN by that document: `base_game` is on screen
 * from boot (the `show` node), a spin goes `on ui.spin → mode → click →
 * spin → present` with no loop in `main.ts`, and the run paints the canvas.
 * `present` now leaves through `done` (`if result.roundComplete`): `true`
 * loops back to `on`, `false` hands off to `step`, which posts the open
 * round and loops back to `present` — dormant on `first-slot`'s math,
 * where every round completes on the first spin, so a plain spin still
 * settles on `on` exactly as before.
 *
 * Same fixture and readers as `scenes.spec.ts`: a private `projectCopy()`
 * served by `startDevHost`, the composition document's `Preview`
 * (`iframe[title="game preview"]`) and the game's own `window.__e8` —
 * here `spin()` (emits `ui.spin`, resolves `{ out }` from the `present`
 * node's exit), `spins()`, `flowTrace()` and `scenesVisible()`.
 *
 * What lands in the file arrives asynchronously (a canvas edit → `PUT
 * /api/flow` → disk), and what lands in the canvas from a spin does too
 * (the interpreter's trace → `ide-bridge` → the host → the `flow-trace`
 * frame), so every such claim is a poll. The file is read back through
 * js-yaml — the host writes it with `yaml.dump`, so the exact text is the
 * host's business, and the document is what a test can honestly compare.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { load } from 'js-yaml';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = 'http://127.0.0.1:5680/';
const PREVIEW = 'iframe[title="game preview"]';

interface Doc {
  nodes: { id: string; kind: string; props?: Record<string, unknown> }[];
  edges: { from: string; to: string; out?: string }[];
}

let dir: string;
let host: DevHost;

test.beforeEach(async () => {
  dir = projectCopy();
  host = await startDevHost(dir);
});

test.afterEach(async () => {
  if (host) await host.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const flowFile = (): Doc => load(readFileSync(join(dir, 'flow.yml'), 'utf8')) as Doc;

/**
 * The game up once on its own URL, then the IDE on its composition document
 * (as `scenes.spec.ts`). The first visit is what reports the game's node
 * KINDS to the host — retained there, so the IDE's boot `GET /api/flow`
 * carries them, the palette has its buttons and every node its ports.
 */
async function openComposition(page: Page): Promise<void> {
  await page.goto(host.gameUrl);
  await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });
  await page.goto(`${IDE_URL}#/doc/composition`);
}

/** The Flow document in front, its ten nodes drawn with ports. */
async function openFlow(page: Page): Promise<void> {
  await page.getByTestId('activity-flow').click();
  await expect(page.getByTestId('flow-screen')).toBeVisible();
  await expect(page.getByTestId('flow-node-draw')).toBeVisible();
  await expect(page.getByTestId('flow-port-draw-next')).toBeVisible({ timeout: 10_000 });
}

async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.locator(PREVIEW).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('preview iframe has no content frame');
  return frame;
}

/** The composition's preview, booted to `ready`. */
async function readyFrame(page: Page): Promise<Frame> {
  const frame = await gameFrame(page);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 20_000 })
    .toBe('ready');
  return frame;
}

const centre = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

test('the Flow document shows the ten nodes of flow.yml, with their ports', async ({ page }) => {
  await openComposition(page);
  await openFlow(page);
  for (const id of ['start', 'base', 'idle', 'mode', 'click', 'spin', 'draw', 'show_win', 'done', 'step']) {
    await expect(page.getByTestId(`flow-node-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('flow-canvas').locator('.react-flow__node')).toHaveCount(10);
  // Ports are the running game's own kinds, relayed by the host: `spin`
  // leaves by `result` or `failed`. Every node but `boot` takes an edge in,
  // `on` too — `draw → show_win → done → (true) idle` / `done → (false)
  // step → draw` is the loop, and React Flow draws no edge into a node
  // without a target handle (measured: two of the five edges missing,
  // error 008 in the console, when triggers had none). `boot` fires by
  // itself; an edge into it does nothing, so none can be drawn.
  await expect(page.getByTestId('flow-port-spin-result')).toBeVisible();
  await expect(page.getByTestId('flow-port-spin-failed')).toBeVisible();
  await expect(
    page.getByTestId('flow-node-start').locator('.react-flow__handle.target'),
  ).toHaveCount(0);
  for (const id of ['idle', 'draw']) {
    await expect(
      page.getByTestId(`flow-node-${id}`).locator('.react-flow__handle.target'),
    ).toHaveCount(1);
  }
  await expect(page.getByTestId('flow-canvas').locator('.react-flow__edge')).toHaveCount(11);
  await expect(page.getByTestId('flow-palette').getByTestId('flow-add-wait')).toBeVisible();
});

test('the palette adds wait-1 and a drag connects draw → wait-1, both landing in flow.yml', async ({
  page,
}) => {
  await openComposition(page);
  await openFlow(page);

  await page.getByTestId('flow-add-wait').click();
  const added = page.getByTestId('flow-node-wait-1');
  await expect(added).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => flowFile().nodes.map((n) => n.id)).toContain('wait-1');
  // Written, and loudly: a fresh `wait` has neither an event nor a delay yet.
  await expect(page.getByTestId('flow-diagnostics')).toContainText(
    "'wait' needs an 'event' or 'ms'",
  );

  // React Flow connects on pointer down over a source handle, a travel,
  // and pointer up over a target handle — `page.mouse` between the two
  // handles' boxes, in steps, is exactly that.
  const from = await page.getByTestId('flow-port-draw-next').boundingBox();
  const to = await added.locator('.react-flow__handle.target').boundingBox();
  if (!from || !to) throw new Error('a handle has no box');
  const a = centre(from);
  const b = centre(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(() => flowFile().edges, { timeout: 10_000 })
    .toContainEqual({ from: 'draw', out: 'next', to: 'wait-1' });
  // The eleven the fixture had are still there — the write appended.
  expect(flowFile().edges).toHaveLength(12);
  await expect(page.getByTestId('flow-canvas').locator('.react-flow__edge')).toHaveCount(12);
});

test('Delete on a selected node removes it and its edges from flow.yml', async ({ page }) => {
  await openComposition(page);
  await openFlow(page);

  // A click selects — the Properties on the right show the node —
  // and focuses the node, so the key reaches React Flow's document
  // listener rather than an input.
  await page.getByTestId('flow-node-draw').click();
  await expect(page.getByTestId('side-right-flow').getByTestId('prop-id')).toHaveValue('draw');
  await expect(page.getByTestId('side-right-flow').getByTestId('prop-kind')).toHaveText('present');
  await page.keyboard.press('Delete');

  await expect(page.getByTestId('flow-node-draw')).toHaveCount(0, { timeout: 10_000 });
  await expect
    .poll(() => flowFile().nodes.map((n) => n.id))
    .toEqual(['start', 'base', 'idle', 'mode', 'click', 'spin', 'show_win', 'done', 'step']);
  // `spin → draw`, `draw → show_win` and `step → draw` went with it — every
  // edge touching `draw`, on either end; `show_win → done` stayed (it
  // never touched `draw`), and so did the other seven, `done`'s own two
  // (`idle`/`step`) among them.
  expect(flowFile().edges).toEqual([
    { from: 'start', to: 'base' },
    { from: 'base', to: 'idle' },
    { from: 'idle', to: 'mode' },
    { from: 'mode', to: 'click' },
    { from: 'click', to: 'spin' },
    { from: 'show_win', to: 'done' },
    { from: 'done', to: 'idle', out: 'true' },
    { from: 'done', to: 'step', out: 'false' },
  ]);
  // Nothing selected any more: the Properties are gone.
  await expect(page.getByTestId('prop-id')).toHaveCount(0);
});

test('the Preview boots with base_game shown, spins through the flow, and the run paints the canvas', async ({
  page,
}) => {
  await openComposition(page);
  const frame = await readyFrame(page);

  // `boot → show base_game`: the scene is up before anyone spins. A poll,
  // since `#status` reads `ready` before the boot GET has answered.
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.scenesVisible()), { timeout: 10_000 })
    .toEqual(['base_game']);
  expect(await frame.evaluate(() => (window as any).__e8.spins().length)).toBe(0);

  // `ui.spin` in, the `present` node's exit out — the page has no loop of
  // its own any more: nothing in it posts a spin or executes a plan.
  const outcome = await frame.evaluate(() => (window as any).__e8.spin());
  expect(outcome).toEqual({ out: 'next' });
  expect(await frame.evaluate(() => (window as any).__e8.spins().length)).toBe(1);
  await expect(frame.locator('#status')).toHaveText('done');
  const trace = (await frame.evaluate(() => (window as any).__e8.flowTrace())) as {
    run: number;
    node: string;
    out: string | null;
  }[];
  const last = Math.max(...trace.map((e) => e.run));
  // `first-slot`'s math completes every round on its first response, so
  // `done` reads `roundComplete: true` and takes the `true` port straight
  // back to `on` — the `step` loop stays dormant, exactly as §1 promises.
  expect(trace.filter((e) => e.run === last).map((e) => `${e.node}:${e.out}`)).toEqual([
    'idle:null',
    'idle:next',
    'mode:null',
    'mode:next',
    'click:null',
    'click:next',
    'spin:null',
    'spin:result',
    'draw:null',
    'draw:next',
    'show_win:null',
    'show_win:next',
    'done:null',
    'done:true',
    'idle:null',
  ]);
  // Code lines only: the file's comments still tell the story of what left.
  const code = readFileSync(join(dir, 'src', 'main.ts'), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
    .join('\n');
  expect(code).not.toMatch(/api\/spin|\.execute\(|\.record\(/);

  // The same run, on the canvas: the trace reached the IDE while the Flow
  // document was not even open, so opening it now paints the latest run —
  // `spin`, `draw` and `done` ran, `idle` is where it rests, `start` was
  // run 1, and `step` never ran (the round completed on its first spin).
  await openFlow(page);
  await expect(page.getByTestId('flow-node-spin')).toHaveClass(/e8-flow-ran/, {
    timeout: 10_000,
  });
  await expect(page.getByTestId('flow-node-draw')).toHaveClass(/e8-flow-ran/);
  await expect(page.getByTestId('flow-node-done')).toHaveClass(/e8-flow-ran/);
  await expect(page.getByTestId('flow-node-idle')).toHaveClass(/e8-flow-active/);
  await expect(page.getByTestId('flow-node-start')).not.toHaveClass(/e8-flow-ran/);
  await expect(page.getByTestId('flow-node-step')).not.toHaveClass(/e8-flow-ran/);
});
