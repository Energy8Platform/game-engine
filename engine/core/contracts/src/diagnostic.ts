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
   *     (see `CompositionScreen`'s `pluginLabel`).
   *  2. **A runtime seam or mechanic id** (e.g. `'session'`,
   *     `'renderer-pixi'`, `'stage'`, `'reels'`, `'play-loop'`, or a
   *     `SpinMechanic.id` like `'classic'`/`'cascade'`) — used by code
   *     that runs INSIDE A LIVE GAME (`session-dev`, `game-runtime`'s
   *     plugins, `play-loop`, `checkShape` in `mechanic.ts`). A running
   *     game's `ctx` has no composition graph to resolve an id against at
   *     all — there is no row for these to be about — so they name the
   *     seam or mechanic itself, the closest thing a game has to an
   *     address for "who is reporting this".
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
   * The separation is enforced by keeping the two in separate arrays that
   * are resolved differently, not by the type system. There used to be a
   * `CompositionDiagnostic`/`GameDiagnostic` pair here, tagged with an
   * optional `namespace` literal, meant to let a signature say which one
   * it meant. They are gone: an OPTIONAL tag that every producer omits
   * (all of them build a plain `Diagnostic` through the factory below)
   * discriminates nothing, so an unqualified `Diagnostic` was assignable
   * to either slot and the pair bought no guarantee at all. What it did
   * buy was a false one — the IDE's own panel was typed `GameDiagnostic[]`
   * while being fed the HOST's composition-row diagnostics, and the label
   * followed the type instead of the data.
   *
   * The rule the arrays actually keep: a diagnostic is resolved id → row
   * name only against rows from its OWN namespace. `CompositionScreen`'s
   * `EditorComposition` resolves `ctx.connection.diagnostics` against the
   * editor's rows; its `GameComposition` resolves the project's
   * diagnostics against the GAME's rows; neither ever resolves the
   * other's, and a live game's runtime diagnostics have no rows to
   * resolve against at all — the same way `connection.ts` already keeps
   * its `hostDiagnostics` and `clientDiagnostics` apart instead of
   * merging them into one array.
   */
  plugin: string;
  /** Where inside the plugin — a config path, a seam name, a file. */
  where: string;
  message: string;
  /** What the human can do about it, when we know. */
  fix?: string;
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
