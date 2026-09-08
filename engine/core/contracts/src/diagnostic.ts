/** How much a failure matters. `error` stops the game; `warning` degrades it. */
export type Severity = 'error' | 'warning' | 'info';

/** A failure that reaches a human, in the same shape for the game, the IDE and the agent. */
export interface Diagnostic {
  severity: Severity;
  /**
   * What this failure is about, in one of three disjoint namespaces — pick
   * whichever one actually applies to where the code raising the
   * diagnostic runs, not a package name in any case:
   *
   *  1. **A composition row id** (`CompositionRow.id`/`ResolvedRow.id`,
   *     e.g. `"bridge1"`) — the same identity `CompositionService.update()`
   *     takes and `CompositionRow.id`/`ResolvedRow.id` carry. Used by code
   *     composing a project or the editor's own graph from
   *     `e8.yml`/`e8.profile.yml`/`e8.patch.yml` (`engine/ide/host`'s
   *     `composition.ts`/`project.ts`/`index.ts`, `parseManifest` in
   *     `manifest.ts`, which takes the entry id as a parameter for exactly
   *     this, and the editor's own `modules.ts`, which names the row whose
   *     client half would not import) — the only place a "row" exists at
   *     all. A diagnostic not about any one entry (e.g. a malformed
   *     e8.yml, caught before any entry exists) carries a fixed sentinel
   *     describing what it *is* about instead (e.g. `'composition'` for
   *     the file itself).
   *  2. **A runtime seam or mechanic id** (e.g. `'session'`,
   *     `'renderer-pixi'`, `'stage'`, `'reels'`, `'play-loop'`, or a
   *     `SpinMechanic.id` like `'classic'`/`'cascade'`) — used by code
   *     that runs INSIDE A LIVE GAME (`session-dev`, `game-runtime`'s
   *     plugins, `play-loop`, `checkShape` in `mechanic.ts`). A running
   *     game's `ctx` has no composition graph to resolve an id against at
   *     all — there is no row for these to be about — so they name the
   *     seam or mechanic itself, the closest thing a game has to an
   *     address for "who is reporting this".
   *  3. **A key inside the editor's own UI** — a slot key
   *     (`ide-client`'s `slots.tsx`, reporting two contributions that
   *     claim one key) or a card key (`CompositionScreen`'s
   *     `CardBoundary`, reporting a card that crashed while rendering).
   *     These are not row ids and never were: the thing that collided is
   *     a key in a registry, and the row that contributed it is not what
   *     a person needs named. Written down because it used to be
   *     invisible — a deleted `pluginLabel` fallback rendered anything
   *     that matched no row as its raw value, so a key travelled through
   *     the id-shaped field without anyone noticing it was not one.
   *
   * The three meet on one screen: `DiagnosticsPanel` renders the project's
   * list, the running game's and the editor's own, one after another. An
   * `e8.yml`/`e8.patch.yml` entry can be given any id a project author
   * picks (see `engine/examples/first-slot/e8.yml`'s `id: bridge1`), so a
   * row literally named `session` is not impossible, and it would render a
   * runtime diagnostic as if it were about that unrelated row if the three
   * were ever resolved against the same id-keyed lookup.
   *
   * The separation is enforced by keeping the three in separate arrays,
   * not by the type system. There used to be a
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
   * The rule the arrays actually keep: nothing resolves `plugin` against
   * anything. `DiagnosticsPanel` prints it raw and tags each row with the
   * ARRAY it arrived in (`project`/`game`/`editor`), which is the one fact
   * about origin that cannot be got wrong by reading this field. The
   * screens that did resolve id → row name — `CompositionScreen`'s two
   * halves, each against its own rows — no longer render diagnostics at
   * all; their own comments record what that resolution was worth and
   * where it would go if it comes back. `connection.ts` still keeps
   * `hostDiagnostics` and `clientDiagnostics` apart for the same reason
   * the arrays are apart here.
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
