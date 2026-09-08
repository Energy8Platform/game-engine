import type { Diagnostic } from '@energy8engine/contracts';

/**
 * One list of everything that has gone wrong, each row saying which side
 * it came from. §8 of the design spec states the principle this closes:
 * "Тот же список видят игра, IDE и агент" — the game, the IDE and the
 * agent see the same list. The debt this answers: the composition screen
 * could show six healthy rows next to a game sitting under its own
 * failure screen, in a browser tab the IDE never looked at. `project`
 * (namespace 1 of `Diagnostic.plugin` — composing/resolving the game) and
 * `game` (namespace 2 — what the running game itself reported, task 7's
 * store) finally meet on one screen here.
 *
 * **The message TYPE is what told the two apart on the wire, and that
 * distinction must survive to the screen.** A human is entitled to write
 * `id: session` in `e8.patch.yml` while a running game's own session seam
 * ALSO reports as `plugin: 'session'` — see `Diagnostic.plugin`'s own doc.
 * This component never inspects `plugin` to decide a row's origin; the
 * origin is decided once, by the caller, by which prop a diagnostic was
 * handed in under (`project` vs `game`) — which is itself decided by which
 * wire message it arrived as (`{type:'diagnostics'}` vs
 * `{type:'game-diagnostics'}`), never by inspecting the diagnostic's own
 * fields. Project rows render before game rows; that ordering, plus the
 * origin tag on the row itself, is the only thing distinguishing two
 * diagnostics that happen to be byte-identical otherwise.
 *
 * **`game === null` is its own state, not an empty list.** A game that has
 * not reported yet — or was never connected; a project can be opened with
 * no game running at all — is not the same fact as a game that reported
 * and has nothing wrong. See `GameDiagnosticsState.diagnostics`'s own doc
 * in `diagnostics.tsx`. This panel says so in words, rather than showing a
 * silently-empty list either state could otherwise produce.
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
}

interface Row {
  diagnostic: Diagnostic;
  origin: 'project' | 'game';
}

export function DiagnosticsPanel({ project, game, droppedFromGame = 0 }: DiagnosticsPanelProps) {
  // Project rows before game rows. The origin tag comes from WHICH ARRAY a
  // diagnostic arrived in — never from `diagnostic.plugin` — see the
  // module doc for why that field can hold the identical string on both
  // sides on purpose.
  const rows: Row[] = [
    ...project.map((diagnostic): Row => ({ diagnostic, origin: 'project' })),
    ...(game ?? []).map((diagnostic): Row => ({ diagnostic, origin: 'game' })),
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
