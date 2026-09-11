import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Monaco } from '../src/editor/Monaco';

/**
 * The one test that runs against the REAL `monaco-editor` import, in its
 * own file because `monaco.test.tsx` mocks that module file-wide.
 *
 * This is also the measurement the task brief asked for: whether Monaco
 * starts under jsdom at all. It does not — the import itself throws
 * (`document.queryCommandSupported is not a function`), before any editor
 * is created — so the wrapper must load Monaco lazily and turn that throw
 * into words on screen. A static `import 'monaco-editor'` in the wrapper
 * would take every test that touches the `ide-client` barrel down with
 * it, the same way an unconditional `node:fs` import once took the whole
 * app down at boot (see `engine/apps/web/vite.config.ts`).
 */
describe('Monaco under jsdom', () => {
  it(
    'survives being mounted where Monaco cannot start, and says so',
    { timeout: 15_000 },
    async () => {
      // jsdom is that place. Failures are data: no crash, no blank pane.
      render(<Monaco value="game = Spin" language="spin" diagnostics={[]} onChange={() => {}} />);
      // Monaco's import takes over a second to get as far as its throw —
      // longer than `findByText`'s default patience.
      const pane = await screen.findByText(/could not start/, {}, { timeout: 10_000 });
      expect(pane).toHaveTextContent(/queryCommandSupported/);
    },
  );
});
