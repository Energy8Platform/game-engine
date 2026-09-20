/**
 * The composition a test pretends the host served, with no host in it.
 *
 * Duplicated from `engine/game/loader/tests/load.test.ts` deliberately,
 * not imported across the package boundary: each engine package has its
 * own vitest config and alias, and a relative climb into another
 * workspace's test directory resolves on one machine and not the next.
 * Twelve lines are cheaper than a shared test-utils package for two
 * callers; if a third appears, extract then.
 */
import type { E8SeamDeclaration, GameCompositionRow, SpinSchema } from '@energy8engine/contracts';

/**
 * Which seam a row declares, keyed by the alphabetic part of its id.
 *
 * A real row gets this from its package's `e8.seam` manifest field, which
 * the host reads and attaches (see `runtime-assets.ts`); a test has no
 * package.json to read, so the fixture stands in for one. Only ids that
 * name a seam get a declaration — `reels1`, like most rows, is a
 * candidate for nothing and always composes. `default: true` mirrors what
 * `@energy8engine/renderer-pixi` actually declares.
 */
const SEAM_BY_PREFIX: Record<string, E8SeamDeclaration> = {
  renderer: { name: 'renderer', matcher: { default: true } },
  session: { name: 'session', matcher: { default: true } },
  // `e8-base`'s two real `session` candidates, mirroring each package's own
  // `e8.seam` (design doc §3): the dev host by default, the platform SDK
  // when the build says so.
  sessionhost: { name: 'session', matcher: { default: true } },
  sessionsdk: { name: 'session', matcher: { buildTarget: 'platform' } },
  // Mirrors `@energy8engine/shell-pixi`'s own `e8.seam` (design doc §4).
  shell: { name: 'ui.shell', matcher: { default: true } },
};

/**
 * Which services a row requires, keyed the same way `SEAM_BY_PREFIX` is.
 *
 * Mirrors what `@energy8engine/play-loop`'s own `package.json` now declares
 * (`e8.runtime.requires: ["board"]`) — a play loop with no board to run a
 * plan against cannot do its job, the same honest reading `requires`'s own
 * doc comment invites. Kept here, and not only there, so a fixture row
 * built by `row('playloop1')` behaves like the real package would without
 * every test spelling `requires` out by hand — the same convenience
 * `SEAM_BY_PREFIX` already buys for `renderer`/`session`.
 */
const REQUIRES_BY_PREFIX: Record<string, string[]> = {
  playloop: ['board'],
};

/** A minimal `GameCompositionRow`, shaped like `runtime-assets.ts`'s `/api/composition` would emit it. */
export function row(id: string, config: Record<string, unknown> = {}): GameCompositionRow {
  const prefix = id.replace(/\d+$/, '');
  const seam = SEAM_BY_PREFIX[prefix];
  const requires = REQUIRES_BY_PREFIX[prefix];
  return {
    id,
    name: `@e/${id}`,
    config,
    from: 'patch',
    runtimeUrl: `/plugin-runtime/${id}`,
    schema: null,
    hot: false,
    ...(seam ? { seam } : {}),
    ...(requires ? { requires } : {}),
  };
}

/**
 * A `fetchFn` that answers `GET /api/composition` with a fixed body,
 * whatever URL it's asked for. `schema` is optional and defaults to
 * absent (not `null`) — most callers don't care about it, and a fixture
 * that never mentions the field is how `createGame`'s `withSchemaCapture`
 * (see `../src/index.ts`) tells "an old host that predates schema" apart
 * from "a host that parsed the .spin and found nothing" (`schema: null`,
 * spelled out).
 */
export function fakeFetch(body: {
  rows: GameCompositionRow[];
  diagnostics: unknown[];
  schema?: SpinSchema | null;
}): typeof fetch {
  return (async () =>
    ({
      ok: true,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

/**
 * The services this suite's FAKE halves put on the context. The real
 * `renderer`/`board`/... types are declared by the packages that provide
 * them — packages this one deliberately no longer depends on, which is
 * the entire point of the task that wrote this file. So the shapes the
 * fakes stand up are declared here, and narrowly: only as far as an
 * assertion actually reads. Not optional, even though a composition
 * without them is exactly what two of these tests set up — `toBeUndefined`
 * asserts that at runtime, where it belongs, and an optional type would
 * only force a `!` onto the reads in the tests that DO compose them.
 */
declare module 'cordis' {
  interface Context {
    reels: { config: unknown };
    renderer: { app: { canvas: HTMLCanvasElement }; gl?: boolean };
    /** What the fake `stage1` half below captured off `ctx.renderer` — see `compose-from-project.test.ts`. */
    stageRenderer: { app: { canvas: HTMLCanvasElement }; gl?: boolean };
  }
}
