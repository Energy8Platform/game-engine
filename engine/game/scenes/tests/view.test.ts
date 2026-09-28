/**
 * `view()`/`views()`/`load()` — F15/F16 from the paper-duel port: nesting is
 * by copy (the module doc), so a document some visible `scene` node embeds
 * is mounted twice — its own hidden top-level mount and the host's copy —
 * and `view()` must answer the one on screen, not just the first one found.
 * `load()` used to be internal-only, and `show()`'s load ended every batch
 * with a full `refresh()` that re-ran EVERY mounted node's `update`, wiping
 * a pose on any view anywhere. See `mount.test.ts`/`once.test.ts` for the
 * harness this borrows.
 */
import { describe, expect, it, vi } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';
import { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, SceneDoc } from '@energy8engine/contracts';
import { createNodeTypes } from '../src/node-types';
import type { NodeType } from '../src/node-types';
import { container, image, scene, type AssetLoader } from '../src/builtin';
import { createScenes } from '../src/scenes';

const loader: AssetLoader = {
  load: vi.fn(async () => {}),
  unload: vi.fn(async () => {}),
  get: () => Texture.EMPTY,
};

function boot(docs: SceneDoc[] = [], opts: { loader?: AssetLoader; extraTypes?: NodeType[] } = {}) {
  const report = vi.fn<(d: Diagnostic) => void>();
  const nodeTypes = createNodeTypes();
  for (const t of [container, image, scene, ...(opts.extraTypes ?? [])]) nodeTypes.register(t);
  const scenes = createScenes({
    root: new Container(),
    design: { width: 100, height: 50 },
    nodeTypes,
    loader: opts.loader ?? loader,
    ctx: new Context(),
    report,
  });
  scenes.replace(docs);
  return { scenes, report, nodeTypes };
}

describe('view() answers the copy on screen', () => {
  const docs = (): SceneDoc[] => [
    { id: 'inner', nodes: [{ id: 'x', type: 'container', props: {} }] },
    { id: 'outer', nodes: [{ id: 'embed', type: 'scene', props: { scene: 'inner' } }] },
  ];
  const ref = { scene: 'inner', node: 'x' };
  /** Each copy picked by WHERE it sits, never by its index in `views()` — that order follows how the mounts were (re)built. */
  const copiesOf = (scenes: ReturnType<typeof boot>['scenes']) => ({
    own: scenes.sceneView('inner')!.getChildByLabel('x')!,
    embedded: scenes.sceneView('outer')!.getChildByLabel('x', true)!,
  });

  it('nothing loaded or shown: view answers the entry own mount — today’s answer', () => {
    const { scenes } = boot(docs());
    const { own } = copiesOf(scenes);
    expect(scenes.views(ref)).toHaveLength(2); // inner's own mount + the copy embedded in outer
    expect(scenes.view(ref)).toBe(own);
  });

  it('show(outer): view answers the copy inside outer’s mount, not inner’s own', async () => {
    const { scenes } = boot(docs());
    const { own, embedded } = copiesOf(scenes);
    await scenes.show('outer');
    expect(scenes.view(ref)).toBe(embedded);
    expect(scenes.view(ref)).not.toBe(own);
  });

  it('hide(outer): view falls back to inner’s own mount again', async () => {
    const { scenes } = boot(docs());
    const { own } = copiesOf(scenes);
    await scenes.show('outer');
    await scenes.hide('outer');
    expect(scenes.view(ref)).toBe(own);
  });

  it('load(outer) → pose via view() → show(outer): the on-screen copy carries the pose as show resolves; the own mount is untouched', async () => {
    const { scenes } = boot(docs());
    const { own, embedded } = copiesOf(scenes);
    await scenes.load('outer');
    scenes.view(ref)!.x = 7;
    await scenes.show('outer');
    expect(scenes.view(ref)).toBe(embedded);
    expect(embedded.x).toBe(7);
    expect(own.x).toBe(0);
  });

  it('a hidden host no longer wins — loaded and hidden, or loaded, shown and hidden', async () => {
    const { scenes } = boot(docs());
    const { own, embedded } = copiesOf(scenes);
    await scenes.load('outer');
    expect(scenes.view(ref)).toBe(embedded);
    await scenes.hide('outer'); // never shown: still drops it
    expect(scenes.view(ref)).toBe(own);
    await scenes.load('outer');
    await scenes.show('outer');
    await scenes.hide('outer');
    expect(scenes.view(ref)).toBe(own);
  });

  it('pending hosts: the latest load wins, a repeat load moves a host to the end, and a replace drops one no longer declared', async () => {
    const { scenes } = boot([
      ...docs(),
      { id: 'other', nodes: [{ id: 'embed', type: 'scene', props: { scene: 'inner' } }] },
    ]);
    const inOther = () => scenes.sceneView('other')!.getChildByLabel('x', true);
    await scenes.load('outer');
    await scenes.load('other');
    expect(scenes.view(ref)).toBe(inOther());
    await scenes.load('outer');
    expect(scenes.view(ref)).toBe(copiesOf(scenes).embedded);
    // `outer` leaves the set, then comes back: the load before it was for a document that is gone.
    scenes.replace([docs()[0]!, { id: 'other', nodes: [{ id: 'embed', type: 'scene', props: { scene: 'inner' } }] }]);
    scenes.replace([
      ...docs(),
      { id: 'other', nodes: [{ id: 'embed', type: 'scene', props: { scene: 'inner' } }] },
    ]);
    expect(scenes.view(ref)).toBe(inOther());
  });
});

describe('views()', () => {
  it('every mounted copy, in mount order; an unknown ref is empty', () => {
    const { scenes } = boot([
      { id: 'inner', nodes: [{ id: 'x', type: 'container', props: {} }] },
      { id: 'outer', nodes: [{ id: 'embed', type: 'scene', props: { scene: 'inner' } }] },
    ]);
    const ref = { scene: 'inner', node: 'x' };
    expect(scenes.views(ref)).toEqual([
      scenes.sceneView('inner')!.getChildByLabel('x'),
      scenes.sceneView('outer')!.getChildByLabel('x', true),
    ]);
    expect(scenes.views({ scene: 'zzz', node: 'nope' })).toEqual([]);
  });

  it('Review Focus 1: inner embedded in two shown hosts — the latest shown wins, views lists all three', async () => {
    const { scenes } = boot([
      { id: 'inner', nodes: [{ id: 'x', type: 'container', props: {} }] },
      { id: 'h1', nodes: [{ id: 'embed', type: 'scene', props: { scene: 'inner' } }] },
      { id: 'h2', nodes: [{ id: 'embed', type: 'scene', props: { scene: 'inner' } }] },
    ]);
    const ref = { scene: 'inner', node: 'x' };
    await scenes.show('h1');
    await scenes.show('h2');
    expect(scenes.views(ref)).toHaveLength(3);
    const inH1 = scenes.sceneView('h1')!.getChildByLabel('x', true);
    const inH2 = scenes.sceneView('h2')!.getChildByLabel('x', true);
    expect(scenes.view(ref)).toBe(inH2);
    expect(scenes.view(ref)).not.toBe(inH1);
    // h2 hides: h1, the one still shown, wins next.
    await scenes.hide('h2');
    expect(scenes.view(ref)).toBe(inH1);
  });
});

describe('load()', () => {
  it('is public, and a following show asks the loader for nothing new', async () => {
    const spy: AssetLoader = { ...loader, load: vi.fn(async () => {}) };
    const { scenes } = boot([{ id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'p.png' } }] }], {
      loader: spy,
    });
    await scenes.load('a');
    expect(spy.load).toHaveBeenCalledWith(['p.png']);
    (spy.load as ReturnType<typeof vi.fn>).mockClear();
    await scenes.show('a');
    expect(spy.load).not.toHaveBeenCalled();
  });

  it('an undeclared id is `show`’s own diagnostic, and still resolves', async () => {
    const { scenes, report } = boot([]);
    await expect(scenes.load('typo')).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', where: 'typo', message: 'scene "typo" is not declared' }),
    );
  });

  it('a pose set after load survives a show that finds nothing left to load', async () => {
    const { scenes } = boot([{ id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'p.png' } }] }]);
    await scenes.load('a');
    const view = scenes.view({ scene: 'a', node: 'i' })!;
    view.x = 123;
    await scenes.show('a');
    expect(view.x).toBe(123);
  });
});

describe('a load re-runs only the nodes it fed', () => {
  /** Its `update` re-lays the view out (`x` back to 0) — a stray re-run shows up as a lost pose, not only in `seen`. */
  function probeType(seen: Container[]): NodeType {
    return {
      type: 'probe',
      schema: Schema.object({ src: Schema.string().default('') }),
      mount: () => new Container(),
      update: (view) => {
        seen.push(view);
        view.x = 0;
      },
      assets: (props) => [(props as { src: string }).src],
    };
  }

  it('a is untouched by loading b: a’s update did not run, a’s pose stands', async () => {
    const seen: Container[] = [];
    const { scenes } = boot([], { extraTypes: [probeType(seen)] });
    scenes.replace([
      { id: 'a', nodes: [{ id: 'i', type: 'probe', props: { src: 'a.png' } }] },
      { id: 'b', nodes: [{ id: 'i', type: 'probe', props: { src: 'b.png' } }] },
    ]);
    const viewA = scenes.view({ scene: 'a', node: 'i' })!;
    const viewB = scenes.view({ scene: 'b', node: 'i' })!;

    seen.length = 0;
    await scenes.load('a');
    expect(seen).toEqual([viewA]); // only a's node fed by this load

    viewA.x = 50;
    seen.length = 0;
    await scenes.load('b');
    expect(seen).toEqual([viewB]); // a's update did NOT re-run
    expect(viewA.x).toBe(50); // a's pose survives
  });

  it('hide(b) unloading b’s art re-runs only the nodes that drew with it: a’s pose stands', async () => {
    const seen: Container[] = [];
    const { scenes } = boot([], { extraTypes: [probeType(seen)] });
    scenes.replace([
      { id: 'a', nodes: [{ id: 'i', type: 'probe', props: { src: 'a.png' } }] },
      { id: 'b', nodes: [{ id: 'i', type: 'probe', props: { src: 'b.png' } }] },
    ]);
    await scenes.show('a');
    await scenes.show('b');
    const viewA = scenes.view({ scene: 'a', node: 'i' })!;
    const viewB = scenes.view({ scene: 'b', node: 'i' })!;

    viewA.x = 50;
    seen.length = 0;
    await scenes.hide('b'); // b.png is an orphan now, and unloaded
    expect(loader.unload).toHaveBeenLastCalledWith(['b.png']);
    expect(seen).toEqual([viewB]);
    expect(viewA.x).toBe(50);
  });

  it('a type with no declared assets is always refreshed — the conservative default', async () => {
    // A type that never says which paths it needs has no way to say "not
    // me": it keeps the old blanket-sweep behaviour, scoped load or not.
    const boomSeen: Container[] = [];
    const { scenes, report } = boot([], {
      extraTypes: [
        {
          type: 'boom',
          schema: Schema.object({}),
          mount: () => new Container(),
          update: (view) => {
            boomSeen.push(view);
            throw new Error('kaboom');
          },
        },
      ],
    });
    scenes.replace([
      {
        id: 'a',
        nodes: [
          { id: 'b', type: 'boom', props: {} },
          { id: 'i', type: 'image', props: { src: 'w.png' } },
        ],
      },
    ]);
    // `replace` already mounted and refreshed once (unscoped, as it always
    // is): `boom` failed there already, so this load's own refresh is a
    // silent repeat of the SAME throw (`failed` suppresses the report).
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ where: 'a/b', message: expect.stringContaining('failed to refresh') }),
    );
    boomSeen.length = 0;
    await scenes.load('a');
    expect(boomSeen).toHaveLength(1); // ran despite the load being scoped to w.png
  });

  it('Review Focus 2: a live patch on a not-yet-loaded node survives its own document’s load', async () => {
    // Patched through `srcKey`, an own prop `update` CONSUMES (it picks the
    // texture) — a common prop like `alpha` is one `refresh` never touches,
    // so it could not tell a refresh re-reading the entry's live props from
    // one re-deriving them from the document.
    const alt = new Texture();
    const textures: Record<string, Texture> = { 'p.png': Texture.WHITE, 'q.png': alt };
    const have = new Set<string>();
    const lazy: AssetLoader = {
      load: vi.fn(async (urls: string[]) => urls.forEach((u) => have.add(u))),
      unload: vi.fn(async (urls: string[]) => urls.forEach((u) => have.delete(u))),
      get: (u) => (have.has(u) ? textures[u] : undefined),
    };
    const { scenes } = boot(
      [{ id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'p.png', srcOf: { alt: 'q.png' } } }] }],
      { loader: lazy },
    );
    const view = scenes.view({ scene: 'a', node: 'i' }) as Sprite;

    expect(scenes.setProps({ scene: 'a', node: 'i' }, { srcKey: 'alt' })).toBe(true);
    expect(view.texture).toBe(Texture.EMPTY); // nothing loaded yet

    await scenes.load('a');
    expect(view.texture).toBe(alt); // the refresh reached it, with the PATCHED key — not the document's `src`
  });
});
