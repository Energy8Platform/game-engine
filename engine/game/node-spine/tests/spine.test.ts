globalThis.requestAnimationFrame = ((fn: (t: number) => void) =>
  setTimeout(() => fn(performance.now()), 16)) as unknown as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = clearTimeout as unknown as typeof cancelAnimationFrame;

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { Spine, SpineTexture, TextureAtlas } from '@esotericsoftware/spine-pixi-v8';
import type { Context } from 'cordis';
import { spine } from '../src/spine';

const dir = new URL('./fixtures/', import.meta.url);
const json = JSON.parse(readFileSync(new URL('minimal.json', dir), 'utf8')) as object;
const atlasText = readFileSync(new URL('minimal.atlas', dir), 'utf8');
/** What the loader holds after `scenes.show`: the atlas parsed and textured, the skeleton raw. */
const loaded = () => {
  const atlas = new TextureAtlas(atlasText);
  atlas.pages[0].setTexture(SpineTexture.from(Texture.WHITE.source));
  return (path: string) => (path.endsWith('.atlas') ? atlas : json);
};

const ctxWith = (get: (path: string) => unknown) =>
  ({ reflect: { get: (name: string) => (name === 'assetLoader' ? { get } : undefined) } }) as unknown as Context;
const none = { reflect: { get: () => undefined } } as unknown as Context;
const props = (over: Record<string, unknown> = {}) =>
  spine.schema({ skeleton: 'assets/hero.json', ...over } as never);
const child = (view: Container) => view.children[0] as Spine;

describe('spine', () => {
  it('declares its asset contract; an empty atlas is the skeleton stem + .atlas', () => {
    expect(spine.type).toBe('spine');
    expect(spine.accept).toEqual({
      extensions: ['skel', 'json'],
      prop: 'skeleton',
      sibling: 'atlas',
    });
    expect(spine.assetProps).toEqual(['skeleton', 'atlas']);
    const meta = (k: string) => (spine.schema.dict![k].meta as { asset?: string[] }).asset;
    expect(meta('skeleton')).toEqual(['skel', 'json']);
    expect(meta('atlas')).toEqual(['atlas']);
    expect(props()).toMatchObject({ loop: true, speed: 1 });
    expect(spine.assets!(props())).toEqual(['assets/hero.json', 'assets/hero.atlas']);
    expect(spine.assets!(props({ skeleton: 'a/b.skel' }))).toEqual(['a/b.skel', 'a/b.atlas']);
    expect(spine.assets!(props({ atlas: 'x/other.atlas' }))).toEqual([
      'assets/hero.json',
      'x/other.atlas',
    ]);
    expect(spine.assets!(spine.schema({ skeleton: '' } as never))).toEqual([]);
  });

  it('mounts a container holding a Spine on the first animation, looping, at speed', () => {
    const view = spine.mount(props(), ctxWith(loaded()));
    expect(view).toBeInstanceOf(Container);
    const s = child(view);
    expect(s).toBeInstanceOf(Spine);
    expect(s.state.tracks[0]!.animation!.name).toBe('idle');
    expect(s.state.tracks[0]!.loop).toBe(true);
    expect(s.state.timeScale).toBe(1);
    expect(s.skeleton.skin!.name).toBe('default');
    spine.unmount!(view);
    expect(s.destroyed).toBe(true);
    expect(view.destroyed).toBe(true);
  });

  it('honours animation, loop, skin and speed', () => {
    const view = spine.mount(
      props({ animation: 'wave', loop: false, skin: 'alt', speed: 2 }),
      ctxWith(loaded()),
    );
    const s = child(view);
    expect(s.state.tracks[0]!.animation!.name).toBe('wave');
    expect(s.state.tracks[0]!.loop).toBe(false);
    expect(s.skeleton.skin!.name).toBe('alt');
    expect(s.state.timeScale).toBe(2);
    spine.unmount!(view);
  });

  it('an unknown animation or skin falls back rather than throwing', () => {
    const view = spine.mount(props({ animation: 'nope', skin: 'nope' }), ctxWith(loaded()));
    const s = child(view);
    expect(s.state.tracks[0]!.animation!.name).toBe('idle');
    expect(s.skeleton.skin!.name).toBe('default');
    spine.unmount!(view);
  });

  it('a skin that turns unknown reverts to the default, not the previous one', () => {
    const ctx = ctxWith(loaded());
    const view = spine.mount(props({ skin: 'alt' }), ctx);
    const s = child(view);
    expect(s.skeleton.skin!.name).toBe('alt');
    spine.update!(view, props({ skin: 'nope' }), ctx);
    expect(s.skeleton.skin!.name).toBe('default');
    spine.unmount!(view);
  });

  it('with nothing loaded mounts an empty container; update fills it once both assets land', () => {
    const view = spine.mount(props(), none);
    expect(view.children).toHaveLength(0);
    const get = loaded();
    // Only the skeleton so far (the atlas still loading): still empty.
    spine.update!(
      view,
      props(),
      ctxWith((p) => (p.endsWith('.json') ? get(p) : undefined)),
    );
    expect(view.children).toHaveLength(0);
    spine.update!(view, props(), ctxWith(get));
    expect(view.children).toHaveLength(1);
    expect(child(view).state.tracks[0]!.animation!.name).toBe('idle');
    spine.unmount!(view);
  });

  it('malformed skeleton throws from update with a message naming the problem, not caught by the type', () => {
    const get = loaded();
    for (const [bad, why] of [
      [{ not: 'a skeleton' }, 'no "bones"'],
      [
        { bones: [{ name: 'root' }], slots: [{ name: 's', bone: 'nope' }] },
        "Couldn't find bone nope",
      ],
    ] as const) {
      // Mounts empty (nothing loaded yet); `update` is what fills it in once both assets land —
      // and now what throws, since the scenes runtime's `refresh()` is what catches and reports it.
      const view = spine.mount(props(), none);
      const ctx = ctxWith((p) => (p.endsWith('.json') ? bad : get(p)));
      expect(() => spine.update!(view, props(), ctx)).toThrow(why);
      expect(view.children).toHaveLength(0);
      view.destroy();
    }
  });

  it('a foreign child mounted under the wrapper (a hand-edited YAML child) survives update, is not treated as the Spine', () => {
    const view = spine.mount(props(), none);
    const foreign = view.addChild(new Container());
    foreign.label = 'foreign';
    spine.update!(view, props(), ctxWith(loaded()));
    expect(view.children).toContain(foreign);
    expect(foreign.destroyed).toBe(false);
    const s = view.children.find((c) => c instanceof Spine);
    expect(s).toBeInstanceOf(Spine);
    expect(s).not.toBe(foreign);
    spine.unmount!(view);
  });

  it('update changes animation, loop, skin and speed in place, and keeps the same Spine', () => {
    const ctx = ctxWith(loaded());
    const view = spine.mount(props(), ctx);
    const s = child(view);
    spine.update!(view, props({ animation: 'wave', loop: false, skin: 'alt', speed: 0.5 }), ctx);
    expect(child(view)).toBe(s);
    expect(s.state.tracks[0]!.animation!.name).toBe('wave');
    expect(s.state.tracks[0]!.loop).toBe(false);
    expect(s.skeleton.skin!.name).toBe('alt');
    expect(s.state.timeScale).toBe(0.5);
    // Same props again: the track is not restarted.
    s.update(0.25);
    const t = s.state.tracks[0]!.trackTime;
    expect(t).toBeGreaterThan(0);
    spine.update!(view, props({ animation: 'wave', loop: false, skin: 'alt', speed: 0.5 }), ctx);
    expect(s.state.tracks[0]!.trackTime).toBe(t);
    spine.unmount!(view);
  });

  it('after an unload of either half the Spine goes; the next load builds it again', () => {
    const view = spine.mount(props(), ctxWith(loaded()));
    const s = child(view);
    spine.update!(view, props(), none);
    expect(view.children).toHaveLength(0);
    expect(s.destroyed).toBe(true);
    const get = loaded();
    spine.update!(view, props(), ctxWith(get));
    const again = child(view);
    expect(again).toBeInstanceOf(Spine);
    // The atlas alone gone: its textures went with it.
    spine.update!(
      view,
      props(),
      ctxWith((p) => (p.endsWith('.atlas') ? undefined : get(p))),
    );
    expect(view.children).toHaveLength(0);
    expect(again.destroyed).toBe(true);
    spine.unmount!(view);
  });

  it('once resolves at once when nothing is loaded yet (no Spine child)', async () => {
    const view = spine.mount(props(), none);
    await expect(spine.once!(view, props(), none)).resolves.toBeUndefined();
  });

  it('once plays the named animation without looping and resolves when it completes', async () => {
    const view = spine.mount(props(), ctxWith(loaded()));
    const s = child(view);
    const p = spine.once!(view, props({ animation: 'wave' }), none);
    const entry = s.state.tracks[0]!;
    expect(entry.animation!.name).toBe('wave');
    expect(entry.loop).toBe(false);
    let settled = false;
    p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false); // not yet — only the track's own completion resolves it
    entry.listener!.complete!(entry);
    await expect(p).resolves.toBeUndefined();
    spine.unmount!(view);
  });

  it('once falls back to the first animation when none is named or the named one is unknown', async () => {
    const view = spine.mount(props(), ctxWith(loaded()));
    const s = child(view);
    const p = spine.once!(view, props({ animation: 'nope' }), none);
    const entry = s.state.tracks[0]!;
    expect(entry.animation!.name).toBe('idle');
    entry.listener!.complete!(entry);
    await expect(p).resolves.toBeUndefined();
    spine.unmount!(view);
  });
});
