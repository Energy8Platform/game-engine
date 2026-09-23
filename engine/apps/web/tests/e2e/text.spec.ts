/**
 * `text` nodes, live props and a tap on the stage, proven in a real
 * browser (spec §9, Task 4 of the text-and-props slice):
 *
 *  1. The example's own `win` node (`scenes/base_game.scene.yml`) and its
 *     `show_win` flow node (`flow.yml`: `draw → show_win → win → bal → done`)
 *     — empty at boot, the last spin's `winAmount` as `$4.60` after one.
 *     `show_win` is a `count` node since the symbol-scenes slice, not the
 *     `prop` node this case was written against: `target: base_game/win`,
 *     `to: '$result.winAmount'`, `ms: 400`, `format: currency` — so the
 *     text is RUN UP to the amount over 400 ms instead of being written
 *     once. The assertion is unchanged and still exact, which is the point
 *     of it: a count writes an eased value each frame and then the exact
 *     end value last, so what the player is left looking at is the credited
 *     amount to the cent, formatted by the same `currency` (which reads
 *     `$session.currency` off the dev host: `{ symbol: '$', decimals: 2,
 *     position: 'left' }`) the old template piped through.
 *  2. `ui.tap` reaching a flow: a `wait { event: ui.tap }` node holds until
 *     a click on the preview canvas, then a `prop` node with a LITERAL
 *     value sets the same `win` node's text.
 *  3. A scene document's own `text` node mounts with a real `width` — the
 *     `nodeProps`/`nodeText` pair, off one extra node in a scene copy.
 *  4. An `emit { wait: true }` holds its branch while an `on { busy:
 *     parallel }` run it started is live: the parallel branch's `prop`
 *     (`'x{$event.n * 2}'` — a template with arithmetic over the event's
 *     payload) lands on the `win` text BEFORE the main branch's (`'after
 *     {$n}'` — the main run has no `$n`, so the template renders `''`
 *     there), and the trace says so in the same order.
 *
 * Same fixture and idioms as `fx.spec.ts`/`contract.spec.ts`: a private
 * `projectCopy()`, its `flow.yml`/`scenes/base_game.scene.yml` rewritten
 * BEFORE `startDevHost` for cases 2/3 (the running host reads them once,
 * at boot; case 4 edits `flow.yml` through the host instead, once the
 * game is up), the composition document's `Preview`
 * (`iframe[title="game preview"]`) and the game's own `window.__e8` — here
 * `nodeText(scene, node)` (Task 4's own hook), `spin()`, `spins()` and
 * `flowTrace()`.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;
const PREVIEW = 'iframe[title="game preview"]';

/**
 * `start(boot) → base(show base_game) → hold(wait ui.tap) → mark(prop
 * base_game/win.text = 'tapped')` — same one-node-per-line style as the
 * example's own `flow.yml` and `fx.spec.ts`'s `TWEEN_FLOW`. `mark`'s
 * `value` is a LITERAL ('tapped', already a string) and the node is a
 * `prop`, not the `count` the example's own `show_win` is — this flow
 * proves the tap reaches the flow at all, not the
 * expression-into-a-text-node path case 1 already covers through the real
 * example.
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

/**
 * Case 4's flow. `beat` emits `pd.round` with `wait: true` and `hear`
 * (`busy: parallel`) answers it while the boot run is still live, so the
 * main branch sits in `beat` until `hear → pause → inner` has ended;
 * `pause` (300 ms) keeps that hold long enough to be a real one. `inner`
 * sees the event (`$event.n`), `after` does not (`$n` is unset in the main
 * run, and a missing var renders `''` in a template). Unlike `TAP_FLOW`,
 * this one reaches the game as a LIVE edit, after boot — see the test for
 * why.
 */
const PARALLEL_FLOW = `version: 1
nodes:
  - { id: start, kind: boot, ui: { x: 40,  y: 80 } }
  - { id: base,  kind: show, props: { scene: base_game }, ui: { x: 220, y: 80 } }
  - { id: beat,  kind: emit, props: { event: pd.round, payload: { n: 3 }, wait: true }, ui: { x: 400, y: 80 } }
  - { id: after, kind: prop, props: { target: base_game/win, prop: text, value: 'after {$n}' }, ui: { x: 580, y: 80 } }
  - { id: hear,  kind: on,   props: { event: pd.round, busy: parallel }, ui: { x: 400, y: 240 } }
  - { id: pause, kind: wait, props: { ms: 300 }, ui: { x: 580, y: 240 } }
  - { id: inner, kind: prop, props: { target: base_game/win, prop: text, value: 'x{$event.n * 2}' }, ui: { x: 760, y: 240 } }
edges:
  - { from: start, to: base }
  - { from: base,  to: beat }
  - { from: beat,  to: after }
  - { from: hear,  to: pause }
  - { from: pause, to: inner }
`;

/** What case 4's in-page observer records: a trace entry and the `win` text the instant it landed. */
type Seen = { node: string; out: string | null; text: string | null };

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
    result: { winAmount: number };
  }[];
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.nodeText('base_game', 'win')), {
      timeout: 10_000,
    })
    .toBe(`$${spins.at(-1)!.result.winAmount.toFixed(2)}`);
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

  // Same boot-GET race `readyFrame` never waits out (case 1's own poll,
  // above): `#status` reads `ready` before `scenes.ready` (the boot GET)
  // has necessarily answered, so `hello` may not be mounted yet.
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.nodeText('base_game', 'hello')), {
      timeout: 10_000,
    })
    .toBe('hello');
  await expect
    .poll(
      () =>
        frame.evaluate(
          () => (window as any).__e8.nodeProps('base_game', 'hello')?.width as number | undefined,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
});

test('an emit with wait holds the main branch until a parallel on-branch ends; templates and arithmetic reach a text node', async ({
  page,
  request,
}) => {
  host = await startDevHost(dir);

  await page.goto(`${IDE_URL}#/doc/composition`);
  const frame = await readyFrame(page);

  // `inner`'s write and `after`'s are one macrotask apart from nothing:
  // `inner` sets the text, its run settles, `beat`'s awaited `emit`
  // resolves and `after` sets the text again — microtasks end to end
  // (`setProps` is synchronous), so no `frame.evaluate` can land between
  // them and a poll on `nodeText` only ever reads `after `. The observer
  // has to be IN the page, and in place before the sequence starts: it
  // wraps the interpreter's live trace array (`flowTrace()` answers the
  // array itself, not a copy; a `replace` empties it in place) and records
  // what the `win` text reads the instant each trace entry lands —
  // `inner:next` right after `inner`'s own write, before `after` enters.
  // Hence the order here: the example's own flow boots the game and parks
  // at `idle`, the observer goes in, and only THEN does case 4's flow
  // reach the game — as a live edit through the host (a disk write is not
  // watched), whose new shape stops the old run, re-arms and fires `boot`
  // again. Trapped at the page's own `window.__e8 = …` instead (an init
  // script's setter), it lost the race: `createGame` — the top-level
  // `await` above that assignment — is already running the flow, and on a
  // cold vite cache the boot run was past `inner` before the harness
  // existed (measured: one run in two).
  await frame.evaluate(() => {
    const e8 = (window as any).__e8;
    const seen: Seen[] = [];
    (window as any).__e8seen = seen;
    const trace = e8.flowTrace() as { node: string; out: string | null }[];
    trace.push = function (this: unknown[], ...entries) {
      for (const e of entries)
        seen.push({ node: e.node, out: e.out, text: e8.nodeText('base_game', 'win') });
      return Array.prototype.push.apply(this, entries);
    };
  });

  // The game's `ide-bridge` must be on `/ide` before the edit is broadcast
  // (a socket that connects later is not replayed). It has spoken once the
  // host's `GET /api/flow` lists a kind only a game registers — `tween`,
  // `flow-fx`'s, never a built-in — which the bridge sends on open.
  const gameKinds = async () => {
    const body = (await (await request.get(`${host.url}/api/flow`)).json()) as {
      kinds: { kind: string }[];
    };
    return body.kinds.map((k) => k.kind);
  };
  await expect.poll(gameKinds, { timeout: 10_000 }).toContain('tween');

  const put = await request.put(`${host.url}/api/files/flow.yml`, {
    data: { base64: Buffer.from(PARALLEL_FLOW).toString('base64') },
  });
  expect(put.ok()).toBe(true);

  // The parallel branch's write first: the instant `inner` left, the text
  // read `x6` — `inner` ran, and `{$event.n * 2}` computed over the
  // emitted payload.
  const seenAt = (node: string, out: string | null) =>
    frame.evaluate(
      ([n, o]) =>
        ((window as any).__e8seen as Seen[]).find((e) => e.node === n && e.out === o)?.text ?? null,
      [node, out] as const,
    );
  await expect.poll(() => seenAt('inner', 'next'), { timeout: 10_000 }).toBe('x6');
  // Then the main branch's: `beat` (wait: true) let go only once the
  // parallel run had ended, and `$n` is not a var of the main run.
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.nodeText('base_game', 'win')), {
      timeout: 10_000,
    })
    .toBe('after ');

  // The same order in the trace: `inner` LEFT (`next`) before `after` was
  // ENTERED (`null`) — the hold, as the interpreter itself recorded it.
  const trace = (await frame.evaluate(() => (window as any).__e8.flowTrace())) as {
    node: string;
    out: string | null;
  }[];
  const innerLeft = trace.findIndex((e) => e.node === 'inner' && e.out === 'next');
  const afterEntered = trace.findIndex((e) => e.node === 'after' && e.out === null);
  expect(innerLeft).toBeGreaterThanOrEqual(0);
  expect(afterEntered).toBeGreaterThan(innerLeft);
});
