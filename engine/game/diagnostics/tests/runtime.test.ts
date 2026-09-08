/**
 * The runtime half's own concern: the service arrives as an ordinary
 * composition row, so a project brings it (or leaves it out) the same way
 * it brings a renderer. See `@energy8engine/spin-log`'s `tests/
 * runtime.test.ts` — this is the same shape of test for the same shape of
 * row.
 */
import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import * as runtime from '../src/runtime';

describe('diagnostics runtime half', () => {
  it('provides a service as ctx.diagnostics', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    expect(ctx.diagnostics).toBeDefined();
    ctx.diagnostics.report({ severity: 'error', plugin: 'p', where: 'w', message: 'm' });
    expect(ctx.diagnostics.list()).toHaveLength(1);

    await ctx.fiber.dispose();
  });

  it('is one service per composition, not one per reader', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    ctx.diagnostics.report({ severity: 'error', plugin: 'p', where: 'w', message: 'm' });
    // A second reader sees the same record — the point of the service
    // being one thing every producer's writer shares, not something each
    // caller makes for itself.
    expect(ctx.diagnostics.list()).toHaveLength(1);
    expect(ctx.diagnostics).toBe(ctx.diagnostics);

    await ctx.fiber.dispose();
  });
});
