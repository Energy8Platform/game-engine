import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpinSchema } from '@energy8engine/contracts';
import { mechanic as classicMechanic } from '@energy8engine/mechanic-classic';
import * as diagnosticsRuntime from '@energy8engine/diagnostics/runtime';
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

  /**
   * The other side of the same freedom: a plugin row that claims an id
   * the composition already gave to something else.
   *
   * `MechanicsService.register` refuses it and records why, but a
   * collision recorded in a registry nobody reads is still silent. This
   * is the read — `createGame` merging it into the same `diagnostics`
   * array the failure screen and the IDE's panel show, after every row
   * that was going to register has.
   */
  it('a row claiming an id the composition already registered is reported, not silently ignored', async () => {
    // The REAL `mechanics1` row, which registers the shipped `classic`,
    // plus a plugin row that tries to take that id for itself — the exact
    // shadowing that was silent before this. `present` returns a marker
    // step so "which one is bound" is answered by what actually presents,
    // not by an id string both of them share.
    const IMPOSTOR = {
      id: 'classic',
      requires: { fields: {} },
      present: () => [{ kind: 'impostor-marker' }] as never,
    };
    const modules: Record<string, unknown> = {
      mechanics1: mechanicsRow,
      impostor1: {
        apply: (ctx: any) => {
          ctx.inject(['mechanics'], (scope: any) => scope.mechanics.register(IMPOSTOR));
        },
      },
    };

    game = await createGame({
      loader: {
        fetchFn: fakeFetch({
          rows: [row('mechanics1', { stages: { base_game: 'classic' } }), row('impostor1')],
          diagnostics: [],
        }),
        importModule: async (url) => modules[url.split('/').pop()!],
      },
    });

    const collision = game.diagnostics.find(
      (d) => d.message.includes('classic') && d.message.includes('already registered'),
    );
    expect(collision).toBeDefined();
    // ...and the incumbent — the shipped mechanic — is what stays bound.
    expect(game.ctx.mechanics.forStage('base_game')).not.toBe(IMPOSTOR);
    expect(game.ctx.mechanics.forStage('base_game')).toBe(classicMechanic);
  });
});

describe('createGame — checkAgainstSchema is actually wired in', () => {
  // Regression test for a defect the review found, not one this suite
  // caught on its own: deleting `checkAgainstSchema`'s call site in
  // `../src/index.ts` left every other test in this package green — the
  // "a third-party mechanic" test above still passes with `schema`
  // entirely absent from `fakeFetch`'s body (`spinSchema` stays `null`,
  // and `checkAgainstSchema(null, …)` is silent by design either way), so
  // it cannot tell "wired correctly" from "wired to nothing". This test
  // is the one difference that can: a real `schema`, missing a field a
  // BOUND mechanic actually needs, run through the REAL `mechanics1` row
  // (not a stand-in), asserting the diagnostic reaches `game.diagnostics`
  // — the same array the failure screen renders.
  it('checks a bound mechanic against the schema the host serves, before any spin', async () => {
    // The exact scenario the review confirmed live against a real
    // `e8 dev`: `classic` bound to `base_game`, and the schema's
    // `base_game` stage missing `lines` — one of `classic`'s own
    // `requires` fields (`grid`/`base_win`/`lines`; see
    // `@energy8engine/mechanic-classic`).
    const SCHEMA_WITHOUT_LINES: SpinSchema = {
      gameId: 'demo',
      betLevels: [1],
      maxWin: 100,
      vars: {},
      stages: {
        base_game: {
          grid: { kind: 'list', of: { kind: 'list', of: { kind: 'int' } } },
          base_win: { kind: 'float' },
          // `lines` deliberately absent.
        },
      },
      records: {},
      actions: [],
      // Nothing was lost reading this one: the absence below is what the
      // file says, not what a parser could not read — which is exactly the
      // distinction `gaps` carries and this test relies on.
      gaps: [],
    };

    game = await createGame({
      loader: {
        fetchFn: fakeFetch({
          rows: [row('mechanics1', { stages: { base_game: 'classic' } })],
          diagnostics: [],
          schema: SCHEMA_WITHOUT_LINES,
        }),
        importModule: async () => mechanicsRow,
      },
    });

    const found = game.diagnostics.find(
      (d) =>
        d.message.includes('classic') &&
        d.message.includes('lines') &&
        d.message.includes('base_game'),
    );
    expect(found).toBeDefined();
  });

  /**
   * A schema that ARRIVED and this build rejected.
   *
   * `isSpinSchema` is the gate, and failing it turns the value into `null`
   * — after which `checkAgainstSchema(null, …)` returns `[]` by design, so
   * the whole pre-flight stops running with nothing on any screen to say
   * so. Every diagnostic reads healthy while a guarantee has quietly been
   * switched off. That is the shape of failure this branch exists to
   * remove, and it is reachable the moment a host and a game are built
   * from different versions of `SpinSchema`.
   */
  it('says so when the host sends a schema this build cannot read, instead of silently not checking', async () => {
    game = await createGame({
      loader: {
        fetchFn: fakeFetch({
          rows: [row('mechanics1', { stages: { base_game: 'classic' } })],
          diagnostics: [],
          // Shaped like a schema, and not one — `stages` is an array.
          schema: { gameId: 'x', stages: [] } as never,
        }),
        importModule: async () => mechanicsRow,
      },
    });

    const found = game.diagnostics.find((d) => d.message.includes('cannot read'));
    expect(found).toBeDefined();
    // A `warning`: the game composes and plays without a pre-flight, and
    // an `error` here would paint the failure screen over a working game.
    expect(found!.severity).toBe('warning');
    expect(found!.message).toContain('before the first spin');
  });

  it('stays silent when the host sends no schema at all, or an explicit null', async () => {
    // The two legitimate answers. Absent is an old host or a fixture that
    // predates schemas; `null` is a host that read the `.spin` and could
    // not parse it, and has already said so in the same response.
    for (const body of [
      { rows: [], diagnostics: [] },
      { rows: [], diagnostics: [], schema: null },
    ]) {
      const app = await createGame({
        loader: { fetchFn: fakeFetch(body), importModule: async () => mechanicsRow },
      });
      expect(app.diagnostics.filter((d) => d.message.includes('cannot read'))).toEqual([]);
      await app.stop();
    }
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
      // `playloop1` declares `requires: ['board']` (see `helpers.ts`), and
      // `recordingHalf` below is generic — it records each row's id, it
      // does not provide `board`. Not this test's concern (it is about
      // seam candidacy, not `requires`), so `board` is provided directly,
      // the same way a live value with no `.yml` home always is.
      provide: { board: {} },
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
    expect(game.diagnostics.some((d) => d.plugin === 'boot' && d.where === 'renderFailure')).toBe(
      true,
    );
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
            {
              severity: 'error',
              plugin: 'project',
              where: 'e8.patch.yml',
              message: 'row addresses a plugin nothing placed',
            },
          ],
        }),
        importModule: async () => ({ apply: () => {} }),
      },
    });

    expect(mount.textContent).toContain('row addresses a plugin nothing placed');
  });

  /**
   * The seam whose absence let a regression ship: the host reads
   * `game/script.spin` and puts what it found — schema, or `null` plus a
   * diagnostic — into the SAME `/api/composition` body as the rows. Until
   * this test, nothing in this package pinned what a game does with that
   * diagnostic, and the answer was "paints the failure screen over the
   * mount", because the diagnostic arrived at `severity: 'error'` and
   * `createGame` blanks on any error. A project with no `.spin` at all
   * played fine before that slice and stopped playing after it.
   *
   * Two claims, and both are about THIS package, not about the host: a
   * warning-severity diagnostic does not blank the game, and it is not
   * swallowed either — it still reaches `game.diagnostics`, which is what
   * the IDE's own panel renders. (The host's half — that a `.spin` it
   * cannot read produces `warning`, not `error` — is pinned on its own
   * side, in `ide/host/tests/schema.test.ts`.)
   */
  it('a schema diagnostic from the host degrades the game — it does not blank it', async () => {
    const mount = document.createElement('div');
    mount.textContent = 'the game';

    game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({
          rows: [row('renderer1')],
          diagnostics: [
            {
              severity: 'warning',
              plugin: 'spin-parser',
              where: 'line 12',
              message: 'record "Broken" is unterminated — dropping it',
            },
          ],
          // What the host serves when the `.spin` did not fully read:
          // spelled out, never omitted (see `fakeFetch`'s own doc).
          schema: null,
        }),
        importModule: async () => ({ apply: () => {} }),
      },
    });

    // The mount is untouched: no failure screen, and whatever the game
    // had drawn is still there.
    expect(mount.textContent).toBe('the game');
    // And the reason still travelled — degraded, not discarded.
    expect(game.diagnostics).toContainEqual(
      expect.objectContaining({ message: 'record "Broken" is unterminated — dropping it' }),
    );
  });
});

describe('createGame — the diagnostics service', () => {
  /**
   * The order guarantee `diagnostics1`'s own comment in `e8.bundle.yml`
   * makes ("even boot, which reports its own troubles, needs to find
   * `ctx.diagnostics` already there") is a property of that FILE, not of
   * this package — so it is pinned here by reading the real file, not by a
   * fixture that could quietly drift from it. A plain regex over `- id:`
   * lines, not a YAML parser: this test's only job is to catch someone
   * moving a row, the same "twelve lines are cheaper" trade `helpers.ts`
   * already makes for this suite.
   */
  it('e8-base places the diagnostics row first, ahead of every row that could report through it', () => {
    const text = readFileSync(
      join(__dirname, '..', '..', '..', 'bundles', 'e8-base', 'e8.bundle.yml'),
      'utf8',
    );
    const ids = [...text.matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((m) => m[1]);

    expect(ids[0]).toBe('diagnostics1');
    // Named explicitly, not just "first": `boot1` is the row the brief
    // calls out by name for reporting its own troubles.
    expect(ids.indexOf('diagnostics1')).toBeLessThan(ids.indexOf('boot1'));
  });

  /** `diagnostics1` resolves to the real runtime half; anything else is a bare no-op row, unless named otherwise below. */
  const importHalf = async (url: string) => {
    const id = url.split('/').pop()!;
    if (id === 'diagnostics1') return diagnosticsRuntime;
    if (id === 'broken1') throw new Error('this module does not exist');
    return { apply: () => {} };
  };

  it('the diagnostics row is applied before anything that reports', async () => {
    // `renderer1` is here only to keep the composition clean — `renderer`
    // is a REQUIRED seam (see `../src/index.ts`), and this test wants an
    // empty list to mean "nothing went wrong", not "one unrelated seam
    // diagnostic happens to share this array with the two rows under test".
    game = await createGame({
      loader: {
        fetchFn: fakeFetch({
          rows: [row('diagnostics1'), row('boot1'), row('renderer1')],
          diagnostics: [],
        }),
        importModule: importHalf,
      },
    });

    expect(game.ctx.diagnostics).toBeDefined();
    expect(game.ctx.diagnostics.list()).toEqual([]);
  });

  it('what createGame collected is in the service, not only in the field', async () => {
    // `broken1`'s half fails to import — one diagnostic `composeFromProject`
    // returns, which lands in `game.diagnostics` the same way it always
    // has. The service must show the SAME thing, not a second copy of it
    // and not nothing.
    game = await createGame({
      loader: {
        fetchFn: fakeFetch({ rows: [row('diagnostics1'), row('broken1')], diagnostics: [] }),
        importModule: importHalf,
      },
    });

    expect(game.diagnostics.length).toBeGreaterThan(0);
    expect(game.ctx.diagnostics.list().map((d) => d.message)).toEqual(
      game.diagnostics.map((d) => d.message),
    );
  });

  it('a game composed without the diagnostics row still runs', async () => {
    // The row is optional, like `spinlog1`. Its absence costs the panel,
    // not the game — `GameApp.diagnostics` (the field every existing
    // caller already reads) is exactly as populated either way: clean here.
    // `renderer1` again only to keep that array actually empty — see the
    // previous test's comment.
    game = await createGame({
      loader: {
        fetchFn: fakeFetch({ rows: [row('boot1'), row('renderer1')], diagnostics: [] }),
        importModule: importHalf,
      },
    });

    expect(game.ctx.diagnostics).toBeUndefined();
    expect(game.diagnostics).toEqual([]);
  });

  /**
   * The HOST's own project diagnostics go into the service too — `boot` and
   * the game's page both paint `list()` and both need the whole picture —
   * but they are SEEDED, not reported, because the editor already holds
   * them off the same `/api/composition` response over its own channel.
   * Forwarding them onward made the IDE panel render one project failure
   * twice, the second copy labelled as the game's.
   */
  it("the host's own diagnostics are seeded, not reported — they are in list() and not in own()", async () => {
    const hostSaid = {
      severity: 'error' as const,
      plugin: 'session',
      where: 'patch',
      message: 'patch addresses row "session", which no bundle placed',
    };
    game = await createGame({
      loader: {
        // One host diagnostic AND one of the game's own (`broken1`'s half
        // fails to import). Both halves are needed: a test with only the
        // host's could pass on an `own()` that returns nothing at all.
        fetchFn: fakeFetch({
          rows: [row('diagnostics1'), row('broken1')],
          diagnostics: [hostSaid],
        }),
        importModule: importHalf,
      },
    });

    const list = game.ctx.diagnostics.list().map((d) => d.message);
    const own = game.ctx.diagnostics.own().map((d) => d.message);

    // Everything is in the game's own list, exactly as `GameApp.diagnostics`
    // says — that half must not regress, or `boot` loses what to paint.
    expect(list).toEqual(game.diagnostics.map((d) => d.message));
    expect(list).toContain(hostSaid.message);

    // But what a forwarder sends excludes it, and still carries the game's
    // own failure.
    expect(own).not.toContain(hostSaid.message);
    expect(own.length).toBe(list.length - 1);
    expect(own.some((m) => m.includes('this module does not exist'))).toBe(true);
  });

  it('reporting to an absent service costs nothing, even when there is something to report', async () => {
    // The guard `reportAll` (and every writer built on it) relies on: a
    // NON-EMPTY list handed to a MISSING service. `list.length === 0`
    // alone cannot catch a missing guard — the loop touches nothing either
    // way when there's nothing to iterate — so this needs a real failure
    // in the mix, with no `diagnostics1` row to receive it.
    game = await createGame({
      loader: {
        fetchFn: fakeFetch({ rows: [row('boot1'), row('broken1')], diagnostics: [] }),
        importModule: importHalf,
      },
    });

    expect(game.ctx.diagnostics).toBeUndefined();
    expect(game.diagnostics.length).toBeGreaterThan(0);
  });
});

describe('createGame — requires: checked after composition, never as an ordering hint', () => {
  /**
   * `E8RuntimeHalf.requires` (task 1) lets a row declare, in its own
   * package.json, which services it cannot do its job without. This is the
   * one place that gets enforced: `createGame` used to leave it entirely to
   * `first-slot/src/main.ts`'s own hand-rolled `REQUIRES` list, which knew
   * nothing about any OTHER project's rows. That list is gone now (see
   * `main.ts`'s own history) — every project gets this for free, from
   * whatever its own rows declared.
   */
  it('a row that requires a service nothing provides is a diagnostic naming both', async () => {
    const mount = document.createElement('div');

    // `row('reels1')` carries no `requires` of its own (see `helpers.ts`'s
    // `REQUIRES_BY_PREFIX` — only `playloop` does), so this composition's
    // only row is given one by hand: it needs `board`, and nothing here
    // provides it.
    game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({
          rows: [{ ...row('reels1'), requires: ['board'] }],
          diagnostics: [],
        }),
        importModule: async () => ({ apply: () => {} }),
      },
    });

    const d = game.diagnostics.find((x) => x.message.includes('board'))!;
    expect(d.plugin).toBe('reels1');
    expect(d.message).toContain('board');
  });

  it('names the row that would have provided it, when the composition has one', async () => {
    // reels1 IS in the composition but its half threw, so `board` never
    // appeared. "reels1 failed, so board is missing" points at the real
    // cause; "board is missing" sends the reader looking for a row that is
    // right there. `playloop1` is the one that actually declares
    // `requires: ['board']` (see `helpers.ts`).
    const mount = document.createElement('div');

    game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({ rows: [row('reels1'), row('playloop1')], diagnostics: [] }),
        importModule: async (url) =>
          url.endsWith('reels1')
            ? { apply: () => { throw new Error('reels1 refused'); } }
            : { apply: (ctx: any) => { ctx.play = {}; } },
      },
    });

    const d = game.diagnostics.find((x) => x.message.includes('board'))!;
    expect(d.message).toContain('reels1');
  });

  it('a row requiring a service that IS provided says nothing', async () => {
    const mount = document.createElement('div');

    // `renderer1` is here only so `REQUIRED_SEAMS` has a winner and this
    // composition's own diagnostics list is actually empty — see every
    // other `toEqual([])` test in this file for the same reason.
    game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({
          rows: [row('renderer1'), row('reels1'), row('playloop1')],
          diagnostics: [],
        }),
        importModule: async (url) =>
          url.endsWith('reels1')
            ? { apply: (ctx: any) => { ctx.provide('board', {}); } }
            : { apply: () => {} },
      },
    });

    expect(game.diagnostics).toEqual([]);
  });

  it('requires is checked after ALL rows applied, not as each one lands', async () => {
    // `playloop1` (requires board) is composed BEFORE `reels1` (provides
    // board) — the opposite of `e8-base`'s own order. A row-by-row checker
    // would judge `playloop1`'s requirement at the moment IT applies, while
    // `board` still does not exist, and report it wrongly. This is the
    // property that keeps `requires` a check and not an ordering
    // constraint — get it wrong and it becomes `inject` by accident.
    const mount = document.createElement('div');

    game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({
          rows: [row('renderer1'), row('playloop1'), row('reels1')],
          diagnostics: [],
        }),
        importModule: async (url) =>
          url.endsWith('reels1')
            ? { apply: (ctx: any) => { ctx.provide('board', {}); } }
            : { apply: () => {} },
      },
    });

    expect(game.diagnostics).toEqual([]);
  });

  /**
   * Regression for a review finding: `renderer1`'s own half throws for a
   * reason that has nothing to do with `board` — its message would say so
   * on its own, under its own id — and `playloop1` requires `board`, which
   * no row anywhere provides. Nothing declares what it PROVIDES, so this
   * function cannot know `renderer1` was never going to supply `board`;
   * the fix is to state both facts and let the reader draw the inference,
   * not to have the message draw it FOR them with confident, unverifiable
   * language ("that is very likely why...").
   */
  it('reports a broken row as a fact next to a DIFFERENT missing requirement, never as its claimed cause', async () => {
    const mount = document.createElement('div');

    game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({ rows: [row('renderer1'), row('playloop1')], diagnostics: [] }),
        importModule: async (url) =>
          url.endsWith('renderer1')
            ? { apply: () => { throw new Error('renderer1 refused'); } }
            : { apply: () => {} },
      },
    });

    const d = game.diagnostics.find((x) => x.message.includes('board'))!;
    // Both facts, stated plainly.
    expect(d.message).toContain('requires "board"');
    expect(d.message).toContain('nothing in the composition provided it');
    expect(d.message).toContain('renderer1');
    expect(d.message).toContain('failed to apply');
    // No causal claim between them — that inference is the reader's to
    // draw, not this function's to assert.
    expect(d.message).not.toMatch(/very likely|why it never appeared|the real cause/i);
  });
});
