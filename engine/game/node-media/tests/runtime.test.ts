import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import { createNodeTypes } from '@energy8engine/scenes';
import * as runtime from '../src/runtime';
import { gif, spritesheet, video } from '../src';

describe('media1 runtime half', () => {
  it('registers spritesheet, video and gif on nodeTypes; dispose takes them back', async () => {
    const ctx = new Context();
    const nodeTypes = createNodeTypes();
    ctx.provide('nodeTypes', nodeTypes);
    const fiber = ctx.plugin(runtime);
    await fiber;
    expect(nodeTypes.get('spritesheet')).toBe(spritesheet);
    expect(nodeTypes.get('video')).toBe(video);
    expect(nodeTypes.get('gif')).toBe(gif);
    await fiber.dispose();
    expect(nodeTypes.list()).toEqual([]);
  });

  it('names itself and needs only nodeTypes', () => {
    expect(runtime.name).toBe('node-media');
    expect(runtime.inject).toEqual(['nodeTypes']);
  });
});
