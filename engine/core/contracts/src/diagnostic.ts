/** How much a failure matters. `error` stops the game; `warning` degrades it. */
export type Severity = 'error' | 'warning' | 'info';

/** A place inside a source FILE — what an editor needs to draw a marker. */
export interface SourcePosition {
  /** 1-based, as every editor counts. */
  line: number;
  /** 1-based. Absent when the producer knows the line and not the column. */
  column?: number;
}

/** A failure that reaches a human, in the same shape for the game, the IDE and the agent. */
export interface Diagnostic {
  severity: Severity;
  /**
   * What this failure is about, in one of four disjoint namespaces — pick
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
   *  3. **Something the editor's own UI is addressed by** — five kinds
   *     of string, all of them the editor talking about itself:
   *
   *      - a slot key (`ide-client`'s `slots.tsx`, reporting two
   *        contributions that claim one key);
   *      - a card key (`CompositionScreen`'s `CardBoundary`, reporting a
   *        card that crashed while rendering);
   *      - a document key (`shell.tsx`, reporting a key nothing answers
   *        to, and `Shell.tsx`'s `DocumentBoundary`, reporting a document
   *        that crashed);
   *      - a screen-preset name (`PreviewWall`, reporting a preset the
   *        wall was asked for and `SCREEN_PRESETS` does not define);
   *      - and, widest of all, a raw address fragment a human typed —
   *        `shell.tsx` passes the hash's key straight in when it names
   *        no document. That one is not a registry key at all, and cannot
   *        be: what is being reported is precisely that nothing answers
   *        to it.
   *
   *     None of these are row ids and none ever were: the thing being
   *     reported is a key (or a would-be key) in the editor, and the row
   *     that contributed it is not what a person needs named. Written
   *     down because it used to be invisible — a deleted `pluginLabel`
   *     fallback rendered anything that matched no row as its raw value,
   *     so a key travelled through the id-shaped field without anyone
   *     noticing it was not one.
   *  4. **A fixed name for a piece of the HOST that is not a row at all** —
   *     `'files'` (the project's file service and its four routes),
   *     `'server'` (the host-wide request boundary in `index.ts`, which
   *     answers for a throw that happened before any handler ran, and
   *     refuses a cross-origin write), `'workspace'` (the folder-of-projects
   *     service: a root it cannot list, an id it does not have, a project
   *     scope that failed to start or stop), `'ide-static'` (the built
   *     IDE shell: a path not in the build, a build that is not there)
   *     and `'compute'` (the headless `e8 check`/`e8 spin`/`e8 shot`
   *     functions in `ide-host/src/compute`: a file they cannot read, an
   *     `n` or `bet` or flag they cannot use; `where` is the path or the
   *     flag). `shot`'s `where` is likewise whatever it was working on:
   *     the PNG path it could not write, the url it could not open or
   *     that was not ready, `playwright` when there is no browser,
   *     `#spin`/`#status` when the spin it clicked did not settle.
   *     These arrived with the file service and fit none
   *     of the three above: a read of `art/logo.png` is about no
   *     composition row, no running seam and no editor key. The `where`
   *     carries the requested path, the request path or the project id;
   *     `plugin` names the service that refused. Listed
   *     because a doc this specific has to grow the case rather than let
   *     a fourth kind travel undeclared.
   *
   * The four meet on one screen: `DiagnosticsPanel` renders the project's
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
  /**
   * Why this failed, for code that has to BRANCH on it — a stable tag no
   * translation touches, unlike `message`. Optional because most producers
   * have nothing branching on them; see `FileFailure` in `files.ts` for
   * the one vocabulary that exists so far, and the 404-turned-400 it was
   * added to prevent.
   */
  code?: string;
  /**
   * Where in a source FILE this is, when the producer knows. Structured
   * because an editor needs a number: `where` carries prose for a human and
   * must never be parsed back — this branch removed exactly that pattern from
   * the host's status selection one slice ago (see `code` above).
   *
   * Absent everywhere except the spin parser today, and absent is not "line
   * 1" — a diagnostic about a whole file has no `at`, because a marker at
   * the top of the file for a whole-file problem would accuse innocent code.
   * Attached by the producer after the fact, the same way `fileDiagnostic`
   * attaches `code`: not a constructor argument, so this factory's five
   * positional strings don't grow a sixth.
   */
  at?: SourcePosition;
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
