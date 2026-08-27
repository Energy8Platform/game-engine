import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Schema from 'schemastery';
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
    // `row.schema` itself must be plain JSON — not a live schemastery
    // instance — since Snapshot exists to cross a socket; a class instance
    // in transit degrades silently (its own toJSON() fires again on the
    // next JSON.stringify, which is not what a naive reader expects).
    expect(typeof row.schema).toBe('object');
    const rebuilt = new Schema(row.schema as any);
    expect(rebuilt.type).toBe('object');
    expect(rebuilt.dict!.speed.meta.min).toBe(1);
  });

  it('keeps the schema readable after crossing the wire — JSON round trip, then rebuild', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin')!;

    // Simulate the actual socket boundary: serialise the whole snapshot the
    // way the host would send it, and parse it back the way the browser
    // would receive it, before ever touching `.dict`.
    const wired = JSON.parse(JSON.stringify(snapshot));
    const wiredRow = wired.rows.find((r: any) => r.name === 'probe-plugin');
    const rebuilt = new Schema(wiredRow.schema);

    expect(rebuilt.dict!.speed.meta.min).toBe(1);
    expect(rebuilt.dict!.speed.meta.description).toBe('reel speed');
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
