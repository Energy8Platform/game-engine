import { afterEach, describe, expect, it } from 'vitest';
import * as diagnosticsRuntime from '@energy8engine/diagnostics/runtime';
import { fakeFetch, row } from './helpers';
import { createGame, type GameApp } from '../src/index';

/**
 * `gameRows` is the game's one door for a live row edit: the IDE (via
 * `ide-bridge`) hands it a row id and that row's whole new config, and the
 * row's own fiber re-applies in place — cordis disposes the row's effects
 * and runs `apply` again — with nothing else in the game restarting. Every
 * half here is a recorder, not the real thing: what is under test is the
 * map from row id to fiber and what the answer says about it.
 */
let game: GameApp | undefined;
afterEach(async () => {
  await game?.stop();
  game = undefined;
});

/** `renderer1` is present only so the required `renderer` seam has a winner and the diagnostics list stays clean. */
const ROWS = [row('diagnostics1'), row('renderer1'), row('reels1', { grid: { cols: 5 } })];

describe('gameRows.update', () => {
  it("re-applies the named row with the new config and answers 'updated'", async () => {
    const applied: { id: string; config: unknown }[] = [];
    const disposed: string[] = [];
    game = await createGame({
      loader: {
        fetchFn: fakeFetch({ rows: ROWS, diagnostics: [] }),
        importModule: async (url) => {
          const id = url.split('/').pop()!;
          if (id === 'diagnostics1') return diagnosticsRuntime;
          return {
            apply: (ctx: any, config: unknown) => {
              applied.push({ id, config });
              ctx.effect(() => () => {
                disposed.push(id);
              });
            },
          };
        },
      },
    });
    expect(game.diagnostics).toEqual([]);

    const answer = await game.ctx.gameRows.update('reels1', { grid: { cols: 4 } });

    expect(answer).toBe('updated');
    expect(disposed).toEqual(['reels1']);
    expect(applied).toEqual([
      { id: 'renderer1', config: {} },
      { id: 'reels1', config: { grid: { cols: 5 } } },
      { id: 'reels1', config: { grid: { cols: 4 } } },
    ]);
  });

  it("answers 'unknown' for a row that has no fiber — one that never composed", async () => {
    game = await createGame({
      loader: {
        fetchFn: fakeFetch({ rows: ROWS, diagnostics: [] }),
        importModule: async (url) =>
          url.endsWith('diagnostics1') ? diagnosticsRuntime : { apply: () => {} },
      },
    });

    expect(await game.ctx.gameRows.update('nope1', {})).toBe('unknown');
  });

  it("a re-apply that throws answers 'failed' and lands in ctx.diagnostics, naming the row", async () => {
    game = await createGame({
      loader: {
        fetchFn: fakeFetch({ rows: ROWS, diagnostics: [] }),
        importModule: async (url) => {
          const id = url.split('/').pop()!;
          if (id === 'diagnostics1') return diagnosticsRuntime;
          return {
            apply: (_ctx: unknown, config: { grid?: { cols?: number } }) => {
              if (config.grid?.cols === 0) throw new Error('a reel needs at least one column');
            },
          };
        },
      },
    });
    expect(game.ctx.diagnostics.list()).toEqual([]);

    expect(await game.ctx.gameRows.update('reels1', { grid: { cols: 0 } })).toBe('failed');

    const [d, ...rest] = game.ctx.diagnostics.list();
    expect(rest).toEqual([]);
    expect(d.severity).toBe('error');
    expect(d.plugin).toBe('reels1');
    expect(d.where).toBe('hot update');
    expect(d.message).toContain('a reel needs at least one column');

    // And the row is not stuck: the next good config applies again.
    expect(await game.ctx.gameRows.update('reels1', { grid: { cols: 3 } })).toBe('updated');
  });
});
