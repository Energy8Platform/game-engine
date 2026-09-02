import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompositionScreen } from '../src/index';

/**
 * The composition screen renders the GAME's resolved composition
 * (`ResolvedRow[]`, each carrying `from` — which layer placed it) plus the
 * PROJECT diagnostics the host serves alongside it.
 *
 * The "overridden" badge and its `bundleIds` prop used to live here too.
 * They are gone: `App.tsx` deliberately never passed `bundleIds` (nothing
 * derives it, and a stale one mislabels rows), so the badge only ever
 * appeared in this file's own render, which is coverage of a feature no
 * person could see.
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

  /**
   * The panel that lists rows by PACKAGE name is the one that has to
   * resolve a diagnostic's row id, or a person reads `reels1` directly
   * above `@energy8engine/reels` and is left to connect the two. This
   * panel was forbidden from resolving on the grounds that its array held
   * a running game's runtime ids — a channel that does not exist. What it
   * actually holds is the host's project diagnostics, which are about
   * exactly these rows.
   */
  it('resolves a project diagnostic to the package name of the row it is about', () => {
    render(
      <CompositionScreen
        rows={rows}
        projectDiagnostics={[
          {
            severity: 'error',
            plugin: 'reels1',
            where: 'package',
            message: 'could not be resolved',
          },
        ]}
      />,
    );
    const diag = screen.getByTestId('project-diagnostic-0');
    expect(diag).toHaveTextContent('@energy8engine/reels');
    expect(diag).toHaveTextContent('could not be resolved');
  });

  it('leaves a diagnostic that is about no single row as it is', () => {
    // A malformed profile, a bundle that was not found: `plugin` is a
    // sentinel or a bundle name, matching no row by construction. The
    // fallback must print it rather than blank it.
    render(
      <CompositionScreen
        rows={rows}
        projectDiagnostics={[
          {
            severity: 'error',
            plugin: 'profile',
            where: 'e8.profile.yml',
            message: 'cannot read e8.profile.yml',
          },
        ]}
      />,
    );
    expect(screen.getByTestId('project-diagnostic-0')).toHaveTextContent('profile');
  });

  /**
   * The two panels resolve against two different row lists and must never
   * cross. `EditorComposition` is only mounted when `ctx` is passed; this
   * render passes none, so the editor's rows are absent entirely — and a
   * project diagnostic naming an id must resolve against the GAME's rows,
   * which is the only list it is about.
   */
  it('resolves against the game rows, never the editor rows', () => {
    render(
      <CompositionScreen
        rows={[{ id: 'session', name: '@e/some-plugin', config: {}, from: 'patch' }]}
        projectDiagnostics={[
          {
            severity: 'error',
            plugin: 'session',
            where: 'package',
            message: 'could not be resolved',
          },
        ]}
      />,
    );
    expect(screen.getByTestId('project-diagnostic-0')).toHaveTextContent('@e/some-plugin');
  });
});
