import type { Diagnostic, GameDiagnosticsSource } from '@energy8engine/contracts';
import type { GameDiagnosticsGroup } from '../plugins/diagnostics';

/**
 * One list of everything that has gone wrong, each row saying which side
 * it came from. §8 of the design spec states the principle this closes:
 * "the game, the IDE and the agent see the same list". The debt this answers: the composition screen
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
 * and has nothing wrong. See `GameDiagnosticsState.groups`'s own doc in
 * `diagnostics.tsx`. This panel says so in words, rather than showing a
 * silently-empty list either state could otherwise produce. `project` and
 * `editor` have no such state — both are always arrays, from the moment
 * this panel exists at all.
 *
 * **Which GAME a row came from is a finer grain living INSIDE the `game`
 * namespace, never a fourth one beside it.** `game` is `readonly
 * GameDiagnosticsGroup[]`, one entry per game that has spoken (see that
 * type's own doc) — not because a game is a new origin to render alongside
 * `project`/`game`/`editor`, but because more than one game can now be
 * talking to the host at once (the preview wall, a later task), and this
 * panel must not flatten them back into one indistinguishable list, which
 * is the exact defect the host-side half of this task closes one layer
 * down. `GAME_DIAGNOSTIC_SOURCES` (which SPEAKER) and this panel's
 * `project → game → editor` order (which NAMESPACE) are two separate axes
 * already; which GAME is a third, and it only ever refines a `game` row —
 * it never reorders or relabels a `project` or `editor` one.
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
 * **WHO said a game-namespace row is a third thing, beside which game and
 * which namespace.** Two speakers reach this panel under `game` — the
 * running game's own `ctx.diagnostics`, and the HOST reporting about that
 * game from a process no browser is in (see `GameDiagnosticsSource`). The
 * wire has always carried the difference and this panel used to drop it,
 * so the host's own `/api/spin` failure rendered as an unlabelled game row
 * beside labelled ones — a host presented as a game, which is exactly what
 * the paragraph above forbids. It is labelled now, and it is still not a
 * fourth origin: it refines a row already in the game namespace, the same
 * way which-game does.
 *
 * **`droppedFromGame` is not decoration.** The logs behind this list are
 * bounded (`@energy8engine/diagnostics`), and `dropped` counts what they
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
   * What every running game has reported (namespace 2), one group per
   * game — see `GameDiagnosticsGroup`. `null` until the first
   * `game-diagnostics` frame from ANY game arrives — see the module doc.
   *
   * `readonly`, matching `GameDiagnosticsState.groups`'s own type
   * (`useGameDiagnostics`'s return): this panel only ever reads the
   * array, so the wider (readonly-accepting) prop type is the honest one,
   * not a cast at the call site.
   */
  game: readonly GameDiagnosticsGroup[] | null;
  /**
   * How many more the bounded logs behind `game` forgot, summed across
   * every group — `GameDiagnosticsState.dropped`'s own total, riding
   * alongside `game`. Every SPEAKER's log, not only the games' own: the
   * host keeps a bounded list too, and this number has always included it.
   * Meaningless while `game` is `null` (nothing has reported a count yet
   * either), so this panel says nothing about it then regardless of what
   * is passed here.
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
  /**
   * Which GAME this row is about — the finer grain living inside
   * `origin === 'game'` rows only (see the module doc). Absent on every
   * `project`/`editor` row, and absent on a `game` row too whenever that
   * row's own group named no game (`GameDiagnosticsGroup.game ===
   * undefined`) — the common single-game case, which must read exactly as
   * it did before there could be more than one.
   */
  gameLabel?: string;
  /**
   * WHO said it — the speaker axis, present on `origin === 'game'` rows
   * only. `'host'` means the host process reporting about the game rather
   * than the game reporting about itself; see `GameDiagnosticsSource`.
   *
   * Absent on `project`/`editor` rows, which have one speaker each and
   * nothing to distinguish.
   */
  speaker?: GameDiagnosticsSource;
}

/**
 * Who said this game-namespace row, in the words a person reads — or
 * nothing at all, which is its own answer.
 *
 * The host is named because it is NOT one of the games, and before this it
 * rendered as the one unlabelled row among labelled ones: a host presented
 * as a game, in the panel whose whole job is saying where a failure came
 * from. A named game is named because a wall has several. And a game that
 * named no game says nothing extra — the ordinary single-project case,
 * which must read exactly as it did before there could be more than one.
 */
function speakerLabel(row: Row): string | null {
  if (row.speaker === 'host') return 'the host';
  if (row.gameLabel !== undefined) return `game "${row.gameLabel}"`;
  return null;
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
  // in all three origins on purpose. Within the game rows, group order is
  // preserved as given (`game` is already `GAME_DIAGNOSTIC_SOURCES`-ordered
  // inside each group, and the order of groups themselves is not a promise
  // this panel or its data source make — see `GameDiagnosticsGroup`'s own
  // doc).
  const rows: Row[] = [
    ...project.map((diagnostic): Row => ({ diagnostic, origin: 'project' })),
    ...(game ?? []).flatMap((group) =>
      group.diagnostics.map((entry): Row => ({
        diagnostic: entry.diagnostic,
        origin: 'game',
        // A HOST frame carries no game of its own and lands in the
        // anonymous group, so `group.game` is the wrong thing to label
        // it with — `speakerLabel` reads the speaker first for exactly
        // that reason.
        gameLabel: group.game,
        speaker: entry.source,
      })),
    ),
    ...editor.map((diagnostic): Row => ({ diagnostic, origin: 'editor' })),
  ];

  return (
    <section className="e8-diagnostics-panel" data-testid="diagnostics-panel">
      {/* No heading and no count of its own (Task 4): the panel tab strip
          in `Shell.tsx` now carries this entry's title, and its count is
          `App.tsx`'s own `ctx.shell.setPanelBadge('diagnostics', …)` — this
          used to repeat both here, one place to look becoming two the
          moment a tab sat right above it. */}
      {rows.length > 0 && (
        <ul className="e8-diagnostics-panel-list">
          {rows.map((row, index) => {
            const speaker = speakerLabel(row);
            return (
              <li
                key={index}
                data-testid={`diag-${index}`}
                data-severity={row.diagnostic.severity}
                className="e8-diagnostic-row"
              >
                <span className="e8-diagnostic-origin">{row.origin}</span>{' '}
                {speaker !== null && <span className="e8-diagnostic-speaker">{speaker}</span>}{' '}
                <strong className="e8-severity">{row.diagnostic.severity}</strong>{' '}
                <span className="e8-diagnostic-plugin">{row.diagnostic.plugin}</span>
                {' · '}
                <span className="e8-diagnostic-where">{row.diagnostic.where}</span>
                {': '}
                <span className="e8-diagnostic-message">{row.diagnostic.message}</span>
                {row.diagnostic.fix ? ` — ${row.diagnostic.fix}` : ''}
              </li>
            );
          })}
        </ul>
      )}

      {rows.length === 0 && game !== null && <p className="e8-empty">nothing to report</p>}

      {game === null && <p className="e8-empty">no game connected yet</p>}

      {game !== null && droppedFromGame > 0 && (
        <p className="e8-diagnostics-dropped">
          {droppedFromGame} more were forgotten — every log behind this list keeps a bounded history
        </p>
      )}
    </section>
  );
}
