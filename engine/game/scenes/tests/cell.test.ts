import { describe, expect, it, vi } from 'vitest';
import { Container, Text, Texture } from 'pixi.js';
import { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, SceneDoc } from '@energy8engine/contracts';
import { createNodeTypes, type NodeType } from '../src/node-types';
import { container, image, text, type AssetLoader } from '../src/builtin';
import { cellProps } from '../src/common-schema';
import { createScenes } from '../src/scenes';

/** A type declaring one prop of each kind `boundValue` coerces to. */
const kinds = {
  schema: Schema.object({
    label: Schema.string().default(''),
    count: Schema.number().default(0),
    on: Schema.boolean().default(false),
  }),
};

describe('cellProps', () => {
  it('resolves a bound string against the cell, and stands at the empty one without data', () => {
    expect(cellProps(kinds, { label: '$cell.name' }, { name: 'orb' }).props.label).toBe('orb');
    expect(cellProps(kinds, { label: '$cell.name' }).props.label).toBe('');
    // With data but no such field: still the empty, never `undefined`.
    expect(cellProps(kinds, { label: '$cell.name' }, {}).props.label).toBe('');
  });

  it('coerces to the prop\'s declared type: a numeric string to a number, anything to a boolean', () => {
    expect(cellProps(kinds, { count: '$cell.n' }, { n: '64' }).props.count).toBe(64);
    expect(cellProps(kinds, { count: '$cell.n' }, { n: 'nope' }).props.count).toBe(0);
    expect(cellProps(kinds, { on: '$cell.b' }, { b: 1 }).props.on).toBe(true);
    expect(cellProps(kinds, { on: '$cell.b' }, { b: 'false' }).props.on).toBe(false);
    expect(cellProps(kinds, { on: '$cell.b' }, { b: 0 }).props.on).toBe(false);
  });

  it('leaves an unbound prop as the document wrote it, and lists exactly the bound keys', () => {
    const { props, bound } = cellProps(
      kinds,
      { label: '$cell.name', count: 3, on: '$cell.b' },
      { name: 'orb', b: true },
    );
    expect(props.count).toBe(3);
    expect(bound).toEqual(['label', 'on']);
    expect(cellProps(kinds, { label: 'plain', count: 3 }, { name: 'orb' }).bound).toEqual([]);
  });

  it('a binding on a prop the type does not declare resolves through COMMON', () => {
    // `alpha` is the runtime's, not the type's — a number all the same.
    expect(cellProps(kinds, { alpha: '$cell.a' }, { a: '0.5' }).props.alpha).toBe(0.5);
    expect(cellProps(kinds, { alpha: '$cell.a' }).props.alpha).toBe(0);
    expect(cellProps(kinds, { alpha: '$cell.a' }, { a: 0.25 }).bound).toEqual(['alpha']);
  });
});

const loader: AssetLoader = {
  load: vi.fn(async () => {}),
  unload: vi.fn(async () => {}),
  get: () => Texture.EMPTY,
};

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A promise the test resolves by hand — `mount.test.ts`'s `deferred`. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** The `orb` cell scene: a literal `src` beside a `$cell`-bound text. */
const orb: SceneDoc = {
  id: 'orb',
  nodes: [
    {
      id: 'root',
      type: 'container',
      props: {},
      children: [
        { id: 'art', type: 'image', props: { src: 'orb.png' } },
        { id: 'mv', type: 'text', props: { text: '$cell.mv' } },
      ],
    },
  ],
};

function boot(docs: SceneDoc[] = [orb], extra: NodeType<any>[] = []) {
  const ctx = new Context();
  const report = vi.fn<(d: Diagnostic) => void>();
  const nodeTypes = createNodeTypes();
  const imageUpdate = vi.fn(image.update!);
  const unmount = vi.fn((v: Container) => v.parent?.removeChild(v));
  for (const t of [container, { ...image, update: imageUpdate, unmount }, { ...text, unmount }])
    nodeTypes.register(t);
  for (const t of extra) nodeTypes.register(t);
  const scenes = createScenes({
    root: new Container(),
    design: { width: 100, height: 50 },
    nodeTypes,
    loader,
    ctx,
    report,
  });
  scenes.replace(docs);
  return { ctx, report, nodeTypes, scenes, imageUpdate, unmount };
}

/** The first `Text` in the copy — what a cell scene's bound node renders as. */
const textIn = (view: Container): Text =>
  view.getChildByLabel('mv', true) as Text;

describe('mountCell', () => {
  it('renders a bound prop against the cell data it is mounted with', () => {
    const { scenes } = boot();
    const cell = scenes.mountCell('orb', { mv: 64 })!;
    expect(cell).not.toBeNull();
    expect(cell.view.label).toBe('orb');
    expect(cell.view.children.map((c) => c.label)).toEqual(['root']);
    expect(textIn(cell.view).text).toBe('64');
  });

  it('with no data a bound prop stands at its empty value', () => {
    const { scenes, report } = boot();
    const cell = scenes.mountCell('orb')!;
    expect(textIn(cell.view).text).toBe('');
    expect(report).not.toHaveBeenCalled();
  });

  it('bind re-resolves the bound node alone: the unbound image is never updated', () => {
    const { scenes, imageUpdate } = boot();
    const cell = scenes.mountCell('orb', { mv: 64 })!;
    imageUpdate.mockClear();
    cell.bind({ mv: 8 });
    expect(textIn(cell.view).text).toBe('8');
    expect(imageUpdate).not.toHaveBeenCalled();
  });

  it('is no part of any mount: setProps never finds it and the shown scene list is untouched', async () => {
    const { scenes, report } = boot();
    const cell = scenes.mountCell('orb', { mv: 64 })!;
    expect(scenes.visible()).toEqual([]);
    scenes.setProps({ scene: 'orb', node: 'mv' }, { text: 'patched' });
    expect(textIn(cell.view).text).toBe('64');
    await scenes.show('orb');
    // The copy is its own: showing the document does not put it on screen.
    expect(cell.view.parent).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it('once resolves at once with no media node, and awaits the one that has it', async () => {
    const { scenes } = boot();
    await expect(scenes.mountCell('orb', { mv: 1 })!.once()).resolves.toBeUndefined();

    const gate = deferred();
    const once = vi.fn(async () => gate.promise);
    const media: NodeType<any> = {
      type: 'media',
      schema: Schema.object({}),
      mount: () => new Container(),
      once,
    };
    const withMedia = boot(
      [{ ...orb, nodes: [...orb.nodes, { id: 'fx', type: 'media', props: {} }] }],
      [media],
    );
    const cell = withMedia.scenes.mountCell('orb', { mv: 1 })!;
    let done = false;
    void cell.once().then(() => (done = true));
    await tick();
    expect(once).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    gate.resolve();
    await tick();
    expect(done).toBe(true);
  });

  it('destroy unmounts every node and empties the copy', () => {
    const { scenes, unmount } = boot();
    const cell = scenes.mountCell('orb', { mv: 64 })!;
    const txt = textIn(cell.view);
    cell.destroy();
    // `image` and `text`, each once — the `container` root has no `unmount`.
    expect(unmount).toHaveBeenCalledTimes(2);
    expect(txt.destroyed).toBe(true);
    expect(cell.view.children).toHaveLength(0);
    expect(cell.view.destroyed).toBe(true);
  });

  it('a document nothing declares is null', () => {
    const { scenes } = boot();
    expect(scenes.mountCell('missing')).toBeNull();
  });
});

describe('a binding under a portrait override', () => {
  it('is no "portrait prop" refusal: the mount and the flip are as lenient as the plain mount', () => {
    const { scenes, report } = boot([]);
    scenes.resize(50, 100);
    // Mounted WHILE portrait: `mountNode` merges the override itself.
    scenes.replace([
      {
        id: 'ord',
        nodes: [{ id: 't', type: 'text', props: { text: '$cell.mv', alpha: '$cell.a', x: 1 } }],
        portrait: { nodes: { t: { x: 9 } } },
      },
    ]);
    const view = scenes.view({ scene: 'ord', node: 't' })!;
    expect(view.position.x).toBe(9);
    expect((view as Text).text).toBe('');
    expect(view.alpha).toBe(0);
    // And back, and again — `applyVariant`'s path.
    scenes.resize(100, 50);
    expect(view.position.x).toBe(1);
    scenes.resize(50, 100);
    expect(view.position.x).toBe(9);
    expect(report).not.toHaveBeenCalled();
  });
});
