import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

let host: IdeHost | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
});

function workspace(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'e8-ide-'));
  writeFileSync(join(dir, 'e8.yml'), yaml);
  return dir;
}

describe('a broken plugin', () => {
  it('does not stop the host from serving', async () => {
    host = await createIdeHost({
      cwd: workspace('- id: b1\n  name: broken-plugin\n'),
      port: 0,
    });
    const res = await fetch(`${host.url}/api/health`);
    expect(res.status).toBe(200);
  });

  it('shows up as a failed row with a diagnostic naming it', async () => {
    host = await createIdeHost({
      cwd: workspace('- id: b1\n  name: broken-plugin\n'),
      port: 0,
    });
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'broken-plugin')!;
    expect(row.state).toBe(3); // FiberState.FAILED
    const failure = snapshot.diagnostics.find((d) => d.plugin === row.id && d.where === 'apply');
    expect(failure?.severity).toBe('error');
    expect(failure?.message).toContain('broken on purpose');
  });

  it('reports an unresolvable package instead of crashing the snapshot', async () => {
    host = await createIdeHost({
      cwd: workspace('- id: g1\n  name: no-such-plugin-anywhere\n'),
      port: 0,
    });
    const snapshot = await host.ctx.composition.snapshot();
    expect(snapshot.diagnostics.some((d) => d.message.includes('no-such-plugin-anywhere'))).toBe(true);
  });
});
