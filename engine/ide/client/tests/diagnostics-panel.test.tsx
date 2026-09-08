import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { diagnostic as d } from '@energy8engine/contracts';
import { DiagnosticsPanel } from '../src/screens/DiagnosticsPanel';

describe('DiagnosticsPanel', () => {
  it('shows a game diagnostic, with its severity and where it came from', () => {
    render(
      <DiagnosticsPanel project={[]} game={[d('error', 'reels', 'runtime', 'reels blew up')]} />,
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
      />,
    );
    expect(screen.getByTestId('diag-0')).toHaveTextContent(/project/i);
  });

  it('one plugin id in both namespaces renders as two separate rows', () => {
    // The collision Slice 1a settled with a comment and Slice 1b kept apart at
    // render. Here they finally meet, and the wire type is what tells them apart.
    const same = { severity: 'error' as const, plugin: 'session', where: 'w', message: 'm' };
    render(<DiagnosticsPanel project={[same]} game={[same]} />);
    expect(screen.getAllByText(/^m$/)).toHaveLength(2);
    expect(screen.getByTestId('diag-0')).toHaveTextContent(/project/i);
    expect(screen.getByTestId('diag-1')).toHaveTextContent(/game/i);
  });

  it('says nothing rather than inventing an empty state when the game has not reported yet', () => {
    render(<DiagnosticsPanel project={[]} game={null} />);
    expect(screen.queryByTestId('diag-0')).toBeNull();
    expect(screen.getByTestId('diagnostics-panel')).toHaveTextContent(
      /no game connected|not connected/i,
    );
  });

  it('a bounded log that forgot something says so', () => {
    render(<DiagnosticsPanel project={[]} game={[d('error', 'p', 'w', 'last')]} droppedFromGame={3} />);
    expect(screen.getByTestId('diagnostics-panel')).toHaveTextContent('3');
  });
});
