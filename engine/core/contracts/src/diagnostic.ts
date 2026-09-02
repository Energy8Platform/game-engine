/** How much a failure matters. `error` stops the game; `warning` degrades it. */
export type Severity = 'error' | 'warning' | 'info';

/** A failure that reaches a human, in the same shape for the game, the IDE and the agent. */
export interface Diagnostic {
  severity: Severity;
  /**
   * What this failure is about, in one of two disjoint namespaces — pick
   * whichever one actually applies to where the code raising the
   * diagnostic runs, not a package name in either case:
   *
   *  1. **A composition row id** (`CompositionRow.id`/`ResolvedRow.id`,
   *     e.g. `"bridge1"`) — the same identity `CompositionService.update()`
   *     takes and `CompositionRow.id`/`ResolvedRow.id` carry. Used
   *     exclusively by code that runs inside the IDE HOST while composing
   *     a project from its `e8.yml`/`e8.profile.yml`/`e8.patch.yml`
   *     (`engine/ide/host`'s `composition.ts`/`project.ts`/`index.ts`, and
   *     `parseManifest` in `manifest.ts`, which takes the entry id as a
   *     parameter for exactly this) — the only place a "row" exists at
   *     all. A diagnostic not about any one entry (e.g. a malformed
   *     e8.yml, caught before any entry exists) carries a fixed sentinel
   *     describing what it *is* about instead (e.g. `'composition'` for
   *     the file itself). Display code resolves id → row name for the
   *     human, falling back to the raw value when it doesn't match any row
   *     (see `CompositionScreen`'s `pluginLabel`). This is what
   *     `CompositionDiagnostic`, below, names.
   *  2. **A runtime seam or mechanic id** (e.g. `'session'`,
   *     `'renderer-pixi'`, `'stage'`, `'reels'`, `'play-loop'`, or a
   *     `SpinMechanic.id` like `'classic'`/`'cascade'`) — used by code
   *     that runs INSIDE A LIVE GAME (`session-dev`, `game-runtime`'s
   *     plugins, `play-loop`, `checkShape` in `mechanic.ts`). A running
   *     game's `ctx` has no composition graph to resolve an id against at
   *     all — there is no row for these to be about — so they name the
   *     seam or mechanic itself, the closest thing a game has to an
   *     address for "who is reporting this". This is what `GameDiagnostic`,
   *     below, names.
   *
   * The two namespaces first meet on one screen in Task 10: the composition
   * screen renders the GAME's resolved rows (`ResolvedRow[]`, carrying
   * `from`) next to the EDITOR's own plugin rows, and a live game's
   * diagnostics can now sit next to the host's. An `e8.yml`/`e8.patch.yml`
   * entry can be given any id a project author picks (see
   * `engine/examples/first-slot/e8.yml`'s `id: bridge1`), so a row
   * literally named `session` is not impossible, and it would render a
   * runtime diagnostic as if it were about that unrelated row if the two
   * were ever resolved against the same id-keyed lookup.
   *
   * The separation is enforced, not merely documented: `CompositionScreen`
   * keeps the two in separate props/arrays (`ctx.connection.diagnostics`
   * vs. `gameDiagnostics`) and only ever resolves the composition half
   * (`pluginLabel`) against composition rows — a `GameDiagnostic` is
   * rendered as-is, never looked up by id — the same way `connection.ts`
   * already keeps its `hostDiagnostics` and `clientDiagnostics` apart
   * instead of merging them into one array. `CompositionDiagnostic` and
   * `GameDiagnostic`, below, name the two namespaces so a signature can say
   * which one it means instead of leaving both as an unqualified
   * `Diagnostic`.
   */
  plugin: string;
  /** Where inside the plugin — a config path, a seam name, a file. */
  where: string;
  message: string;
  /** What the human can do about it, when we know. */
  fix?: string;
}

/**
 * A `Diagnostic` from namespace 1 of `Diagnostic.plugin` — `plugin` is a
 * composition row id. The `namespace` tag is optional (existing producers,
 * all of which build a plain `Diagnostic` through the `diagnostic()`
 * factory below, need not set it) but its literal type still does real
 * work: a value explicitly typed `GameDiagnostic` cannot be assigned where
 * a `CompositionDiagnostic` is expected, and vice versa, because `'game'`
 * and `'composition'` don't overlap. This does not, by itself, stop an
 * untyped or widened `Diagnostic` from being handed to either slot — the
 * guarantee that actually matters lives in `CompositionScreen` keeping the
 * two arrays apart at runtime (see `Diagnostic.plugin`'s doc comment).
 */
export interface CompositionDiagnostic extends Diagnostic {
  readonly namespace?: 'composition';
}

/** A `Diagnostic` from namespace 2 of `Diagnostic.plugin` — `plugin` is a runtime seam or mechanic id. See `CompositionDiagnostic`'s doc comment for what the `namespace` tag does and does not guarantee. */
export interface GameDiagnostic extends Diagnostic {
  readonly namespace?: 'game';
}

export function diagnostic(
  severity: Severity,
  plugin: string,
  where: string,
  message: string,
  fix?: string,
): Diagnostic {
  return fix === undefined
    ? { severity, plugin, where, message }
    : { severity, plugin, where, message, fix };
}
