import { describe, expect, it, vi } from 'vitest';
import { Container, Text, Texture } from 'pixi.js';
import { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, SceneDoc } from '@energy8engine/contracts';
import { createNodeTypes, type NodeType } from '../src/node-types';
import { container, image, scene, text, type AssetLoader } from '../src/builtin';
import { createScenes } from '../src/scenes';

const loader: AssetLoader = {
  load: vi.fn(async () => {}),
  unload: vi.fn(async () => {}),
  get: () => Texture.EMPTY,
};

/** A type with its own prop and no `update`: the runtime can only remount it. */
const fake: NodeType<{ kind: string }> = {
  type: 'fake',
  schema: Schema.object({ kind: Schema.string().default('a') }),
  mount: (p) => Object.assign(new Container(), { kind: p.kind }),
};

/** Design 480×288 (`first-slot`'s); no portrait size, so portrait is the rotated 288×480. */
function boot(docs: SceneDoc[] = []) {
  const ctx = new Context();
  const report = vi.fn<(d: Diagnostic) => void>();
  const nodeTypes = createNodeTypes();
  for (const t of [container, image, scene, text, fake]) nodeTypes.register(t);
  const scenes = createScenes({
    root: new Container(),
    design: { width: 480, height: 288 },
    nodeTypes,
    loader,
    ctx,
    report,
  });
  scenes.replace(docs);
  return { report, scenes, view: (node: string) => scenes.view({ scene: 'a', node })! };
}

/** 1280×720 with no insets: landscape. 288×480: portrait, the rotated design at scale 1 (its safe rect IS the design). */
const LANDSCAPE = [1280, 720] as const;
const PORTRAIT = [288, 480] as const;

const kindOf = (v: Container | undefined) => (v as unknown as { kind: string } | undefined)?.kind;

describe('orientation', () => {
  it('is landscape before the first resize; a resize measures the SAFE rect', () => {
    const { scenes } = boot([{ id: 'a', nodes: [] }]);
    expect(scenes.orientation()).toBe('landscape');
    scenes.resize(...LANDSCAPE);
    expect(scenes.orientation()).toBe('landscape');
    scenes.resize(...PORTRAIT);
    expect(scenes.orientation()).toBe('portrait');
    // A square viewport whose insets take a side band: the safe rect is taller than wide.
    scenes.resize(480, 480, { top: 0, right: 200, bottom: 0, left: 0 });
    expect(scenes.orientation()).toBe('portrait');
    scenes.resize(480, 480, { top: 200, right: 0, bottom: 0, left: 0 });
    expect(scenes.orientation()).toBe('landscape');
  });

  it('the portrait fit uses the portrait design: the rotated landscape one by default, `portrait` when given', () => {
    const { scenes } = boot([{ id: 'a', nodes: [] }]);
    // 288×480 into 288×480: scale 1, safe rect = the design.
    const fit = scenes.resize(...PORTRAIT);
    expect(fit.scale).toBe(1);
    expect(fit.viewport).toEqual({ left: 0, top: 0, right: 288, bottom: 480 });
    const own = createScenes({
      root: new Container(),
      design: { width: 480, height: 288 },
      portrait: { width: 144, height: 240 },
      nodeTypes: createNodeTypes(),
      loader,
      ctx: new Context(),
    });
    expect(own.resize(...PORTRAIT).scale).toBe(2);
    expect(own.resize(...LANDSCAPE).scale).toBeCloseTo(720 / 288, 10);
  });
});

describe('the portrait variant', () => {
  const doc = (): SceneDoc => ({
    id: 'a',
    nodes: [
      { id: 'logo', type: 'text', props: { text: 'hi', x: 10, y: 20 } },
      { id: 'coin', type: 'container', props: { x: 5 } },
    ],
    portrait: {
      nodes: {
        logo: { x: 0, y: 40, pin: 'top', text: 'HI' },
        coin: { visible: false },
      },
    },
  });

  it('a portrait resize applies portrait.nodes (x/y/pin place, visible hides, text updates); landscape restores the document', () => {
    const { report, scenes, view } = boot([doc()]);
    scenes.resize(...LANDSCAPE);
    expect([view('logo').x, view('logo').y]).toEqual([10, 20]);
    expect((view('logo') as Text).text).toBe('hi');
    expect(view('coin').visible).toBe(true);

    scenes.resize(...PORTRAIT);
    // pin: top of the 288×480 safe rect is (144, 0); x/y are offsets from it.
    expect(view('logo').x).toBeCloseTo(144, 10);
    expect(view('logo').y).toBeCloseTo(40, 10);
    expect((view('logo') as Text).text).toBe('HI');
    expect(view('coin').visible).toBe(false);
    // A later resize that stays portrait re-places the pin and touches nothing else.
    scenes.resize(360, 640);
    expect(view('logo').x).toBeCloseTo(144, 10);
    expect((view('logo') as Text).text).toBe('HI');

    scenes.resize(...LANDSCAPE);
    expect([view('logo').x, view('logo').y]).toEqual([10, 20]);
    expect((view('logo') as Text).text).toBe('hi');
    expect(view('coin').visible).toBe(true);
    // The document itself was never written to.
    expect(scenes.docs().get('a')!.nodes[0].props).toEqual({ text: 'hi', x: 10, y: 20 });
    expect(report).not.toHaveBeenCalled();
  });

  it('a refused override keeps the landscape props, with a diagnostic naming the prop', () => {
    const { report, scenes, view } = boot([
      {
        id: 'a',
        nodes: [
          { id: 't', type: 'text', props: { text: 'hi', size: 20 } },
          { id: 'ok', type: 'container', props: {} },
        ],
        portrait: { nodes: { t: { size: 'big', x: 5 }, ok: { x: 7 } } },
      },
    ]);
    scenes.resize(...PORTRAIT);
    expect((view('t') as Text).style.fontSize).toBe(20);
    expect(view('t').x).toBe(0);
    // The sibling's override still lands: a refusal is per node.
    expect(view('ok').x).toBe(7);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({
      severity: 'error',
      plugin: 'scenes',
      where: 'a/t',
      message: expect.stringMatching(/^portrait prop size: /),
      fix: 'fix the override',
    });
    // Back to landscape: nothing to undo for `t`, and no second complaint.
    scenes.resize(...LANDSCAPE);
    expect(view('ok').x).toBe(0);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('a type without `update` whose own prop changes is remounted in place: same z-index, a new entry', () => {
    const { scenes, view } = boot([
      {
        id: 'a',
        nodes: [
          { id: 'bg', type: 'container', props: {} },
          { id: 'f', type: 'fake', props: { kind: 'a', x: 1 } },
          { id: 'fg', type: 'container', props: {} },
        ],
        portrait: { nodes: { f: { kind: 'b', x: 2 } } },
      },
    ]);
    const root = scenes.sceneView('a')!;
    const v1 = view('f');
    expect(root.getChildIndex(v1)).toBe(1);
    scenes.resize(...PORTRAIT);
    const v2 = view('f');
    expect(v2).not.toBe(v1);
    expect(v1.parent).toBeNull();
    expect(kindOf(v2)).toBe('b');
    expect(v2.x).toBe(2);
    expect(root.children.map((c) => c.label)).toEqual(['bg', 'f', 'fg']);
    scenes.resize(...LANDSCAPE);
    const v3 = view('f');
    expect(v3).not.toBe(v2);
    expect(kindOf(v3)).toBe('a');
    expect(v3.x).toBe(1);
    expect(root.children.map((c) => c.label)).toEqual(['bg', 'f', 'fg']);
  });

  it('a type without `update` whose own props are unchanged is not remounted: its children and their live patches survive', () => {
    const { scenes, view } = boot([
      {
        id: 'a',
        nodes: [
          {
            id: 'wrap',
            type: 'container',
            props: { x: 1 },
            children: [{ id: 'kid', type: 'container', props: {} }],
          },
        ],
        portrait: { nodes: { wrap: { x: 50 } } },
      },
    ]);
    const wrap = view('wrap');
    const kid = view('kid');
    expect(scenes.setProps({ scene: 'a', node: 'kid' }, { alpha: 0.5 })).toBe(true);
    scenes.resize(...PORTRAIT);
    expect(view('wrap')).toBe(wrap);
    expect(wrap.x).toBe(50);
    expect(view('kid')).toBe(kid);
    expect(kid.alpha).toBe(0.5);
    scenes.resize(...LANDSCAPE);
    expect(view('wrap')).toBe(wrap);
    expect(wrap.x).toBe(1);
  });

  it('a `scene` host: an own-prop override rebuilds its embedded copy; a common one just applies; a shown host stays shown', async () => {
    const { scenes, view } = boot([
      {
        id: 'a',
        nodes: [
          { id: 'host', type: 'scene', props: { scene: 'b', visible: false } },
          { id: 'swap', type: 'scene', props: { scene: 'b' } },
        ],
        portrait: { nodes: { host: { x: 5 }, swap: { scene: 'c' } } },
      },
      { id: 'b', nodes: [{ id: 'n1', type: 'container', props: {} }] },
      { id: 'c', nodes: [{ id: 'n2', type: 'container', props: {} }] },
    ]);
    scenes.resize(...LANDSCAPE);
    await scenes.show('a');
    await scenes.show('b');
    const host = view('host');
    expect(host.visible).toBe(true);
    expect(view('swap').children[0]!.label).toBe('n1');
    scenes.resize(...PORTRAIT);
    expect(view('host')).toBe(host);
    expect(host.x).toBe(5);
    expect(host.visible).toBe(true);
    expect(view('swap').children[0]!.label).toBe('n2');
    scenes.resize(...LANDSCAPE);
    expect(host.x).toBe(0);
    expect(host.visible).toBe(true);
    expect(view('swap').children[0]!.label).toBe('n1');
  });

  it('layering: document < portrait < live — a setProps patch survives a flip both ways and wins over the override', () => {
    const { scenes, view } = boot([
      {
        id: 'a',
        nodes: [{ id: 't', type: 'text', props: { text: 'doc', x: 0 } }],
        portrait: { nodes: { t: { text: 'por', x: 9 } } },
      },
    ]);
    scenes.resize(...LANDSCAPE);
    expect(scenes.setProps({ scene: 'a', node: 't' }, { text: 'live' })).toBe(true);
    scenes.resize(...PORTRAIT);
    expect((view('t') as Text).text).toBe('live');
    expect(view('t').x).toBe(9);
    // A patch made while portrait: still on top of the override, and kept on the way back.
    expect(scenes.setProps({ scene: 'a', node: 't' }, { y: 3 })).toBe(true);
    expect(view('t').x).toBe(9);
    scenes.resize(...LANDSCAPE);
    expect((view('t') as Text).text).toBe('live');
    expect([view('t').x, view('t').y]).toEqual([0, 3]);
  });

  it('assets() lists both layers: an image whose portrait src differs preloads both', async () => {
    const { scenes } = boot([
      {
        id: 'a',
        nodes: [{ id: 'i', type: 'image', props: { src: 'l.png' } }],
        portrait: { nodes: { i: { src: 'p.png' } } },
      },
    ]);
    expect(scenes.assetsOf('a')).toEqual(['l.png', 'p.png']);
    await scenes.show('a');
    expect(loader.load).toHaveBeenLastCalledWith(['l.png', 'p.png']);
  });

  it('an override for an id that is not a top-level node is one warning per mount', () => {
    const { report, scenes } = boot([
      {
        id: 'a',
        nodes: [
          { id: 'wrap', type: 'container', props: {}, children: [{ id: 'kid', type: 'container', props: {} }] },
        ],
        portrait: { nodes: { ghost: { x: 1 }, kid: { x: 2 } } },
      },
    ]);
    scenes.resize(...PORTRAIT);
    scenes.resize(...LANDSCAPE);
    expect(report.mock.calls.map(([d]) => d)).toEqual([
      {
        severity: 'warning',
        plugin: 'scenes',
        where: 'a/ghost',
        message: 'portrait override for unknown node "ghost"',
        fix: 'name a top-level node of this scene',
      },
      {
        severity: 'warning',
        plugin: 'scenes',
        where: 'a/kid',
        message: 'portrait override for unknown node "kid"',
        fix: 'name a top-level node of this scene',
      },
    ]);
  });

  it('a document mounted while portrait comes up with the override applied; its document props stay the document\'s', () => {
    const { scenes, view } = boot();
    scenes.resize(...PORTRAIT);
    const d = doc();
    scenes.replace([d]);
    expect(view('logo').x).toBeCloseTo(144, 10);
    expect((view('logo') as Text).text).toBe('HI');
    expect(view('coin').visible).toBe(false);
    expect(d.nodes[0].props).toEqual({ text: 'hi', x: 10, y: 20 });
    // The editor's `replace()` diff reads document props: the same document again is no remount.
    const logo = view('logo');
    scenes.replace([doc()]);
    expect(view('logo')).toBe(logo);
    scenes.resize(...LANDSCAPE);
    expect([view('logo').x, view('logo').y]).toEqual([10, 20]);
    expect((view('logo') as Text).text).toBe('hi');
  });

  it('an embedded copy turns too: a document\'s roots take its own override inside a host (big_win through base_game)', async () => {
    const { report, scenes, view } = boot([
      {
        id: 'a',
        nodes: [
          { id: 'host', type: 'scene', props: { scene: 'b', visible: false } },
          { id: 'coin', type: 'container', props: {} },
        ],
        portrait: { nodes: { coin: { visible: false } } },
      },
      {
        id: 'b',
        nodes: [
          { id: 'title', type: 'text', props: { text: 'big win', x: 10 } },
          { id: 'wrap', type: 'container', props: {}, children: [{ id: 'kid', type: 'container', props: { x: 1 } }] },
        ],
        // `pin` on an embedded root is inert (the host lays the copy out); `x` still lands.
        portrait: { nodes: { title: { visible: false, pin: 'top', x: 20 }, kid: { x: 9 } } },
      },
    ]);
    scenes.resize(...LANDSCAPE);
    await scenes.show('a');
    await scenes.show('b');
    const copy = view('host').children.find((c) => c.label === 'title')!;
    const own = scenes.view({ scene: 'b', node: 'title' })!;
    const copyKid = view('host').children.find((c) => c.label === 'wrap')!.children[0]!;
    expect([copy.visible, own.visible]).toEqual([true, true]);
    scenes.resize(...PORTRAIT);
    expect(copy.visible).toBe(false);
    expect(copy.x).toBe(20);
    expect(own.visible).toBe(false);
    // The own top-level mount pins (top of the 288×480 rect is x = 144); the copy does not.
    expect(own.x).toBeCloseTo(144 + 20, 10);
    expect(view('coin').visible).toBe(false);
    // A nested id is not a root: unknown, and the child untouched.
    expect(copyKid.x).toBe(1);
    expect(view('host').visible).toBe(true);
    scenes.resize(...LANDSCAPE);
    expect([copy.visible, own.visible, view('coin').visible]).toEqual([true, true, true]);
    expect(copy.x).toBe(10);
    expect(report.mock.calls.map(([d]) => d.where)).toEqual(['b/kid']);
  });

  it('a remount whose mount throws (an override `scene: "nope"`) keeps the old subtree, one diagnostic, and the flip back is a no-op', () => {
    const { report, scenes, view } = boot([
      {
        id: 'a',
        nodes: [
          { id: 'bg', type: 'container', props: {} },
          { id: 'swap', type: 'scene', props: { scene: 'b' } },
          { id: 'fg', type: 'container', props: {} },
        ],
        portrait: { nodes: { swap: { scene: 'nope' } } },
      },
      { id: 'b', nodes: [{ id: 'n1', type: 'container', props: {} }] },
    ]);
    const root = scenes.sceneView('a')!;
    const old = view('swap');
    scenes.resize(...PORTRAIT);
    expect(view('swap')).toBe(old);
    expect(old.children[0]!.label).toBe('n1');
    expect(root.children.map((c) => c.label)).toEqual(['bg', 'swap', 'fg']);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', where: 'a/swap', message: expect.stringContaining('"nope"') }),
    );
    scenes.resize(...LANDSCAPE);
    expect(view('swap')).toBe(old);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('a `scene` override\'s target is in the graph: assets() lists it, and editing it while portrait refreshes the copy', async () => {
    const { scenes, view } = boot([
      {
        id: 'a',
        nodes: [{ id: 'swap', type: 'scene', props: { scene: 'b' } }],
        portrait: { nodes: { swap: { scene: 'c' } } },
      },
      { id: 'b', nodes: [{ id: 'n1', type: 'image', props: { src: 'b.png' } }] },
      { id: 'c', nodes: [{ id: 'n2', type: 'image', props: { src: 'c.png' } }] },
    ]);
    expect(scenes.assetsOf('a')).toEqual(['b.png', 'c.png']);
    scenes.resize(...PORTRAIT);
    expect(view('swap').children.map((c) => c.label)).toEqual(['n2']);
    scenes.replace([
      scenes.docs().get('a')!,
      scenes.docs().get('b')!,
      {
        id: 'c',
        nodes: [
          { id: 'n2', type: 'image', props: { src: 'c.png' } },
          { id: 'n3', type: 'container', props: {} },
        ],
      },
    ]);
    expect(view('swap').children.map((c) => c.label)).toEqual(['n2', 'n3']);
  });

  it('a per-node remount does not list a skipped node twice', async () => {
    const { report, scenes } = boot([
      {
        id: 'a',
        nodes: [
          {
            id: 'f',
            type: 'fake',
            props: { kind: 'a' },
            children: [{ id: 'g', type: 'nope', props: {} }],
          },
        ],
        portrait: { nodes: { f: { kind: 'b' } } },
      },
    ]);
    scenes.resize(...PORTRAIT);
    await scenes.show('a');
    expect(report.mock.calls.filter(([d]) => d.where === 'a/g')).toHaveLength(1);
  });

  it('a refused override on a fresh portrait mount fails the override, not the node', () => {
    const { report, scenes, view } = boot();
    scenes.resize(...PORTRAIT);
    scenes.replace([
      {
        id: 'a',
        nodes: [{ id: 't', type: 'text', props: { text: 'hi', size: 20 } }],
        portrait: { nodes: { t: { size: 'big' } } },
      },
    ]);
    expect((view('t') as Text).style.fontSize).toBe(20);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', where: 'a/t', message: expect.stringMatching(/^portrait prop size: /) }),
    );
  });
});
