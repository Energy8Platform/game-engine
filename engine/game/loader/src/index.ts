/**
 * `loader`: the piece that makes the browser stop knowing its own
 * composition in advance.
 *
 * Before this package, a game statically imported every mechanic it might
 * ever need. `composeFromProject` replaces that with two HTTP round trips
 * to the IDE host: `GET /api/composition` for the ordered row list (task
 * 4's `resolveComposition`, served by `engine/ide/host/src/plugins/
 * runtime-assets.ts`), then one fetch of each row's own `runtimeUrl` for
 * the JS that actually wires it up. A third-party mechanic package becomes
 * addable without touching this repo at all — it only has to land in the
 * project's composition.
 *
 * **This file does not build `/plugin-runtime/:id` itself** — it imports
 * whatever `row.runtimeUrl` already says, same precedent `clientUrl`
 * already set for the EDITOR's own rows (`engine/ide/client/src/plugins/
 * modules.ts` imports `row.clientUrl` rather than constructing one). The
 * host decides the URL because only the host knows whether a real vite
 * dev server is sitting on this origin: a raw, byte-for-byte
 * `/plugin-runtime/:id` response cannot resolve TypeScript syntax or a
 * bare `import 'pixi.js'`, but `/@fs/<realpath>` served through `dev-game`'s
 * own vite instance can (measured directly — see task-8-report.md's
 * appended finding). A row whose `runtimeUrl` is `null` has no runtime
 * half at all and is skipped — a legitimate, silent case, the same way a
 * half with no `apply` export is (see below), not a failure.
 *
 * This is the runtime-half sibling of `engine/ide/client/src/plugins/
 * modules.ts`, which does the identical job for the EDITOR's client half.
 * Read that file before changing this one; the two should stay obviously
 * related, not independently reinvented. They differ in exactly the ways
 * their two situations differ:
 *
 *  - The client half is driven by a live `/ide` WebSocket subscription
 *    (`ctx.connection.snapshot`) that can push a fresh row list at any
 *    time, so `modules.ts` runs an incremental `sync()` guarded by
 *    `attempted`/`applied` sets. A running GAME has no such socket — it
 *    composes itself once, at boot, from one `fetch` — so this file is a
 *    plain async function, not a cordis plugin with its own service.
 *  - The client half is applied as `apply(ctx)` — one argument — because
 *    its settings live in the row the editor already holds locally. A
 *    RUNTIME half is applied as `apply(ctx, config)` — **two** arguments —
 *    because the row's `config` is the only thing that distinguishes,
 *    say, `reels1` with a 5x3 grid from `reels1` with a 6x4 one, and
 *    there is no other channel to it. This divergence is deliberate: do
 *    not "fix" the two apply signatures into agreement.
 *
 * Every rule below is bought the same way `modules.ts`'s were — a game
 * that fails to compose must still say why, not go blank:
 *  - This function **never throws**. The composition fetch, an import, and
 *    a synchronous throw out of `apply` are all caught and turned into a
 *    `Diagnostic` instead.
 *  - A half with no `apply` export is a no-op, not a failure — it
 *    imported cleanly, it just has nothing to wire up.
 *  - Rows are applied **in order, one at a time** (a `for` loop with
 *    `await`, not `Promise.all`) — the composition is ordered on purpose,
 *    and `boot` (task 5) has to be in place before it can report the
 *    failures of the rows that come after it.
 *  - One row failing does not stop the rest: the spec's isolation
 *    requirement, not an all-or-nothing app.
 *  - The caller may narrow the row list first (`options.plan`) — a seam
 *    has exactly one provider, and choosing between candidates is a rule
 *    this file deliberately does not hold. See `LoadOptions.plan`.
 */
import type { Context } from 'cordis';
import { type Diagnostic, diagnostic, type GameCompositionRow } from '@energy8engine/contracts';

/** What a `plan` step answers: which rows actually compose, and what deciding that produced. */
export interface RowPlan {
  rows: GameCompositionRow[];
  diagnostics: Diagnostic[];
}

export interface LoadOptions {
  /** Base URL of the host. Defaults to the page origin. */
  origin?: string;
  /** Injected for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Injected for tests; defaults to a dynamic import. */
  importModule?: (url: string) => Promise<unknown>;
  /**
   * The caller's one chance to decide what actually composes, between
   * "the host said these rows" and "the first row applies".
   *
   * It exists because not every row in a composition is meant to run: a
   * seam is a capability with exactly ONE provider, so when two rows both
   * offer `renderer`, applying both is precisely the wrong answer — and
   * the rule that picks between them (`@energy8engine/seam`'s
   * `selectProvider`, driven by an environment this file knows nothing
   * about) is not this loader's to hold. This function stays a faithful
   * applier of a row list; who narrows that list is the caller's problem,
   * and its diagnostics travel back with everyone else's.
   *
   * Awaited, so the caller can also bring up whatever it provides itself
   * (a session, a mount, art) BEFORE the first row applies, rather than
   * racing rows that might read it.
   */
  plan?: (rows: GameCompositionRow[]) => RowPlan | Promise<RowPlan>;
  /**
   * Called with the diagnostics the HOST sent on the composition response —
   * a malformed `e8.profile.yml`, a bundle that was not found, a row whose
   * package could not be resolved — before any row applies.
   *
   * They are also in this function's return value, exactly as they always
   * were (the same objects, spread into the returned array), so a caller
   * that ignores this hook loses nothing. It exists because a caller may
   * need to tell those apart from everything else in that array, and only
   * this function knows which is which by the time they are merged: the
   * editor ALREADY has the host's diagnostics, over its own channel, so a
   * game that forwards its list onward has to know not to send them again.
   * See `@energy8engine/diagnostics`'s `seed`/`own`.
   *
   * Never throws out of this function: like everything else here, a hook
   * that fails is not a reason for the game to go blank.
   */
  onHostDiagnostics?: (diagnostics: readonly Diagnostic[]) => void;
}

interface CompositionResponse {
  rows: GameCompositionRow[];
  diagnostics: Diagnostic[];
}

/** The shape a runtime half's module is expected to have — `apply` is optional (see the no-op rule above). */
interface RuntimeHalf {
  apply?: (ctx: Context, config: Record<string, unknown>) => void;
}

export async function composeFromProject(ctx: Context, options: LoadOptions = {}): Promise<Diagnostic[]> {
  // `location` only exists in a real browser; falling back to '' (a
  // relative fetch, resolved by whatever loaded this page) keeps this
  // usable from a test/node context that never passes `origin` either.
  const origin = options.origin ?? (typeof location !== 'undefined' ? location.origin : '');
  const fetchFn = options.fetchFn ?? fetch;
  const importModule = options.importModule ?? ((url: string) => import(/* @vite-ignore */ url));

  let composition: CompositionResponse;
  try {
    const res = await fetchFn(`${origin}/api/composition`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    composition = (await res.json()) as CompositionResponse;
  } catch (error) {
    // Named where it looked, not just that it failed: "the game loaded
    // nothing" is undebuggable without knowing which origin the browser
    // actually asked. `origin` is '' whenever the default (page origin)
    // is in play, so that case is spelled out explicitly instead of
    // printing an empty string.
    const target = origin === '' ? '(page origin)' : origin;
    return [
      diagnostic(
        'error',
        'composition',
        'fetch',
        `failed to fetch composition from ${target}/api/composition: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'check that the IDE host is running and reachable from the browser',
      ),
    ];
  }

  // The host's own diagnostics (a malformed e8.yml, a bundle that failed to
  // resolve, …) travel through untouched; rows below only ever ADD to this.
  const diagnostics: Diagnostic[] = [...composition.diagnostics];
  // Announced as well as returned — see `LoadOptions.onHostDiagnostics`.
  // The SAME objects that went into `diagnostics` above (the array is
  // spread; the diagnostics in it are not copied), so a caller can match
  // them by identity against what this function returns. Guarded because a
  // caller's hook throwing must not abandon a composition that has not
  // started applying yet.
  if (options.onHostDiagnostics && composition.diagnostics.length > 0) {
    try {
      options.onHostDiagnostics(composition.diagnostics);
    } catch {
      // Nothing to report it to that would not be this same list.
    }
  }

  // No `plan`: every row the host resolved applies, in the order it
  // resolved them — the behaviour before this option existed.
  let rows = composition.rows;
  if (options.plan) {
    try {
      const planned = await options.plan(rows);
      rows = planned.rows;
      diagnostics.push(...planned.diagnostics);
    } catch (error) {
      // Same rule as a row's own `apply`: the caller's decision failing
      // is data, not a reason for the game to go blank. Nothing composes
      // in that case — a plan that threw has no answer about which rows
      // were meant to.
      rows = [];
      diagnostics.push(
        diagnostic(
          'error',
          'composition',
          'plan',
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  for (const row of rows) {
    if (row.runtimeUrl === null) continue; // no runtime half — nothing to load, not a failure

    try {
      const module = (await importModule(row.runtimeUrl)) as RuntimeHalf;
      // Awaited on purpose. A synchronous throw from `apply` lands in this
      // same try/catch either way (the call is still inside the `try`),
      // but an ASYNC `apply` — `renderer-pixi`'s among them, and every
      // other row in `e8-base` could reasonably become one — returns a
      // pending promise that a bare, un-awaited call lets float free. An
      // unawaited rejection is not "no diagnostic": it is an unhandled
      // promise rejection, invisible to this function's own try/catch and
      // to anyone reading the screen. Measured directly: `boot1` failed
      // exactly this way before both this fix and its own row config bug
      // were corrected (see task-8-report.md).
      await module.apply?.(ctx, row.config);
    } catch (error) {
      // The URL is interpolated, not left to the caught error to mention:
      // a native `import()` failure says something like "Failed to fetch
      // dynamically imported module" and a throw out of `apply` says
      // nothing about where the module came from at all. With the host now
      // reporting the rows it could not resolve at all, this row-level
      // diagnostic is often the only ADDRESS a person gets for a row that
      // did resolve and then broke — and `row.runtimeUrl` is right here.
      diagnostics.push(
        diagnostic(
          'error',
          row.id,
          'runtime',
          `${row.runtimeUrl}: ${error instanceof Error ? error.message : String(error)}`,
          'check the plugin runtime entry in its package.json',
        ),
      );
    }
  }

  return diagnostics;
}
