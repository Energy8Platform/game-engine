import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

// Template fixture (checked in) copied into a fresh, disposable temp
// directory per test — see beforeEach. Not fixtures/workspace (Task 3 pins
// its e8.yml at `[]`) or fixtures/composition (Task 4's read-only fixture);
// and, per review, not even shared *between this file's own tests* either.
// These tests mutate the composition file on disk, and any directory shared
// across tests — or across runs — races itself against
// `@cordisjs/plugin-include`'s asynchronous, uncancellable write (see the
// doc comment on `CompositionService.update()`). An earlier version of
// this file used one shared fixture plus a fixed-duration guard delay in
// afterEach to let a pending write flush before restoring it; that delay was
// an empirical guess about latency, not a structural guarantee, and it had
// already let a stale write corrupt the checked-in template once. A fresh
// directory per test has no shared mutable state to race: nothing to
// restore, no delay to tune, nothing a stray write can corrupt — the
// directory is simply discarded.
const TEMPLATE_FILE = join(__dirname, 'fixtures', 'update-workspace', 'e8.yml');

// `readPackageJson()` resolves plugin packages via `createRequire(cwd)`,
// which walks *up* from `cwd` looking for `node_modules` — a bare OS temp
// directory has nothing above it to find. Resolve where `probe-plugin` (a
// devDependency of this package, hoisted to the repo root) actually lives
// once, then symlink just that package into each temp workspace, so package
// resolution behaves the same as it would from inside the repo.
const PROBE_PLUGIN_DIR = dirname(
  createRequire(join(__dirname, 'noop.js')).resolve('probe-plugin/package.json'),
);

let host: IdeHost;
let workspace: string;

function file(): string {
  return join(workspace, 'e8.yml');
}

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'ide-host-update-'));
  writeFileSync(file(), readFileSync(TEMPLATE_FILE, 'utf8'));
  mkdirSync(join(workspace, 'node_modules'));
  symlinkSync(PROBE_PLUGIN_DIR, join(workspace, 'node_modules', 'probe-plugin'), 'dir');
  (globalThis as any).__probeApplied = [];
  host = await createIdeHost({ cwd: workspace, port: 0 });
});

afterEach(async () => {
  // Grab the `Include` subtree that owns the pending-write bookkeeping
  // *before* disposing the host, so we can still reach it afterward.
  const includeTree = [...host.ctx.loader.entries()].find((e) => e.options.name === 'probe-plugin')
    ?.parent?.tree as { writeTask?: unknown } | undefined;

  await host.stop();

  // `host.stop()` does not cancel `@cordisjs/plugin-include`'s pending
  // write timer (see the comment on composition.update()'s interface:
  // `ctx.loader.update()` resolving does not mean the write has landed, and
  // there is no public signal for when it does). Deleting the temp
  // directory while that timer is still armed makes its write throw ENOENT
  // as an unhandled rejection once it fires — measured directly. Rather
  // than guess how long to wait (the failure mode this whole per-test-temp-
  // directory setup replaced), poll the library's own `writeTask` field
  // until it clears, which is the actual condition, not an assumed
  // duration. This is test-cleanup-only introspection into a private field,
  // never production code reaching into it.
  if (includeTree) {
    await vi.waitFor(() => {
      if (includeTree.writeTask) throw new Error('write still pending');
    });
  }

  rmSync(workspace, { recursive: true, force: true });
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
    // interface) — it is not synchronized with the promise
    // `ctx.loader.update()` returns, so the write can genuinely still be in
    // flight the instant this line runs. Measured: without polling, this
    // assertion fails deterministically (100% of runs), not intermittently.
    // Polling is the honest way to observe a genuinely async, unsignalled
    // write — unlike the fixed-duration guard delay this file used to have
    // in afterEach, this waits for the real condition, not a guessed
    // duration.
    await vi.waitFor(() => {
      expect(readFileSync(file(), 'utf8')).toContain('speed: 3');
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

  it('reports both failures, and does not throw, when the rollback itself fails', async () => {
    const id = await probeId(host);
    const entry = [...host.ctx.loader.entries()].find((e) => e.id === id)!;
    // Force the rollback's own `ctx.loader.update()` call to reject too, by
    // making `before` — the value composition.update() captures to restore
    // on failure — itself invalid by the time the rollback runs. Mutating
    // `entry.options.config` directly (bypassing composition.update()) is
    // the only way to induce this from the public surface: it changes what
    // the *next* call reads as "the current config" without going through
    // any validation itself.
    entry.options.config = { speed: 999 };

    // The point of this test: `composition.update()` must resolve, not
    // reject, even when both the edit *and* its own rollback fail — a host
    // service reporting failure as data, with nothing left silent, is the
    // whole contract. If it throws here, the `await` below throws too and
    // the test fails with that exception instead of a clean assertion,
    // which is exactly the outcome this test exists to catch.
    const diagnostics = await host.ctx.composition.update(id, { speed: -1 });

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[1].severity).toBe('error');
    expect(diagnostics[1].message).toContain('rollback');
  });
});
