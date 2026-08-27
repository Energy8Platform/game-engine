import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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
  await host.stop();
});
// The above is the *only* teardown — deliberately no `rmSync` of
// `workspace`. See below for why.
//
// Three things were tried here, in order, and each was measured, not
// assumed:
//
//   1. A fixed-duration guard delay before restoring a *shared* fixture.
//      Empirical guess about latency; a stale write landed after the
//      restore and corrupted the checked-in template on disk.
//   2. Per-test disposable directories (kept — see beforeEach above), with
//      an `afterEach` that polled `@cordisjs/plugin-include`'s private
//      `writeTask` field before removing the directory. `writeTask` clears
//      when the write's `setTimeout` *fires*, not when the `writeFile()` +
//      `rename()` it kicks off actually land — so the poll narrowed the
//      race to one syscall pair instead of closing it, and depended on an
//      unexported implementation field with a silent-forever failure mode
//      if the library ever renamed it.
//   3. Deleting (2)'s poll and moving cleanup to a best-effort, try/catch
//      per-directory `rmSync` loop in `afterAll`. Measured: this fails
//      *every* run (20/20), not intermittently — `rmSync` itself always
//      succeeds (nothing to catch), and the unhandled rejection comes from
//      a *separate* promise chain: `Include.writeFile()`'s own
//      `setTimeout(fn, 0)` callback calls `this._writeFile(config)`
//      without awaiting or catching it, so when that write's `open()`
//      lands after `afterAll` has already removed the directory, the
//      rejection has no handler anywhere in reach — no `try/catch` around
//      our own `rmSync` call can intercept a rejection from a promise we
//      never hold a reference to. `afterAll` runs immediately after the
//      last test's own pending write, with no other test's setup to
//      incidentally buy it time, which is why this is *worse* than (1) or
//      (2): near-guaranteed, not occasional.
//
// So: no attempt at synchronous removal at all. A stray directory under the
// OS temp root is not a defect — the OS reclaims it — and unlike (1)-(3),
// leaving it alone cannot itself produce a race or an unhandled rejection,
// because nothing ever competes with the library's own write for the
// directory's existence.

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
