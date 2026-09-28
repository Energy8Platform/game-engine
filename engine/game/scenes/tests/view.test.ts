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

  it('nothing shown: view answers the entry own mount — today’s answer', () => {
    const { scenes } = boot(docs());
    const ref = { scene: 'inner', node: 'x' };
    const copies = scenes.views(ref);
    expect(copies).toHaveLength(2); // inner's own mount + the copy embedded in outer
    expect(scenes.view(ref)).toBe(copies[0]);
  });

  it('show(outer): view answers the copy inside outer’s mount, not inner’s own', async () => {
    const { scenes } = boot(docs());
    const ref = { scene: 'inner', node: 'x' };
    const [own, embedded] = scenes.views(ref);
    await scenes.show('outer');
    expect(scenes.view(ref)).toBe(embedded);
    expect(scenes.view(ref)).not.toBe(own);
    expect(scenes.sceneView('outer')!.getChildByLabel('x', true)).toBe(embedded);
  });

  it('hide(outer): view falls back to inner’s own mount again', async () => {
    const { scenes } = boot(docs());
    const ref = { scene: 'inner', node: 'x' };
    const [own] = scenes.views(ref);
    await scenes.show('outer');
    await scenes.hide('outer');
    expect(scenes.view(ref)).toBe(own);
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
  function probeType(seen: Container[]): NodeType {
    return {
      type: 'probe',
      schema: Schema.object({ src: Schema.string().default('') }),
      mount: () => new Container(),
      update: (view) => void seen.push(view),
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
    const have = new Set<string>();
    const lazy: AssetLoader = {
      load: vi.fn(async (urls: string[]) => urls.forEach((u) => have.add(u))),
      unload: vi.fn(async (urls: string[]) => urls.forEach((u) => have.delete(u))),
      get: (u) => (have.has(u) ? Texture.WHITE : undefined),
    };
    const { scenes } = boot([{ id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'p.png' } }] }], {
      loader: lazy,
    });
    const view = scenes.view({ scene: 'a', node: 'i' }) as Sprite;
    expect(view.texture).not.toBe(Texture.WHITE); // not loaded yet

    expect(scenes.setProps({ scene: 'a', node: 'i' }, { alpha: 0.5 })).toBe(true);
    expect(view.alpha).toBe(0.5);

    await scenes.load('a');
    expect(view.texture).toBe(Texture.WHITE); // the refresh still reached it — same document
    expect(view.alpha).toBe(0.5); // the live patch was not undone by the refresh
  });
});
