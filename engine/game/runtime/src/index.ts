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
 *     know which row wants which name: the caller names the capability
 *     (`assets`, or whatever a third-party row asks for) and the row reads
 *     it. One name IS special-cased — `mount`, the element the game owns
 *     on the page, because this file also uses it itself for the failure
 *     screen. It travels as `config.mount`, and the name is RESERVED:
 *     providing `mount` through the map too is one diagnostic naming that
 *     entry, not a second registration and not a dead composition.
 *
 *  2. **The seam choice.** A seam is a capability with exactly one
 *     provider. When a composition offers two `renderer` rows, applying
 *     both, or applying whichever came first, is the worst available
 *     outcome: the game runs, looks fine, and renders with something other
 *     than what the person intended. So candidates (rows whose package
 *     declares `e8.seam`) go through `@energy8engine/seam`'s
 *     `selectProvider`, and only the winner is composed. Zero or two
 *     matching candidates yields no provider and a diagnostic naming them
 *     and their matchers. The winner also takes the losing candidate's
 *     POSITION in the row order rather than keeping its own, so a patch
 *     that ADDS a competing provider — which `resolveComposition` appends
 *     last — still applies before the rows that read the seam. See the
 *     `slotOf` map in `plan`.
 *
 *  3. **The failure screen.** `boot` no longer orchestrates anything — it
 *     renders (see `@energy8engine/boot/runtime`). Deciding WHEN to render
 *     needs the whole diagnostics list and the mount, and only the caller
 *     of `composeFromProject` holds both. So this file makes that call.
 *     Note what that means for the mount: the screen REPLACES its
 *     children, including a canvas `renderer1` may already have attached.
 *     That is intended — a composition with an `error` in it is not a game
 *     a player should be looking at, and half a game under an error
 *     message is worse than the message alone.
 *
 * Failures are data throughout: `createGame` never throws. A composition
 * that fails returns a `GameApp` whose `diagnostics` say why, and — when
 * there is a mount — puts that same text where a person can read it,
 * rather than leaving a blank rectangle.
 */
import { Context, type Fiber } from 'cordis';
import {
  diagnostic,
  type Diagnostic,
  type E8SeamDeclaration,
  type GameCompositionRow,
  isSpinSchema,
  moduleCopies,
  type SpinSchema,
} from '@energy8engine/contracts';
import { composeFromProject, type LoadOptions, type RowPlan } from '@energy8engine/loader';
import { selectProvider, type SeamCandidate, type SeamContext } from '@energy8engine/seam';
import { renderBootFailure } from '@energy8engine/boot';
import type { BootService } from '@energy8engine/boot/runtime';
import type { SessionConfig } from '@energy8engine/session-dev';
import type { DiagnosticsService } from '@energy8engine/diagnostics';
import { checkAgainstSchema } from './plugins/mechanics';

export type { MechanicsService } from './plugins/mechanics';

/**
 * The game's one door for a live row edit. The IDE (through `ide-bridge`)
 * names a row and hands over that row's WHOLE new config — a patch row
 * replaces, it does not merge — and the row's own fiber re-applies in
 * place: cordis disposes every effect the row made and runs its `apply`
 * again, and nothing else in the game restarts, so the session, the
 * balance and the spin log all live on. Every row `composeFromProject`
 * applied has a fiber here, the ones whose `apply` threw included: a bad
 * config fixed live is exactly the case that wants a re-apply.
 */
export interface GameRowsService {
  /**
   * `'updated'` once the row has re-applied with `config`; `'unknown'` for
   * an id with no fiber (a row that never composed — lost its seam, had no
   * runtime half, or failed to import) — silent, by design; `'failed'` when
   * the re-apply threw, or when the row still could not apply because its
   * `inject` is unmet — either way an `error` diagnostic on
   * `ctx.diagnostics` naming the row. A failed row keeps its fiber: the
   * next `update` runs `apply` again.
   */
  update(id: string, config: Record<string, unknown>): Promise<'updated' | 'unknown' | 'failed'>;
}

declare module 'cordis' {
  interface Context {
    gameRows: GameRowsService;
  }
}

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

/** `cordis`'s `FiberState.PENDING` — a `const enum`, so no runtime value to import. */
const FIBER_PENDING = 0;

const SESSION_SEAM = 'session';

/**
 * The provider name `config.session` enters the `session` seam under. This
 * is the one package name left in this file, and it is here for the reason
 * given at `GameConfig.session`: `session-dev` is not a composition row —
 * it is a local development capability the CALLER hands over, and it still
 * has to compete for the seam rather than assume it.
 */
const LOCAL_SESSION_PROVIDER = 'session-dev';
/**
 * Its module, as a VARIABLE rather than a literal at the `import()` below:
 * a dynamic import keeps a literal specifier out of the browser's way at
 * evaluation time (see `GameConfig.session`), but a bundler still follows
 * a literal — `vite build` over a game page (`e8 build`) traced this into
 * `node:fs`/`node:child_process` and refused the whole build, measured in
 * task-7-report.md of the shell/session/build slice. Rollup cannot follow
 * an identifier, so the bundle carries the bare specifier and nothing
 * behind it; the branch that reaches it is a Node caller's (`compose.test.ts`
 * spawns the real e8-server through it), never a page's.
 */
const LOCAL_SESSION_MODULE = '@energy8engine/session-dev';

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
  /**
   * Seam names to leave unprovided — every candidate declaring one of
   * these seams is dropped before a winner is picked, and no diagnostic is
   * raised for it: the caller asked. The editor page composes with
   * `without: ['ui.shell']` (§4 of the design doc), so the scene editor
   * never mounts the Pixi shell even though the same composition's `shell1`
   * row is right there. A name matching no candidate is a silent no-op. A
   * seam listed in `REQUIRED_SEAMS` is the one exception: it is still
   * visited below regardless of `without` (that loop draws its seam set
   * from `REQUIRED_SEAMS` too, not only from the surviving candidates), so
   * `without: ['renderer']` still produces the ordinary "no provider"
   * diagnostic rather than silently blanking the screen.
   */
  without?: string[];
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

/**
 * Draws the reasons where a person can read them: through the composed
 * `boot` row when the composition got that far, through this package's own
 * copy of the same function when it did not.
 *
 * Both halves are load-bearing. The fallback exists because the screen
 * reporting "the composition failed" cannot itself depend on the
 * composition having succeeded. The try/catch exists because the composed
 * one is a THIRD PARTY's code — replacing the boot row with a branded
 * screen is a thing this design actively invites — and a failure screen
 * that throws would propagate out of `createGame`, whose caller is
 * routinely a module-top-level `await` with no `try` of its own. That
 * leaves the page blank: the exact white rectangle this whole mechanism
 * exists to prevent, reached through the one service we told people to
 * swap. The diagnostic is pushed BEFORE the fallback runs, so the screen
 * a person ends up looking at names the broken screen too.
 */
function renderFailure(ctx: Context, mount: HTMLElement, diagnostics: Diagnostic[]): void {
  const boot = ctx.reflect.get('boot', false) as BootService | undefined;
  if (boot) {
    try {
      boot.renderFailure(mount, diagnostics);
      return;
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'error',
          'boot',
          'renderFailure',
          `the composed failure screen threw: ${error instanceof Error ? error.message : String(error)}`,
          'fix the boot row, or remove it so the built-in screen is used',
        ),
      );
    }
  }
  renderBootFailure(mount, diagnostics);
}

/** A row's re-apply threw: the row stays on its old effects-less fiber (cordis does not roll back), and the person hears why. */
function reportHotFailure(ctx: Context, rowId: string, error: unknown): void {
  const d = diagnostic(
    'error',
    rowId,
    'hot update',
    `re-applying "${rowId}" with the edited config threw: ${
      error instanceof Error ? error.message : String(error)
    }`,
    'fix the value, or reload the game to go back to the composition on disk',
  );
  const log = ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined;
  log?.report(d);
}

/** The page's own query string, for matchers that key off one. Empty anywhere there is no `location`. */
function readUrlParams(): Record<string, string> {
  if (typeof location === 'undefined') return {};
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(location.search)) params[key] = value;
  return params;
}

/**
 * Wraps the `fetchFn` handed to `composeFromProject` so this file can read
 * `schema` off the SAME `/api/composition` response the loader already
 * fetches for `rows`/`diagnostics`, instead of a second round trip to the
 * same URL — the host puts `schema` in that response for exactly this
 * reason (see `runtime-assets.ts`'s doc comment on `GET /api/composition`).
 * `composeFromProject` calls `fetchFn` exactly once. On the SUCCESS path
 * it only ever reads `res.ok` and `res.json()` off what comes back, so
 * substituting a plain object shaped the same way, after reading the body
 * ourselves, changes nothing it can observe there. On the FAILURE path
 * (`!res.ok`) it also reads `res.status`/`res.statusText` to build its own
 * diagnostic — which is exactly why that branch, below, returns the
 * original `res` untouched rather than a substitute missing those fields.
 *
 * A response whose status was not ok is returned untouched — that is
 * `composeFromProject`'s own failure to report, and this wrapper has
 * nothing useful to say about a schema it never got a body for.
 * `onSchema` runs after validating the raw wire value through
 * `isSpinSchema`, and the three answers it can give are not alike:
 *
 *  - **absent** (`schema` is not a field of the body at all) — an old host,
 *    or a test double that predates schemas. "No schema", silently: there
 *    is nothing to say about a field nobody sent.
 *  - **`null`** — the host read the `.spin` and could not parse it. Also
 *    silent here: the host has already said so, in its own diagnostics,
 *    which travel in the same response.
 *  - **present and malformed** — a value ARRIVED and this side rejected it.
 *    That one is reported. The consequence is invisible otherwise: a
 *    rejected schema becomes `null`, `checkAgainstSchema(null, …)` returns
 *    `[]` by design, and the entire pre-flight silently stops running while
 *    every screen still reads as healthy. Failures are data, and this is a
 *    failure of the wire, not of the math.
 */
function withSchemaCapture(
  fetchFn: typeof fetch,
  onSchema: (schema: SpinSchema | null, rejected: Diagnostic | null) => void,
): typeof fetch {
  return (async (...args: Parameters<typeof fetch>) => {
    const res = await fetchFn(...args);
    if (!res.ok) return res;
    const body: unknown = await res.json();
    const raw =
      typeof body === 'object' && body !== null ? (body as { schema?: unknown }).schema : undefined;
    if (isSpinSchema(raw)) {
      onSchema(raw, null);
    } else {
      onSchema(
        null,
        raw === undefined || raw === null
          ? null
          : diagnostic(
              'warning',
              'game-runtime',
              'schema',
              'the host sent a schema this build cannot read, so no mechanic was checked against the math before the first spin',
              'the host and the game are probably built from different versions — rebuild or reinstall so both agree on the SpinSchema shape',
            ),
      );
    }
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
}

/**
 * `E8RuntimeHalf.requires` (task 1's declaration), enforced. Each row in
 * `composedRows` said, in its own package.json, which services it cannot do
 * its job without; this checks that every one of them actually exists on
 * `ctx` by now.
 *
 * **Called exactly once, after the composition loop has finished — never
 * per row.** That is not a style choice: a row that requires a service a
 * LATER row provides is not broken, because the loader has already decided
 * the order by the time this game exists. Checking as each row lands would
 * judge that row before the composition has finished answering it, and the
 * result would be `inject` again — ordering rows by their declared needs —
 * which is exactly the field `manifest.ts`'s own doc comment says
 * `requires` is not a revival of. `createGame` only calls this once, with
 * `composedRows` captured after the whole loop, so there is no branch here
 * that could run early even by accident.
 *
 * A row whose OWN half already failed (an `apply` that threw, a package
 * that would not resolve, a bad `e8.runtime.entry` — anything that left an
 * `error` diagnostic under its own id) is skipped rather than also checked:
 * its own diagnostic already explains why it provided nothing, and a
 * second complaint about its unmet requirements would just be the same
 * failure counted twice under two different rows.
 */
function checkRequires(
  ctx: Context,
  composedRows: readonly GameCompositionRow[],
  diagnosticsSoFar: readonly Diagnostic[],
): Diagnostic[] {
  const brokenRowIds = new Set(
    diagnosticsSoFar.filter((d) => d.severity === 'error').map((d) => d.plugin),
  );
  // Named alongside a missing requirement's own message, when there are
  // any — but only as a FACT, never as a claimed cause. No row anywhere
  // declares what it PROVIDES, only what it requires, so this function has
  // no way to know whether a given broken row was ever going to supply the
  // service some OTHER row is missing; `reels1` failing has nothing to do
  // with `board` being unmet if the row that actually needed `board` was
  // never going to get it from `reels1` in the first place. A reader who
  // sees both facts side by side can draw that inference for themselves —
  // correctly, most of the time a composition has exactly one broken row —
  // and the message must not draw it FOR them, confidently, when the code
  // has no way to check it.
  const brokenRowNames = composedRows.map((row) => row.id).filter((id) => brokenRowIds.has(id));

  const found: Diagnostic[] = [];
  for (const row of composedRows) {
    if (brokenRowIds.has(row.id) || !row.requires?.length) continue;
    for (const service of new Set(row.requires)) {
      if (ctx.reflect.get(service, false) !== undefined) continue;
      const missing = `the "${row.id}" row requires "${service}", and nothing in the composition provided it`;
      found.push(
        diagnostic(
          'error',
          row.id,
          service,
          brokenRowNames.length > 0
            ? `${missing}. These rows failed to apply: ${brokenRowNames
                .map((id) => `"${id}"`)
                .join(', ')}`
            : missing,
          `add a row that provides "${service}" to this composition, or check whether "${row.id}" still needs it`,
        ),
      );
    }
  }
  return found;
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
  /**
   * The subset of `diagnostics` that came from the HOST, on the composition
   * response — filled by `composeFromProject`'s `onHostDiagnostics` hook
   * below, and read once at the end of this function.
   *
   * They are in `diagnostics` too, merged with everything else, and they
   * must stay merged: `boot` paints one list and so does the game's own
   * page. What this set is for is the OTHER reader — the editor already
   * holds these, off the same `/api/composition` response, over its own
   * channel — so a game forwarding its list onward has to know not to send
   * them again. Identity is how it can tell; the loader spreads the array
   * and never copies the diagnostics in it. Declared out here rather than
   * beside its one write because the write is inside the `try` and the read
   * is after it.
   */
  const fromHost = new Set<Diagnostic>();
  /** Every applied row's fiber, by row id — what `gameRows.update` re-applies. */
  const fibers = new Map<string, Fiber>();

  try {
    // Everything the caller supplies goes on the context first, so a row
    // applied a moment later finds it already there. `mount` is provided
    // under its own name for the same reason the rest are: a row that
    // needs the page (the renderer, attaching its canvas) has no other
    // way to reach it.
    if (config.mount) ctx.provide('mount', config.mount);
    for (const [name, value] of Object.entries(config.provide ?? {})) {
      try {
        ctx.provide(name, value);
      } catch (error) {
        // One malformed entry costs one diagnostic naming it — not the
        // whole game. The realistic case is a caller passing `mount` in
        // this map as well as in its own field: cordis refuses a second
        // registration of a name, and an unguarded `provide` here would
        // abandon the composition before a single row had applied.
        diagnostics.push(
          diagnostic(
            'error',
            'game-runtime',
            'provide',
            `could not provide "${name}": ${error instanceof Error ? error.message : String(error)}`,
            '"mount" is provided by createGame itself — pass the element as config.mount, not in provide',
          ),
        );
      }
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

      // `config.without` — see that field's own doc. Recorded as `null`
      // directly, before `selectProvider` runs at all: a seam nobody was
      // allowed to enter has no decision to explain, so this costs no
      // diagnostic, unlike every other way a seam can end up unprovided.
      // The candidates themselves are dropped from `eligible` so the loop
      // below never even considers them — a `without`-ed seam that still
      // had two ambiguous candidates must stay silent, not merely picked
      // as `null` after also complaining about the ambiguity.
      const withoutSeams = new Set(config.without ?? []);
      for (const seam of withoutSeams) winner.set(seam, null);
      const eligible = candidates.filter((c) => !withoutSeams.has(c.seam));

      for (const seam of new Set([...REQUIRED_SEAMS, ...eligible.map((c) => c.seam)])) {
        const selection = selectProvider(seam, eligible, env);
        planDiagnostics.push(...selection.diagnostics);
        winner.set(seam, selection.provider);
      }

      if (winner.get(SESSION_SEAM) === LOCAL_SESSION_PROVIDER) {
        try {
          // Dynamic on purpose, and by a variable — see `GameConfig.session`
          // and `LOCAL_SESSION_MODULE`. Typed through the static `import
          // type`, so the seam's config stays checked.
          const session = (await import(
            /* @vite-ignore */ LOCAL_SESSION_MODULE
          )) as typeof import('@energy8engine/session-dev');
          await ctx.plugin(session, config.session!);
          // `session-dev` already computed the SPECIFIC reason it could
          // not start (naming the binary, pointing at binPath/
          // E8_SERVER_BINARY/gamesDir) and exposes it eagerly for exactly
          // this. Pushing it through beats re-deriving a vaguer one from
          // `pid === null`.
          const started = ctx.reflect.get('session', false) as
            { startupDiagnostic?: Diagnostic | null } | undefined;
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

      /**
       * Where each seam's provider belongs in the row order: the FIRST
       * position any candidate for that seam occupies.
       *
       * This is what makes the documented third-party story the working
       * one. `resolveComposition` APPENDS a row a patch adds, so shipping
       * `@acme/gl` with `e8.seam: { renderer, … }` and adding it as a row
       * puts it LAST — after `scenes1`, which reads `ctx.renderer`. A plain
       * filter would then compose `boot1, scenes1, …, renderer2`:
       * `renderer1` dropped for losing, `scenes1` applied against a context
       * with no renderer on it, and a failure screen blaming `scenes1` for
       * a mistake nobody made. The only arrangement that worked was
       * replacing `renderer1` in place, which abandons the competition the
       * seam exists for.
       *
       * So a winner takes the losing candidate's SLOT rather than keeping
       * its own: what a seam's position in the composition expresses is
       * "the renderer goes here", and which package fills it is exactly
       * the question the seam defers. Rows that declare no seam never
       * move.
       */
      const slotOf = new Map<string, number>();
      rows.forEach((row, index) => {
        if (!isSeamCandidate(row)) return;
        if (!slotOf.has(row.seam.name)) slotOf.set(row.seam.name, index);
      });

      const planned: GameCompositionRow[] = [];
      rows.forEach((row, index) => {
        if (!isSeamCandidate(row)) {
          planned.push(row);
          return;
        }
        // Every candidate is visited; only the one sitting in the seam's
        // slot emits, and what it emits is the WINNER, not itself. Losing
        // is silent — the diagnostic explaining why nothing won was
        // already recorded above.
        if (slotOf.get(row.seam.name) !== index) return;
        const winningId = winner.get(row.seam.name);
        // `undefined` when nothing won (zero or ambiguous candidates), and
        // also when the winner is not a row at all — `config.session`'s
        // local `session-dev` provider competes for the `session` seam
        // without being in the composition. Both mean the slot stays
        // empty, which is correct: `createGame` brings the session up
        // itself, above.
        const winningRow = rows.find(
          (candidate) =>
            isSeamCandidate(candidate) &&
            candidate.seam.name === row.seam.name &&
            candidate.id === winningId,
        );
        if (winningRow) planned.push(winningRow);
      });

      composedRows = planned;
      return { rows: planned, diagnostics: planDiagnostics };
    };

    // Captured by `withSchemaCapture` below, off the composition fetch
    // `composeFromProject` makes on its own — see that function's doc.
    let spinSchema: SpinSchema | null = null;
    // Captured by `plan` above, once it has picked a seam winner per seam
    // and settled the final row order — the exact list `composeFromProject`
    // is about to apply, one row at a time. Read by the `requires` check
    // below, after that loop has actually run: a losing seam candidate
    // never applies and owes nothing.
    let composedRows: GameCompositionRow[] = [];
    // A `warning`, not an `error`: this is a fact about the wire between a
    // host and a game, and it must not paint the failure screen over a game
    // that composes and plays perfectly well without a pre-flight — the same
    // line `plugins/schema.ts` on the host side already draws for a `.spin`
    // it could not read. What it must not do is nothing.
    const fetchFn = withSchemaCapture(config.loader?.fetchFn ?? fetch, (schema, rejected) => {
      spinSchema = schema;
      if (rejected) diagnostics.push(rejected);
    });

    diagnostics.push(
      ...(await composeFromProject(ctx, {
        ...config.loader,
        fetchFn,
        plan,
        onHostDiagnostics: (list) => {
          for (const d of list) fromHost.add(d);
        },
        onApplied: (id, fiber) => fibers.set(id, fiber),
      })),
    );

    // cordis rc.8's `Fiber.update` schedules the restart and drops its
    // promise, so a re-apply that throws is an UNHANDLED rejection on top
    // of the fiber's own recorded error (measured: vitest flagged it).
    // Listening on the update waterfall — `global`, or cordis scopes the
    // listener to the ROOT fiber's own updates — and settling that promise
    // here keeps the failure to the one place it is read from,
    // `fiber.await()` below, without hiding it: the fiber still records it.
    ctx.on(
      'internal/update',
      function (_config, _noSave, next) {
        return Promise.resolve(next()).catch(() => undefined) as unknown as void;
      },
      { global: true },
    );

    // One chain per row. Measured on cordis rc.8: two overlapping
    // `fiber.update`s keep ONE — a second call before the first's restart
    // has begun replaces it (only v2 ever applies), and one landing while
    // v1's async `apply` is in flight is dropped (the fiber restores v1's
    // epoch) — so a second edit before the first settled would silently
    // lose either way. Each row's updates run one after another; different
    // rows still run concurrently.
    const chains = new Map<string, Promise<unknown>>();
    ctx.provide('gameRows', {
      update(id, config) {
        const fiber = fibers.get(id);
        if (!fiber) return Promise.resolve('unknown');
        const task = () => reapply(fiber, id, config);
        const prev = chains.get(id) ?? Promise.resolve();
        const run = prev.then(task, task);
        chains.set(id, run);
        return run;
      },
    } satisfies GameRowsService);

    // `reapply` never rejects — a throw is a `'failed'` verdict — so the
    // chain above cannot be poisoned.
    async function reapply(
      fiber: Fiber,
      id: string,
      config: Record<string, unknown>,
    ): Promise<'updated' | 'failed'> {
      try {
        // `update` is synchronous and only SCHEDULES the restart; what
        // the re-run `apply` threw surfaces from `await()` (measured:
        // cordis rc.8 stores it as the fiber's error, which `update`
        // clears again before the next try).
        fiber.update(config);
        await fiber.await();
        // Resolved without applying: the row's `inject` is still unmet
        // (the loader said so at boot; this is the same fact, live).
        if (fiber.state === FIBER_PENDING) {
          const missing = Object.keys(fiber.inject).filter(
            (name) => ctx.reflect.get(name, false) === undefined,
          );
          throw new Error(
            `the row did not apply: it injects ${missing
              .map((name) => `"${name}"`)
              .join(
                ', ',
              )}, and nothing in the composition provides ${missing.length === 1 ? 'it' : 'them'}`,
          );
        }
        return 'updated';
      } catch (error) {
        reportHotFailure(ctx, id, error);
        return 'failed';
      }
    }

    // §7.1's pre-flight: a mechanic's `requires` checked against what the
    // math's schema actually declares, before the first spin — not just
    // against the sample of one that already ran. Only when a
    // `mechanics1`-shaped row is actually part of this composition; a
    // project with none has nothing bound to check.
    const mechanics = ctx.reflect.get('mechanics', false);
    if (mechanics) {
      // Two rows that claimed one mechanic id. Read HERE rather than
      // reported from `register` itself, because `register` returns a
      // disposer (every caller hands it to `ctx.effect`) and because this
      // is the first moment at which every row that was going to register
      // has — a row registering from an `inject` callback lands during
      // composition, not before it. See `MechanicsService.collisions`.
      diagnostics.push(...mechanics.collisions());
      diagnostics.push(...checkAgainstSchema(spinSchema, mechanics.bindings()));
    }

    // `requires`, checked once here — after `composeFromProject` has
    // awaited every row's `apply` — never inside that loop. See
    // `checkRequires`'s own doc comment for why that boundary is the whole
    // point.
    diagnostics.push(...checkRequires(ctx, composedRows, diagnostics));
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

  // Every row's module graph has loaded by now, so every stateful engine
  // package has marked itself (see contracts' `module-copies.ts`). Outside
  // the `try`: a second tween registry may be exactly why it threw.
  for (const [name, urls] of moduleCopies()) {
    if (urls.length < 2) continue;
    diagnostics.push(
      diagnostic(
        'warning',
        'runtime',
        'modules',
        `two copies of ${name} are loaded — ${urls.join(', ')}: its module state (tweens, caches, classes) exists twice`,
        `make the project resolve the engine's copy: declare it "*" or match the engine's version`,
      ),
    );
  }

  // `diagnostics` is final as of this line — nothing below adds to it. Mirror
  // it into the service a `diagnostics1` row may have provided, so a panel
  // reading `ctx.diagnostics` sees exactly what `GameApp.diagnostics` says,
  // not only what was collected after boot (see task-2-3-report.md, and the
  // module doc's point 1). A no-op when no such row composed — the row is
  // optional, like `spinlog1`; its absence costs the panel, not the game.
  // This is the ONE place this array is written to the service: every
  // producer that writes to it directly for a diagnostic born AFTER this
  // function returns (a plan step, a post-spin check, ...) is a DIFFERENT
  // event than anything collected here, so there is no double count between
  // the two.
  //
  // **Two ways in, not one, and the difference is which OTHER reader
  // already has the entry.** Everything this game worked out for itself —
  // the seam plan, a row whose `apply` threw, a schema it could not read,
  // a mechanic id two rows claimed — is `report`ed, and a bridge forwarding
  // to the editor sends it on, because nothing else would ever tell the
  // editor about it. The HOST's own project diagnostics (`fromHost`) are
  // `seed`ed instead: the editor fetched the very same list off
  // `/api/composition` for itself, so forwarding them made the IDE panel
  // render one project failure twice — once as the project's, once wrongly
  // as the game's. They still go IN, unchanged, because `boot` and the
  // game's page both paint `list()` and both need the whole picture.
  const diagnosticsService = ctx.reflect.get('diagnostics', false) as
    DiagnosticsService | undefined;
  if (diagnosticsService) {
    for (const d of diagnostics) {
      if (fromHost.has(d)) diagnosticsService.seed(d);
      else diagnosticsService.report(d);
    }
  }

  if (config.mount && diagnostics.some((d) => d.severity === 'error')) {
    renderFailure(ctx, config.mount, diagnostics);
  }

  return {
    ctx,
    diagnostics,
    stop: async () => {
      await ctx.fiber.dispose();
    },
  };
}
