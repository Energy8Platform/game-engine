import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { createGame, type GameApp } from '../src/index';
import { fakeFetch, row } from './helpers';
import * as mechanicsRow from '../src/runtime';

/**
 * What is left of `createGame`'s own job once the project decides the
 * composition: handing the caller's live values to the rows, choosing one
 * provider per seam, bringing up the caller's own session, and putting the
 * reasons on screen when something failed. The rows themselves are fakes
 * here — each real runtime half is proven in its own package's suite, and
 * a game that actually spins is proven in a real browser (see
 * task-9-report.md), not under jsdom, where pixi cannot initialise at all.
 *
 * The session is NOT a fake: `session-dev` spawns a real `e8-server`
 * against the same fixture its own suite uses, because "the caller's
 * session provider comes up before the first row applies" is a claim about
 * real process startup, not about a stub.
 */
const GAME = join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game');

/** A row half that records what it was handed, and marks the context so a test can see it ran. */
function recordingHalf(applied: string[]) {
  return async (url: string) => ({
    apply: (ctx: any, config: unknown) => {
      const id = url.split('/').pop()!;
      applied.push(id);
      ctx[id] = { config };
    },
  });
}

let game: GameApp | undefined;
afterEach(async () => {
  // Session-dev spawns a real `e8-server` process; leaving it running
  // between tests (or after the suite exits) is exactly the "orphaned
  // process" failure mode the task brief warns about.
  await game?.stop();
  game = undefined;
});

describe('createGame — what only the caller can supply', () => {
  it('hands the caller live values the project file cannot carry, before any row applies', async () => {
    // The two values with no home in YAML: a function (the symbol
    // resolver a real `reels1` reads off `assets`) and a live DOM element.
    // Neither is special-cased by name — `createGame` provides whatever
    // map it was given, and the row reads it back off `ctx`.
    const resolve = vi.fn();
    const mount = document.createElement('div');
    let seen: { resolve: unknown; mount: unknown } | undefined;

    game = await createGame({
      mount,
      provide: { assets: { resolve } },
      loader: {
        fetchFn: fakeFetch({ rows: [row('renderer1'), row('anything1')], diagnostics: [] }),
        importModule: async () => ({
          apply: (ctx: any) => {
            seen = {
              resolve: ctx.reflect.get('assets', false)?.resolve,
              mount: ctx.reflect.get('mount', false),
            };
          },
        }),
      },
    });

    expect(seen?.resolve).toBe(resolve);
    expect(seen?.mount).toBe(mount);
  });

  it('brings up the caller session before the first row applies, and plays a real spin through it', async () => {
    const order: string[] = [];

    game = await createGame({
      session: { gamesDir: GAME, port: 0 },
      loader: {
        fetchFn: fakeFetch({ rows: [row('renderer1')], diagnostics: [] }),
        importModule: async () => ({
          apply: (ctx: any) => {
            // Reads through `reflect` for the same reason every row does:
            // a plain `ctx.session` throws inside a plugin that did not
            // inject it.
            order.push(ctx.reflect.get('session', false) ? 'session-was-ready' : 'session-missing');
          },
        }),
      },
    });

    expect(order).toEqual(['session-was-ready']);

    const { result, diagnostics } = await game.ctx.session.play({
      gameId: 'first-slot',
      action: 'spin',
      betLevel: 1.0,
    });
    expect(diagnostics).toEqual([]);
    expect(result?.stage).toBe('base_game');
  });

  it("surfaces session-dev's own specific startup reason, not a vaguer one re-derived here", async () => {
    game = await createGame({
      session: {
        gamesDir: GAME,
        port: 0,
        binPath: '/nonexistent/e8-server-binary',
        readyTimeoutMs: 5_000,
      },
      loader: {
        fetchFn: fakeFetch({ rows: [row('renderer1')], diagnostics: [] }),
        importModule: async () => ({}),
      },
    });

    const sessionDiagnostic = game.diagnostics.find(
      (d) => d.severity === 'error' && d.plugin === 'session',
    );
    expect(sessionDiagnostic).toBeDefined();
    expect(sessionDiagnostic!.message).toContain('/nonexistent/e8-server-binary');
    expect(sessionDiagnostic!.fix).toContain('E8_SERVER_BINARY');
    expect(sessionDiagnostic).toBe(game.ctx.session.startupDiagnostic);
  });
});

describe('createGame — the composition comes from the project, not from this module', () => {
  it('composes nothing at all when the project resolves no rows — there is no hardcoded floor', async () => {
    // The defect this whole task exists to remove: `createGame` used to
    // import both mechanics, the renderer, the stage, the reels and the
    // play loop and wire them in itself, so a game got them whether its
    // project asked for them or not — and a third-party mechanic could
    // not join without an edit to this repo. An empty composition must
    // now produce an empty game.
    game = await createGame({
      loader: {
        fetchFn: fakeFetch({ rows: [], diagnostics: [] }),
        importModule: async () => ({}),
      },
    });

    for (const service of ['mechanics', 'board', 'renderer', 'stage', 'play', 'boot']) {
      expect(game.ctx.reflect.get(service, false)).toBeUndefined();
    }
  });
});

describe('createGame — a third-party mechanic', () => {
  it('composes, binds and runs without the failure screen painting over it', async () => {
    // The end-to-end shape of the plan's central claim: a mechanic this
    // repo has never heard of, registered by somebody else's row, bound
    // by the patch through the REAL `mechanics1` row. This used to end
    // with a working game under a failure screen — the binding resolved
    // and the row was still reported failed.
    const mount = document.createElement('div');
    mount.textContent = 'untouched';

    const ACME = { id: 'acme', requires: { fields: {} }, present: () => [] };
    const modules: Record<string, unknown> = {
      renderer1: { apply: () => {} },
      mechanics1: mechanicsRow,
      acme1: {
        apply: (ctx: any) => {
          ctx.inject(['mechanics'], (scope: any) => scope.mechanics.register(ACME));
        },
      },
    };

    game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({
          rows: [
            row('renderer1'),
            row('mechanics1', { stages: { base_game: 'acme' } }),
            row('acme1'),
          ],
          diagnostics: [],
        }),
        importModule: async (url) => modules[url.split('/').pop()!],
      },
    });

    expect(game.diagnostics).toEqual([]);
    expect(game.ctx.mechanics.forStage('base_game')?.id).toBe('acme');
    expect(mount.textContent).toBe('untouched');
  });
});

describe('createGame — a malformed provide entry', () => {
  it('costs one diagnostic naming that entry, not the whole composition', async () => {
    // `mount` is reserved — createGame provides it itself. A caller
    // passing it through the map too makes cordis refuse the second
    // registration, and an unguarded provide would abandon the
    // composition before a single row applied.
    const applied: string[] = [];
    const mount = document.createElement('div');

    game = await createGame({
      mount,
      provide: { mount, assets: { resolve: () => undefined } },
      loader: {
        fetchFn: fakeFetch({ rows: [row('renderer1'), row('reels1')], diagnostics: [] }),
        importModule: recordingHalf(applied),
      },
    });

    expect(applied).toEqual(['renderer1', 'reels1']);
    expect(game.diagnostics).toHaveLength(1);
    expect(game.diagnostics[0].where).toBe('provide');
    expect(game.diagnostics[0].message).toContain('mount');
    // The entry that was fine still landed.
    expect(game.ctx.reflect.get('assets', false)).toBeDefined();
  });
});

describe('createGame — choosing one provider per seam', () => {
  it('prefers the candidate whose matcher fits this build over the default one', async () => {
    // Both rows offer `renderer`; only one declares itself for this build
    // target. The winner composes and the loser is never applied at all —
    // "applied but ignored" would still have built a second renderer.
    const applied: string[] = [];

    game = await createGame({
      buildTarget: 'stake',
      loader: {
        fetchFn: fakeFetch({
          rows: [
            row('renderer1'),
            { ...row('renderer2'), seam: { name: 'renderer', matcher: { buildTarget: 'stake' } } },
          ],
          diagnostics: [],
        }),
        importModule: recordingHalf(applied),
      },
    });

    expect(applied).toEqual(['renderer2']);
    expect(game.diagnostics).toEqual([]);
  });

  it('a row that declares no seam always composes — most rows are candidates for nothing', async () => {
    const applied: string[] = [];

    game = await createGame({
      loader: {
        fetchFn: fakeFetch({
          rows: [row('boot1'), row('renderer1'), row('reels1'), row('playloop1')],
          diagnostics: [],
        }),
        importModule: recordingHalf(applied),
      },
    });

    expect(applied).toEqual(['boot1', 'renderer1', 'reels1', 'playloop1']);
    expect(game.diagnostics).toEqual([]);
  });
});

describe('createGame — the failure screen', () => {
  it('draws the reasons through the composed boot row when the composition got that far', async () => {
    // `boot1` provides `ctx.boot`, and THAT is what should render — a
    // project can replace the boot row with its own branded screen and
    // this file never learns about it.
    const mount = document.createElement('div');
    const rendered: unknown[] = [];

    game = await createGame({
      mount,
      loader: {
        // No renderer row at all, so there is a real error to report.
        fetchFn: fakeFetch({ rows: [row('boot1')], diagnostics: [] }),
        importModule: async () => ({
          apply: (ctx: any) => {
            ctx.provide('boot', {
              renderFailure: (root: HTMLElement, diagnostics: unknown[]) => {
                rendered.push(...diagnostics);
                root.textContent = 'the project own failure screen';
              },
            });
          },
        }),
      },
    });

    expect(rendered).toEqual(game.diagnostics);
    expect(mount.textContent).toBe('the project own failure screen');
  });

  it('survives a composed failure screen that throws, and still shows text', async () => {
    // The boot row is a THIRD PARTY's code — swapping it for a branded
    // screen is something this design invites — so it can throw. If that
    // propagates, `createGame` rejects, and a caller awaiting it at module
    // top level (which `first-slot`'s own entry does) renders nothing at
    // all: the white rectangle the whole mechanism exists to prevent,
    // reached through the one service we told people to replace.
    const mount = document.createElement('div');

    game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({ rows: [row('boot1')], diagnostics: [] }),
        importModule: async () => ({
          apply: (ctx: any) => {
            ctx.provide('boot', {
              renderFailure() {
                throw new Error('screen-blew-up');
              },
            });
          },
        }),
      },
    });

    // Visible text, from the built-in screen the broken one fell back to —
    // and it names the broken screen as well as the original problem.
    expect(mount.textContent).toContain('This game could not start');
    expect(mount.textContent).toContain('screen-blew-up');
    expect(mount.textContent).toContain('renderer');
    expect(
      game.diagnostics.some((d) => d.plugin === 'boot' && d.where === 'renderFailure'),
    ).toBe(true);
  });

  it('falls back to its own copy when the composition never got as far as a boot row', async () => {
    // The screen that reports "the composition failed" cannot depend on
    // the composition having succeeded.
    const mount = document.createElement('div');

    game = await createGame({
      mount,
      loader: {
        fetchFn: async () => {
          throw new Error('the host was not there');
        },
      },
    });

    expect(mount.textContent).toContain('This game could not start');
    expect(mount.textContent).toContain('the host was not there');
  });

  it('leaves the mount alone when nothing failed', async () => {
    const mount = document.createElement('div');
    mount.textContent = 'untouched';

    game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({ rows: [row('renderer1')], diagnostics: [] }),
        importModule: async () => ({ apply: () => {} }),
      },
    });

    expect(game.diagnostics).toEqual([]);
    expect(mount.textContent).toBe('untouched');
  });

  it('carries the host own project diagnostics through to the screen', async () => {
    const mount = document.createElement('div');

    game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({
          rows: [row('renderer1')],
          diagnostics: [
            { severity: 'error', plugin: 'project', where: 'e8.patch.yml', message: 'row addresses a plugin nothing placed' },
          ],
        }),
        importModule: async () => ({ apply: () => {} }),
      },
    });

    expect(mount.textContent).toContain('row addresses a plugin nothing placed');
  });
});
