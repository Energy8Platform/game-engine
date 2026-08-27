import { join } from 'node:path';
import { EntryGroup } from '@cordisjs/plugin-loader';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

const WORKSPACE = join(__dirname, 'fixtures', 'workspace');
const MISSING_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'missing-e8yml');
const MALFORMED_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'malformed-e8yml');
const MAPPING_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'mapping-e8yml');
const NON_OBJECT_ENTRY_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'non-object-entry-e8yml');
const MISSING_NAME_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'missing-name-e8yml');
const EMPTY_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'empty-e8yml');
const NONEMPTY_WORKSPACE = join(__dirname, 'fixtures', 'nonempty-workspace');

let host: IdeHost | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
});

/** Runs `fn`, then asserts it left no dangling unhandled promise rejection. */
async function expectNoUnhandledRejection(fn: () => Promise<void>): Promise<void> {
  const onUnhandledRejection = vi.fn();
  process.once('unhandledRejection', onUnhandledRejection);
  await fn();
  // give the event loop a turn to surface any rejection the boot sequence left dangling
  await new Promise((resolve) => setImmediate(resolve));
  process.removeListener('unhandledRejection', onUnhandledRejection);
  expect(onUnhandledRejection).not.toHaveBeenCalled();
}

describe('createIdeHost', () => {
  it('serves a health route on an ephemeral port', async () => {
    host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
    const res = await fetch(`${host.url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('exposes the loader so composition can be read from the live graph', async () => {
    host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
    expect(typeof host.ctx.loader.entries).toBe('function');
  });

  it('stops cleanly — the port stops answering', async () => {
    host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
    const url = host.url;
    await host.stop();
    host = undefined;
    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  });
});

describe('createIdeHost — boot diagnostics', () => {
  it('reports a missing e8.yml as a diagnostic and still serves the health route', async () => {
    await expectNoUnhandledRejection(async () => {
      host = await createIdeHost({ cwd: MISSING_E8YML_WORKSPACE, port: 0 });

      const res = await fetch(`${host.url}/api/health`);
      expect(res.status).toBe(200);

      expect(host.diagnostics).toHaveLength(1);
      expect(host.diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'composition' });
      expect(host.diagnostics[0].message).toContain('e8.yml');
    });
  });

  it('reports malformed YAML as a diagnostic and still serves the health route', async () => {
    await expectNoUnhandledRejection(async () => {
      host = await createIdeHost({ cwd: MALFORMED_E8YML_WORKSPACE, port: 0 });

      const res = await fetch(`${host.url}/api/health`);
      expect(res.status).toBe(200);

      expect(host.diagnostics).toHaveLength(1);
      expect(host.diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'composition' });
    });
  });

  it('reports no diagnostics when e8.yml is valid', async () => {
    host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
    expect(host.diagnostics).toEqual([]);
  });

  it('reports a mapping at the top level as a diagnostic, not a crash', async () => {
    await expectNoUnhandledRejection(async () => {
      host = await createIdeHost({ cwd: MAPPING_E8YML_WORKSPACE, port: 0 });

      const res = await fetch(`${host.url}/api/health`);
      expect(res.status).toBe(200);

      expect(host.diagnostics).toHaveLength(1);
      expect(host.diagnostics[0]).toMatchObject({
        severity: 'error',
        plugin: 'composition',
        where: 'e8.yml',
      });
      expect(host.diagnostics[0].message).toContain('array');
    });
  });

  it('reports a non-object composition entry as a diagnostic, not a crash', async () => {
    await expectNoUnhandledRejection(async () => {
      host = await createIdeHost({ cwd: NON_OBJECT_ENTRY_E8YML_WORKSPACE, port: 0 });

      const res = await fetch(`${host.url}/api/health`);
      expect(res.status).toBe(200);

      expect(host.diagnostics).toHaveLength(1);
      expect(host.diagnostics[0]).toMatchObject({
        severity: 'error',
        plugin: 'composition',
        where: 'e8.yml[0]',
      });
    });
  });

  it('reports a composition entry with no name as a diagnostic, not a crash', async () => {
    await expectNoUnhandledRejection(async () => {
      host = await createIdeHost({ cwd: MISSING_NAME_E8YML_WORKSPACE, port: 0 });

      const res = await fetch(`${host.url}/api/health`);
      expect(res.status).toBe(200);

      expect(host.diagnostics).toHaveLength(1);
      expect(host.diagnostics[0]).toMatchObject({
        severity: 'error',
        plugin: 'composition',
        where: 'e8.yml[0]',
      });
      expect(host.diagnostics[0].message).toContain('name');
    });
  });

  it('treats an empty e8.yml as an empty composition, not an error', async () => {
    await expectNoUnhandledRejection(async () => {
      host = await createIdeHost({ cwd: EMPTY_E8YML_WORKSPACE, port: 0 });

      const res = await fetch(`${host.url}/api/health`);
      expect(res.status).toBe(200);
      expect(host.diagnostics).toEqual([]);
    });
  });

  it('gives an empty file and an explicit [] the same diagnostics and the same loader graph', async () => {
    const emptyFileHost = await createIdeHost({ cwd: EMPTY_E8YML_WORKSPACE, port: 0 });
    const emptyArrayHost = await createIdeHost({ cwd: WORKSPACE, port: 0 }); // WORKSPACE's e8.yml is `[]`
    try {
      expect(emptyFileHost.diagnostics).toEqual([]);
      expect(emptyArrayHost.diagnostics).toEqual([]);

      const emptyFileEntries = [...emptyFileHost.ctx.loader.entries()];
      const emptyArrayEntries = [...emptyArrayHost.ctx.loader.entries()];

      // pin the actual count on both sides — an absent `@cordisjs/plugin-include`
      // row on one and present on the other would still pass a "no error" check
      expect(emptyFileEntries).toHaveLength(0);
      expect(emptyArrayEntries).toHaveLength(0);
    } finally {
      await emptyFileHost.stop();
      await emptyArrayHost.stop();
    }
  });
});

describe('createIdeHost — boot failure cleanup', () => {
  it('disposes the partially built context when a later boot step throws', async () => {
    host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
    const takenPort = Number(new URL(host.url).port);

    // NONEMPTY_WORKSPACE (not WORKSPACE's `[]`) so the failed attempt
    // actually registers an include entry — since round 3, an empty
    // composition registers no entry at all, and this spy needs one to tear
    // down in order to prove anything.
    const stopSpy = vi.spyOn(EntryGroup.prototype, 'stop');
    await expect(createIdeHost({ cwd: NONEMPTY_WORKSPACE, port: takenPort })).rejects.toThrow(
      'No open ports available',
    );

    // the failed attempt's own Loader root group must have been torn down
    expect(stopSpy).toHaveBeenCalled();
    stopSpy.mockRestore();
  });
});
