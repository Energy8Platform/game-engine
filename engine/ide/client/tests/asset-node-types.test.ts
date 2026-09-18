import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import type { FileEntry } from '@energy8engine/contracts';
import * as assetNodeTypes from '../src/plugins/asset-node-types';

const file = (path: string): FileEntry => ({ path, kind: 'file' });
const node =
  (type: string, prop: string) =>
  (src: string, { x, y }: { x: number; y: number }) => ({ type, props: { [prop]: src, x, y } });

async function boot() {
  const ctx = new Context();
  await ctx.plugin(assetNodeTypes);
  return ctx;
}

/** What `scenes` derives from a game's report: spritesheet (json), spine (skel/json + `.atlas` beside), video (mp4). */
async function media() {
  const ctx = await boot();
  ctx.assetNodeTypes.register('derived:spritesheet', {
    extensions: ['json'],
    node: node('spritesheet', 'sheet'),
  });
  ctx.assetNodeTypes.register('derived:spine', {
    extensions: ['skel', 'json'],
    sibling: 'atlas',
    node: node('spine', 'skeleton'),
  });
  ctx.assetNodeTypes.register('derived:video', { extensions: ['mp4'], node: node('video', 'src') });
  return ctx;
}

const typeOf = (ctx: Context, path: string, tree?: FileEntry[]) =>
  ctx.assetNodeTypes.pick(path, tree)?.node(path, { x: 0, y: 0 }).type;

describe('assetNodeTypes', () => {
  it('has no built-in: a fresh service picks nothing and lists nothing', async () => {
    const ctx = await boot();
    expect(ctx.assetNodeTypes.pick('assets/a.png')).toBeUndefined();
    expect(ctx.assetNodeTypes.list()).toEqual([]);
  });

  it('picks by extension case-insensitively, against extensions lower-cased too', async () => {
    const ctx = await boot();
    ctx.assetNodeTypes.register('image', {
      extensions: ['png', 'JPG'],
      node: node('image', 'src'),
    });
    expect(typeOf(ctx, 'assets/a.PNG')).toBe('image');
    expect(typeOf(ctx, 'assets/a.jpg')).toBe('image');
    expect(ctx.assetNodeTypes.pick('assets/a.webp')).toBeUndefined();
  });

  it('with a tree: a .json with its .atlas beside is the sibling registration; alone, the sibling-less one', async () => {
    const ctx = await media();
    const tree = [file('assets/a.json'), file('assets/a.atlas'), file('assets/b.json')];
    expect(typeOf(ctx, 'assets/a.json', tree)).toBe('spine');
    expect(typeOf(ctx, 'assets/b.json', tree)).toBe('spritesheet');
    expect(typeOf(ctx, 'assets/c.mp4', tree)).toBe('video');
  });

  it('with a tree: the sibling is looked up by the stem of the path as written, case kept', async () => {
    const ctx = await media();
    expect(typeOf(ctx, 'assets/A.JSON', [file('assets/A.atlas')])).toBe('spine');
    expect(typeOf(ctx, 'assets/A.JSON', [file('assets/a.atlas')])).toBe('spritesheet');
  });

  it('with a tree: a directory named like the sibling does not count; a .skel with no atlas is still spine (the host reports the missing atlas)', async () => {
    const ctx = await media();
    expect(typeOf(ctx, 'assets/a.json', [{ path: 'assets/a.atlas', kind: 'dir' }])).toBe(
      'spritesheet',
    );
    expect(typeOf(ctx, 'assets/a.skel', [])).toBe('spine');
  });

  it('without a tree the sibling rule is ignored: the last registered for the extension wins', async () => {
    const ctx = await media();
    expect(typeOf(ctx, 'assets/b.json')).toBe('spine');
    expect(typeOf(ctx, 'assets/a.skel')).toBe('spine');
  });

  it('a registration made BEFORE the derived ones wins too: derived:* rank last whenever they arrive', async () => {
    const ctx = await boot();
    ctx.assetNodeTypes.register('mine', { extensions: ['json'], node: node('mine', 'file') });
    ctx.assetNodeTypes.register('derived:spritesheet', {
      extensions: ['json'],
      node: node('spritesheet', 'sheet'),
    });
    expect(typeOf(ctx, 'b.json')).toBe('mine');
    expect(typeOf(ctx, 'b.json', [file('b.json')])).toBe('mine');
    // Two of the project's own: the later one wins, as before.
    ctx.assetNodeTypes.register('later', { extensions: ['json'], node: node('later', 'file') });
    expect(typeOf(ctx, 'b.json')).toBe('later');
  });

  it('a registration made after the derived ones wins its extension among the sibling-less', async () => {
    const ctx = await media();
    const off = ctx.assetNodeTypes.register('mine', {
      extensions: ['json', 'mp4'],
      node: node('mine', 'file'),
    });
    expect(typeOf(ctx, 'b.json', [file('b.json')])).toBe('mine');
    expect(typeOf(ctx, 'c.mp4', [file('c.mp4')])).toBe('mine');
    // A sibling match is the more specific claim and still wins.
    expect(typeOf(ctx, 'a.json', [file('a.json'), file('a.atlas')])).toBe('spine');
    off();
    expect(typeOf(ctx, 'b.json', [file('b.json')])).toBe('spritesheet');
  });

  it('list() returns registrations in registration order', async () => {
    const ctx = await media();
    const off = ctx.assetNodeTypes.register('sound', {
      extensions: ['mp3'],
      node: node('sound', 'src'),
    });
    expect(ctx.assetNodeTypes.list().map((r) => r.id)).toEqual([
      'derived:spritesheet',
      'derived:spine',
      'derived:video',
      'sound',
    ]);
    off();
    expect(ctx.assetNodeTypes.list().map((r) => r.id)).toEqual([
      'derived:spritesheet',
      'derived:spine',
      'derived:video',
    ]);
  });

  it('registering the same def object twice for one id: disposal is by slot, not by value — a repeat call to an already-fired disposer must not evict the other slot', async () => {
    const ctx = await boot();
    const def = { extensions: ['foo'], node: node('foo', 'src') };
    ctx.assetNodeTypes.register('dup', def);
    const offSecond = ctx.assetNodeTypes.register('dup', def);
    offSecond();
    offSecond(); // already fired — a value-based (indexOf) disposer would wrongly find and evict the first slot here
    expect(ctx.assetNodeTypes.pick('a.foo')).toBe(def);
    expect(ctx.assetNodeTypes.list().filter((r) => r.id === 'dup')).toHaveLength(1);
  });

  it('pick finds no extension in a path with no dot, nor in a dotfile', async () => {
    const ctx = await media();
    expect(ctx.assetNodeTypes.pick('README')).toBeUndefined();
    expect(ctx.assetNodeTypes.pick('assets/.json')).toBeUndefined();
  });

  it('a later register with an existing id wins (last-wins), and its disposer restores the earlier one', async () => {
    const ctx = await media();
    const off = ctx.assetNodeTypes.register('derived:video', {
      extensions: ['mp4', 'gif'],
      node: node('custom-video', 'src'),
    });
    expect(typeOf(ctx, 'a.gif')).toBe('custom-video');
    expect(typeOf(ctx, 'a.mp4')).toBe('custom-video');
    off();
    expect(ctx.assetNodeTypes.pick('a.gif')).toBeUndefined();
    expect(typeOf(ctx, 'a.mp4')).toBe('video');
  });
});
