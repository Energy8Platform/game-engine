import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompositionScreen } from '../src/index';

/**
 * The composition screen renders the GAME's resolved composition
 * (`ResolvedRow[]`, each carrying `from` — which layer placed it).
 *
 * The "overridden" badge and its `bundleIds` prop used to live here too.
 * They are gone: `App.tsx` deliberately never passed `bundleIds` (nothing
 * derives it, and a stale one mislabels rows), so the badge only ever
 * appeared in this file's own render, which is coverage of a feature no
 * person could see.
 *
 * The PROJECT diagnostics the host serves alongside `rows` used to render
 * here too — a standalone list, resolving each diagnostic's `plugin` id to
 * the row's package name — until `DiagnosticsPanel` (Task 8) made this
 * screen's own copy pure duplication of what the panel already shows (see
 * `CompositionScreen.tsx`'s own comment on `GameComposition` for the full
 * reasoning, including the row-name resolution this dropped rather than
 * carried over silently). `CompositionScreenProps` no longer takes a
 * `projectDiagnostics` prop at all, which is what made the three tests
 * that used to sit here — resolving a project diagnostic to a row's
 * package name, leaving an unresolvable one as-is, and never crossing into
 * the editor's own rows — stop compiling; they tested a feature that no
 * longer exists at this layer.
 */
const rows = [
  { id: 'boot1', name: '@energy8engine/boot', config: {}, from: 'bundle:e8-base' },
  { id: 'reels1', name: '@energy8engine/reels', config: { grid: 5 }, from: 'patch' },
].map((row) => ({ ...row, runtimeUrl: null, schema: null, hot: false }));

describe('composition screen — layers', () => {
  it('shows which layer placed each row', () => {
    render(<CompositionScreen rows={rows} />);
    expect(screen.getByTestId('row-boot1')).toHaveTextContent('e8-base');
    expect(screen.getByTestId('row-reels1')).toHaveTextContent('patch');
  });
});
