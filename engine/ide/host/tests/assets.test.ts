import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

// `fixtures/composition` (Task 4) is the fixture whose e8.yml actually
// registers `probe-plugin` — `fixtures/workspace` has an empty composition.
const WORKSPACE = join(__dirname, 'fixtures', 'composition');

let host: IdeHost;
beforeEach(async () => {
  host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
});
afterEach(async () => {
  await host.stop();
});

describe('plugin client assets', () => {
  it('serves the client half as a javascript module', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin')!;
    const res = await fetch(`${host.url}${row.clientUrl}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toContain('__probeClientApplied');
  });

  it('404s for an entry that has no client half', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const include = snapshot.rows.find((r) => r.name === '@cordisjs/plugin-include')!;
    const res = await fetch(`${host.url}/plugin-client/${include.id}`);
    expect(res.status).toBe(404);
  });

  it('404s for an id that has no matching entry at all', async () => {
    const res = await fetch(`${host.url}/plugin-client/not-a-real-id`);
    expect(res.status).toBe(404);
  });
});
