/**
 * The contract holes closed this slice (slice 22), proven in a real
 * browser (Task 5) — the one place a premise about `spin`'s request, the
 * design→viewport fit, and the `shape`/mask node types can be checked
 * against what the game actually rendered rather than against `e8.yml`'s
 * text:
 *
 *  1. `flow.yml`'s `spin` node posts `betLevel` (a string prop, `Number()`
 *     converted by `run` — Task 2) and `present` records it as the spin
 *     log's `request` (Task 2's one-line addition to `kinds.ts`) —
 *     `__e8.spins()` (the durable log, not `flowTrace()`) carries it.
 *  2. `e8.patch.yml`'s `renderer1` row sizes the pixi `Application`
 *     directly (`config` -> `Application.init()`), and `scenes`' runtime
 *     `fit()`s the design into it at boot — `__e8.stageScale()` reads
 *     `scenes.container.scale.x` (Task 3).
 *  3. A `shape` node (`disc`) and `image`'s widened common props
 *     (`width`/`height`/`tint`, Task 3) land on the mounted view, off the
 *     same `nodeProps` this suite's `fx.spec.ts` already reads `.x`
 *     from — now widened to report them too. Alongside: a `container`
 *     masked by a `shape` child (`mask: true`, Task 3/4) with an `image`
 *     sibling, live in a real renderer — the one thing Task 3's own
 *     review flagged as "cannot verify" (a headless unit test builds the
 *     tree; nothing had pixi actually draw it) — asserting `view.mask` is
 *     actually SET (`nodeVisible` alone cannot tell "the mask took" from
 *     "the masking child never mounted" — a mount failure is caught per
 *     child, so the parent reads visible either way) and that the LIVE
 *     diagnostics service — not the frozen boot-time snapshot every other
 *     `__e8.diagnostics` read in this suite uses, which cannot see
 *     anything reported after boot-script evaluation — carries no `scenes`
 *     error once the mask is confirmed up.
 *
 * Same fixture and idioms as `fx.spec.ts`/`scenes.spec.ts`: a private
 * `projectCopy()`, its files edited BEFORE `startDevHost` (the running
 * host reads them once, at boot), the composition document's `Preview`
 * (`iframe[title="game preview"]`) and the game's own `window.__e8`.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump, load } from 'js-yaml';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = 'http://127.0.0.1:5680/';
const PREVIEW = 'iframe[title="game preview"]';

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

interface FlowDoc {
  version: number;
  nodes: { id: string; kind: string; props?: Record<string, unknown>; ui?: unknown }[];
  edges: { from: string; to: string }[];
}

interface PatchDoc {
  rows: { id: string; name?: string; config?: Record<string, unknown> }[];
}

test('a spin records its request — betLevel and action — in the durable spin log', async ({
  page,
}) => {
  // `spin`'s own props, not appended rows: the fixture's `flow.yml` already
  // has one `spin` node (see `project-fixture.ts`'s doc on why appending
  // rather than rewriting matters) — `betLevel` is a STRING prop (a
  // numeric literal or `$path`; `run` converts with `Number()`), so `'5'`
  // here becomes the number `5` in the recorded request.
  const flowFile = join(dir, 'flow.yml');
  const flow = load(readFileSync(flowFile, 'utf8')) as FlowDoc;
  const spinNode = flow.nodes.find((n) => n.id === 'spin')!;
  spinNode.props = { ...spinNode.props, betLevel: '5' };
  writeFileSync(flowFile, dump(flow, { noRefs: true }));
  host = await startDevHost(dir);

  await page.goto(`${IDE_URL}#/doc/composition`);
  const frame = await readyFrame(page);
  expect(await frame.evaluate(() => (window as any).__e8.spin())).toEqual({ out: 'next' });

  const spins = (await frame.evaluate(() => (window as any).__e8.spins())) as {
    request: Record<string, unknown>;
  }[];
  expect(spins.length).toBe(1);
  expect(spins[spins.length - 1].request).toEqual(
    expect.objectContaining({ betLevel: 5, action: 'spin' }),
  );
});

test('the stage scales the design into the renderer — `stageScale()` off `scenes.container`', async ({
  page,
}) => {
  // Design stays 480×288 (`scenes1`, untouched); only `renderer1` grows to
  // 960×576 — exactly double on both axes, so `contain` fit gives a clean
  // scale of 2 (960/480 = 576/288 = 2), not a number that needs rounding.
  const patchFile = join(dir, 'e8.patch.yml');
  const patch = load(readFileSync(patchFile, 'utf8')) as PatchDoc;
  const renderer = patch.rows.find((r) => r.id === 'renderer1')!;
  renderer.config = { ...renderer.config, width: 960, height: 576 };
  writeFileSync(patchFile, dump(patch, { noRefs: true }));
  host = await startDevHost(dir);

  await page.goto(`${IDE_URL}#/doc/composition`);
  const frame = await readyFrame(page);
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.stageScale()), { timeout: 10_000 })
    .toBe(2);

  // The design's own x (240, `scenes/base_game.scene.yml`'s `logo`) is
  // unaffected — the scale lives on the container, not on the node.
  expect(await frame.evaluate(() => (window as any).__e8.nodeProps('base_game', 'logo')?.x)).toBe(
    240,
  );
});

test('a shape node and widened common props render — plus a live mask, with no boot diagnostics', async ({
  page,
}) => {
  // Rewritten whole, not patched piecemeal (`fx.spec.ts`'s `TWEEN_FLOW`
  // does the same for `flow.yml`): every node the fixture already had
  // (`board`, `coin`, `big_win`) stays, `logo` gains `width`/`height`/
  // `tint`, and two new top-level nodes are added — `disc` (a plain
  // `shape`) and `clip`, a `container` whose `shape` child `hole` masks
  // it (`mask: true`) with an `image` sibling inside the clipped region.
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
    props: { src: assets/logo.png, x: 240, y: 40, anchor: 0.5, width: 100, height: 50, tint: '#ff0000' }
  - id: coin
    type: spritesheet
    props: { sheet: assets/coin.json, x: 40, y: 40, fps: 8, anchor: 0.5 }
  - id: big_win
    type: scene
    props: { scene: big_win, visible: false }
  - id: disc
    type: shape
    props: { kind: circle, radius: 20, fill: '#00ff00' }
  - id: clip
    type: container
    children:
      - id: hole
        type: shape
        props: { kind: rect, width: 40, height: 40, mask: true }
      - id: clip_img
        type: image
        props: { src: assets/coin.png }
`,
  );
  host = await startDevHost(dir);

  await page.goto(`${IDE_URL}#/doc/composition`);
  const frame = await readyFrame(page);

  // `width`/`height` on an `image` mounted before its texture loads settle
  // once the load lands (pixi's own `Sprite.texture` setter re-applies a
  // cached `_width`/`_height` against the new texture) — poll rather than
  // read once, the same reason `fx.spec.ts` polls `nodeProps(...).x`.
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.nodeProps('base_game', 'logo')), {
      timeout: 10_000,
    })
    .toEqual(expect.objectContaining({ width: 100, height: 50, tint: 0xff0000 }));

  expect(await frame.evaluate(() => (window as any).__e8.nodeVisible('base_game', 'disc'))).toBe(
    true,
  );

  // The mask smoke: `clip`'s view actually has a `mask` set (not just
  // "visible" — a `nodeVisible` reading of `true` proves nothing here,
  // since a masking CHILD that failed to mount would still leave `clip`
  // itself visible: `mountNode` catches per-child, so `nodeVisible`
  // cannot distinguish "the mask took" from "the child never mounted").
  // Polled: the child mounts asynchronously after `clip` itself does.
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.nodeMasked('base_game', 'clip')), {
      timeout: 10_000,
    })
    .toBe(true);

  // `diagnostics` (the frozen, boot-script-time snapshot) cannot see
  // anything `scenes` reports while mounting `clip`/`hole` after that
  // snapshot was taken — `liveDiagnostics()` re-reads the service now,
  // once the mask above is confirmed to have taken: pixi actually drew a
  // `Graphics` mask without the `scenes` row reporting a failure over it.
  const diagnostics = (await frame.evaluate(() => (window as any).__e8.liveDiagnostics())) as {
    severity: string;
    plugin: string;
  }[];
  expect(diagnostics.filter((d) => d.severity === 'error' && d.plugin === 'scenes')).toEqual([]);
});
