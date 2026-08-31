/**
 * `first-slot`'s browser entry — what `e8 dev`'s `dev-game` plugin serves
 * through vite. This is the minimal "open, click spin" harness the SDD
 * plan's Task 11 needs, not a finished game shell: a real `createGame`
 * (session-less — the math session lives server-side, in `dev-game`'s own
 * `ctx.session`, reached over `POST /api/spin`) with a plain placeholder
 * symbol resolver standing in for real art, plus a `<select>` to switch
 * `base_game` between the two shipped mechanics — the plan's own
 * demonstration that the same spin plays differently depending on which
 * one is bound (see the SDD ledger's Ruling 2/3).
 *
 * `SpinResult` (from `POST /api/spin`) is shipped across unchanged — see
 * `session-dev`'s own type doc — and driven straight through
 * `ctx.mechanics`/`ctx.board`/`executePlan`, the same seam `createGame`'s
 * own test suite exercises against fakes.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { SymbolResolver, SymbolView } from '@energy8platform/game-engine/slot';
import { createGame } from '@energy8engine/game-runtime';
import { executePlan } from '@energy8engine/play-loop';

const CELL = 96;
const GRID = { cols: 5, rows: 3 };
const COLORS = [0xef4444, 0xf59e0b, 0xeab308, 0x22c55e, 0x38bdf8, 0xa78bfa];

/** Colored square + symbol id — a stand-in for real art (see energy8-slots:generating-assets for that). */
const resolve: SymbolResolver = (symbolId: string): SymbolView => {
  const view = new Container() as SymbolView;
  const n = Number(symbolId);
  const color = COLORS[((n - 1) % COLORS.length + COLORS.length) % COLORS.length];
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

mechanicSelect.addEventListener('change', () => {
  game.ctx.mechanics.bind('base_game', mechanicSelect.value);
});

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

    const shapeProblems = game.ctx.mechanics.check(body.stage, body.data);
    if (shapeProblems.length > 0) {
      log(`mechanic can't read this stage's data: ${JSON.stringify(shapeProblems)}`);
      statusEl.textContent = 'shape mismatch — see log';
      return;
    }

    const mechanic = game.ctx.mechanics.forStage(body.stage)!;
    const plan = mechanic.present(body.data);
    const problems = await executePlan(plan, game.ctx.board);
    if (problems.length > 0) log(`presentation problems: ${JSON.stringify(problems)}`);
    statusEl.textContent = 'done';
  } catch (error) {
    log(`error: ${error instanceof Error ? error.message : String(error)}`);
    statusEl.textContent = 'error — see log';
  } finally {
    spinBtn.disabled = false;
  }
});
