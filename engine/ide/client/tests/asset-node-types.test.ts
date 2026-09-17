import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import * as assetNodeTypes from '../src/plugins/asset-node-types';

async function boot() {
  const ctx = new Context();
  await ctx.plugin(assetNodeTypes);
  return ctx;
}

describe('assetNodeTypes', () => {
  it('picks the built-in image type case-insensitively by extension', async () => {
    const ctx = await boot();
    expect(ctx.assetNodeTypes.pick('assets/a.PNG')?.node).toBeInstanceOf(Function);
    expect(ctx.assetNodeTypes.pick('assets/a.jpg')).toBeDefined();
    expect(ctx.assetNodeTypes.pick('assets/a.jpeg')).toBeDefined();
    expect(ctx.assetNodeTypes.pick('assets/a.webp')).toBeDefined();
  });

  it('returns undefined for an unregistered extension', async () => {
    const ctx = await boot();
    expect(ctx.assetNodeTypes.pick('clip.mp4')).toBeUndefined();
  });

  it('node() builds an image node at the drop point', async () => {
    const ctx = await boot();
    const def = ctx.assetNodeTypes.pick('a/logo.png')!;
    expect(def.node('a/logo.png', { x: 10, y: 20 })).toEqual({
      type: 'image',
      props: { src: 'a/logo.png', x: 10, y: 20, anchor: 0.5 },
    });
  });

  it('list() returns registrations in registration order', async () => {
    const ctx = await boot();
    const off = ctx.assetNodeTypes.register('sound', {
      extensions: ['mp3'],
      node: (src, { x, y }) => ({ type: 'sound', props: { src, x, y } }),
    });
    expect(ctx.assetNodeTypes.list().map((r) => r.id)).toEqual(['image', 'sound']);
    off();
    expect(ctx.assetNodeTypes.list().map((r) => r.id)).toEqual(['image']);
  });

  it('a later register with an existing id wins (last-wins), and its disposer restores the built-in', async () => {
    const ctx = await boot();
    const custom = {
      extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
      node: (src: string, { x, y }: { x: number; y: number }) => ({
        type: 'custom-image',
        props: { src, x, y },
      }),
    };
    const off = ctx.assetNodeTypes.register('image', custom);
    expect(ctx.assetNodeTypes.pick('a.gif')?.node('a.gif', { x: 0, y: 0 })).toEqual({
      type: 'custom-image',
      props: { src: 'a.gif', x: 0, y: 0 },
    });

    off();
    // restored to the built-in
    expect(ctx.assetNodeTypes.pick('a.gif')).toBeUndefined();
    expect(ctx.assetNodeTypes.pick('a.png')?.node('a.png', { x: 1, y: 2 })).toEqual({
      type: 'image',
      props: { src: 'a.png', x: 1, y: 2, anchor: 0.5 },
    });
  });
});
