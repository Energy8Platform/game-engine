/**
 * `first-slot`'s browser entry — what `e8 dev`'s `dev-game` plugin serves
 * through vite, and what Task 12's preview iframe points at (same server,
 * see `engine/ide/client/src/screens/CompositionScreen.tsx`'s `Preview`).
 * This is the minimal "open, click spin" harness the SDD plan's Task 11
 * needs, not a finished game shell: a real `createGame` (session-less — the
 * math session lives server-side, in `dev-game`'s own `ctx.session`,
 * reached over `POST /api/spin`) with a plain placeholder symbol resolver
 * standing in for real art, plus a `<select>` to switch `base_game` between
 * the two shipped mechanics — the plan's own demonstration that the same
 * spin plays differently depending on which one is bound (see the SDD
 * ledger's Ruling 2/3).
 *
 * `SpinResult` (from `POST /api/spin`) is shipped across unchanged — see
 * `session-dev`'s own type doc — and driven straight through
 * `ctx.mechanics`/`ctx.board`/`executePlan`, the same seam `createGame`'s
 * own test suite exercises against fakes.
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
import { executePlan } from '@energy8engine/play-loop';
import * as ideBridge from '@energy8engine/ide-bridge';
import type { PresentationPlan } from '@energy8engine/contracts';

const CELL = 96;
const GRID = { cols: 5, rows: 3 };
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
  renderer: { width: GRID.cols * CELL, height: GRID.rows * CELL, background: '#10121a' },
  stage: { design: { width: GRID.cols * CELL, height: GRID.rows * CELL } },
  reels: { resolve, config: { grid: GRID } },
  stages: { base_game: mechanicSelect.value },
  mount,
});

if (game.diagnostics.length > 0) {
  statusEl.textContent = 'composition has errors — see log';
  for (const d of game.diagnostics) log(`[${d.severity}] ${d.plugin} (${d.where}): ${d.message}`);
}

if (game.ctx.renderer) {
  // Boot only renders a failure screen into `mount` on error — a
  // successful start leaves it untouched (see @energy8engine/boot's
  // module doc), so mounting the live canvas here never fights that.
  mount.appendChild(game.ctx.renderer.app.canvas);
  statusEl.textContent = 'ready';
} else {
  statusEl.textContent = 'no renderer — see log';
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
  const problems = await executePlan(plan, game.ctx.board);
  if (problems.length > 0) log(`presentation problems: ${JSON.stringify(problems)}`);
  return plan;
}

let lastSpin: { stage: string; data: Record<string, unknown> } | null = null;

spinBtn.addEventListener('click', async () => {
  spinBtn.disabled = true;
  statusEl.textContent = 'spinning…';
  try {
    const res = await fetch('/api/spin', { method: 'POST' });
    const body = await res.json();

    if (!res.ok) {
      log(`spin failed: ${JSON.stringify(body.diagnostics)}`);
      statusEl.textContent = 'spin failed — see log';
      return;
    }

    log(`win ${body.win} (total ${body.totalWin}), stage "${body.stage}"`);
    lastSpin = { stage: body.stage, data: body.data };
    await presentStage(body.stage, body.data);
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
  /** Hits `/api/spin` for real and presents the result under whichever mechanic is currently bound. Returns the raw result and the full plan the mechanic actually emitted (step kind AND content — see `presentStage`'s doc). */
  async spin(): Promise<{ result: unknown; steps: PresentationPlan }> {
    const res = await fetch('/api/spin', { method: 'POST' });
    const body = await res.json();
    if (!res.ok) throw new Error(`spin failed: ${JSON.stringify(body.diagnostics)}`);
    lastSpin = { stage: body.stage, data: body.data };
    const steps = await presentStage(body.stage, body.data);
    return { result: body, steps };
  },
  /** Re-presents arbitrary (or the last captured) stage data under whichever mechanic is currently bound — the same `data`, a possibly different mechanic. */
  async present(stage?: string, data?: Record<string, unknown>): Promise<PresentationPlan> {
    const target = stage && data ? { stage, data } : lastSpin;
    if (!target) throw new Error('no spin to present yet');
    return presentStage(target.stage, target.data);
  },
};
