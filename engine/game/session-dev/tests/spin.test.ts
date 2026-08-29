import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { startE8Server, type E8Handle } from '../src/e8server';

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
});
