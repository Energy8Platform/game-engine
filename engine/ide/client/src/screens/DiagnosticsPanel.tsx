import type { Diagnostic } from '@energy8engine/contracts';

/**
 * One list of everything that has gone wrong, each row saying which side
 * it came from. §8 of the design spec states the principle this closes:
 * "Тот же список видят игра, IDE и агент" — the game, the IDE and the
 * agent see the same list. The debt this answers: the composition screen
 * could show six healthy rows next to a game sitting under its own
 * failure screen, in a browser tab the IDE never looked at. `project`
 * (namespace 1 of `Diagnostic.plugin` — composing/resolving the game),
 * `game` (namespace 2 — what the running game itself reported) and
 * `editor` (the IDE's own plugin graph, a third origin this panel used to
 * only count) finally meet on one screen here.
 *
 * **The message TYPE is what told them apart on the wire, and that
 * distinction must survive to the screen.** A human is entitled to write
 * `id: session` in `e8.patch.yml` while a running game's own session seam
 * ALSO reports as `plugin: 'session'` — see `Diagnostic.plugin`'s own doc.
 * This component never inspects `plugin` to decide a row's origin; the
 * origin is decided once, by the caller, by which prop a diagnostic was
 * handed in under (`project`, `game` or `editor`) — itself decided by
 * where that diagnostic actually came from (a `{type:'diagnostics'}`
 * message, a `{type:'game-diagnostics'}` frame, or `ctx.connection`'s own
 * state), never by inspecting the diagnostic's own fields. Project rows
 * render before game rows before editor rows; that ordering, plus the
 * origin tag on the row itself, is the only thing distinguishing two
 * diagnostics that happen to be byte-identical otherwise.
 *
 * **`game === null` is its own state, not an empty list.** A game that has
 * not reported yet — or was never connected; a project can be opened with
 * no game running at all — is not the same fact as a game that reported
 * and has nothing wrong. See `GameDiagnosticsState.diagnostics`'s own doc
 * in `diagnostics.tsx`. This panel says so in words, rather than showing a
 * silently-empty list either state could otherwise produce. `project` and
 * `editor` have no such state — both are always arrays, from the moment
 * this panel exists at all.
 *
 * **The editor used to be a count pointing elsewhere; now it is rows,
 * here.** `ctx.connection.diagnostics` — the IDE's own plugin graph —
 * used to arrive as `editorCount`, a number, with the entries themselves
 * rendered by `CompositionScreen` instead, resolved against the row each
 * was about. That left "one place to look" with a second place after
 * all. `CompositionScreen` no longer renders that list — every editor
 * diagnostic is a row here, same as `project`'s and `game`'s. The
 * id-to-row-name resolution `CompositionScreen` used to do is the one
 * capability that did not move with them; see its own comment for why.
 *
 * **`droppedFromGame` is not decoration.** The game's own diagnostics log
 * is bounded (`@energy8engine/diagnostics`), and `dropped` counts what it
 * forgot. A panel that rendered only the surviving entries, with nothing
 * anywhere saying some were forgotten, would look complete while lying
 * about it — worse than a panel that said nothing at all.
 */
export interface DiagnosticsPanelProps {
  /**
   * The project's own diagnostics — composing/resolving the game
   * (namespace 1 of `Diagnostic.plugin`). Always an array: asking "is the
   * project OK" always gets an answer, even when the answer is "nothing
   * wrong" — unlike `game`, there is no "hasn't answered yet" state for
   * the project half.
   */
  project: readonly Diagnostic[];
  /**
   * What the running game itself has reported (namespace 2). `null` until
   * its first `game-diagnostics` frame arrives — see the module doc.
   *
   * `readonly`, matching `GameDiagnosticsState.diagnostics`'s own type
   * (`useGameDiagnostics`'s return, task 7): this panel only ever reads
   * the array, so the wider (readonly-accepting) prop type is the honest
   * one, not a cast at the call site.
   */
  game: readonly Diagnostic[] | null;
  /**
   * How many more the game's own bounded log forgot, riding the same
   * frame as `game`. Meaningless while `game` is `null` (nothing has
   * reported a count yet either), so this panel says nothing about it
   * then regardless of what is passed here.
   */
  droppedFromGame?: number;
  /**
   * The EDITOR's own diagnostics — `ctx.connection.diagnostics`
   * (`useEditorDiagnostics`'s return), a third origin alongside `project`
   * and `game`. Always an array, the same as `project`: the IDE's own
   * plugin graph has no "hasn't reported yet" state either.
   *
   * This used to arrive as `editorCount`, a number, with the actual
   * entries rendered by `CompositionScreen` instead — see the module doc
   * for why that changed and what it cost. Required, like `project` and
   * `game`: it was briefly optional "so call sites written before this
   * prop existed keep compiling", which was never true of anything — the
   * prop it replaced was REMOVED in the same edit, so no such call site
   * could compile either way. What optional actually bought was a panel
   * that silently shows two of its three sources when a caller forgets
   * the third.
   */
  editor: readonly Diagnostic[];
}

interface Row {
  diagnostic: Diagnostic;
  origin: 'project' | 'game' | 'editor';
}

export function DiagnosticsPanel({
  project,
  game,
  droppedFromGame = 0,
  editor,
}: DiagnosticsPanelProps) {
  // Project rows before game rows before editor rows. The origin tag comes
  // from WHICH ARRAY a diagnostic arrived in — never from `diagnostic.plugin`
  // — see the module doc for why that field can hold the identical string
  // in all three origins on purpose.
  const rows: Row[] = [
    ...project.map((diagnostic): Row => ({ diagnostic, origin: 'project' })),
    ...(game ?? []).map((diagnostic): Row => ({ diagnostic, origin: 'game' })),
    ...editor.map((diagnostic): Row => ({ diagnostic, origin: 'editor' })),
  ];

  return (
    <section className="e8-diagnostics-panel" data-testid="diagnostics-panel">
      <h2>Diagnostics</h2>

      {rows.length > 0 && (
        <ul className="e8-diagnostics-panel-list">
          {rows.map((row, index) => (
            <li
              key={index}
              data-testid={`diag-${index}`}
              data-severity={row.diagnostic.severity}
              className="e8-diagnostic-row"
            >
              <span className="e8-diagnostic-origin">{row.origin}</span>{' '}
              <strong className="e8-severity">{row.diagnostic.severity}</strong>{' '}
              <span className="e8-diagnostic-plugin">{row.diagnostic.plugin}</span>
              {' · '}
              <span className="e8-diagnostic-where">{row.diagnostic.where}</span>
              {': '}
              <span className="e8-diagnostic-message">{row.diagnostic.message}</span>
              {row.diagnostic.fix ? ` — ${row.diagnostic.fix}` : ''}
            </li>
          ))}
        </ul>
      )}

      {rows.length === 0 && game !== null && <p className="e8-empty">nothing to report</p>}

      {game === null && <p className="e8-empty">no game connected yet</p>}

      {game !== null && droppedFromGame > 0 && (
        <p className="e8-diagnostics-dropped">
          the game's own log forgot {droppedFromGame} more — it only keeps a bounded history
        </p>
      )}
    </section>
  );
}
