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
import type { E8SeamDeclaration, GameCompositionRow } from '@energy8engine/contracts';

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
};

/** A minimal `GameCompositionRow`, shaped like `runtime-assets.ts`'s `/api/composition` would emit it. */
export function row(id: string, config: Record<string, unknown> = {}): GameCompositionRow {
  const seam = SEAM_BY_PREFIX[id.replace(/\d+$/, '')];
  return {
    id,
    name: `@e/${id}`,
    config,
    from: 'patch',
    runtimeUrl: `/plugin-runtime/${id}`,
    ...(seam ? { seam } : {}),
  };
}

/** A `fetchFn` that answers `GET /api/composition` with a fixed body, whatever URL it's asked for. */
export function fakeFetch(body: {
  rows: GameCompositionRow[];
  diagnostics: unknown[];
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
