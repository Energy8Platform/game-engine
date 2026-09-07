/**
 * The runtime half's own concern: the log arrives as an ordinary
 * composition row, so a project brings it (or leaves it out) the same way
 * it brings a renderer.
 */
import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import * as runtime from '../src/runtime';

describe('spin-log runtime half', () => {
  it('provides a log as ctx.spinLog', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    expect(ctx.spinLog).toBeDefined();
    ctx.spinLog.append({ request: { bet: 1 }, result: { win: 0 }, plan: [] });
    expect(ctx.spinLog.entries()).toHaveLength(1);

    await ctx.fiber.dispose();
  });

  it('is one log per composition, not one per reader', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);

    ctx.spinLog.append({ request: {}, result: {}, plan: [] });
    // A second reader sees the same record — the point of the log being a
    // service rather than something each caller makes for itself.
    expect(ctx.spinLog.entries()).toHaveLength(1);
    expect(ctx.spinLog).toBe(ctx.spinLog);

    await ctx.fiber.dispose();
  });
});
