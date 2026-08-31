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
   *  1. **A composition row id** (`CompositionRow.id`, e.g. `"bridge1"`) —
   *     the same identity `CompositionService.update()` takes and
   *     `CompositionRow.id` carries. Used exclusively by code that runs
   *     inside the IDE HOST while composing a project from its `e8.yml`
   *     (`engine/ide/host`'s `composition.ts`/`index.ts`, and
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
   * Today the two never mix in one `Diagnostic[]`: composition
   * diagnostics travel only through `engine/ide/host`'s `Snapshot`/`/ide`
   * socket (`ConnectionService.diagnostics`' `hostDiagnostics` half in
   * `engine/ide/client/src/plugins/connection.ts`), and a running game's
   * own diagnostics (`GameApp.diagnostics`) stay local to whatever browser
   * tab is running it — nothing forwards them across that socket yet. If
   * that ever changes (surfacing a live game's diagnostics — e.g. which
   * session provider is active — in the composition screen is an intended
   * later step), keep the two OUT of the same id-resolved array the same
   * way `connection.ts` already keeps host- and client-authored
   * diagnostics apart, rather than relying on the two namespaces never
   * colliding: an `e8.yml` entry can be given any id a project author
   * picks (see `engine/examples/first-slot/e8.yml`'s `id: bridge1`), so a
   * row literally named `session` is not impossible, and it would render
   * a runtime diagnostic as if it were about that unrelated row.
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
