import { describe, expect, it, vi } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';
import { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, SceneDoc } from '@energy8engine/contracts';
import { createNodeTypes } from '../src/node-types';
import { container, image, scene, type AssetLoader } from '../src/builtin';
import { createScenes, type ScenesService } from '../src/scenes';

const loader: AssetLoader = {
  load: vi.fn(async () => {}),
  unload: vi.fn(async () => {}),
  get: () => Texture.EMPTY,
};

function boot(docs: SceneDoc[] = []) {
  const ctx = new Context();
  const report = vi.fn<(d: Diagnostic) => void>();
  const nodeTypes = createNodeTypes();
  for (const t of [container, image, scene]) nodeTypes.register(t);
  const root = new Container();
  const scenes = createScenes({
    root,
    design: { width: 100, height: 50 },
    nodeTypes,
    loader,
    ctx,
    report,
  });
  scenes.replace(docs);
  return { ctx, report, nodeTypes, root, scenes };
}

const byId = (s: ScenesService, sceneId: string, nodeId: string) =>
  s.view({ scene: sceneId, node: nodeId });

describe('mounting', () => {
  it('mounts nodes in list order with common props, children into their parent', () => {
    const { scenes } = boot([
      {
        id: 'a',
        nodes: [
          { id: 'bg', type: 'image', props: { src: 'bg.png', x: 5, y: 6 } },
          {
            id: 'grp',
            type: 'container',
            props: { alpha: 0.5 },
            children: [{ id: 'in', type: 'image', props: { src: 'k.png' } }],
          },
        ],
      },
    ]);
    const rootA = scenes.sceneView('a')!;
    expect(rootA.children.map((c) => c.label)).toEqual(['bg', 'grp']);
    expect(byId(scenes, 'a', 'bg')!.position.x).toBe(5);
    expect(byId(scenes, 'a', 'grp')!.alpha).toBe(0.5);
    expect(byId(scenes, 'a', 'in')!.parent).toBe(byId(scenes, 'a', 'grp'));
  });

  it('an unknown type is an error diagnostic and the node is skipped; the rest mounts', () => {
    const { scenes, report } = boot([
      {
        id: 'a',
        nodes: [
          { id: 'x', type: 'spine', props: {} },
          { id: 'y', type: 'container', props: {} },
        ],
      },
    ]);
    expect(byId(scenes, 'a', 'x')).toBeUndefined();
    expect(byId(scenes, 'a', 'y')).toBeDefined();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', plugin: 'scenes', where: 'a/x' }),
    );
  });

  it('a duplicate node id: the later node is skipped with an error', () => {
    const { scenes, report } = boot([
      {
        id: 'a',
        nodes: [
          { id: 'n', type: 'container', props: { x: 1 } },
          { id: 'n', type: 'container', props: { x: 2 } },
        ],
      },
    ]);
    expect(byId(scenes, 'a', 'n')!.x).toBe(1);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ where: 'a/n' }));
  });

  it('a scene node mounts the referenced document as a child, hidden by default when told so', () => {
    const { scenes } = boot([
      { id: 'big', nodes: [{ id: 'banner', type: 'container', props: {} }] },
      { id: 'base', nodes: [{ id: 'bw', type: 'scene', props: { scene: 'big', visible: false } }] },
    ]);
    const bw = byId(scenes, 'base', 'bw')!;
    expect(bw.visible).toBe(false);
    expect(bw.children[0].label).toBe('banner');
  });

  it('a reference cycle skips the node with an error; a missing scene too', () => {
    const { scenes, report } = boot([
      { id: 'a', nodes: [{ id: 'toB', type: 'scene', props: { scene: 'b' } }] },
      {
        id: 'b',
        nodes: [
          { id: 'toA', type: 'scene', props: { scene: 'a' } },
          { id: 'toZ', type: 'scene', props: { scene: 'zzz' } },
        ],
      },
    ]);
    expect(report.mock.calls.map((c) => c[0].where)).toEqual(
      expect.arrayContaining(['b/toA', 'b/toZ']),
    );
    expect(scenes.sceneView('a')).toBeDefined();
  });

  it('replace remounts only changed documents and keeps a visible scene visible', async () => {
    const { scenes, root } = boot([
      { id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] },
      { id: 'b', nodes: [{ id: 'm', type: 'container', props: {} }] },
    ]);
    await scenes.show('a');
    const viewA = scenes.sceneView('a');
    const viewB = scenes.sceneView('b');
    scenes.replace([
      { id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] },
      { id: 'b', nodes: [{ id: 'm', type: 'container', props: { x: 9 } }] },
    ]);
    expect(scenes.sceneView('a')).toBe(viewA);
    expect(scenes.sceneView('b')).not.toBe(viewB);
    expect(scenes.visible()).toEqual(['a']);
    expect(scenes.container.children).toContain(viewA);
    scenes.replace([{ id: 'b', nodes: [] }]);
    expect(scenes.sceneView('a')).toBeUndefined();
    expect(scenes.visible()).toEqual([]);
    expect(root.children).toContain(scenes.container);
  });

  it('re-registering a node type remounts every node of that type', () => {
    const { scenes, nodeTypes } = boot([
      { id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] },
    ]);
    const before = byId(scenes, 'a', 'n');
    nodeTypes.register({ ...container });
    expect(byId(scenes, 'a', 'n')).not.toBe(before);
  });

  it('a view the type did not build survives an unmount: `unmount` detaches, the runtime never destroys', () => {
    const foreign = new Container();
    const { scenes, nodeTypes } = boot();
    nodeTypes.register({
      type: 'foreign',
      schema: Schema.object({}),
      mount: () => foreign,
      unmount: (v) => v.parent?.removeChild(v),
    });
    scenes.replace([{ id: 'a', nodes: [{ id: 'f', type: 'foreign', props: {} }] }]);
    scenes.replace([]);
    expect(foreign.destroyed).toBe(false);
    expect(foreign.parent).toBeNull();
  });
});

describe('show / hide', () => {
  it('loads the union of assets through nesting before showing, unloads orphans on hide', async () => {
    const { scenes } = boot([
      { id: 'big', nodes: [{ id: 'i', type: 'image', props: { src: 'big.png' } }] },
      {
        id: 'base',
        nodes: [
          { id: 'bg', type: 'image', props: { src: 'bg.png' } },
          { id: 'bw', type: 'scene', props: { scene: 'big' } },
        ],
      },
      { id: 'other', nodes: [{ id: 'bg2', type: 'image', props: { src: 'bg.png' } }] },
    ]);
    expect(scenes.assetsOf('base').sort()).toEqual(['bg.png', 'big.png']);
    await scenes.show('base');
    expect(loader.load).toHaveBeenLastCalledWith(expect.arrayContaining(['bg.png', 'big.png']));
    await scenes.show('other');
    await scenes.hide('base');
    expect(loader.unload).toHaveBeenLastCalledWith(['big.png']); // bg.png still shown by `other`
    expect(scenes.visible()).toEqual(['other']);
  });

  it('a failed load is an error naming the path; the scene still shows', async () => {
    const failing: AssetLoader = {
      ...loader,
      load: vi.fn(async () => {
        throw new Error('404');
      }),
    };
    const ctx = new Context();
    const report = vi.fn<(d: Diagnostic) => void>();
    const nodeTypes = createNodeTypes();
    nodeTypes.register(image);
    const scenes = createScenes({
      root: new Container(),
      design: { width: 1, height: 1 },
      nodeTypes,
      loader: failing,
      ctx,
      report,
    });
    scenes.replace([{ id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'nope.png' } }] }]);
    await scenes.show('a');
    expect(scenes.visible()).toEqual(['a']);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('nope.png') }),
    );
  });

  it('an image mounted before its texture loaded picks it up once show has loaded it', async () => {
    const tex = Texture.WHITE;
    const have = new Set<string>();
    const lazy: AssetLoader = {
      load: vi.fn(async (urls: string[]) => urls.forEach((u) => have.add(u))),
      unload: vi.fn(async (urls: string[]) => urls.forEach((u) => have.delete(u))),
      get: (u) => (have.has(u) ? tex : undefined),
    };
    const nodeTypes = createNodeTypes();
    nodeTypes.register(image);
    const scenes = createScenes({
      root: new Container(),
      design: { width: 1, height: 1 },
      nodeTypes,
      loader: lazy,
      ctx: new Context(),
    });
    scenes.replace([{ id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'w.png' } }] }]);
    const sprite = byId(scenes, 'a', 'i') as Sprite;
    expect(sprite.texture).not.toBe(tex);
    await scenes.show('a');
    expect(sprite.texture).toBe(tex);
    await scenes.hide('a');
    expect(sprite.texture).toBe(Texture.EMPTY);
  });

  it('showing a nested scene flips its node visible inside the visible parent', async () => {
    const { scenes } = boot([
      { id: 'big', nodes: [] },
      { id: 'base', nodes: [{ id: 'bw', type: 'scene', props: { scene: 'big', visible: false } }] },
    ]);
    await scenes.show('base');
    await scenes.show('big');
    expect(byId(scenes, 'base', 'bw')!.visible).toBe(true);
    expect(scenes.visible()).toEqual(['base']);
    await scenes.hide('big');
    expect(byId(scenes, 'base', 'bw')!.visible).toBe(false);
  });

  it('an unknown scene is an error diagnostic, resolved; the same scene twice is a no-op', async () => {
    const { scenes, report } = boot([{ id: 'a', nodes: [] }]);
    await scenes.show('zzz');
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ where: 'zzz' }));
    await scenes.show('a');
    await scenes.show('a');
    expect(scenes.visible()).toEqual(['a']);
  });

  it('concurrent shows run in order', async () => {
    const order: string[] = [];
    const slow: AssetLoader = {
      ...loader,
      load: vi.fn(async (urls) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(urls.join());
      }),
    };
    const ctx = new Context();
    const nodeTypes = createNodeTypes();
    nodeTypes.register(image);
    const scenes = createScenes({
      root: new Container(),
      design: { width: 1, height: 1 },
      nodeTypes,
      loader: slow,
      ctx,
    });
    scenes.replace([
      { id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'a.png' } }] },
      { id: 'b', nodes: [{ id: 'i', type: 'image', props: { src: 'b.png' } }] },
    ]);
    await Promise.all([scenes.show('a'), scenes.show('b')]);
    expect(order).toEqual(['a.png', 'b.png']);
    expect(scenes.visible()).toEqual(['a', 'b']);
  });

  it('highlight draws one box at the top and null clears it', () => {
    const { scenes } = boot([{ id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] }]);
    scenes.highlight({ scene: 'a', node: 'n' });
    const top = scenes.container.children.at(-1)!;
    expect(top.label).toBe('highlight');
    expect(top.visible).toBe(true);
    scenes.highlight(null);
    expect(scenes.container.children.at(-1)!.visible).toBe(false);
  });
});
