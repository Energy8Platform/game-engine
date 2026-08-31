import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { Container } from 'pixi.js';
import type { SymbolResolver } from '@energy8platform/game-engine/slot';
import { createGame, type GameApp } from '../src/index';

/**
 * This suite proves COMPOSITION, not rendering — pixi does not initialise
 * usefully under jsdom (measured: `Application.init()` reaches real
 * canvas/WebGL work jsdom does not implement, and rejects). What IS proven
 * here, end to end, against the real pieces (not fakes): the math session
 * really starts against `e8-server` (same fixture `session-dev`'s own
 * suite uses), the registry really registers and binds both shipped
 * mechanics, `reels`' board really builds headlessly, and the
 * renderer/stage half — which DOES need a canvas — degrades to a
 * diagnostic instead of throwing or hanging. A live, spinning game is
 * Task 11's (by hand) and Task 12's (headless browser) to prove.
 */
const GAME = join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game');

const resolve: SymbolResolver = vi.fn((id: string) => {
  const c = new Container() as unknown as { __symbol: string };
  c.__symbol = id;
  return c as any;
});

let game: GameApp | undefined;
afterEach(async () => {
  // Session-dev spawns a real `e8-server` process; leaving it running
  // between tests (or after the suite exits) is exactly the "orphaned
  // process" failure mode the task brief warns about.
  await game?.stop();
  game = undefined;
});

describe('createGame composes the whole e8-base bundle', () => {
  it('brings up session, mechanics and board — the pieces that need no canvas', async () => {
    game = await createGame({
      session: { gamesDir: GAME, port: 0 },
      reels: { resolve, config: { grid: { cols: 5, rows: 3 } } },
      stages: { base_game: 'classic' },
    });

    expect(typeof game.ctx.session.play).toBe('function');
    expect(typeof game.ctx.mechanics.register).toBe('function');
    expect(game.ctx.board).toBeDefined();
    expect(typeof game.ctx.board.spinTo).toBe('function');
  });

  it('plays a real spin through the composed session, independent of any renderer', async () => {
    game = await createGame({
      session: { gamesDir: GAME, port: 0 },
    });

    const { result, diagnostics } = await game.ctx.session.play({
      gameId: 'first-slot',
      action: 'spin',
      betLevel: 1.0,
    });

    expect(diagnostics).toEqual([]);
    expect(result?.stage).toBe('base_game');
  });

  it('registers both shipped mechanics and binds stages from config', async () => {
    game = await createGame({
      stages: { base_game: 'classic', free_spins: 'cascade' },
    });

    expect(game.ctx.mechanics.forStage('base_game')?.id).toBe('classic');
    expect(game.ctx.mechanics.forStage('free_spins')?.id).toBe('cascade');
  });

  it('reports binding a stage to a mechanic id nobody ships, same as the bare registry', async () => {
    game = await createGame({ stages: { base_game: 'no-such-mechanic' } });

    expect(
      game.diagnostics.some(
        (d) => d.severity === 'error' && d.message.includes('no-such-mechanic'),
      ),
    ).toBe(true);
  });

  it('the board builds headlessly with no renderer configured at all', async () => {
    game = await createGame({
      reels: { resolve, config: { grid: { cols: 3, rows: 3 } } },
    });

    expect(game.ctx.board).toBeDefined();
    expect(game.ctx.renderer).toBeUndefined();
    expect(game.diagnostics).toEqual([]);
  });

  it('a reels config that fails to build degrades to a diagnostic instead of crashing createGame', async () => {
    // `resolve` is only ever called (by the legacy `SymbolCell.setData`)
    // for a non-null initial symbol, so an initial `board` is what makes
    // construction actually reach — and throw from — a broken `resolve`
    // (measured directly; a `resolve` that throws with no initial `board`
    // never gets called at all, since every cell starts empty).
    game = await createGame({
      reels: {
        resolve: () => {
          throw new Error('boom-from-resolve');
        },
        config: { grid: { cols: 1, rows: 1 } },
        board: [[{ symbol: 'x' }]],
      },
    });

    expect(game.ctx.board).toBeUndefined();
    expect(
      game.diagnostics.some(
        (d) =>
          d.severity === 'error' && d.plugin === 'reels' && d.message.includes('boom-from-resolve'),
      ),
    ).toBe(true);
  });

  it('a renderer attempted under jsdom degrades to a diagnostic instead of throwing or hanging', async () => {
    // `renderer: {}` is what opts a caller into attempting a renderer at
    // all — see `GameConfig.renderer`'s doc comment. `createGame` itself
    // must not reject even though `Application.init()` underneath does.
    await expect(
      (async () => {
        game = await createGame({ renderer: {} });
      })(),
    ).resolves.toBeUndefined();

    expect(game!.ctx.renderer).toBeUndefined();
    expect(
      game!.diagnostics.some((d) => d.severity === 'error' && d.plugin === 'renderer-pixi'),
    ).toBe(true);
  });

  it('stage never mounts when the renderer it needs never came up — no throw, no service', async () => {
    game = await createGame({
      renderer: {},
      stage: { design: { width: 1920, height: 1080 } },
      reels: { resolve, config: { grid: { cols: 3, rows: 3 } } },
    });

    expect(game.ctx.renderer).toBeUndefined();
    expect(game.ctx.stage).toBeUndefined();
    // The board still exists — reels does not need the renderer either
    // (see plugins/reels.ts) — it is just never mounted anywhere visible.
    expect(game.ctx.board).toBeDefined();
  });

  it('does not attempt a renderer at all when neither `renderer` nor `mount` was asked for', async () => {
    game = await createGame({});

    expect(game.ctx.renderer).toBeUndefined();
    expect(game.diagnostics).toEqual([]);
  });

  it('an unstartable session is known before boot ever tries the renderer — start() is skipped', async () => {
    game = await createGame({
      session: {
        gamesDir: GAME,
        port: 0,
        binPath: '/nonexistent/e8-server-binary',
        readyTimeoutMs: 5_000,
      },
      renderer: {},
    });

    // The session failure is recorded...
    expect(game.diagnostics.some((d) => d.severity === 'error' && d.plugin === 'session')).toBe(
      true,
    );
    // ...and because boot saw that error before ever calling start(), the
    // renderer was never even attempted — no renderer-pixi diagnostic
    // alongside the session one.
    expect(game.diagnostics.some((d) => d.plugin === 'renderer-pixi')).toBe(false);
    expect(game.ctx.renderer).toBeUndefined();
  });
});
