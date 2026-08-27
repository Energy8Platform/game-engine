import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

const WORKSPACE = join(__dirname, 'fixtures', 'workspace');

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
