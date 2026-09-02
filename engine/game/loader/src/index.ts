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
 */
import type { Context } from 'cordis';
import { type Diagnostic, diagnostic, type GameCompositionRow } from '@energy8engine/contracts';

export interface LoadOptions {
  /** Base URL of the host. Defaults to the page origin. */
  origin?: string;
  /** Injected for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Injected for tests; defaults to a dynamic import. */
  importModule?: (url: string) => Promise<unknown>;
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

  for (const row of composition.rows) {
    if (row.runtimeUrl === null) continue; // no runtime half — nothing to load, not a failure

    try {
      const module = (await importModule(row.runtimeUrl)) as RuntimeHalf;
      // Synchronous throws from `apply` land in this same try/catch as an
      // import failure — the call is still inside the `try`, so nothing
      // extra is needed to catch it.
      module.apply?.(ctx, row.config);
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'error',
          row.id,
          'runtime',
          error instanceof Error ? error.message : String(error),
          'check the plugin runtime entry in its package.json',
        ),
      );
    }
  }

  return diagnostics;
}
