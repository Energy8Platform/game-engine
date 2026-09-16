import { afterEach, describe, expect, it } from 'vitest';
import * as diagnosticsRuntime from '@energy8engine/diagnostics/runtime';
import * as mechanicsRuntime from '../src/runtime';
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

  it("a row whose `inject` is still unmet answers 'failed', with a diagnostic saying what it waits for", async () => {
    game = await createGame({
      loader: {
        fetchFn: fakeFetch({ rows: [...ROWS, row('stage1')], diagnostics: [] }),
        importModule: async (url) => {
          const id = url.split('/').pop()!;
          if (id === 'diagnostics1') return diagnosticsRuntime;
          if (id === 'stage1') return { inject: ['never'], apply: () => {} };
          return { apply: () => {} };
        },
      },
    });
    // The boot-time complaint about the same thing, from the loader.
    expect(game.diagnostics.map((d) => d.plugin)).toEqual(['stage1']);

    expect(await game.ctx.gameRows.update('stage1', {})).toBe('failed');

    const hot = game.ctx.diagnostics.list().filter((d) => d.where === 'hot update');
    expect(hot).toHaveLength(1);
    expect(hot[0].plugin).toBe('stage1');
    expect(hot[0].message).toContain('"never"');
  });

  it('a hot update of mechanics1 re-provides `mechanics`, and a fresh read resolves against the new one', async () => {
    game = await createGame({
      loader: {
        fetchFn: fakeFetch({
          rows: [
            row('diagnostics1'),
            row('renderer1'),
            row('mechanics1', { stages: { base_game: 'classic' } }),
          ],
          diagnostics: [],
        }),
        importModule: async (url) => {
          const id = url.split('/').pop()!;
          if (id === 'diagnostics1') return diagnosticsRuntime;
          if (id === 'mechanics1') return mechanicsRuntime;
          return { apply: () => {} };
        },
      },
    });
    const before = game.ctx.reflect.get('mechanics', false) as typeof game.ctx.mechanics;
    expect(before.forStage('base_game')?.id).toBe('classic');

    expect(await game.ctx.gameRows.update('mechanics1', { stages: { base_game: 'cascade' } })).toBe(
      'updated',
    );

    const after = game.ctx.reflect.get('mechanics', false) as typeof game.ctx.mechanics;
    expect(after).not.toBe(before);
    expect(after.forStage('base_game')?.id).toBe('cascade');
    // The captured one is dead — its bindings and registrations were
    // effects of the old fiber run, and the re-apply disposed them — so
    // anything still holding it presents nothing, not even the old thing.
    expect(before.forStage('base_game')).toBeNull();
  });

  it('two updates of one row back-to-back both apply, in order — the second is not dropped on the first’s in-flight restart', async () => {
    // Measured on cordis rc.8: `fiber.update(v2)` while v1's async `apply`
    // is still running is DROPPED — the fiber restores v1's epoch and v2
    // never applies. A form committing twice in quick succession (blur,
    // then Enter) would lose its last value. `gameRows` serialises per row.
    const applied: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    game = await createGame({
      loader: {
        fetchFn: fakeFetch({ rows: ROWS, diagnostics: [] }),
        importModule: async (url) => {
          const id = url.split('/').pop()!;
          if (id === 'diagnostics1') return diagnosticsRuntime;
          if (id !== 'reels1') return { apply: () => {} };
          return {
            apply: async (_ctx: unknown, config: { grid?: { cols?: number } }) => {
              applied.push(config);
              // The BOOT apply (`cols: 5`) must not wait — only the re-applies do.
              if (config.grid?.cols !== 5) await gate;
            },
          };
        },
      },
    });
    applied.length = 0;

    const first = game.ctx.gameRows.update('reels1', { grid: { cols: 4 } });
    const second = game.ctx.gameRows.update('reels1', { grid: { cols: 3 } });
    release();

    expect(await Promise.all([first, second])).toEqual(['updated', 'updated']);
    expect(applied).toEqual([{ grid: { cols: 4 } }, { grid: { cols: 3 } }]);
    expect(game.ctx.diagnostics.list()).toEqual([]);
  });
});
