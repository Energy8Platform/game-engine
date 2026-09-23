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

  it('a bound prop is an expression: a template, a format, a comparison, arithmetic', () => {
    expect(cellProps(kinds, { label: 'x{$cell.mv}' }, { mv: 64 }).props.label).toBe('x64');
    expect(cellProps(kinds, { label: '{$cell.mv | multiplier}' }, { mv: 64 }).props.label).toBe(
      'x64',
    );
    expect(cellProps(kinds, { count: '$cell.mv * 2' }, { mv: 64 }).props.count).toBe(128);
    expect(cellProps(kinds, { on: '$cell.layer > 0' }, { layer: 1 }).props.on).toBe(true);
    expect(cellProps(kinds, { on: '$cell.layer > 0' }, { layer: 0 }).props.on).toBe(false);
    // A template already produced a string; a number prop takes it all the same.
    expect(cellProps(kinds, { count: '{$cell.mv}' }, { mv: 7 }).props.count).toBe(7);
  });

  it('the vars are the cell alone: `| currency` has no $session and drops the symbol', () => {
    expect(cellProps(kinds, { label: '{$cell.win | currency}' }, { win: 4.6 }).props.label).toBe(
      '4.60',
    );
  });

  it('a malformed expression is one report and the prop stands at its empty', () => {
    const report = vi.fn();
    const { props, bound } = cellProps(
      kinds,
      { label: '{$cell.mv +}', count: '$cell.mv' },
      { mv: 64 },
      report,
    );
    expect(props.label).toBe('');
    expect(props.count).toBe(64);
    expect(bound).toEqual(['label', 'count']);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toContain('{$cell.mv +}');
  });

  it('with no data nothing is evaluated: even a malformed expression is silent at its empty', () => {
    const report = vi.fn();
    expect(cellProps(kinds, { label: '{$cell.mv +}' }, undefined, report).props.label).toBe('');
    expect(report).not.toHaveBeenCalled();
  });

  it('a string that merely looks like one is no binding: the mention is `$cell` itself', () => {
    expect(cellProps(kinds, { label: '$cellular' }, { mv: 1 }).bound).toEqual([]);
    expect(cellProps(kinds, { label: '$cellular' }, { mv: 1 }).props.label).toBe('$cellular');
    expect(cellProps(kinds, { label: 'a cell' }, { mv: 1 }).bound).toEqual([]);
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

  it('once answers false with no media node, and awaits — then true for — the one that has it', async () => {
    const { scenes } = boot();
    // `false`: nothing in the copy had an `once`, which is what lets a caller
    // showing the copy for a while floor it (`@energy8engine/symbols`).
    await expect(scenes.mountCell('orb', { mv: 1 })!.once()).resolves.toBe(false);

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
    let done: boolean | undefined;
    void cell.once().then((ran) => (done = ran));
    await tick();
    expect(once).toHaveBeenCalledTimes(1);
    expect(done).toBeUndefined();
    gate.resolve();
    await tick();
    expect(done).toBe(true);
  });

  it('two copies of one document, bound to different cells, stay independent', () => {
    const { scenes } = boot();
    const a = scenes.mountCell('orb', { mv: 2 })!;
    const b = scenes.mountCell('orb', { mv: 9 })!;
    expect([textIn(a.view).text, textIn(b.view).text]).toEqual(['2', '9']);
    a.bind({ mv: 5 });
    expect(textIn(a.view).text).toBe('5');
    expect(textIn(b.view).text).toBe('9');
    a.destroy();
    expect(textIn(b.view).text).toBe('9');
    expect(b.view.destroyed).toBe(false);
  });

  it('bind re-applies a bound COMMON prop, which no type owns', () => {
    const hot: SceneDoc = {
      id: 'hot',
      nodes: [{ id: 'art', type: 'image', props: { src: 'orb.png', alpha: '$cell.hot' } }],
    };
    const { scenes } = boot([hot]);
    const cell = scenes.mountCell('hot', { hot: 0.25 })!;
    const view = cell.view.getChildByLabel('art', true)!;
    expect(view.alpha).toBe(0.25);
    cell.bind({ hot: 1 });
    expect(view.alpha).toBe(1);
    // `bound` is what a caller skipping the whole bind reads.
    expect(cell.bound).toBe(true);
    expect(scenes.mountCell('hot')!.bound).toBe(true);
  });

  it('a node type nothing registered is one diagnostic per type, per call', () => {
    const { scenes, report } = boot([
      {
        id: 'gap',
        nodes: [
          { id: 'a', type: 'nope', props: {} },
          { id: 'b', type: 'nope', props: {} },
        ],
      },
    ]);
    report.mockClear();
    const cell = scenes.mountCell('gap')!;
    expect(cell.bound).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({
      severity: 'error',
      where: 'gap',
      message: 'node type "nope" is not registered — the node is skipped',
    });
  });

  it('a bound OWN prop of a type with no update is an error naming the node and the prop', () => {
    const plain: NodeType<any> = {
      type: 'plain',
      schema: Schema.object({ kind: Schema.string().default('') }),
      mount: () => new Container(),
    };
    const { scenes, report } = boot(
      [
        {
          id: 'p',
          nodes: [{ id: 'n', type: 'plain', props: { kind: '$cell.kind', alpha: '$cell.hot' } }],
        },
      ],
      [plain],
    );
    const cell = scenes.mountCell('p', { kind: 'a', hot: 1 })!;
    report.mockClear();
    // A COMMON prop alone is fine — the runtime applies that one itself.
    cell.bind({ kind: 'a', hot: 0.5 });
    expect(cell.view.getChildByLabel('n', true)!.alpha).toBe(0.5);
    expect(report).not.toHaveBeenCalled();
    cell.bind({ kind: 'b', hot: 0.5 });
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({
      severity: 'error',
      where: 'p/n',
      message: 'plain "n" cannot take a new kind: the type has no update',
    });
    // Once per entry, like every other report a copy makes.
    cell.bind({ kind: 'c', hot: 0.5 });
    expect(report).toHaveBeenCalledTimes(1);
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

  it('a malformed bound expression is a diagnostic on the node, at mount and at bind', () => {
    const { scenes, report } = boot([
      { id: 'bad', nodes: [{ id: 'mv', type: 'text', props: { text: '{$cell.mv +}' } }] },
    ]);
    report.mockClear();
    const cell = scenes.mountCell('bad', { mv: 64 })!;
    expect(textIn(cell.view).text).toBe('');
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({
      severity: 'error',
      where: 'bad/mv',
      message: expect.stringContaining('{$cell.mv +}'),
    });
    cell.bind({ mv: 8 });
    expect(textIn(cell.view).text).toBe('');
    expect(report).toHaveBeenCalledTimes(2);
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
