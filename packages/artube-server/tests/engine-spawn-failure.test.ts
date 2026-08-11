import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine } from '../src/engine';

// Node's ChildProcess is an EventEmitter: an unlistened 'error' event (e.g.
// ENOENT when the binary doesn't exist) throws synchronously and crashes
// the whole host process instead of just this test. This file lives apart
// from engine.test.ts's shared `beforeAll` engine so a regression here fails
// only this test, not the whole suite via a runner crash.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('startEngine — деградация при ошибке спавна', () => {
  it('падает понятным rejection, называющим бинарь и причину, а не роняет процесс', async () => {
    const badBin = join(fixtures, 'no-such-e8-server-binary');
    // Vitest runs test files in parallel by default, and engine.test.ts's
    // `beforeAll` spawns a real engine that starts its own findFreePort
    // scan from DEFAULT_ENGINE_PORT (50251) concurrently with this one. The
    // probe-bind-release port check has a known TOCTOU race (tracked
    // separately, not fixed here) — under that race this test's client can
    // end up connecting to *engine.test.ts's* real server instead of
    // failing to connect at all, flipping a should-reject case into a false
    // resolve. Pin this test to a port far outside the default scan range
    // so the two starts can't collide.
    await expect(
      startEngine({ gamesDir: fixtures, binPath: badBin, port: 52251 }),
    ).rejects.toThrow(
      new RegExp(`e8-server.*${badBin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*ENOENT`),
    );
  });
});
