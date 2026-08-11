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
    // No port pin needed: `spawnEngine` now rejects a missing binary
    // (ENOENT) directly, before ever creating a gRPC client — so this can't
    // race engine.test.ts's real engine into a false-resolve the way a
    // probe-then-connect approach could.
    await expect(
      startEngine({ gamesDir: fixtures, binPath: badBin }),
    ).rejects.toThrow(
      new RegExp(`e8-server.*${badBin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*ENOENT`),
    );
  });
});
