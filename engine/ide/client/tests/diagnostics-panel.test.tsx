import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Context } from 'cordis';
import {
  diagnostic as d,
  type Diagnostic,
  type GameDiagnosticsSource,
} from '@energy8engine/contracts';
import type { GameDiagnosticsGroup } from '../src/plugins/diagnostics';
import { DiagnosticsPanel } from '../src/screens/DiagnosticsPanel';
import { CompositionScreen } from '../src/screens/CompositionScreen';

/**
 * One `game` group, built the way the store builds one: every entry
 * carries the SPEAKER that said it, because two of them share this
 * namespace and the panel has to tell them apart (see
 * `GameDiagnosticsEntry`). `source` defaults to `'game'` — a running
 * game's own account, which is what most of these tests are about — so a
 * fixture only says `'host'` where the difference is the point.
 */
function group(
  game: string | undefined,
  diagnostics: Diagnostic[],
  source: GameDiagnosticsSource = 'game',
  dropped = 0,
): GameDiagnosticsGroup {
  return { game, diagnostics: diagnostics.map((diagnostic) => ({ source, diagnostic })), dropped };
}

describe('DiagnosticsPanel', () => {
  it('shows a game diagnostic, with its severity and where it came from', () => {
    render(
      <DiagnosticsPanel
        project={[]}
        game={[group(undefined, [d('error', 'reels', 'runtime', 'reels blew up')])]}
        editor={[]}
      />,
    );
    expect(screen.getByText(/reels blew up/)).toBeVisible();
    expect(screen.getByTestId('diag-0')).toHaveTextContent('reels');
    expect(screen.getByTestId('diag-0')).toHaveTextContent(/game/i);
  });

  it('marks a project diagnostic as the project’s, not the game’s', () => {
    render(
      <DiagnosticsPanel
        project={[d('error', 'reels1', 'package', 'could not resolve')]}
        game={[]}
        editor={[]}
      />,
    );
    expect(screen.getByTestId('diag-0')).toHaveTextContent(/project/i);
  });

  it('one plugin id in both namespaces renders as two separate rows', () => {
    // The collision Slice 1a settled with a comment and Slice 1b kept apart at
    // render. Here they finally meet, and the wire type is what tells them apart.
    const same = { severity: 'error' as const, plugin: 'session', where: 'w', message: 'm' };
    render(<DiagnosticsPanel project={[same]} game={[group(undefined, [same])]} editor={[]} />);
    expect(screen.getAllByText(/^m$/)).toHaveLength(2);
    expect(screen.getByTestId('diag-0')).toHaveTextContent(/project/i);
    expect(screen.getByTestId('diag-1')).toHaveTextContent(/game/i);
  });

  it('says nothing rather than inventing an empty state when the game has not reported yet', () => {
    render(<DiagnosticsPanel project={[]} game={null} editor={[]} />);
    expect(screen.queryByTestId('diag-0')).toBeNull();
    expect(screen.getByTestId('diagnostics-panel')).toHaveTextContent(
      /no game connected|not connected/i,
    );
  });

  it('a bounded log that forgot something says so', () => {
    render(
      <DiagnosticsPanel
        project={[]}
        game={[group(undefined, [d('error', 'p', 'w', 'last')])]}
        droppedFromGame={3}
        editor={[]}
      />,
    );
    expect(screen.getByTestId('diagnostics-panel')).toHaveTextContent('3');
  });

  it('the heading reads "Diagnostics", matching the tab that opens it', () => {
    // Ruling 8/9 once pinned this heading to Russian as a narrow exception
    // while the panel's own rows stayed English; D4 retired that split —
    // the interface is English throughout (dictionary in the design doc's
    // §3), so this heading now simply matches the tab, for the same reason
    // `App.test.tsx` pins the composition tab: a screen's own title reads
    // in the language of the screen. Addressed by accessible name,
    // matching that file's precedent.
    render(<DiagnosticsPanel project={[]} game={[]} editor={[]} />);
    expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeTruthy();
  });
});

/**
 * The editor as a first-class third source, not a count pointing at
 * `CompositionScreen` — see `DiagnosticsPanel`'s module doc for why that
 * changed. Its own local `d` takes `(plugin, message)`, not the
 * four-argument `diagnostic` the suite above imports as `d`: these tests
 * don't care about `where`, and shadowing inside this `describe` keeps
 * that filler out of every line without touching the tests above.
 */
describe('DiagnosticsPanel — the editor as a third source', () => {
  const d = (plugin: string, message: string): Diagnostic => ({
    severity: 'error',
    plugin,
    where: 'w',
    message,
  });

  it('shows an editor diagnostic, marked as the editor’s', () => {
    render(
      <DiagnosticsPanel project={[]} game={[]} editor={[d('slots', 'two cards claim key "x"')]} />,
    );
    expect(screen.getByTestId('diag-0')).toHaveTextContent('two cards claim key');
    expect(screen.getByTestId('diag-0')).toHaveTextContent(/editor/i);
  });

  it('one id in all three namespaces renders as three rows, each attributed', () => {
    // Guards attribution actually coming from WHICH ARRAY a diagnostic
    // arrived in, not from `diagnostic.plugin` (identical here on purpose,
    // matching the two-namespace collision test above): reading origin off
    // `plugin` would collapse three rows into fewer, or mis-order them.
    const same = d('session', 'm');
    render(<DiagnosticsPanel project={[same]} game={[group(undefined, [same])]} editor={[same]} />);
    expect(screen.getAllByText(/^m$/)).toHaveLength(3);
    expect(screen.getByTestId('diag-0')).toHaveTextContent(/project/i);
    expect(screen.getByTestId('diag-1')).toHaveTextContent(/game/i);
    expect(screen.getByTestId('diag-2')).toHaveTextContent(/editor/i);
  });

  it('renders every editor diagnostic as its own row, not just the first', () => {
    render(
      <DiagnosticsPanel
        project={[]}
        game={[]}
        editor={[d('slots', 'first'), d('schema-form', 'second')]}
      />,
    );
    expect(screen.getAllByTestId(/^diag-/)).toHaveLength(2);
    expect(screen.getByTestId('diag-0')).toHaveTextContent(/editor/i);
    expect(screen.getByTestId('diag-1')).toHaveTextContent(/editor/i);
  });

  it('adds no rows and no note when there is nothing from the editor', () => {
    render(<DiagnosticsPanel project={[]} game={[]} editor={[]} />);
    expect(screen.queryByTestId('diag-0')).toBeNull();
    expect(screen.getByTestId('diagnostics-panel')).toHaveTextContent(/nothing to report/i);
  });
});

/**
 * Task 5: `game` went from a flat `Diagnostic[]` to `GameDiagnosticsGroup[]`
 * — one group per game, because the preview wall (a later task) can have
 * several talking to the host at once, and the panel must not flatten them
 * back into one indistinguishable list, which would put us right back
 * where the host-side defect started (see task-5-context.md). Which GAME a
 * row came from is a finer grain living INSIDE the `game` namespace, not a
 * fourth namespace next to `project`/`game`/`editor` — these tests never
 * add a fourth origin label, only a finer one attached to `game` rows.
 */
describe('DiagnosticsPanel — several games, each kept apart', () => {
  it('the panel attributes a game row to its game', () => {
    render(
      <DiagnosticsPanel
        project={[]}
        editor={[]}
        game={[
          group('tile-3', [d('error', 'reels', 'w', 'mobile broke')]),
          group('tile-1', [d('error', 'reels', 'w', 'desktop broke')]),
        ]}
      />,
    );
    expect(screen.getByTestId('diag-0')).toHaveTextContent('tile-3');
    expect(screen.getByTestId('diag-1')).toHaveTextContent('tile-1');
  });

  it('one game is shown exactly as before, with no game label to read', () => {
    // The single-game case is the common one and must not grow ceremony.
    render(
      <DiagnosticsPanel
        project={[]}
        editor={[]}
        game={[group(undefined, [d('error', 'reels', 'w', 'it broke')])]}
      />,
    );
    expect(screen.getByTestId('diag-0')).toHaveTextContent('it broke');
    expect(screen.getByTestId('diag-0').textContent).not.toMatch(/tile|game "/i);
  });

  it('two rows from the same game both carry that game’s label', () => {
    render(
      <DiagnosticsPanel
        project={[]}
        editor={[]}
        game={[
          group('tile-1', [d('error', 'reels', 'w', 'first'), d('error', 'reels', 'w', 'second')]),
        ]}
      />,
    );
    expect(screen.getByTestId('diag-0')).toHaveTextContent('tile-1');
    expect(screen.getByTestId('diag-1')).toHaveTextContent('tile-1');
  });
});

/**
 * Ruling 29: the host is not a game. Two speakers reach this panel under
 * one namespace — the running game's own `ctx.diagnostics`, and the HOST
 * reporting about that game from a process no browser is in. Before the
 * wall, every game row was unlabelled and the host's rows looked like the
 * rest. Now that each tile is named, the host's own `/api/spin` failure
 * rendered as the one UNLABELLED game row beside labelled ones — a host
 * presented as a game, in the panel that exists to say where a failure
 * came from. It is labelled; it is still not a fourth origin.
 */
describe('DiagnosticsPanel — the host is a speaker, not a game', () => {
  it("names the host's own row as the host's", () => {
    render(
      <DiagnosticsPanel
        project={[]}
        editor={[]}
        game={[group(undefined, [d('error', 'session', 'play', 'spin failed')], 'host')]}
      />,
    );
    expect(screen.getByTestId('diag-0')).toHaveTextContent(/host/i);
  });

  it('does not turn the host into a fourth origin', () => {
    // The row still belongs to the game namespace — its `plugin` is a seam
    // id, not a composition row id — so the origin tag must still read
    // `game`. Naming the speaker refines that row; it does not move it.
    render(
      <DiagnosticsPanel
        project={[]}
        editor={[]}
        game={[group(undefined, [d('error', 'session', 'play', 'spin failed')], 'host')]}
      />,
    );
    expect(screen.getByTestId('diag-0').querySelector('.e8-diagnostic-origin')!.textContent).toBe(
      'game',
    );
  });

  it("tells the host's row apart from a tile's, side by side", () => {
    // The shape the wall actually produces: a named tile in trouble, and
    // the host in trouble about the same project. Two rows that used to
    // differ only by the presence of a label.
    render(
      <DiagnosticsPanel
        project={[]}
        editor={[]}
        game={[
          group('Desktop', [d('error', 'reels', 'runtime', 'tile broke')]),
          group(undefined, [d('error', 'session', 'play', 'spin failed')], 'host'),
        ]}
      />,
    );
    expect(screen.getByTestId('diag-0')).toHaveTextContent('game "Desktop"');
    expect(screen.getByTestId('diag-0').textContent).not.toMatch(/the host/i);
    expect(screen.getByTestId('diag-1')).toHaveTextContent(/the host/i);
    expect(screen.getByTestId('diag-1').textContent).not.toMatch(/Desktop/);
  });

  it('does not attribute the forgotten count to the game alone', () => {
    // `droppedFromGame` sums every speaker's bounded log, the host's
    // included, so a line reading "the game's own log forgot N" was a
    // claim the number does not support.
    render(
      <DiagnosticsPanel
        project={[]}
        editor={[]}
        game={[group(undefined, [d('error', 'session', 'play', 'spin failed')], 'host')]}
        droppedFromGame={2}
      />,
    );
    const dropped = document.querySelector('.e8-diagnostics-dropped')!;
    expect(dropped.textContent).toContain('2');
    expect(dropped.textContent).not.toMatch(/the game's own log/i);
  });
});

/**
 * A hand-built `ctx`, not a full `createIdeClient()` — matching
 * `diagnostics.test.ts`'s own reasoning for the same choice. This test
 * only needs `CompositionScreen` to mount without crashing and to have
 * SOME editor diagnostic sitting in `ctx.connection.diagnostics`, so the
 * property under test — nothing here renders `.e8-diagnostics` any more —
 * has something to fail to find before the fix and nothing to find after
 * it, rather than passing vacuously either way.
 */
function harness(): Context {
  const diagnostics: Diagnostic[] = [{ severity: 'error', plugin: 'x', where: 'w', message: 'm' }];
  return {
    connection: {
      snapshot: null,
      diagnostics,
      subscribe: () => () => {},
      update: () => {},
      report: () => {},
    },
    slots: {
      register: () => () => {},
      list: () => [],
      subscribe: () => () => {},
    },
    // `Preview` (inside the screen) reads the workspace; nothing answered yet.
    workspace: { state: () => null, subscribe: () => () => {} },
  } as unknown as Context;
}

describe('CompositionScreen — the editor half moved to DiagnosticsPanel', () => {
  it('the composition screen no longer keeps a diagnostics list of its own', () => {
    render(<CompositionScreen ctx={harness()} />);
    expect(document.querySelector('.e8-diagnostics')).toBeNull();
  });
});
