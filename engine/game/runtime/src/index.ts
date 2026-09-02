/**
 * The game runtime. `createGame` boots a game — it does not decide what
 * the game IS.
 *
 * That distinction is the whole point of this file. It used to import both
 * mechanics, `renderer-pixi`, `stage`, `reels`, `boot` and `play-loop` at
 * the top and wire them together by hand, which meant a third-party
 * mechanic could not join a game without an edit to this repo. The row
 * list now comes from the project — `composeFromProject` fetches
 * `/api/composition` and applies each row's runtime half in order — so
 * adding a plugin is a line of YAML in a bundle or a patch, and this file
 * never learns its name.
 *
 * What is left here is only what genuinely cannot live in a project file:
 *
 *  1. **Live values.** A `.yml` row can carry a grid size; it cannot carry
 *     a function (the symbol resolver that turns an id into art) or a DOM
 *     element (the mount the game draws into). Those reach their rows
 *     through `config.provide` — a map of service name to value, placed on
 *     the context BEFORE the first row applies, so a row reads them the
 *     same way it reads any other row's service. `createGame` does not
 *     know which row wants which name; the caller names the capability
 *     (`assets`, `mount`, anything a third-party row asks for) and the row
 *     reads it. `mount` is the one value this file also uses itself — it
 *     is where the failure screen goes — so it has its own field, and is
 *     provided under the name `mount` for rows that want it too.
 *
 *  2. **The seam choice.** A seam is a capability with exactly one
 *     provider. When a composition offers two `renderer` rows, applying
 *     both, or applying whichever came first, is the worst available
 *     outcome: the game runs, looks fine, and renders with something other
 *     than what the person intended. So candidates (rows whose package
 *     declares `e8.seam`) go through `@energy8engine/seam`'s
 *     `selectProvider`, and only the winner is composed. Zero or two
 *     matching candidates yields no provider and a diagnostic naming them
 *     and their matchers.
 *
 *  3. **The failure screen.** `boot` no longer orchestrates anything — it
 *     renders (see `@energy8engine/boot/runtime`). Deciding WHEN to render
 *     needs the whole diagnostics list and the mount, and only the caller
 *     of `composeFromProject` holds both. So this file makes that call.
 *
 * Failures are data throughout: `createGame` never throws. A composition
 * that fails returns a `GameApp` whose `diagnostics` say why, and — when
 * there is a mount — puts that same text where a person can read it,
 * rather than leaving a blank rectangle.
 */
import { Context } from 'cordis';
import {
  diagnostic,
  type Diagnostic,
  type E8SeamDeclaration,
  type GameCompositionRow,
} from '@energy8engine/contracts';
import { composeFromProject, type LoadOptions, type RowPlan } from '@energy8engine/loader';
import { selectProvider, type SeamCandidate, type SeamContext } from '@energy8engine/seam';
import { renderBootFailure } from '@energy8engine/boot';
import type { BootService } from '@energy8engine/boot/runtime';
import type { SessionConfig } from '@energy8engine/session-dev';

export type { MechanicsService, MechanicsConfig } from './plugins/mechanics';

/**
 * Seams a game is expected to have even when nothing offers one. A game
 * whose composition has no `renderer` provider is a blank screen, and the
 * one thing it must not do is be blank silently — so zero candidates here
 * is a diagnostic, not a quiet no-op. Every other seam is resolved only
 * when something actually offers it: a game reaching its math over its own
 * `fetch` legitimately has no `session` provider, and saying so would be
 * noise.
 */
const REQUIRED_SEAMS = ['renderer'];

const SESSION_SEAM = 'session';

/**
 * The provider name `config.session` enters the `session` seam under. This
 * is the one package name left in this file, and it is here for the reason
 * given at `GameConfig.session`: `session-dev` is not a composition row —
 * it is a local development capability the CALLER hands over, and it still
 * has to compete for the seam rather than assume it.
 */
const LOCAL_SESSION_PROVIDER = 'session-dev';

export interface GameConfig {
  /**
   * Live values the project file cannot carry, as service name → value,
   * placed on the context before the first row applies. A row reads them
   * off `ctx` exactly like any other service — `reels1` takes its symbol
   * resolver from `assets`, for instance. Nothing here is special-cased by
   * name: a third-party row asks for whatever it asks for, and the caller
   * provides it.
   */
  provide?: Record<string, unknown>;
  /**
   * Where to reach the composition, and (for tests) what to fetch and
   * import with. `plan` is set by `createGame` itself — the seam choice is
   * not the caller's to override.
   */
  loader?: Omit<LoadOptions, 'plan'>;
  /**
   * The element this game owns on the page. Provided to rows as the
   * `mount` service (the renderer attaches its canvas there), and used
   * directly by this file as the surface the failure screen is drawn on.
   * Omitted in tests and headless callers — everything still composes,
   * there is just nothing to draw.
   */
  mount?: HTMLElement;
  /** This build's target, for seam matchers declaring `{ buildTarget: … }`. */
  buildTarget?: string;
  /** Query parameters, for seam matchers declaring `{ urlParam: … }`. Defaults to the page's own. */
  urlParams?: Record<string, string>;
  /**
   * Starts a local `session-dev` as this game's `session` provider. Kept
   * as a config field rather than a composition row because it is a
   * DEVELOPMENT capability of the caller's process, not a plugin of the
   * game: its module graph reaches `node:child_process`/`node:fs`/
   * `node:net` (it spawns the real e8-server binary), so the import below
   * is dynamic and stays behind this condition. A static import resolves
   * and evaluates before any of `createGame`'s own code runs, and a
   * bundler targeting a browser externalizes those builtins — which throws
   * on evaluation and aborts the whole module graph, session or no
   * session. That was measured in `engine/examples/first-slot`'s browser
   * entry (task-11-report.md), and `tests/lazy-session-import.test.ts`
   * pins it.
   */
  session?: SessionConfig;
}

export interface GameApp {
  ctx: Context;
  /** Everything that went wrong, from the host's own project diagnostics through the seam choice to each row's runtime half. Never a reason for `createGame` to reject. */
  diagnostics: Diagnostic[];
  stop(): Promise<void>;
}

type SeamRow = GameCompositionRow & { seam: E8SeamDeclaration };

function isSeamCandidate(row: GameCompositionRow): row is SeamRow {
  return row.seam !== undefined;
}

/** The page's own query string, for matchers that key off one. Empty anywhere there is no `location`. */
function readUrlParams(): Record<string, string> {
  if (typeof location === 'undefined') return {};
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(location.search)) params[key] = value;
  return params;
}

/**
 * Boots the game. Async because composition is: the composition is
 * fetched, and each row's runtime half imported and applied, before this
 * resolves — so every caller gets a `GameApp` whose services are already
 * settled: present, or permanently absent with a `Diagnostic` explaining
 * why, never "maybe, ask again later."
 */
export async function createGame(config: GameConfig = {}): Promise<GameApp> {
  const ctx = new Context();
  const diagnostics: Diagnostic[] = [];

  try {
    // Everything the caller supplies goes on the context first, so a row
    // applied a moment later finds it already there. `mount` is provided
    // under its own name for the same reason the rest are: a row that
    // needs the page (the renderer, attaching its canvas) has no other
    // way to reach it.
    if (config.mount) ctx.provide('mount', config.mount);
    for (const [name, value] of Object.entries(config.provide ?? {})) {
      ctx.provide(name, value);
    }

    const env: SeamContext = {
      buildTarget: config.buildTarget,
      urlParams: config.urlParams ?? readUrlParams(),
    };

    /**
     * Runs between "the host said these rows" and "the first row
     * applies": picks one provider per seam, drops the rows that lost,
     * and brings up the caller's own session provider if that is the one
     * that won — before any row that might read `ctx.session`.
     */
    const plan = async (rows: GameCompositionRow[]): Promise<RowPlan> => {
      const candidates: SeamCandidate[] = rows.filter(isSeamCandidate).map((row) => ({
        seam: row.seam.name,
        // The row id, not the package name: two rows can be the same
        // package with different config, and the id is what a person
        // edits in the patch to resolve the ambiguity.
        provider: row.id,
        matcher: row.seam.matcher,
      }));

      if (config.session) {
        candidates.push({
          seam: SESSION_SEAM,
          provider: LOCAL_SESSION_PROVIDER,
          matcher: { default: true },
        });
      }

      const planDiagnostics: Diagnostic[] = [];
      const winner = new Map<string, string | null>();
      for (const seam of new Set([...REQUIRED_SEAMS, ...candidates.map((c) => c.seam)])) {
        const selection = selectProvider(seam, candidates, env);
        planDiagnostics.push(...selection.diagnostics);
        winner.set(seam, selection.provider);
      }

      if (winner.get(SESSION_SEAM) === LOCAL_SESSION_PROVIDER) {
        try {
          // Dynamic on purpose — see `GameConfig.session`.
          const session = await import('@energy8engine/session-dev');
          await ctx.plugin(session, config.session!);
          // `session-dev` already computed the SPECIFIC reason it could
          // not start (naming the binary, pointing at binPath/
          // E8_SERVER_BINARY/gamesDir) and exposes it eagerly for exactly
          // this. Pushing it through beats re-deriving a vaguer one from
          // `pid === null`.
          const started = ctx.reflect.get('session', false) as
            | { startupDiagnostic?: Diagnostic | null }
            | undefined;
          if (started?.startupDiagnostic) planDiagnostics.push(started.startupDiagnostic);
        } catch (error) {
          // Caught here rather than left to the loader's own catch: a
          // session that fails to start must not take the seam
          // diagnostics collected above down with it, and must not stop
          // the rows from composing either. Nothing orchestrates a
          // "don't even try the renderer" any more — `boot` renders, it
          // does not decide (see `@energy8engine/boot`).
          planDiagnostics.push(
            diagnostic(
              'error',
              LOCAL_SESSION_PROVIDER,
              'start',
              error instanceof Error ? error.message : String(error),
            ),
          );
        }
      }

      return {
        // A row that declares no seam always composes; a row that does
        // composes only if it won. Losing is silent here — the diagnostic
        // explaining why nothing won was already recorded above.
        rows: rows.filter((row) => !isSeamCandidate(row) || winner.get(row.seam.name) === row.id),
        diagnostics: planDiagnostics,
      };
    };

    diagnostics.push(...(await composeFromProject(ctx, { ...config.loader, plan })));
  } catch (error) {
    // `composeFromProject` catches its own failures, its rows', and the
    // plan's, so reaching here means something structural — providing a
    // caller's service, say — broke. It still must not reject: this
    // function's caller may be a module-top-level `await` with no `try`
    // of its own, and a throw there renders nothing at all.
    diagnostics.push(
      diagnostic(
        'error',
        'game-runtime',
        'compose',
        `composition failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  if (config.mount && diagnostics.some((d) => d.severity === 'error')) {
    // The composed `boot` row's renderer when the composition got that
    // far, this package's own copy of the same function when it did not.
    // The fallback is the point: the screen that reports "the composition
    // failed" cannot itself depend on the composition having succeeded.
    const boot = ctx.reflect.get('boot', false) as BootService | undefined;
    (boot?.renderFailure ?? renderBootFailure)(config.mount, diagnostics);
  }

  return {
    ctx,
    diagnostics,
    stop: async () => {
      await ctx.fiber.dispose();
    },
  };
}
