import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createIdeHost } from '../src/index';

function fixture(name: string): string {
  return join(__dirname, 'fixtures', name);
}

/**
 * `ctx.spinSchema` — the host's read of `game/script.spin`, exposed the
 * same way `ctx.project` already exposes the composition: a live getter
 * pair plus `reload()`, never a throw. See `../src/plugins/schema.ts`'s
 * module doc for why this judgement (an action naming a stage the schema
 * does not declare) lives here and not in `isSpinSchema`.
 */
describe('ctx.spinSchema', () => {
  it('parses the project game/script.spin and exposes it', async () => {
    const host = await createIdeHost({ cwd: fixture('project-simple'), port: 0 });
    expect(host.ctx.spinSchema.schema!.gameId).toBe('demo');
    await host.stop();
  });

  it('a missing script.spin is a diagnostic and the host still starts', async () => {
    const host = await createIdeHost({ cwd: fixture('project-no-spin'), port: 0 });
    expect(host.ctx.spinSchema.schema).toBeNull();
    expect(host.ctx.spinSchema.diagnostics.some((d) => d.where.includes('script.spin'))).toBe(
      true,
    );
    expect(host.url).toBeTruthy();
    await host.stop();
  });

  it('an action naming a stage the enum does not declare is a diagnostic', async () => {
    // The judgement task 1's type guard deliberately refused to make.
    const host = await createIdeHost({ cwd: fixture('project-stage-typo'), port: 0 });
    expect(host.ctx.spinSchema.diagnostics.some((d) => d.message.includes('free_spins'))).toBe(
      true,
    );
    await host.stop();
  });
});

describe('GET /api/composition carries the schema', () => {
  it('the composition response carries the schema', async () => {
    const host = await createIdeHost({ cwd: fixture('project-simple'), port: 0 });
    const body = await (await fetch(`${host.url}/api/composition`)).json();
    expect(body.schema.gameId).toBe('demo');
    await host.stop();
  });

  it('carries a null schema and its diagnostics rather than omitting the field', async () => {
    const host = await createIdeHost({ cwd: fixture('project-no-spin'), port: 0 });
    const body = await (await fetch(`${host.url}/api/composition`)).json();
    expect(body).toHaveProperty('schema');
    expect(body.schema).toBeNull();
    expect(body.diagnostics.length).toBeGreaterThan(0);
    await host.stop();
  });
});
