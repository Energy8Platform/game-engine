import { describe, expect, it, vi } from 'vitest';

/**
 * Pins the fix for the one path `createGame`'s own catch block existed for
 * but nothing reached: a plugin throwing synchronously during composition.
 * Every plugin `createGame` composes internally (`renderer.ts`, `stage.ts`,
 * `reels.ts`) already catches its own failures and degrades to a
 * `Diagnostic` — so reproducing the outer catch honestly needs a plugin
 * that does NOT, and the only one composed here without an internal catch
 * is `session-dev`'s `apply()` (see `compose.ts`'s `if (config.session)`
 * branch). Mocked here the same way `lazy-session-import.test.ts` mocks it
 * — a fake `apply` that throws — rather than sending the real session-dev
 * a config that makes ITS OWN internal try/catch fire (which would prove
 * nothing about this file's concern).
 *
 * Before the fix, `createGame` disposed `ctx` and rethrew: a caller that
 * `await`s `createGame` at module top level with no `try` of its own (see
 * `engine/examples/first-slot/src/main.ts`) would have its whole module
 * evaluation aborted, rendering nothing — the exact white rectangle `boot`
 * exists to prevent. Asserting on `mount.textContent`, not a spy, so this
 * test fails for the right reason if the fix regresses to a silent catch
 * that never renders anything either.
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

describe('createGame — a plugin throwing during composition', () => {
  it('does not reject, and renders the failure as text instead of leaving mount empty', async () => {
    const mount = document.createElement('div');

    const game = await createGame({
      session: { gamesDir: '/nonexistent', port: 0 },
      mount,
    });

    expect(mount.textContent).toContain('boom-from-a-plugin-that-does-not-catch-its-own-failures');
    expect(
      game.diagnostics.some(
        (d) => d.severity === 'error' && d.message.includes('boom-from-a-plugin-that-does-not-catch-its-own-failures'),
      ),
    ).toBe(true);

    // stop() must still be callable (and a no-op) — a caller that doesn't
    // know composition failed shouldn't have to special-case calling it.
    await expect(game.stop()).resolves.toBeUndefined();
  });

  it('does not throw even with no mount to render into', async () => {
    await expect(
      createGame({ session: { gamesDir: '/nonexistent', port: 0 } }),
    ).resolves.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('boom-from-a-plugin-that-does-not-catch-its-own-failures'),
        }),
      ],
    });
  });
});
