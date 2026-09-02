import { describe, expect, it, vi } from 'vitest';

/**
 * Pins the one rule that outranks everything else in this file's package:
 * `createGame` does not reject. Its caller is routinely a module-top-level
 * `await` with no `try` of its own (see `engine/examples/first-slot/src/
 * main.ts`), so a throw aborts module evaluation and renders nothing —
 * precisely the blank rectangle the failure screen exists to prevent.
 *
 * Reproducing that honestly needs something that genuinely throws.
 * Composition rows cannot: `composeFromProject` catches a throwing
 * `apply()` per row by design. The caller's OWN session provider can — it
 * is brought up by `createGame` itself, not by the loader — so
 * `session-dev` is mocked here with an `apply` that throws, the same way
 * `lazy-session-import.test.ts` mocks it, rather than sending the real
 * session-dev a config that makes its own internal try/catch fire (which
 * would prove nothing about this file's concern).
 *
 * Asserting on `mount.textContent`, not a spy, so this fails for the right
 * reason if the fix regresses to a silent catch that renders nothing.
 */
vi.mock('@energy8engine/session-dev', () => ({
  name: 'session',
  apply: () => {
    throw new Error('boom-from-a-plugin-that-does-not-catch-its-own-failures');
  },
  Config: undefined,
  inject: undefined,
}));

import { createGame } from '../src/index';
import { fakeFetch } from './helpers';

/** No rows — the failure under test is the caller's own session provider, not a row's. */
const noComposition = { fetchFn: fakeFetch({ rows: [], diagnostics: [] }) };

describe('createGame — the caller session provider throwing', () => {
  it('does not reject, and renders the failure as text instead of leaving mount empty', async () => {
    const mount = document.createElement('div');

    const game = await createGame({
      session: { gamesDir: '/nonexistent', port: 0 },
      loader: noComposition,
      mount,
    });

    expect(mount.textContent).toContain('boom-from-a-plugin-that-does-not-catch-its-own-failures');
    expect(
      game.diagnostics.some(
        (d) =>
          d.severity === 'error' &&
          d.message.includes('boom-from-a-plugin-that-does-not-catch-its-own-failures'),
      ),
    ).toBe(true);

    // stop() must still be callable (and a no-op) — a caller that doesn't
    // know composition failed shouldn't have to special-case calling it.
    await expect(game.stop()).resolves.toBeUndefined();
  });

  it('does not throw even with no mount to render into', async () => {
    await expect(
      createGame({ session: { gamesDir: '/nonexistent', port: 0 }, loader: noComposition }),
    ).resolves.toMatchObject({
      // `arrayContaining`, not an exact list: this composition also has no
      // `renderer` provider, which is its own (correct) diagnostic. The
      // session failure must not swallow the others, and the others must
      // not swallow it.
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining(
            'boom-from-a-plugin-that-does-not-catch-its-own-failures',
          ),
        }),
      ]),
    });
  });
});
