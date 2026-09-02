/**
 * `first-slot`'s browser entry — what `e8 dev`'s `dev-game` plugin serves
 * through vite, and what Task 12's preview iframe points at (same server,
 * see `engine/ide/client/src/screens/CompositionScreen.tsx`'s `Preview`).
 * This is the minimal "open, click spin" harness, not a finished game
 * shell.
 *
 * **What this file no longer does.** It used to hand `createGame` the
 * renderer size, the stage's design resolution, the reel grid and the
 * stage→mechanic binding as a JS object. All four now live in this
 * project's own `e8.patch.yml`, on top of the `e8-base` bundle its
 * `e8.profile.yml` stacks: `createGame` fetches that composition from the
 * host and applies each row's runtime half. Changing the grid is an edit
 * to a `.yml` file, and adding a plugin is a row — neither is a change to
 * this file or to the engine.
 *
 * What is left is exactly what a project file cannot hold:
 *  - `resolve`, a function: the placeholder art below. It travels as the
 *    `assets` service, which `reels1`'s runtime half reads off `ctx` (see
 *    `@energy8engine/reels`'s `src/runtime.ts`). A real game replaces this
 *    with its own art and changes nothing else.
 *  - `mount`, a live DOM element: this page's own `#mount`. It travels the
 *    same way — `createGame` provides it as the `mount` service, the
 *    renderer row attaches its canvas to it, and `createGame` draws the
 *    failure screen on it when something went wrong.
 *
 * Everything the game then does — the registry, the board, executing a
 * presentation plan — is reached through `game.ctx`, off services rows
 * provided. There is no static import of a mechanic, a renderer, or the
 * play loop here; that is the property this whole slice was built for.
 *
 * The other side of that freedom is that a composition can legally leave
 * out something this page needs, and nothing in the engine can know it
 * did — so this file states its own requirements (`REQUIRES`, below) and
 * says so on screen when one is missing, instead of booting to `ready`
 * over an empty canvas.
 *
 * `@energy8engine/ide-bridge` (Task 12) is composed directly into
 * `game.ctx` below — the "hot fork to the game": it opens the SAME `/ide`
 * websocket `engine/ide/client/src/plugins/connection.ts` speaks, listens
 * for the composition row a project's `e8.yml` gives it (see this
 * project's own `e8.yml`), and rebinds `base_game` live, with no reload of
 * this page or the IDE around it. Nothing about this import makes
 * `first-slot` a production game — `ide-bridge` is a plugin of the editor
 * phase (see its own module doc); a real game's bundle simply never
 * imports it.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { SymbolResolver, SymbolView } from '@energy8platform/game-engine/slot';
import { createGame } from '@energy8engine/game-runtime';
import * as ideBridge from '@energy8engine/ide-bridge';
import {
  diagnostic,
  type Diagnostic,
  type PresentationPlan,
  type SpinResult,
} from '@energy8engine/contracts';
// Type-only, and fully erased: these two modules are what DECLARE the
// `ctx.board` and `ctx.play` services this page reads off the composed
// context. Importing their types is not importing them — nothing here
// pulls `reels` or `play-loop` into the bundle, and neither package is
// composed by this file. It is the page saying, in the type system, which
// capabilities it expects the project's composition to have provided.
import type {} from '@energy8engine/reels/runtime';
import type {} from '@energy8engine/play-loop/runtime';

/** Matches `e8.patch.yml`'s `reels1` grid — this file only uses it to size the placeholder art. */
const CELL = 96;
const COLORS = [0xef4444, 0xf59e0b, 0xeab308, 0x22c55e, 0x38bdf8, 0xa78bfa];

/** Colored square + symbol id — a stand-in for real art (see energy8-slots:generating-assets for that). */
const resolve: SymbolResolver = (symbolId: string): SymbolView => {
  const view = new Container() as SymbolView;
  const n = Number(symbolId);
  const color = COLORS[(((n - 1) % COLORS.length) + COLORS.length) % COLORS.length];
  const box = new Graphics().rect(4, 4, CELL - 8, CELL - 8).fill(color);
  view.addChild(box);
  const label = new Text({
    text: symbolId,
    style: { fill: 0x10121a, fontSize: 36, fontWeight: 'bold' },
  });
  label.anchor.set(0.5);
  label.position.set(CELL / 2, CELL / 2);
  view.addChild(label);
  return view;
};

const mount = document.getElementById('mount')!;
const logEl = document.getElementById('log')!;
const statusEl = document.getElementById('status')!;
const spinBtn = document.getElementById('spin') as HTMLButtonElement;
const mechanicSelect = document.getElementById('mechanic') as HTMLSelectElement;

function log(message: string): void {
  logEl.textContent = `${new Date().toLocaleTimeString()}  ${message}\n${logEl.textContent}`;
}

const game = await createGame({
  mount,
  // The one value with no home in a `.yml` row: a function.
  provide: { assets: { resolve } },
});

/**
 * What THIS page needs the composition to have provided. Not a rule the
 * engine could hold: removing a row is a legal edit, and a game that
 * reaches its own math over `fetch` and draws with something other than a
 * reel board is a perfectly good game with neither of these services. So
 * the requirement is stated where it is actually true — here, by the page
 * that reads `ctx.board` and `ctx.play` further down.
 *
 * It is stated because of what happens otherwise, which was measured
 * (task-11-report.md): delete `reels1` from `e8.patch.yml` and this page
 * used to boot to `ready` with an empty canvas and no explanation
 * anywhere — the white rectangle the whole `boot` design exists to
 * prevent, reached by an edit the composition considers valid.
 *
 * `reflect.get(name, false)` rather than `ctx.board`: cordis throws on a
 * property read of a REGISTERED service a plugin did not `inject`, and
 * "nobody provided one" is the answer this needs, not an exception.
 */
const REQUIRES = [
  {
    service: 'board',
    row: 'reels1',
    pkg: '@energy8engine/reels',
    what: 'a reel board to draw on',
  },
  {
    service: 'play',
    row: 'playloop1',
    pkg: '@energy8engine/play-loop',
    what: 'a play loop to run a presentation plan through',
  },
] as const;

const missing = REQUIRES.filter(
  (need) => game.ctx.reflect.get(need.service, false) === undefined,
).map((need) =>
  diagnostic(
    'error',
    'first-slot',
    need.service,
    `this game needs ${need.what}, and no row in the composition provides "${need.service}" — the "${need.row}" row (${need.pkg}) is not there`,
    `restore the "${need.row}" row — the e8-base bundle places it, so look for a "remove: true" on it in e8.patch.yml`,
  ),
);

const diagnostics = [...game.diagnostics, ...missing];

/**
 * Draws the reasons where a person is already looking — over the mount,
 * replacing whatever the renderer row attached to it. `createGame` does
 * this itself for the diagnostics IT collected; these are ours, found
 * after it returned, so making them visible is ours to do too.
 *
 * Through the composed `boot` service, which is the point of `boot1`
 * being a row: a project that ships a branded failure screen gets this
 * one too. The fallback and the try/catch are the same two guards
 * `createGame`'s own `renderFailure` carries, for the same two reasons —
 * `boot1` can legally be dropped from a composition as well, and a
 * failure screen that throws must not blank the page it was supposed to
 * explain.
 */
if (missing.length > 0) {
  const boot = game.ctx.reflect.get('boot', false) as
    { renderFailure(root: HTMLElement, list: Diagnostic[]): void } | undefined;
  try {
    if (!boot) throw new Error('no boot row in this composition');
    boot.renderFailure(mount, diagnostics);
  } catch {
    mount.textContent = [
      'This game could not start',
      ...diagnostics.map((d) => `${d.plugin} — ${d.where}: ${d.message}`),
    ].join('\n');
  }
}

if (diagnostics.length > 0) {
  statusEl.textContent = 'composition has errors — see log';
  for (const d of diagnostics) log(`[${d.severity}] ${d.plugin} (${d.where}): ${d.message}`);
} else {
  statusEl.textContent = 'ready';
}

// `ide-bridge`'s own boot-time bind uses `mechanicSelect.value` too, so the
// two channels (this page's local `<select>`, and the IDE's composition
// screen over `/ide`) agree at first load; whichever one the developer
// touches most recently wins from then on — see ide-bridge's module doc.
ideBridge.apply(game.ctx, { base_game: mechanicSelect.value });

mechanicSelect.addEventListener('change', () => {
  game.ctx.mechanics.bind('base_game', mechanicSelect.value);
});

/**
 * Checks `data` against the stage's currently bound mechanic, presents it,
 * and runs the resulting plan through the real board — the one code path
 * both a real spin (below) and the test-only replay instrumentation
 * (`window.__e8`, further down) go through, so a Playwright test observing
 * the latter is observing exactly what a real spin would have produced,
 * not a shortcut built just for the test.
 *
 * `ctx.play.execute` and `ctx.board` are both services rows provided
 * (`playloop1` and `reels1`) — this file imports neither package.
 *
 * Returns the full `PresentationPlan`, not just each step's `kind` — a
 * step's content (which board `spinTo`/`refill` name, which cells `remove`
 * names) is exactly what a person watching the board actually sees, and a
 * kind-only sequence cannot tell a correctly-refilled board apart from one
 * with a permanent hole in it.
 */
async function presentStage(
  stage: string,
  data: Record<string, unknown>,
): Promise<PresentationPlan> {
  const shapeProblems = game.ctx.mechanics.check(stage, data);
  if (shapeProblems.length > 0) {
    log(`mechanic can't read this stage's data: ${JSON.stringify(shapeProblems)}`);
    statusEl.textContent = 'shape mismatch — see log';
    return [];
  }

  const mechanic = game.ctx.mechanics.forStage(stage)!;
  const plan = mechanic.present(data);
  const problems = await game.ctx.play.execute(plan, game.ctx.board);
  if (problems.length > 0) log(`presentation problems: ${JSON.stringify(problems)}`);
  return plan;
}

let lastSpin: { stage: string; data: Record<string, unknown> } | null = null;

spinBtn.addEventListener('click', async () => {
  spinBtn.disabled = true;
  statusEl.textContent = 'spinning…';
  try {
    const res = await fetch('/api/spin', { method: 'POST' });
    // `dev-game`'s route responds with the bare `SpinResult` (contracts'
    // normative envelope for this crossing) on 2xx, or `{ diagnostics }`
    // on a non-2xx — see dev-game.ts's own route handler.
    const body: SpinResult | { diagnostics: unknown[] } = await res.json();

    if (!res.ok) {
      log(`spin failed: ${JSON.stringify((body as { diagnostics: unknown[] }).diagnostics)}`);
      statusEl.textContent = 'spin failed — see log';
      return;
    }

    const result = body as SpinResult;
    log(`win ${result.win} (total ${result.totalWin}), stage "${result.stage}"`);
    lastSpin = { stage: result.stage, data: result.data };
    await presentStage(result.stage, result.data);
    statusEl.textContent = 'done';
  } catch (error) {
    log(`error: ${error instanceof Error ? error.message : String(error)}`);
    statusEl.textContent = 'error — see log';
  } finally {
    spinBtn.disabled = false;
  }
});

/**
 * Test-only instrumentation for the SDD plan's Task 12, step 5. Playwright
 * has no other honest way to observe "the SAME spin result presents
 * differently under a different mechanic" than asking the game what it
 * actually ran — checking `e8.yml` or the `/ide` websocket traffic would
 * only prove a config value changed, not that the board did anything
 * different (see the task brief: "a test that checks e8.yml instead of the
 * screen would be checking the wrong end of the pipe"). Nothing on this
 * page's own UI calls `window.__e8`; a production game bundle never
 * imports this file's test harness, either.
 */
(window as unknown as { __e8: unknown }).__e8 = {
  /** The composition this game actually ran with — how a test tells "the project composed it" apart from "the page hardcoded it". Includes what THIS page found missing (see `REQUIRES`), not only what `createGame` collected. */
  diagnostics,
  /** Hits `/api/spin` for real and presents the result under whichever mechanic is currently bound. Returns the raw result and the full plan the mechanic actually emitted (step kind AND content — see `presentStage`'s doc). */
  async spin(): Promise<{ result: SpinResult; steps: PresentationPlan }> {
    const res = await fetch('/api/spin', { method: 'POST' });
    const body: SpinResult | { diagnostics: unknown[] } = await res.json();
    if (!res.ok) {
      throw new Error(
        `spin failed: ${JSON.stringify((body as { diagnostics: unknown[] }).diagnostics)}`,
      );
    }
    const result = body as SpinResult;
    lastSpin = { stage: result.stage, data: result.data };
    const steps = await presentStage(result.stage, result.data);
    return { result, steps };
  },
  /** Re-presents arbitrary (or the last captured) stage data under whichever mechanic is currently bound — the same `data`, a possibly different mechanic. */
  async present(stage?: string, data?: Record<string, unknown>): Promise<PresentationPlan> {
    const target = stage && data ? { stage, data } : lastSpin;
    if (!target) throw new Error('no spin to present yet');
    return presentStage(target.stage, target.data);
  },
};
