import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

// Own fixture, deliberately not shared with fixtures/workspace (Task 3 pins
// its e8.yml at `[]`) or fixtures/composition (Task 4's read-only fixture).
// vitest runs test files in parallel, and these tests mutate the composition
// file on disk mid-run — sharing a fixture with a read-only test would make
// that test race against these writes.
const WORKSPACE = join(__dirname, 'fixtures', 'update-workspace');
const FILE = join(WORKSPACE, 'e8.yml');

let host: IdeHost;
let original: string;

beforeEach(async () => {
  original = readFileSync(FILE, 'utf8');
  (globalThis as any).__probeApplied = [];
  host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
});

afterEach(async () => {
  await host.stop();
  // `@cordisjs/plugin-include`'s disk write is debounced internally via a
  // bare `setTimeout(fn, 0)` with no public way to await its completion (see
  // the comment on composition.update()'s success path). `host.stop()` does
  // not cancel that pending timer — measured empirically: without this
  // delay, a write still in flight from this test's own
  // `composition.update()` call can land *after* the restore below runs,
  // permanently overwriting this checked-in fixture with the test's
  // leftover value. Give it a moment to flush so our restore is the write
  // that wins.
  await new Promise((resolve) => setTimeout(resolve, 50));
  writeFileSync(FILE, original);
});

async function probeId(host: IdeHost): Promise<string> {
  const snapshot = await host.ctx.composition.snapshot();
  return snapshot.rows.find((r) => r.name === 'probe-plugin')!.id;
}

describe('composition.update', () => {
  it('restarts the plugin in place with the new config', async () => {
    const diagnostics = await host.ctx.composition.update(await probeId(host), { speed: 3 });
    expect(diagnostics).toEqual([]);
    expect((globalThis as any).__probeApplied).toEqual([12, 'off', 3]);
  });

  it('writes the change back to the composition file', async () => {
    await host.ctx.composition.update(await probeId(host), { speed: 3 });
    // `@cordisjs/plugin-include` schedules the actual file write via a bare
    // `setTimeout(fn, 0)` (see composition.ts's comment on the update()
    // success path) — it is not synchronized with the promise
    // `ctx.loader.update()` returns, so the write can genuinely still be in
    // flight the instant this line runs. Measured: without polling, this
    // assertion fails deterministically (100% of runs), not intermittently.
    await vi.waitFor(() => {
      expect(readFileSync(FILE, 'utf8')).toContain('speed: 3');
    });
  });

  it('reports an invalid value as a diagnostic and keeps the old config', async () => {
    const diagnostics = await host.ctx.composition.update(await probeId(host), { speed: 999 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].where).toContain('config');
    const snapshot = await host.ctx.composition.snapshot();
    expect(snapshot.rows.find((r) => r.name === 'probe-plugin')!.config).toEqual({ speed: 12 });
  });

  it('reports an unknown entry id instead of throwing', async () => {
    const diagnostics = await host.ctx.composition.update('nope', { speed: 3 });
    expect(diagnostics[0].message).toContain('nope');
  });
});
