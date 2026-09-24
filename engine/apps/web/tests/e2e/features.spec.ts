/**
 * Slice 36's browser proof: all nine data-driven feature steps of the
 * `features1` row (`@energy8engine/reels-features`, composed in `e8-base`)
 * play from a mechanic's plan, and the board ends where their data says.
 *
 * The mechanic is a fixture this spec writes into its own project copy —
 * `plugins/feature-probe/`, shaped like `first-slot`'s `plugins/reel-step`
 * (a project plugin: `e8.runtime.requires: ["mechanics"]`, a mechanic
 * registered through `ctx.inject(['mechanics'])`) — and binds `base_game`
 * to. It ignores the spin's data: its FIRST `present` lands `BOARD` and
 * then runs `FEATURES`, one step of each kind; its THIRD lands `BOARD`, a
 * fresh `giant`, then a `giant { clear: true }` in the same plan (I1: the
 * explicit clear); every other spin only lands `BOARD` again. A feature
 * never reads the math (spec §0), so fixed data is exactly what a real
 * mechanic would hand it.
 *
 * `FEATURES` is ordered so each step's data is valid on the board the
 * earlier ones leave, and so every kind that changes a symbol leaves at
 * least one cell no other step touches afterwards (`nudge`'s (4,0),
 * `walkWild`'s emptied trail, …) — `AFTER`, written out by hand below, is
 * what they imply together. `multipliers` keeps every symbol and adds a
 * `multiplier` to the cell's data (as `dropWilds` does with its own), which
 * `symbols()` cannot see: `MULTIPLIERS` is that half of the board, read
 * through `__e8.cellMultiplier()`. `sticky` changes no cell: its proof is the
 * overlay count read through `__e8.featureOverlays()`.
 *
 * Talks to the game on its own URL (`host.gameUrl`), like `tempo.spec.ts`:
 * nothing here needs the IDE's chrome.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump, load } from 'js-yaml';
import { expect, test } from '@playwright/test';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

/** The board both spins land on, `[col][row]` — symbols `1`..`5`, all `first-slot` image art (no orb `6`: its scene wants a band). */
const BOARD = [
  [1, 2, 3],
  [2, 3, 4],
  [3, 4, 1],
  [4, 1, 2],
  [1, 2, 3],
];

/** One step of each kind, in play order; the trailing comment is the board change. */
const FEATURES = [
  // col 4 → 5 1 2 (the reel slid down one row, a 5 entered at the top)
  { kind: 'nudge', reel: 4, by: 1, settled: [5, 1, 2] },
  // col 0 → 5 5 5
  { kind: 'expandWild', reel: 0, symbol: 5 },
  // (1,0) and (1,1) emptied, (2,1) → 5
  {
    kind: 'walkWild',
    path: [
      { col: 1, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ],
    symbol: 5,
  },
  // (3,0) → 5, carrying multiplier 2
  { kind: 'dropWilds', cells: [{ col: 3, row: 0 }], symbol: 5, multiplier: 2 },
  // (2,0), (2,2) → 4
  {
    kind: 'reveal',
    cells: [
      { col: 2, row: 0 },
      { col: 2, row: 2 },
    ],
    symbol: 4,
  },
  // (1,2) → 1
  { kind: 'transform', cells: [{ col: 1, row: 2 }], to: 1 },
  // symbols kept; (0,1) and (4,0) carry multiplier 3 and 4 — not (3,0): its 2 is dropWilds'
  {
    kind: 'multipliers',
    cells: [
      { col: 0, row: 1, value: 3 },
      { col: 4, row: 0, value: 4 },
    ],
    total: 12,
  },
  // symbols kept; two persistent rings
  {
    kind: 'sticky',
    cells: [
      { col: 0, row: 0 },
      { col: 0, row: 2 },
    ],
    on: true,
  },
  // (3,1) (3,2) (4,1) (4,2) → 2, under one giant view
  { kind: 'giant', col: 3, row: 1, width: 2, height: 2, symbol: 2 },
];

/** `BOARD` after `FEATURES`, as `__e8.symbols()` reads it — worked out by hand from the comments above. */
const AFTER = [
  ['5', '5', '5'],
  [null, null, '1'],
  ['4', '5', '4'],
  ['5', '2', '2'],
  ['5', '2', '2'],
];

/** Each cell's `multiplier` after `FEATURES`, `[col][row]`: `dropWilds`' 2 and `multipliers`' 3 and 4; `null` everywhere else. */
const MULTIPLIERS = [
  [null, 3, null],
  [null, null, null],
  [null, null, null],
  [2, null, null],
  [4, null, null],
];

/** The fixture plugin's entry: fixed plans, a module-level spin counter. */
const PROBE_SOURCE = `/** features.spec.ts's fixture mechanic — see that file's header. */
const BOARD = ${JSON.stringify(BOARD)};
const FEATURES = ${JSON.stringify(FEATURES)};
let spins = 0;

export const name = 'feature-probe';

export function apply(ctx: any): void {
  ctx.inject(['mechanics'], (c: any) => {
    c.effect(
      () =>
        c.mechanics.register({
          id: 'feature-probe',
          requires: { fields: {} },
          present: () => {
            const spin = spins++;
            if (spin === 0) return [{ kind: 'spinTo', board: BOARD }, ...FEATURES];
            // spin 3: a fresh giant, then an explicit \`clear: true\` in the same plan
            if (spin === 2)
              return [
                { kind: 'spinTo', board: BOARD },
                { kind: 'giant', col: 3, row: 1, width: 2, height: 2, symbol: 2 },
                { kind: 'giant', clear: true },
              ];
            return [{ kind: 'spinTo', board: BOARD }];
          },
        }),
      'feature-probe:mechanic',
    );
  });
}
`;

interface PatchRow {
  id: string;
  name?: string;
  config?: { stages?: Record<string, string> };
}

/** Writes `plugins/feature-probe/` into the copy and binds `base_game` to it in `e8.patch.yml`. */
function probeFixture(dir: string): void {
  const plugin = join(dir, 'plugins', 'feature-probe');
  mkdirSync(join(plugin, 'src'), { recursive: true });
  writeFileSync(
    join(plugin, 'package.json'),
    JSON.stringify(
      {
        name: 'feature-probe',
        version: '0.0.0',
        private: true,
        type: 'module',
        main: 'src/index.ts',
        e8: { runtime: { entry: './src/index.ts', requires: ['mechanics'] }, hot: false },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(plugin, 'src', 'index.ts'), PROBE_SOURCE);

  const patchFile = join(dir, 'e8.patch.yml');
  const patch = load(readFileSync(patchFile, 'utf8')) as { rows: PatchRow[] };
  const mechanics = patch.rows.find((r) => r.id === 'mechanics1')!;
  mechanics.config = {
    ...mechanics.config,
    stages: { ...mechanics.config?.stages, base_game: 'feature-probe' },
  };
  patch.rows.push({ id: 'probe1', name: 'feature-probe', config: {} });
  writeFileSync(patchFile, dump(patch, { noRefs: true }));
}

let dir: string;
let host: DevHost;

test.afterEach(async () => {
  if (host) await host.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('all nine feature steps play from a mechanic’s plan: the board, a sticky ring past the next spin, the giant gone', async ({
  page,
}) => {
  dir = projectCopy();
  probeFixture(dir);
  host = await startDevHost(dir);

  await page.goto(host.gameUrl);
  await expect.poll(() => page.locator('#status').textContent(), { timeout: 20_000 }).toBe('ready');
  expect(await page.evaluate(() => (window as any).__e8.bound('base_game'))).toBe('feature-probe');

  const spin = () => page.evaluate(() => (window as any).__e8.spin());
  const symbols = () => page.evaluate(() => (window as any).__e8.symbols());
  const overlays = () => page.evaluate(() => (window as any).__e8.featureOverlays());
  const multipliers = () =>
    page.evaluate(() =>
      [0, 1, 2, 3, 4].map((col) =>
        [0, 1, 2].map((row) => (window as any).__e8.cellMultiplier(col, row)),
      ),
    );
  const errors = () =>
    page.evaluate(() =>
      ((window as any).__e8.liveDiagnostics() as { severity: string; message: string }[])
        .filter((d) => d.severity === 'error')
        .map((d) => d.message),
    );

  // ── spin 1: BOARD, then the nine steps. The diagnostics first: they say WHY a spin failed.
  const first = await spin();
  expect(await errors()).toEqual([]);
  expect(first).toEqual({ out: 'next' });
  expect(await symbols()).toEqual(AFTER);
  expect(await multipliers()).toEqual(MULTIPLIERS);
  expect(await overlays()).toEqual({ sticky: 2, giant: 1 });

  // ── spin 2: BOARD alone — the rings stay until a `sticky { on: false }`, the giant goes at spin start
  const second = await spin();
  expect(await errors()).toEqual([]);
  expect(second).toEqual({ out: 'next' });
  expect(await symbols()).toEqual(BOARD.map((col) => col.map(String)));
  // a fresh board: no cell keeps the last spin's multiplier
  expect(await multipliers()).toEqual(BOARD.map((col) => col.map(() => null)));
  expect(await overlays()).toEqual({ sticky: 2, giant: 0 });

  // ── spin 3: a fresh giant, then `giant { clear: true }` in the same plan — gone before the spin ends
  const third = await spin();
  expect(await errors()).toEqual([]);
  expect(third).toEqual({ out: 'next' });
  expect(await overlays()).toEqual({ sticky: 2, giant: 0 });
});
