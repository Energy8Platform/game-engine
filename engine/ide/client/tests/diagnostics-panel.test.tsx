import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Context } from 'cordis';
import { diagnostic as d, type Diagnostic } from '@energy8engine/contracts';
import { DiagnosticsPanel } from '../src/screens/DiagnosticsPanel';
import { CompositionScreen } from '../src/screens/CompositionScreen';

describe('DiagnosticsPanel', () => {
  it('shows a game diagnostic, with its severity and where it came from', () => {
    render(
      <DiagnosticsPanel
        project={[]}
        game={[d('error', 'reels', 'runtime', 'reels blew up')]}
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
    render(<DiagnosticsPanel project={[same]} game={[same]} editor={[]} />);
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
        game={[d('error', 'p', 'w', 'last')]}
        droppedFromGame={3}
        editor={[]}
      />,
    );
    expect(screen.getByTestId('diagnostics-panel')).toHaveTextContent('3');
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
    render(<DiagnosticsPanel project={[same]} game={[same]} editor={[same]} />);
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
  } as unknown as Context;
}

describe('CompositionScreen — the editor half moved to DiagnosticsPanel', () => {
  it('the composition screen no longer keeps a diagnostics list of its own', () => {
    render(<CompositionScreen ctx={harness()} />);
    expect(document.querySelector('.e8-diagnostics')).toBeNull();
  });
});
