import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import { createNodeTypes } from '@energy8engine/scenes';
import * as runtime from '../src/runtime';
import { spine } from '../src';

describe('spine1 runtime half', () => {
  it('registers spine on nodeTypes; dispose takes it back', async () => {
    const ctx = new Context();
    const nodeTypes = createNodeTypes();
    ctx.provide('nodeTypes', nodeTypes);
    const fiber = ctx.plugin(runtime);
    await fiber;
    expect(nodeTypes.get('spine')).toBe(spine);
    await fiber.dispose();
    expect(nodeTypes.list()).toEqual([]);
  });

  it('names itself and needs only nodeTypes', () => {
    expect(runtime.name).toBe('node-spine');
    expect(runtime.inject).toEqual(['nodeTypes']);
  });
});
