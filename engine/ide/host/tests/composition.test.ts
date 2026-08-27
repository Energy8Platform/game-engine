import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

const WORKSPACE = join(__dirname, 'fixtures', 'composition');

let host: IdeHost;
beforeEach(async () => {
  (globalThis as any).__probeApplied = [];
  host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
});
afterEach(async () => {
  await host.stop();
});

describe('composition.snapshot', () => {
  it('lists the entry with its config and live fiber state', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin');
    expect(row).toBeDefined();
    expect(row!.config).toEqual({ speed: 12 });
    expect(row!.disabled).toBe(false);
    expect(row!.state).toBe(2); // FiberState.ACTIVE
  });

  it('carries the plugin schema as JSON the browser can rebuild', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin')!;
    expect((row.schema as any).type).toBe('object');
    expect((row.schema as any).dict.speed.meta.min).toBe(1);
  });

  it('carries the manifest facts the IDE acts on', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin')!;
    expect(row.hot).toBe(true);
    expect(row.clientUrl).toBe(`/plugin-client/${row.id}`);
  });

  it('says nothing about entries that have no schema, instead of inventing one', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const include = snapshot.rows.find((r) => r.name === '@cordisjs/plugin-include')!;
    expect(include.clientUrl).toBeNull();
  });
});
