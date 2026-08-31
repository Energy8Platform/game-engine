import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startE8Server, type E8Handle, type SpinResult } from '../src/e8server';

// e8-server's --games-dir is NOT recursive — it must point directly at the
// folder holding the .spin file(s), not an ancestor of it (measured: pointed
// at the game's root instead of its `game/` subdir, e8-server loaded zero
// games and every play() rejected with 'unknown game "first-slot" (loaded: )').
const GAME = join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game');

let e8: E8Handle;
beforeAll(async () => {
  e8 = await startE8Server({ gamesDir: GAME, port: 0 });
}, 30_000);
afterAll(async () => {
  await e8?.stop();
});

/** RTP isn't tuned in this task, so a winning spin isn't guaranteed on the
 *  first draw — spin until `predicate` matches, or fail loudly instead of
 *  hanging past the suite's timeout. */
async function spinUntil(
  predicate: (r: SpinResult) => boolean,
  maxAttempts = 1000,
): Promise<SpinResult> {
  for (let i = 0; i < maxAttempts; i++) {
    const r = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    if (predicate(r)) return r;
  }
  throw new Error(`spinUntil: predicate never matched in ${maxAttempts} spins`);
}

describe('a real spin through e8-server', () => {
  it('returns a 5x3 grid of symbol ids', async () => {
    const result = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    expect(result.stage).toBe('base_game');
    expect(result.data.grid).toHaveLength(5);
    expect(result.data.grid[0]).toHaveLength(3);
    for (const col of result.data.grid) {
      for (const cell of col) expect(typeof cell).toBe('number');
    }
  });

  it('reports a win as a bet multiplier', async () => {
    const result = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    expect(typeof result.data.win).toBe('number');
    expect(result.data.win).toBeGreaterThanOrEqual(0);
  });

  it('gives different grids across spins', async () => {
    const a = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    const b = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    expect(JSON.stringify(a.data.grid)).not.toBe(JSON.stringify(b.data.grid));
  });

  it('stops cleanly — the port is released', async () => {
    const handle = await startE8Server({ gamesDir: GAME, port: 0 });
    const port = handle.port;
    await handle.stop();
    const second = await startE8Server({ gamesDir: GAME, port });
    expect(second.port).toBe(port);
    await second.stop();
  });

  it('does not leave a proto tempdir behind', async () => {
    // The gRPC client's proto is loaded from a mkdtempSync'd directory
    // under os.tmpdir() (see grpcClient in e8server.ts) — it used to be
    // removed nowhere, so every startE8Server() call left a
    // /tmp/e8proto-* directory behind forever. The dir is cleaned up
    // synchronously, right after the proto is loaded — well before
    // startE8Server() even returns — so this doesn't need to wait on
    // stop() at all; two full start/stop cycles must leave the same set
    // of e8proto-* entries in tmpdir() as before either ran.
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith('e8proto-'));

    const a = await startE8Server({ gamesDir: GAME, port: 0 });
    await a.stop();
    const b = await startE8Server({ gamesDir: GAME, port: 0 });
    await b.stop();

    const after = readdirSync(tmpdir()).filter((name) => name.startsWith('e8proto-'));
    expect(after).toEqual(before);
  });
});

// Rulings from the brief: (1) stage data must include the winning LINES, not
// just grid+win; (2) stage data must ALSO include a cascade-shaped chain of
// steps, each carrying its board, its removed cells and its win. These tests
// pin the STRUCTURE of both — not just that the fields exist — so a
// regression that empties or malforms either shape fails loudly.
describe('data.lines — ruling 1: reveal the wins, not just grid + win', () => {
  it('a line entry carries the fields a mechanic reads: which row, which symbol, how many, how much, and where', async () => {
    const result = await spinUntil((r) => r.data.lines.length > 0);
    const line = result.data.lines[0];

    expect(typeof line.line).toBe('number');
    expect(typeof line.symbol).toBe('number');
    expect(typeof line.count).toBe('number');
    expect(line.count).toBeGreaterThanOrEqual(3);
    expect(typeof line.win).toBe('number');
    expect(line.win).toBeGreaterThan(0);

    expect(Array.isArray(line.positions)).toBe(true);
    expect(line.positions).toHaveLength(line.count);
    for (const p of line.positions) {
      expect(typeof p.col).toBe('number');
      expect(typeof p.row).toBe('number');
    }
  });
});

describe('data.cascade_history — ruling 2: a cascade-shaped chain of steps', () => {
  it('a step carries the board after it, the cells removed, and that step\'s win', async () => {
    const result = await spinUntil((r) => r.data.cascade_history.length > 0);
    const step = result.data.cascade_history[0];

    // the board after the step: same 5x3 shape as the top-level grid
    expect(step.grid).toHaveLength(5);
    expect(step.grid[0]).toHaveLength(3);
    for (const col of step.grid) {
      for (const cell of col) expect(typeof cell).toBe('number');
    }

    // the cells removed that round — non-empty whenever the step exists at all
    expect(Array.isArray(step.removed)).toBe(true);
    expect(step.removed.length).toBeGreaterThan(0);
    for (const p of step.removed) {
      expect(typeof p.col).toBe('number');
      expect(typeof p.row).toBe('number');
    }

    // that step's own win
    expect(typeof step.win).toBe('number');
    expect(step.win).toBeGreaterThan(0);
  });
});

// The coordinator's correction: "the mechanic renders, the math pays" — win
// (== data.win, cascade-inclusive, what the server actually credits) must
// never be confused with base_win (round-0-only, what a `classic` mechanic
// would reveal alongside `lines`). Pin both halves of that invariant.
describe('data.win vs data.base_win — the mechanic renders, the math pays', () => {
  it('base_win is exactly the sum of the revealed lines', async () => {
    const result = await spinUntil((r) => r.data.lines.length > 0);
    const sumLines = result.data.lines.reduce((total: number, l: any) => total + l.win, 0);
    expect(result.data.base_win).toBeCloseTo(sumLines, 10);
  });

  it('win sums every cascade round; base_win only round 0 — they diverge once a cascade retriggers', async () => {
    const result = await spinUntil((r) => r.data.cascade_history.length >= 2);
    const sumSteps = result.data.cascade_history.reduce((total: number, s: any) => total + s.win, 0);
    expect(result.data.win).toBeCloseTo(sumSteps, 10);
    // the whole point of the invariant: once there's a second cascade round,
    // the credited total is strictly more than what `lines`/`base_win` alone
    // would show a player under a `classic` presentation.
    expect(result.data.win).toBeGreaterThan(result.data.base_win);
  });
});
