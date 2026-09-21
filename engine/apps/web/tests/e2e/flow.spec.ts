/**
 * The flow editor, proven in a real browser (flow editor spec, Task 10):
 * the Flow document draws `flow.yml`'s twenty-two nodes; the palette adds a
 * node, a drag between two handles adds an edge, `Delete` on a selected
 * node takes it and its edges out — each landing in the file; and the
 * Preview's game is DRIVEN by that document: `base_game` is on screen
 * from boot (the `show` node, then `reset` — the shell freed on every
 * re-arm), a spin goes `on shell.spin → busy → click → spin → present`
 * with no loop in `main.ts`, and the run paints the
 * canvas. `present` leaves through `show_win → win → bal → done` (`if
 * result.roundComplete`): `true` goes on to `ack → free → auto` (the
 * autoplay gate, `false` on a manual spin — the run ends there), `false`
 * hands off to `step`, which posts the open round and loops back to
 * `present` — dormant on `first-slot`'s math, where every round completes
 * on the first spin. A `failed` port (`spin`/`present`/`step`) goes to
 * `halt` (autoplay off) and on to the same `free`. Since slice 26 ("shell,
 * session, build") the Spin the flow hears is the SHELL's (`shell.spin`,
 * relayed by the `shell1` row); `__e8.spin()` presses it — see `main.ts`'s
 * `pressSpin`.
 *
 * Same fixture and readers as `scenes.spec.ts`: a private `projectCopy()`
 * served by `startDevHost`, the composition document's `Preview`
 * (`iframe[title="game preview"]`) and the game's own `window.__e8` —
 * here `spin()` (presses the shell's Spin, resolves `{ out }` from the
 * `present` node's exit), `spins()`, `flowTrace()` and `scenesVisible()`.
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

/** The Flow document in front, its twenty-two nodes drawn with ports. */
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

/** `flow.yml`'s node ids, in file order — `flowFile().nodes` after a delete is this list minus one. */
const NODE_IDS = [
  'start', 'base', 'reset', 'idle', 'autoin', 'busy', 'click', 'spin', 'draw', 'show_win', 'win',
  'bal', 'done', 'step', 'halt', 'ack', 'free', 'auto', 'tick', 'more', 'pause', 'again',
];

test('the Flow document shows the twenty-two nodes of flow.yml, with their ports', async ({
  page,
}) => {
  await openComposition(page);
  await openFlow(page);
  for (const id of NODE_IDS) {
    await expect(page.getByTestId(`flow-node-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('flow-canvas').locator('.react-flow__node')).toHaveCount(22);
  // Ports are the running game's own kinds, relayed by the host: `spin`
  // leaves by `result` or `failed`. Every node but `boot` takes an edge in,
  // `on` too — `more → (true) pause → again → (true) busy` is the autoplay
  // loop back into the chain, `done → (false) step → draw` the round's —
  // and React Flow
  // draws no edge into a node without a target handle (measured: two of
  // the five edges missing, error 008 in the console, when triggers had
  // none). `boot` fires by itself; an edge into it does nothing, so none
  // can be drawn.
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
  await expect(page.getByTestId('flow-canvas').locator('.react-flow__edge')).toHaveCount(26);
  await expect(page.getByTestId('flow-palette').getByTestId('flow-add-wait')).toBeVisible();
});

test('the palette adds wait-1 and a drag connects draw → wait-1, both landing in flow.yml', async ({
  page,
}) => {
  // The palette drops a new node at the CENTRE of the visible pane
  // (`screenToFlowPosition` of the canvas element's own box), not at a
  // fixed doc-space offset that grew with the existing node count — so
  // `wait-1` lands inside the canvas at Playwright's default 1280×720,
  // where the twenty-third node's old `80 + 40 × n` spot did not.
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
  // The twenty-six the fixture had are still there — the write appended.
  expect(flowFile().edges).toHaveLength(27);
  await expect(page.getByTestId('flow-canvas').locator('.react-flow__edge')).toHaveCount(27);
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
    .toEqual(NODE_IDS.filter((id) => id !== 'draw'));
  // `spin → draw`, `draw → show_win`, `draw → (failed) halt` and `step →
  // draw` went with it — every edge touching `draw`, on either end; the
  // other twenty-two stayed, in file order, `show_win → win` (it never
  // touched `draw`) and `done`'s own two (`ack`/`step`) among them.
  expect(flowFile().edges).toEqual([
    { from: 'start', to: 'base' },
    { from: 'base', to: 'reset' },
    { from: 'reset', to: 'idle' },
    { from: 'idle', to: 'busy' },
    { from: 'autoin', to: 'busy' },
    { from: 'busy', to: 'click' },
    { from: 'click', to: 'spin' },
    { from: 'spin', to: 'halt', out: 'failed' },
    { from: 'show_win', to: 'win' },
    { from: 'win', to: 'bal' },
    { from: 'bal', to: 'done' },
    { from: 'done', to: 'ack', out: 'true' },
    { from: 'done', to: 'step', out: 'false' },
    { from: 'step', to: 'halt', out: 'failed' },
    { from: 'halt', to: 'free' },
    { from: 'ack', to: 'free' },
    { from: 'free', to: 'auto' },
    { from: 'auto', to: 'tick', out: 'true' },
    { from: 'tick', to: 'more' },
    { from: 'more', to: 'pause', out: 'true' },
    { from: 'pause', to: 'again' },
    { from: 'again', to: 'busy', out: 'true' },
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

  // The shell's Spin in, the `present` node's exit out — the page has no
  // loop of its own any more: nothing in it posts a spin or executes a plan.
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
  // `done` reads `roundComplete: true` and takes the `true` port on to
  // `ack` and the shell's release — the `step` loop stays dormant, exactly
  // as §1 promises — and a manual spin ends at the autoplay gate (`auto`,
  // `false`: nobody started one).
  expect(trace.filter((e) => e.run === last).map((e) => `${e.node}:${e.out}`)).toEqual([
    'idle:null',
    'idle:next',
    'busy:null',
    'busy:next',
    'click:null',
    'click:next',
    'spin:null',
    'spin:result',
    'draw:null',
    'draw:next',
    'show_win:null',
    'show_win:next',
    'win:null',
    'win:next',
    'bal:null',
    'bal:next',
    'done:null',
    'done:true',
    'ack:null',
    'ack:next',
    'free:null',
    'free:next',
    'auto:null',
    'auto:false',
  ]);
  // Code lines only: the file's comments still tell the story of what left.
  const code = readFileSync(join(dir, 'src', 'main.ts'), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
    .join('\n');
  expect(code).not.toMatch(/api\/spin|\.execute\(|\.record\(/);

  // The same run, on the canvas: the trace reached the IDE while the Flow
  // document was not even open, so opening it now paints the latest run —
  // `spin`, `draw`, `done` and `free` ran, `auto` (the run's last entry) is
  // where it rests, `start` was run 1, and `step`/`tick` never ran (the
  // round completed on its first spin; nobody started an autoplay).
  await openFlow(page);
  await expect(page.getByTestId('flow-node-spin')).toHaveClass(/e8-flow-ran/, {
    timeout: 10_000,
  });
  await expect(page.getByTestId('flow-node-draw')).toHaveClass(/e8-flow-ran/);
  await expect(page.getByTestId('flow-node-done')).toHaveClass(/e8-flow-ran/);
  await expect(page.getByTestId('flow-node-free')).toHaveClass(/e8-flow-ran/);
  await expect(page.getByTestId('flow-node-auto')).toHaveClass(/e8-flow-active/);
  await expect(page.getByTestId('flow-node-start')).not.toHaveClass(/e8-flow-ran/);
  await expect(page.getByTestId('flow-node-step')).not.toHaveClass(/e8-flow-ran/);
  await expect(page.getByTestId('flow-node-tick')).not.toHaveClass(/e8-flow-ran/);
});
