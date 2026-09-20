/**
 * Responsive layout, proven in a real browser (slice 27, spec §9's e2e):
 * `first-slot` fills the window, its `win` readout stays pinned above
 * the shell's bar, turned to portrait its `logo` rises and its `coin`
 * hides, and the scene editor writes portrait edits into `portrait.nodes`
 * and a pinned node's drag as an OFFSET.
 *
 * Readers: the game page's `window.__e8` (`stageScale`, `fit` — the safe
 * rect in design units — `orientation`, `nodeProps`, `nodeVisible`), as
 * `game-shell.spec.ts` reads it, and the editor page's `window.__e8edit`
 * (`snapshot`, `fit`, `orientation`), as `canvas.spec.ts` reads it. What
 * lands in the file arrives asynchronously (an event → the IDE's `PUT
 * /api/scenes/<id>` → disk), so every file claim is a poll.
 *
 * Numbers, measured 2026-09-20 on the checked-in fixture (Playwright's
 * Chromium): at 1280×720 the shell's bar leaves a 1280×628 safe rect, the
 * 480×288 design fits it at 2.1806, height-limited, and the safe rect in
 * design units is −53.5..533.5 × 0..288 — so `win` (`pin: bottom, y:
 * −24`) reads y 264, the design's own bottom minus 24. At 800×600 the
 * fit is WIDTH-limited (1.6667) and the rect 0..480 × −10.9..298.9: the
 * safe rect's bottom is past the design's, and `win` reads 274.9 — the
 * reading a design-box pin could not give, which is why the second size
 * is not another 16:9. At 390×844 the rect is portrait, the 288×480
 * portrait design fits it at 1.3542, width-limited: 0..288 × −23.3..503.3;
 * `logo` (`pin: top, y: 40`) reads y 16.7 against its landscape 40, and
 * the board (`pin: top, x: −112, y: 115, scale: 0.55`) sits at (32, 91.7)
 * — its grid, 277×165, from x 5.6 to 282.8 and from y 65.3 down, 16.6
 * under the logo's bottom edge (48.7).
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Frame, type Locator, type Page } from '@playwright/test';
import { load } from 'js-yaml';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = 'http://127.0.0.1:5680/';
const CANVAS = 'iframe[title="scene canvas"]';

interface Fit {
  scale: number;
  x: number;
  y: number;
  viewport: { left: number; top: number; right: number; bottom: number };
}
interface Props {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface SceneDoc {
  nodes: { id: string; props: Record<string, unknown> }[];
  portrait?: { nodes: Record<string, Record<string, unknown>> };
}

let dir: string;
let host: DevHost;

test.afterEach(async () => {
  if (host) await host.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** The game page at `ready`, hooks installed and `base_game` shown (the boot GET) — `game-shell.spec.ts`'s `readyPage` plus the scene. */
async function readyGame(page: Page): Promise<void> {
  await page.goto(host.gameUrl);
  await expect.poll(() => page.locator('#status').textContent(), { timeout: 20_000 }).toBe('ready');
  await expect
    .poll(() => page.evaluate(() => (window as any).__e8?.scenesVisible() ?? []), {
      timeout: 20_000,
    })
    .toContain('base_game');
}

/** One read of everything the two game-page cases compare, after a `resize` has settled (the fit follows the canvas, which follows the window — a `ResizeObserver` away). */
async function layout(page: Page, expectScale: (scale: number) => boolean) {
  await expect
    .poll(
      () =>
        page
          .evaluate((): number | null => (window as any).__e8.stageScale())
          .then((s) => s !== null && expectScale(s)),
      { timeout: 10_000 },
    )
    .toBe(true);
  return page.evaluate(() => {
    const e = (window as any).__e8;
    return {
      scale: e.stageScale() as number,
      fit: e.fit() as Fit,
      orientation: e.orientation() as string,
      win: e.nodeProps('base_game', 'win') as Props,
      logo: e.nodeProps('base_game', 'logo') as Props,
      board: e.nodeProps('base_game', 'board') as Props,
      coin: e.nodeVisible('base_game', 'coin') as boolean,
    };
  });
}

test('the canvas follows the window; `win` stays pinned to the safe rect’s bottom at either size', async ({
  page,
}) => {
  dir = projectCopy();
  host = await startDevHost(dir);
  await readyGame(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  const wide = await layout(page, (s) => s > 2);
  // The canvas IS the window: `#mount` is `position: fixed; inset: 0` and
  // `renderer1` names no size (slice 27's `e8.patch.yml`).
  expect(await page.locator('#mount canvas').boundingBox()).toMatchObject({
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  });
  expect(wide.orientation).toBe('landscape');

  // 4:3, not another 16:9: a 16:9 window fits the 16:9 design
  // height-limited, and the safe rect's bottom is then the design's own
  // (288) — a `win` pinned to the DESIGN's bottom would read the same
  // 264. Width-limited, the safe rect runs past the design (bottom ≈
  // 298.9) and only a pin to the SAFE rect follows it.
  await page.setViewportSize({ width: 800, height: 600 });
  const tall = await layout(page, (s) => s < 1.8);
  expect(await page.locator('#mount canvas').boundingBox()).toMatchObject({
    width: 800,
    height: 600,
  });
  expect(tall.scale).not.toBe(wide.scale);
  expect(tall.fit.viewport.bottom).toBeGreaterThan(288);

  // `win` is `pin: bottom, x: 0, y: -24, anchor: 0.5`: its centre sits on
  // the safe rect's bottom edge — the viewport's bottom minus the shell's
  // bar — 24 design px up, at either size, so its y DIFFERS between the
  // two; and on that edge's CENTRE, which is not the design's centre when
  // the rect is wider than it.
  expect(tall.win.y).not.toBe(wide.win.y);
  for (const { win, fit } of [wide, tall]) {
    expect(Math.abs(win.y - (fit.viewport.bottom - 24))).toBeLessThan(0.5);
    expect(Math.abs(win.x - (fit.viewport.left + fit.viewport.right) / 2)).toBeLessThan(0.5);
  }
});

test('turned to portrait the board and the logo pin to the top, the coin hides, a spin still plays; back to landscape restores', async ({
  page,
}) => {
  dir = projectCopy();
  host = await startDevHost(dir);
  await readyGame(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  const wide = await layout(page, (s) => s > 2);
  expect(wide.orientation).toBe('landscape');
  expect(wide.coin).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const tall = await layout(page, (s) => s < 1.5);
  expect(tall.orientation).toBe('portrait');
  // `portrait.nodes.logo` is `{ pin: top, x: 0, y: 40 }`: the logo hangs
  // 40 design px under the safe rect's top edge (negative here — the
  // 288×480 portrait design is letterboxed in a 390×702 rect), on the
  // 288-wide design's centre line.
  expect(Math.abs(tall.logo.y - (tall.fit.viewport.top + 40))).toBeLessThan(0.5);
  expect(Math.abs(tall.logo.x - 144)).toBeLessThan(0.5);
  expect(tall.coin).toBe(false);

  // `portrait.nodes.board` is `{ pin: top, x: -112, y: 115, scale: 0.55 }`
  // — common props only, so the reels node takes the common pass and is
  // not remounted. The reels view's ORIGIN is reel 0's column centre and
  // row 0's centre (local bounds −48..456 × −48..252 at cell 96, gap 6),
  // so the grid's edges are `48·scale` and `456·scale`/`252·scale` off
  // the view's position — never `width/2`. What the numbers were chosen
  // for: the grid's top at least 16 design px under the logo's bottom
  // edge, the whole grid inside the 288-wide design, `win` under it.
  const cell = 48 * 0.55;
  expect(tall.board.y).not.toBe(wide.board.y);
  expect(tall.board.y - cell).toBeGreaterThanOrEqual(tall.logo.y + tall.logo.height / 2 + 16);
  expect(tall.board.x - cell).toBeGreaterThanOrEqual(0);
  expect(tall.board.x + 456 * 0.55).toBeLessThanOrEqual(288);
  expect(tall.win.y).toBeGreaterThan(tall.board.y + 252 * 0.55);

  // The board still PLAYS after the flip: a spin presents on the same
  // reels (the shell's Spin, the `present` node's exit, the grid read back).
  expect(await page.evaluate(() => (window as any).__e8.spin())).toEqual({ out: 'next' });
  const symbols = (await page.evaluate(() => (window as any).__e8.symbols())) as string[][];
  expect(symbols).toHaveLength(5);
  expect(symbols.flat()).toHaveLength(15);
  expect(symbols.flat().every((s) => typeof s === 'string')).toBe(true);

  await page.setViewportSize({ width: 1280, height: 720 });
  const back = await layout(page, (s) => s > 2);
  expect(back.orientation).toBe('landscape');
  expect(back.coin).toBe(true);
  expect(back.logo).toEqual(wide.logo);
  expect(back.board).toEqual(wide.board);
});

// ---- the scene editor (`canvas.spec.ts`'s readers and gestures) ----

const sceneFile = () => readFileSync(join(dir, 'scenes', 'base_game.scene.yml'), 'utf8');
const sceneDoc = () => load(sceneFile()) as SceneDoc;
const nodeProps = (doc: SceneDoc, id: string) => doc.nodes.find((n) => n.id === id)?.props;

async function openSceneTab(page: Page): Promise<void> {
  await page.goto(`${IDE_URL}#/doc/composition`);
  await page.getByTestId('activity-scenes').click();
  await expect(page.getByTestId('scene-base_game')).toBeVisible();
  await page.getByTestId('scene-base_game').dblclick();
  await expect(page.getByTestId('scene-doc-base_game')).toBeVisible();
}

async function frameOf(page: Page, selector: string): Promise<Frame> {
  const handle = await page.locator(selector).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`${selector} has no content frame`);
  return frame;
}

/** The `safeBottom` the IDE put in the canvas iframe's URL — its own number for the preset just picked. */
async function safeBottomOf(page: Page): Promise<number> {
  const src = (await page.locator(CANVAS).getAttribute('src')) ?? '';
  const m = /safeBottom=(\d+)/.exec(src);
  if (!m) throw new Error(`no safeBottom in the canvas src: ${src}`);
  return Number(m[1]);
}

/**
 * The canvas iframe's frame once the document for `safeBottom` is the one
 * that is up and has emitted `ready`. A preset change is a new `src`
 * (`SceneDocument`), so the page RELOADS: the old document keeps
 * answering until it is gone, and `location.search` is what tells the
 * new one apart.
 */
async function readyCanvas(page: Page, safeBottom: number): Promise<Frame> {
  await expect(page.locator(CANVAS)).toHaveAttribute(
    'src',
    new RegExp(`safeBottom=${safeBottom}(?!\\d)`),
  );
  const frame = await frameOf(page, CANVAS);
  await expect
    .poll(
      () =>
        frame
          .evaluate(
            () =>
              location.search +
              ((window as any).__e8edit
                ?.emitted()
                .some((e: { event: string }) => e.event === 'ready')
                ? ' ready'
                : ''),
          )
          .catch(() => ''),
      { timeout: 30_000 },
    )
    .toMatch(new RegExp(`safeBottom=${safeBottom}(?!\\d).* ready$`));
  return frame;
}

/**
 * Design → screen for the canvas iframe: the page's own fit (the design
 * scaled and offset inside the iframe — 1:1 under `design`, letterboxed
 * under a preset) and then the IDE's CSS zoom, from the iframe's box
 * against its intrinsic width — `canvas.spec.ts`'s `mapper` with the fit
 * in front.
 */
async function mapper(iframe: Locator, frame: Frame) {
  const box = await iframe.boundingBox();
  const width = Number(await iframe.getAttribute('width'));
  if (!box || !width) throw new Error('canvas iframe has no box');
  const fit = (await frame.evaluate(() => (window as any).__e8edit.fit())) as Fit;
  const zoom = box.width / width;
  return (x: number, y: number) => ({
    x: box.x + (fit.x + x * fit.scale) * zoom,
    y: box.y + (fit.y + y * fit.scale) * zoom,
  });
}

/** Press at `from`, travel to `to` in steps (past the gizmo's 3 px slop), release. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

const centreOf = async (frame: Frame, node: string) => {
  const b = (await frame.evaluate(() => (window as any).__e8edit.snapshot().bounds))[node] as {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
};

test('portrait edits land in portrait.nodes, design edits in the node; a pinned drag writes the offset', async ({
  page,
}) => {
  dir = projectCopy();
  // `win` is an empty text — no bounds, nothing for the gizmo's body to
  // catch. Given a word so case (4) can drag it; nothing else changes.
  const file = join(dir, 'scenes', 'base_game.scene.yml');
  writeFileSync(file, readFileSync(file, 'utf8').replace("text: ''", 'text: WIN'));
  host = await startDevHost(dir);
  const logoBefore = nodeProps(sceneDoc(), 'logo');
  expect(logoBefore).toEqual({ src: 'assets/logo.png', x: 240, y: 40, anchor: 0.5 });

  await openSceneTab(page);
  await readyCanvas(page, 0);

  // (3a) The phone portrait preset: the canvas is 390×844 with the mobile
  // bar's band (whatever `safeBottom` the IDE put in the URL — the
  // preset's own number, read back rather than assumed), the scenes fit
  // the portrait design, and the page says so.
  await page.getByTestId('canvas-viewport').selectOption('phone-portrait');
  await expect(page.locator(CANVAS)).toHaveAttribute('width', '390');
  let frame = await readyCanvas(page, await safeBottomOf(page));
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8edit.orientation()))
    .toBe('portrait');
  let at = await mapper(page.locator(CANVAS), frame);
  const logo = await centreOf(frame, 'logo');
  await page.mouse.click(at(logo.x, logo.y).x, at(logo.x, logo.y).y);
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8edit.snapshot().selected), {
      timeout: 10_000,
    })
    .toBe('logo');
  await drag(page, at(logo.x, logo.y), at(logo.x + 40, logo.y + 20));
  // The override changed — and holds its pin: the drag wrote OFFSETS from
  // the top pin's point (40 right of the centre, 60 under the edge).
  await expect
    .poll(() => JSON.stringify(sceneDoc().portrait?.nodes.logo), { timeout: 10_000 })
    .not.toBe(JSON.stringify({ pin: 'top', x: 0, y: 40 }));
  const override = sceneDoc().portrait!.nodes.logo;
  expect(override.pin).toBe('top');
  expect(override.x as number).toBeCloseTo(40, 0);
  expect(override.y as number).toBeCloseTo(60, 0);
  expect(nodeProps(sceneDoc(), 'logo'), 'the node itself is untouched').toEqual(logoBefore);
  await expect(page.getByTestId('canvas-tree').getByTestId('node-logo')).toContainText('◐');

  // (3b) Back to the design box: the same drag goes to the node's own
  // props, and the override stays as it was written.
  await page.getByTestId('canvas-viewport').selectOption('design');
  await expect(page.locator(CANVAS)).toHaveAttribute('width', '480');
  frame = await readyCanvas(page, await safeBottomOf(page));
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8edit.orientation()))
    .toBe('landscape');
  at = await mapper(page.locator(CANVAS), frame);
  await page.mouse.click(at(240, 40).x, at(240, 40).y);
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8edit.snapshot().selected), {
      timeout: 10_000,
    })
    .toBe('logo');
  await drag(page, at(240, 40), at(280, 40));
  await expect.poll(() => nodeProps(sceneDoc(), 'logo')?.x, { timeout: 10_000 }).toBe(280);
  expect(nodeProps(sceneDoc(), 'logo')).toEqual({ ...logoBefore, x: 280 });
  expect(sceneDoc().portrait!.nodes.logo).toEqual(override);

  // (4) `win` is `pin: bottom, x: 0, y: -24`: under `design` its centre is
  // at (240, 264). Dragged 20 right and 14 up, the file reads the OFFSET
  // from the bottom pin's point (240, 288) — (20, −38) — not the absolute
  // (260, 250) the gizmo moved the view to.
  await page.getByTestId('canvas-tree').getByTestId('node-win').click();
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8edit.snapshot().selected), {
      timeout: 10_000,
    })
    .toBe('win');
  const win = await centreOf(frame, 'win');
  expect(win.x).toBeCloseTo(240, 0);
  expect(win.y).toBeCloseTo(264, 0);
  await drag(page, at(win.x, win.y), at(win.x + 20, win.y - 14));
  await expect.poll(() => nodeProps(sceneDoc(), 'win')?.x, { timeout: 10_000 }).not.toBe(0);
  const after = nodeProps(sceneDoc(), 'win')!;
  expect(after.pin).toBe('bottom');
  expect(Math.abs(after.x as number)).toBeLessThan(100);
  expect(after.y as number).toBeLessThan(0);
  expect(after.x as number).toBeCloseTo(20, 0);
  expect(after.y as number).toBeCloseTo(-38, 0);
});
