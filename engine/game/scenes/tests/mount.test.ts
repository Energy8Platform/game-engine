import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, SceneDoc } from '@energy8engine/contracts';
import { createNodeTypes } from '../src/node-types';
import { container, image, scene, shape, text, type AssetLoader } from '../src/builtin';
import { createScenes, type ScenesService } from '../src/scenes';
import { createTransitions, fade, type TickerLike } from '../src/transitions';

/** A ticker the test drives by hand — `transitions.test.ts` has the same. */
function fakeTicker(): TickerLike & { tick(ms: number): void } {
  const fns = new Set<(t: { deltaMS: number }) => void>();
  return {
    add: (fn) => fns.add(fn),
    remove: (fn) => fns.delete(fn),
    tick: (ms) => [...fns].forEach((fn) => fn({ deltaMS: ms })),
  };
}

/** A promise the test resolves by hand. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

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

  it('an unknown type skips the node and the rest mounts; the error comes when the scene shows', async () => {
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
    // Not yet: nothing is on screen, and the type may still be on its way.
    expect(report).not.toHaveBeenCalled();
    await scenes.show('a');
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', plugin: 'scenes', where: 'a/x' }),
    );
  });

  it('a type registered after replace but before show is no error: the remount mounts the node', async () => {
    // The boot order in a real composition: `scenes1` replaces the boot
    // set first, `reels1` registers `reels` from an `inject` callback later.
    const { scenes, nodeTypes, report } = boot([
      { id: 'a', nodes: [{ id: 'x', type: 'spine', props: {} }] },
    ]);
    nodeTypes.register({ type: 'spine', schema: Schema.object({}), mount: () => new Container() });
    expect(byId(scenes, 'a', 'x')).toBeDefined();
    await scenes.show('a');
    expect(report).not.toHaveBeenCalled();
  });

  it('a type taken away and registered again while the scene is visible (a hot re-apply) is no error', async () => {
    const { scenes, nodeTypes, report } = boot([
      { id: 'a', nodes: [{ id: 'x', type: 'spine', props: {} }] },
    ]);
    const spine = { type: 'spine', schema: Schema.object({}), mount: () => new Container() };
    const dispose = nodeTypes.register(spine);
    await scenes.show('a');
    dispose();
    expect(byId(scenes, 'a', 'x')).toBeUndefined();
    nodeTypes.register(spine);
    expect(byId(scenes, 'a', 'x')).toBeDefined();
    expect(report).not.toHaveBeenCalled();
  });

  it('a type taken away for good is an error on the next show', async () => {
    const { scenes, nodeTypes, report } = boot([
      { id: 'a', nodes: [{ id: 'x', type: 'spine', props: {} }] },
    ]);
    const dispose = nodeTypes.register({
      type: 'spine',
      schema: Schema.object({}),
      mount: () => new Container(),
    });
    await scenes.show('a');
    dispose();
    expect(report).not.toHaveBeenCalled();
    await scenes.hide('a');
    await scenes.show('a');
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', plugin: 'scenes', where: 'a/x' }),
    );
  });

  it('a common prop off its type fails that node alone; the rest mounts and shows', async () => {
    const { scenes, report } = boot([
      {
        id: 'a',
        nodes: [
          { id: 'x', type: 'container', props: { x: 'abc' } },
          { id: 'y', type: 'container', props: { x: 1 } },
        ],
      },
    ]);
    expect(byId(scenes, 'a', 'x')).toBeUndefined();
    expect(byId(scenes, 'a', 'y')!.x).toBe(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        where: 'a/x',
        message: expect.stringContaining('failed to mount'),
      }),
    );
    await scenes.show('a');
    expect(scenes.visible()).toEqual(['a']);
  });

  it('a container sized by `width` scales to its children, whose own `width` stays geometry', () => {
    // `applyCommon` at mount time reads a container's bounds as 0 (no children
    // yet) and silently leaves `scale` at 1 — the pass after the children is
    // what makes a sized container (and a gizmo resize of one) stick.
    const { scenes, nodeTypes } = boot();
    nodeTypes.register(shape);
    scenes.replace([
      {
        id: 'a',
        nodes: [
          {
            id: 'box',
            type: 'container',
            props: { width: 300 },
            children: [{ id: 'art', type: 'shape', props: { width: 100, height: 100 } }],
          },
        ],
      },
    ]);
    expect(byId(scenes, 'a', 'box')!.scale.x).toBe(3);
    // `shape` declares `width`/`height` itself: 100 is the rectangle drawn,
    // NOT a rescale of it on top.
    const art = byId(scenes, 'a', 'art')!;
    expect(art.scale.x).toBe(1);
    expect(art.getLocalBounds().width).toBe(100);
  });

  it('`mask: true` masks the node\'s parent, and the unmount clears it', () => {
    // The parent is a FOREIGN view (the runtime detaches it, never destroys
    // it): the one case where a stale `mask` would outlive the masking node.
    const { scenes, nodeTypes } = boot();
    const host = new Container();
    nodeTypes.register({
      type: 'foreign',
      schema: Schema.object({}),
      mount: () => host,
      unmount: (v) => v.parent?.removeChild(v),
    });
    scenes.replace([
      {
        id: 'a',
        nodes: [
          {
            id: 'host',
            type: 'foreign',
            props: {},
            children: [{ id: 'cut', type: 'container', props: { mask: true } }],
          },
        ],
      },
    ]);
    expect(host.mask).toBe(byId(scenes, 'a', 'cut'));
    scenes.replace([{ id: 'a', nodes: [] }]);
    expect(host.mask).toBeFalsy();   // pixi's getter reads back `undefined`, not `null`
    expect(host.destroyed).toBe(false);
  });

  it("a type owning `width` with a non-number schema still mounts, and can still be the mask", () => {
    // The common pass is handed the STRIPPED props, and `mask` is read off
    // that same dict: validating `width: 'thick'` as a common number would
    // throw and take the node (and its children) down with it.
    const { scenes, nodeTypes, report } = boot();
    nodeTypes.register({
      type: 'gauge',
      schema: Schema.object({ width: Schema.union(['thin', 'thick']).default('thin') }),
      mount: () => new Container(),
    });
    scenes.replace([
      {
        id: 'a',
        nodes: [
          {
            id: 'host',
            type: 'container',
            props: {},
            children: [{ id: 'g', type: 'gauge', props: { width: 'thick', mask: true } }],
          },
        ],
      },
    ]);
    expect(report).not.toHaveBeenCalled();
    expect(byId(scenes, 'a', 'host')!.mask).toBe(byId(scenes, 'a', 'g'));
  });

  it('a second sibling asking to mask the same parent is a diagnostic, not a silent overwrite', () => {
    const { scenes, report } = boot([
      {
        id: 'a',
        nodes: [
          {
            id: 'host',
            type: 'container',
            props: {},
            children: [
              { id: 'cut', type: 'container', props: { mask: true } },
              { id: 'also', type: 'container', props: { mask: true } },
            ],
          },
        ],
      },
    ]);
    // The first one keeps it.
    expect(byId(scenes, 'a', 'host')!.mask).toBe(byId(scenes, 'a', 'cut'));
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        where: 'a/also',
        message: '"cut" is already the mask of host',
      }),
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
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        where: 'a/n',
        message:
          'node id "n" is declared twice in "a" — ids are unique per document, not per parent, and the later one is skipped',
        fix: 'prefix them, e.g. "rock_bar" and "paper_bar"',
      }),
    );
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

  it('view finds a node nested under a container, not just top-level ones', () => {
    const { scenes } = boot([
      {
        id: 'a',
        nodes: [
          {
            id: 'grp',
            type: 'container',
            props: {},
            children: [
              {
                id: 'inner',
                type: 'container',
                props: {},
                children: [{ id: 'deep', type: 'image', props: { src: 'k.png' } }],
              },
            ],
          },
        ],
      },
    ]);
    expect(byId(scenes, 'a', 'inner')!.parent).toBe(byId(scenes, 'a', 'grp'));
    expect(byId(scenes, 'a', 'deep')!.parent).toBe(byId(scenes, 'a', 'inner'));
    expect(byId(scenes, 'a', 'nope')).toBeUndefined();
  });

  it("view does not leak a node from an embedded scene's own doc into the host scene's lookup", async () => {
    const { scenes } = boot([
      { id: 'b', nodes: [{ id: 'x', type: 'container', props: {} }] },
      {
        id: 'a',
        nodes: [
          { id: 'embed', type: 'scene', props: { scene: 'b' } },
          {
            id: 'grp',
            type: 'container',
            props: {},
            children: [{ id: 'inA', type: 'container', props: {} }],
          },
        ],
      },
    ]);
    await scenes.show('a');
    // `b/x` mounted into `a`'s Mount.all (via the `scene` node's own mountDoc) — but it is not
    // a node of `a`; a bare id match used to resolve it anyway.
    expect(byId(scenes, 'a', 'x')).toBeUndefined();
    // `b` itself still finds its own node, scoped correctly.
    expect(byId(scenes, 'b', 'x')).toBeDefined();
    // a genuinely nested node of `a` (under `container`) still resolves.
    expect(byId(scenes, 'a', 'inA')).toBeDefined();
  });

  it('a view the type did not build survives an unmount: `unmount` detaches, the runtime never destroys', () => {
    const foreign = new Container();
    const { scenes, nodeTypes } = boot();
    const unmount = vi.fn((v: Container) => v.parent?.removeChild(v));
    nodeTypes.register({
      type: 'foreign',
      schema: Schema.object({}),
      mount: () => foreign,
      unmount,
    });
    scenes.replace([{ id: 'a', nodes: [{ id: 'f', type: 'foreign', props: {} }] }]);
    scenes.replace([]);
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(unmount).toHaveBeenCalledWith(foreign);
    expect(foreign.destroyed).toBe(false);
    expect(foreign.parent).toBeNull();
  });

  it('a `shape` view is one the runtime built itself: unmount destroys it, the mirror of the foreign case above', () => {
    const { scenes, nodeTypes } = boot();
    nodeTypes.register(shape);
    scenes.replace([{ id: 'a', nodes: [{ id: 's', type: 'shape', props: {} }] }]);
    const view = byId(scenes, 'a', 's') as Graphics;
    expect(view).toBeInstanceOf(Graphics);
    scenes.replace([]);
    expect(view.destroyed).toBe(true);
  });

  it('a `$cell` binding in an ordinary document mounts at its empty value, and says so', async () => {
    // The runtime is lenient everywhere — only a cell scene is SUPPOSED to
    // carry one — but no longer silent: a built dist may never have run
    // the host's static check.
    const { scenes, nodeTypes, report } = boot([
      { id: 'a', nodes: [{ id: 't', type: 'text', props: { text: 'x{$cell.mv}' } }] },
    ]);
    nodeTypes.register(text);
    await scenes.show('a');
    expect((byId(scenes, 'a', 't') as Text).text).toBe('');
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        where: 'a/t',
        message: '"text" reads $cell, but this document was not mounted for a cell',
      }),
    );
  });
  it('a preview `show` of a bound document reports nothing — not even when an edit remounts it; a plain `show` still does', async () => {
    // The IDE looking at a cell scene is not the game showing one.
    const doc = { id: 'a', nodes: [{ id: 't', type: 'text', props: { text: 'x{$cell.mv}' } }] };
    const { scenes, nodeTypes, report } = boot([doc]);
    nodeTypes.register(text);
    await scenes.show('a', { preview: true });
    scenes.replace([{ ...doc, nodes: [{ ...doc.nodes[0], props: { text: 'y{$cell.mv}' } }] }]);
    expect(report).not.toHaveBeenCalled();
    await scenes.hide('a');
    await scenes.show('a');
    expect(report).toHaveBeenCalledTimes(1);
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

  it('a throwing update is reported once per node; siblings still refresh and the scene still shows', async () => {
    const tex = Texture.WHITE;
    const have = new Set<string>();
    const lazy: AssetLoader = {
      load: vi.fn(async (urls: string[]) => urls.forEach((u) => have.add(u))),
      unload: vi.fn(async (urls: string[]) => urls.forEach((u) => have.delete(u))),
      get: (u) => (have.has(u) ? tex : undefined),
    };
    const report = vi.fn<(d: Diagnostic) => void>();
    const nodeTypes = createNodeTypes();
    nodeTypes.register(image);
    nodeTypes.register({
      type: 'boom',
      schema: Schema.object({}),
      mount: () => new Container(),
      update: () => {
        throw new Error('kaboom');
      },
    });
    const scenes = createScenes({
      root: new Container(),
      design: { width: 1, height: 1 },
      nodeTypes,
      loader: lazy,
      ctx: new Context(),
      report,
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
    const sprite = byId(scenes, 'a', 'i') as Sprite;
    await scenes.show('a');
    expect(scenes.visible()).toEqual(['a']);
    expect(sprite.texture).toBe(tex); // the sibling still got refreshed
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        where: 'a/b',
        message: expect.stringContaining('failed to refresh'),
      }),
    );
    await scenes.hide('a'); // unloads w.png, refreshing again
    await scenes.show('a'); // reloads it, refreshing again
    expect(report).toHaveBeenCalledTimes(1); // still just the one diagnostic
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
      // `a` is the slow one: only a queue still yields it first.
      load: vi.fn(async (urls) => {
        await new Promise((r) => setTimeout(r, urls[0] === 'a.png' ? 10 : 1));
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

  it('the highlight box follows the node through a remount', () => {
    const { scenes } = boot([
      { id: 'a', nodes: [{ id: 'n', type: 'image', props: { src: 'w.png', x: 0 } }] },
    ]);
    scenes.highlight({ scene: 'a', node: 'n' });
    const box = scenes.container.children.at(-1)!;
    const before = box.getLocalBounds().minX;
    scenes.replace([{ id: 'a', nodes: [{ id: 'n', type: 'image', props: { src: 'w.png', x: 40 } }] }]);
    expect(box.visible).toBe(true);
    expect(box.getLocalBounds().minX).toBe(before + 40);
    scenes.replace([]);
    expect(box.visible).toBe(false);
  });
});

describe('show / hide under change', () => {
  it('a nested host keeps its own alpha after a fade in and out', async () => {
    const ticker = fakeTicker();
    const transitions = createTransitions();
    transitions.register(fade);
    const nodeTypes = createNodeTypes();
    for (const t of [container, scene]) nodeTypes.register(t);
    const scenes = createScenes({
      root: new Container(),
      design: { width: 1, height: 1 },
      nodeTypes,
      loader,
      ctx: new Context(),
      transitions,
      transition: 'fade',
      transitionMs: 100,
      ticker,
    });
    scenes.replace([
      { id: 'big', nodes: [] },
      {
        id: 'base',
        nodes: [{ id: 'bw', type: 'scene', props: { scene: 'big', alpha: 0.5, visible: false } }],
      },
    ]);
    const showBase = scenes.show('base');
    await tick();
    ticker.tick(100);
    await showBase;
    const host = byId(scenes, 'base', 'bw')!;
    const showBig = scenes.show('big');
    await tick();
    ticker.tick(100);
    await showBig;
    expect(host.visible).toBe(true);
    expect(host.alpha).toBe(0.5);
    const hideBig = scenes.hide('big');
    await tick();
    ticker.tick(100);
    await hideBig;
    expect(host.visible).toBe(false);
    expect(host.alpha).toBe(0.5);
  });

  it('a replace that drops the document during its load: "not declared", nothing shown', async () => {
    const gate = deferred();
    const gated: AssetLoader = { ...loader, load: vi.fn(() => gate.promise) };
    const report = vi.fn<(d: Diagnostic) => void>();
    const nodeTypes = createNodeTypes();
    nodeTypes.register(image);
    const scenes = createScenes({
      root: new Container(),
      design: { width: 1, height: 1 },
      nodeTypes,
      loader: gated,
      ctx: new Context(),
      report,
    });
    scenes.replace([{ id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'a.png' } }] }]);
    const showing = scenes.show('a');
    await tick(); // the queue reached the load
    expect(gated.load).toHaveBeenCalled();
    scenes.replace([]);
    gate.resolve();
    await showing;
    expect(scenes.visible()).toEqual([]);
    expect(scenes.container.children.map((c) => c.label)).toEqual(['highlight']);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        where: 'a',
        message: expect.stringContaining('not declared'),
      }),
    );
  });

  it('a replace that remounts the document during its hide transition leaves no ghost', async () => {
    const gate = deferred();
    const transitions = createTransitions();
    transitions.register({ id: 'slow', run: () => gate.promise });
    const nodeTypes = createNodeTypes();
    nodeTypes.register(container);
    const scenes = createScenes({
      root: new Container(),
      design: { width: 1, height: 1 },
      nodeTypes,
      loader,
      ctx: new Context(),
      transitions,
      transition: 'slow',
    });
    scenes.replace([{ id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] }]);
    await scenes.show('a', { transition: 'cut' });
    const hiding = scenes.hide('a');
    await tick(); // the transition is running
    scenes.replace([{ id: 'a', nodes: [{ id: 'n', type: 'container', props: { x: 1 } }] }]);
    gate.resolve();
    await hiding;
    expect(scenes.visible()).toEqual([]);
    expect(scenes.container.children.map((c) => c.label)).toEqual(['highlight']);
    expect(scenes.sceneView('a')!.parent).toBeNull();
  });

  it('editing an asset path of a visible scene loads the new asset', async () => {
    const seen: string[][] = [];
    const spy: AssetLoader = { ...loader, load: vi.fn(async (urls) => void seen.push([...urls])) };
    const nodeTypes = createNodeTypes();
    nodeTypes.register(image);
    const scenes = createScenes({
      root: new Container(),
      design: { width: 1, height: 1 },
      nodeTypes,
      loader: spy,
      ctx: new Context(),
    });
    scenes.replace([{ id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'x.png' } }] }]);
    await scenes.show('a');
    scenes.replace([{ id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'y.png' } }] }]);
    await tick();
    expect(seen).toEqual([['x.png'], ['y.png']]);
    expect(scenes.visible()).toEqual(['a']);
  });
});

describe('live props', () => {
  it('setProps patches a mounted node: the type re-validates, `update` re-applies, the DOCUMENT is untouched', () => {
    const { scenes, nodeTypes } = boot();
    nodeTypes.register(shape);
    scenes.replace([
      { id: 'a', nodes: [{ id: 's', type: 'shape', props: { width: 40, height: 20 } }] },
    ]);
    const view = byId(scenes, 'a', 's') as Graphics;
    expect(scenes.setProps({ scene: 'a', node: 's' }, { width: 80 })).toBe(true);
    // `height` still comes from the document — the patch is a MERGE.
    expect(view.getLocalBounds()).toMatchObject({ maxX: 80, maxY: 20 });
    expect(scenes.docs().get('a')!.nodes[0].props.width).toBe(40);
    // A second patch merges over the first, not over the document alone.
    expect(scenes.setProps({ scene: 'a', node: 's' }, { height: 50 })).toBe(true);
    expect(view.getLocalBounds()).toMatchObject({ maxX: 80, maxY: 50 });
  });

  it('a common key in the patch goes through the common pass', () => {
    const { scenes } = boot([
      { id: 'a', nodes: [{ id: 'n', type: 'container', props: { x: 1, alpha: 1 } }] },
    ]);
    const view = byId(scenes, 'a', 'n')!;
    expect(scenes.setProps({ scene: 'a', node: 'n' }, { x: 12, alpha: 0.25 })).toBe(true);
    expect(view.x).toBe(12);
    expect(view.alpha).toBe(0.25);
  });

  it('a node nested under a container is patchable too', () => {
    const { scenes } = boot([
      {
        id: 'a',
        nodes: [
          {
            id: 'grp',
            type: 'container',
            props: {},
            children: [{ id: 'deep', type: 'container', props: {} }],
          },
        ],
      },
    ]);
    expect(scenes.setProps({ scene: 'a', node: 'deep' }, { x: 7 })).toBe(true);
    expect(byId(scenes, 'a', 'deep')!.x).toBe(7);
  });

  it('an unknown node is `false` and a diagnostic, nothing else', () => {
    const { scenes, report } = boot([{ id: 'a', nodes: [] }]);
    expect(scenes.setProps({ scene: 'a', node: 'nope' }, { x: 1 })).toBe(false);
    expect(scenes.setProps({ scene: 'zzz', node: 'n' }, { x: 1 })).toBe(false);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', where: 'a/nope' }),
    );
  });

  it('a value the type refuses is `false` and a diagnostic naming the prop; the view is untouched', () => {
    const { scenes, nodeTypes, report } = boot();
    nodeTypes.register(shape);
    scenes.replace([
      { id: 'a', nodes: [{ id: 's', type: 'shape', props: { width: 40, height: 20 } }] },
    ]);
    const view = byId(scenes, 'a', 's') as Graphics;
    expect(scenes.setProps({ scene: 'a', node: 's' }, { kind: 'blob' })).toBe(false);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        where: 'a/s',
        message: expect.stringContaining('prop kind'),
      }),
    );
    expect(view.getLocalBounds()).toMatchObject({ maxX: 40, maxY: 20 });
    // A value only the APPLY refuses (a colour pixi cannot parse) is the same answer.
    expect(scenes.setProps({ scene: 'a', node: 's' }, { fill: 'not-a-colour' })).toBe(false);
    // …and so is a common prop off its type.
    expect(scenes.setProps({ scene: 'a', node: 's' }, { x: 'abc' })).toBe(false);
    expect(byId(scenes, 'a', 's')!.x).toBe(0);
  });

  it('a refused patch is not remembered: the next good one merges over the document, not over it', () => {
    const { scenes, nodeTypes } = boot();
    nodeTypes.register(shape);
    scenes.replace([
      { id: 'a', nodes: [{ id: 's', type: 'shape', props: { width: 40, height: 20 } }] },
    ]);
    expect(scenes.setProps({ scene: 'a', node: 's' }, { kind: 'blob' })).toBe(false);
    expect(scenes.setProps({ scene: 'a', node: 's' }, { width: 80 })).toBe(true);
    expect(byId(scenes, 'a', 's')!.getLocalBounds()).toMatchObject({ maxX: 80, maxY: 20 });
  });

  it('refresh re-applies the MERGED props; an unrelated replace keeps the patch', () => {
    const seen: number[] = [];
    const { scenes, nodeTypes } = boot();
    nodeTypes.register({
      type: 'probe',
      schema: Schema.object({ v: Schema.number().default(0) }),
      mount: () => new Container(),
      update: (_view, p) => void seen.push((p as { v: number }).v),
    });
    scenes.replace([{ id: 'a', nodes: [{ id: 'p', type: 'probe', props: { v: 1 } }] }]);
    expect(scenes.setProps({ scene: 'a', node: 'p' }, { v: 7 })).toBe(true);
    seen.length = 0;
    // `b` is the only changed document: `a` is not remounted, and the
    // remount's own `refresh()` runs over every mount.
    scenes.replace([
      { id: 'a', nodes: [{ id: 'p', type: 'probe', props: { v: 1 } }] },
      { id: 'b', nodes: [] },
    ]);
    expect(seen).toEqual([7]);
  });

  it('a remount drops the patch: the document props win again', () => {
    const { scenes, nodeTypes } = boot();
    nodeTypes.register(shape);
    scenes.replace([
      { id: 'a', nodes: [{ id: 's', type: 'shape', props: { width: 40, height: 20 } }] },
    ]);
    expect(scenes.setProps({ scene: 'a', node: 's' }, { width: 80 })).toBe(true);
    // A re-register of the type is a remount of every node using it.
    nodeTypes.register({ ...shape });
    expect(byId(scenes, 'a', 's')!.getLocalBounds()).toMatchObject({ maxX: 40, maxY: 20 });
  });

  it('a patched `scene` host keeps the patch across a transition, not just the document props', async () => {
    const { scenes } = boot([
      { id: 'big', nodes: [] },
      { id: 'base', nodes: [{ id: 'bw', type: 'scene', props: { scene: 'big', alpha: 1 } }] },
    ]);
    await scenes.show('base');
    expect(scenes.setProps({ scene: 'base', node: 'bw' }, { alpha: 0.5 })).toBe(true);
    await scenes.show('big');
    expect(byId(scenes, 'base', 'bw')!.alpha).toBe(0.5);
  });

  // What the flow's `prop` kind does — `nodeSchema(ref)` says the node has the
  // prop, then `setProps(ref, { [prop]: value })` with the string as typed.
  it("`prop` on a `scene` host's `scene` remounts the embedded document in place; show/hide bookkeeping holds", async () => {
    const { scenes, report } = boot([
      { id: 'big_win', nodes: [{ id: 'banner', type: 'container', props: {} }] },
      { id: 'free_spins', nodes: [{ id: 'fs', type: 'container', props: {} }] },
      {
        id: 'base_game',
        nodes: [
          { id: 'under', type: 'container', props: {} },
          { id: 'bw', type: 'scene', props: { scene: 'big_win', visible: false, x: 7 } },
          { id: 'over', type: 'container', props: {} },
        ],
      },
    ]);
    await scenes.show('base_game');
    await scenes.show('big_win');
    const root = scenes.sceneView('base_game')!;
    const ref = { scene: 'base_game', node: 'bw' };
    const v1 = byId(scenes, 'base_game', 'bw')!;
    expect(v1.visible).toBe(true);
    expect(root.getChildByLabel('banner', true)).not.toBeNull();
    expect(scenes.nodeSchema(ref)!.dict).toHaveProperty('scene');

    expect(scenes.setProps(ref, { scene: 'free_spins' })).toBe(true);
    const v2 = byId(scenes, 'base_game', 'bw')!;
    expect(v2).not.toBe(v1);
    expect(v1.parent).toBeNull();
    expect(root.children.map((c) => c.label)).toEqual(['under', 'bw', 'over']);
    expect(root.getChildByLabel('fs', true)).not.toBeNull();
    expect(root.getChildByLabel('banner', true)).toBeNull();
    // The common props ride along; the document is untouched.
    expect(v2.x).toBe(7);
    expect(scenes.docs().get('base_game')!.nodes[1].props.scene).toBe('big_win');
    // `free_spins` was never shown: the fresh host takes the document's `visible: false`.
    expect(v2.visible).toBe(false);
    await scenes.show('free_spins');
    expect(v2.visible).toBe(true);
    await scenes.hide('free_spins');
    expect(v2.visible).toBe(false);
    // A later common patch merges over the live `scene`: no remount, the same view.
    expect(scenes.setProps(ref, { alpha: 0.5 })).toBe(true);
    expect(byId(scenes, 'base_game', 'bw')).toBe(v2);
    expect(v2.alpha).toBe(0.5);
    // Pointing back at a document that IS shown: the fresh host comes up visible.
    expect(scenes.setProps(ref, { scene: 'big_win' })).toBe(true);
    const v3 = byId(scenes, 'base_game', 'bw')!;
    expect(v3).not.toBe(v2);
    expect(v3.visible).toBe(true);
    expect(v3.alpha).toBe(0.5);
    expect(root.getChildByLabel('banner', true)).not.toBeNull();
    // A document that does not exist: refused, the old host stays, one diagnostic.
    report.mockClear();
    expect(scenes.setProps(ref, { scene: 'nope' })).toBe(false);
    expect(byId(scenes, 'base_game', 'bw')).toBe(v3);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ where: 'base_game/bw' }));
  });

  it('patches EVERY copy of the node: the embedded one on screen, and the standalone mount', async () => {
    const { scenes, nodeTypes } = boot();
    nodeTypes.register(text);
    scenes.replace([
      { id: 'big_win', nodes: [{ id: 'banner', type: 'text', props: { text: 'x0' } }] },
      {
        id: 'base_game',
        nodes: [{ id: 'bw', type: 'scene', props: { scene: 'big_win', visible: false } }],
      },
    ]);
    await scenes.show('base_game');
    // A host is visible, so this flips the EMBEDDED copy — `big_win`'s own
    // top-level mount stays off screen, and it is the one `view()` answers.
    await scenes.show('big_win');
    expect(scenes.setProps({ scene: 'big_win', node: 'banner' }, { text: 'x99' })).toBe(true);
    const onScreen = scenes.sceneView('base_game')!.getChildByLabel('banner', true) as Text;
    const standalone = byId(scenes, 'big_win', 'banner') as Text;
    expect(onScreen).not.toBe(standalone);
    expect(onScreen.text).toBe('x99');
    expect(standalone.text).toBe('x99');
  });

  it('a copy whose `update` throws leaves NO copy remembering the patch', async () => {
    const seen: number[] = [];
    let bad: Container | null = null;
    const { scenes, nodeTypes, report } = boot();
    nodeTypes.register({
      type: 'probe',
      schema: Schema.object({ v: Schema.number().default(0) }),
      mount: () => new Container(),
      update: (view, p) => {
        seen.push((p as { v: number }).v);
        if (view === bad) throw new Error('no');
      },
    });
    scenes.replace([
      { id: 'big_win', nodes: [{ id: 'banner', type: 'probe', props: { v: 1 } }] },
      {
        id: 'base_game',
        nodes: [{ id: 'bw', type: 'scene', props: { scene: 'big_win', visible: false } }],
      },
    ]);
    await scenes.show('base_game');
    await scenes.show('big_win');
    // The SECOND copy the apply loop reaches — `entriesOf` answers the
    // standalone mount first (it was replaced first), the embedded one after.
    bad = scenes.sceneView('base_game')!.getChildByLabel('banner', true);
    report.mockClear();
    seen.length = 0;

    expect(scenes.setProps({ scene: 'big_win', node: 'banner' }, { v: 5 })).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ where: 'big_win/banner' }));

    // Neither copy kept it — not even the one whose `update` came back
    // clean before the throw: a following no-op patch re-applies the
    // DOCUMENT's `v`, which it could not do if `live` had been committed.
    bad = null;
    seen.length = 0;
    expect(scenes.setProps({ scene: 'big_win', node: 'banner' }, {})).toBe(true);
    expect(seen).toEqual([1, 1]);
  });
});

describe('nodeSchema', () => {
  it('merges COMMON with the type\'s own dict, the type winning the name', () => {
    const { scenes, nodeTypes } = boot();
    nodeTypes.register({
      type: 'gauge',
      schema: Schema.object({ width: Schema.union(['thin', 'thick']).default('thin') }),
      mount: () => new Container(),
    });
    scenes.replace([{ id: 'a', nodes: [{ id: 'g', type: 'gauge', props: {} }] }]);
    const dict = scenes.nodeSchema({ scene: 'a', node: 'g' })!.dict!;
    // The TYPE's own `width` wins over COMMON's number — what a caller
    // coercing a literal must see (the runtime strips it the same way).
    expect(dict.width.type).toBe('union');
    expect(dict.alpha.type).toBe('number');
    expect(dict.visible.type).toBe('boolean');
    expect(dict.tint.type).toBe('string');
    expect(scenes.nodeSchema({ scene: 'a', node: 'nope' })).toBeUndefined();
    expect(scenes.nodeSchema({ scene: 'zzz', node: 'g' })).toBeUndefined();
  });
});

describe('live props are all-or-nothing', () => {
  /** A patch is one change: half of it landing is worse than none of it, because nothing says which half. */
  it('a mixed patch whose COMMON half is bad applies neither half', () => {
    const { scenes, nodeTypes } = boot();
    nodeTypes.register(shape);
    scenes.replace([
      { id: 'a', nodes: [{ id: 's', type: 'shape', props: { width: 40, height: 20 } }] },
    ]);
    const view = byId(scenes, 'a', 's') as Graphics;
    // `width` is the TYPE's, `x` is the runtime's: the type pass alone
    // would say yes, redraw at 999, and only then trip over `x`.
    expect(scenes.setProps({ scene: 'a', node: 's' }, { width: 999, x: 'abc' })).toBe(false);
    expect(view.getLocalBounds()).toMatchObject({ maxX: 40, maxY: 20 });
    expect(view.x).toBe(0);
  });

  it('a mixed patch whose COLOUR half is bad applies neither half', () => {
    const { scenes } = boot([
      { id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'k.png' } }] },
    ]);
    const view = byId(scenes, 'a', 'i') as Sprite;
    expect(scenes.setProps({ scene: 'a', node: 'i' }, { x: 12, tint: 'not-a-colour' })).toBe(false);
    expect(view.x).toBe(0);
  });

  it("a `text` patch with a bad fill leaves the old text as well as the old colour", () => {
    const { scenes, nodeTypes } = boot();
    nodeTypes.register(text);
    scenes.replace([
      { id: 'a', nodes: [{ id: 't', type: 'text', props: { text: 'OLD', fill: '#ffffff' } }] },
    ]);
    const view = byId(scenes, 'a', 't') as Text;
    expect(scenes.setProps({ scene: 'a', node: 't' }, { text: 'NEW', fill: 'bad' })).toBe(false);
    expect(view.text).toBe('OLD');
    expect(view.style.fill).toBe(0xffffff);
  });

  it('the diagnostic names the one prop at fault when the message identifies it', () => {
    const { scenes, report } = boot([
      { id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] },
    ]);
    scenes.setProps({ scene: 'a', node: 'n' }, { alpha: 0.5, x: 'abc' });
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringContaining('prop x:') }),
    );
  });
});
