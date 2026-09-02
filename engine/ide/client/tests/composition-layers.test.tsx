import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompositionScreen } from '../src/index';

/**
 * Task 10: the composition screen also renders the GAME's resolved
 * composition (`ResolvedRow[]`, each carrying `from` — which layer placed
 * it) alongside a live game's own diagnostics. The third case is the one
 * that matters: `Diagnostic.plugin` carries two disjoint namespaces (a
 * composition row id vs. a runtime seam/mechanic id — see diagnostic.ts),
 * and a patch author is free to write `id: session`, which collides with
 * the game's own `session` seam. The screen must keep the two apart.
 */
const rows = [
  { id: 'boot1', name: '@energy8engine/boot', config: {}, from: 'bundle:e8-base' },
  { id: 'reels1', name: '@energy8engine/reels', config: { grid: 5 }, from: 'patch' },
];

describe('composition screen — layers', () => {
  it('shows which layer placed each row', () => {
    render(<CompositionScreen rows={rows} />);
    expect(screen.getByTestId('row-boot1')).toHaveTextContent('e8-base');
    expect(screen.getByTestId('row-reels1')).toHaveTextContent('patch');
  });

  it('a row the patch overrode reads as overridden, not as newly added', () => {
    render(<CompositionScreen rows={rows} bundleIds={['boot1', 'reels1']} />);
    expect(screen.getByTestId('row-reels1')).toHaveTextContent(/overrid/i);
  });

  it('a game diagnostic never renders as an editor row name, even when ids collide', () => {
    // The patch is free to name a row `session`; the game independently
    // stamps `session` on its own seam diagnostics. These are two different
    // namespaces and the screen must not conflate them.
    render(
      <CompositionScreen
        rows={[{ id: 'session', name: '@e/some-plugin', config: {}, from: 'patch' }]}
        gameDiagnostics={[
          { severity: 'error', plugin: 'session', where: 'start', message: 'e8-server not found' },
        ]}
      />,
    );
    const diag = screen.getByTestId('game-diagnostic-0');
    expect(diag).toHaveTextContent('e8-server not found');
    expect(diag).not.toHaveTextContent('@e/some-plugin');
  });
});
