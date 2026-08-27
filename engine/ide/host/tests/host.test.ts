import { join } from 'node:path';
import { EntryGroup } from '@cordisjs/plugin-loader';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

const WORKSPACE = join(__dirname, 'fixtures', 'workspace');
const MISSING_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'missing-e8yml');
const MALFORMED_E8YML_WORKSPACE = join(__dirname, 'fixtures', 'malformed-e8yml');

let host: IdeHost | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
});

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
    const onUnhandledRejection = vi.fn();
    process.once('unhandledRejection', onUnhandledRejection);

    host = await createIdeHost({ cwd: MISSING_E8YML_WORKSPACE, port: 0 });

    const res = await fetch(`${host.url}/api/health`);
    expect(res.status).toBe(200);

    expect(host.diagnostics).toHaveLength(1);
    expect(host.diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'composition' });
    expect(host.diagnostics[0].message).toContain('e8.yml');

    // give the event loop a turn to surface any rejection the boot sequence left dangling
    await new Promise((resolve) => setImmediate(resolve));
    process.removeListener('unhandledRejection', onUnhandledRejection);
    expect(onUnhandledRejection).not.toHaveBeenCalled();
  });

  it('reports malformed YAML as a diagnostic and still serves the health route', async () => {
    host = await createIdeHost({ cwd: MALFORMED_E8YML_WORKSPACE, port: 0 });

    const res = await fetch(`${host.url}/api/health`);
    expect(res.status).toBe(200);

    expect(host.diagnostics).toHaveLength(1);
    expect(host.diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'composition' });
  });

  it('reports no diagnostics when e8.yml is valid', async () => {
    host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
    expect(host.diagnostics).toEqual([]);
  });
});

describe('createIdeHost — boot failure cleanup', () => {
  it('disposes the partially built context when a later boot step throws', async () => {
    host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
    const takenPort = Number(new URL(host.url).port);

    const stopSpy = vi.spyOn(EntryGroup.prototype, 'stop');
    await expect(createIdeHost({ cwd: WORKSPACE, port: takenPort })).rejects.toThrow(
      'No open ports available',
    );

    // the failed attempt's own Loader root group must have been torn down
    expect(stopSpy).toHaveBeenCalled();
    stopSpy.mockRestore();
  });
});
