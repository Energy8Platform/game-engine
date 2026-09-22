import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Server from '@cordisjs/plugin-server';
import Schema from 'schemastery';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NodeTypeInfo,
  SceneDoc,
  SceneNode,
  ScenesResponse,
  ServerMessage,
} from '@energy8engine/contracts';
import { createIdeHost, type IdeHost } from '../src/index';
import { checkNode, checkScenes } from '../src/plugins/scenes';

/** Every `new Schema(…)` the plugin makes — the memo test counts them; the proxy is transparent otherwise. */
const constructed = vi.hoisted(() => ({ n: 0 }));
vi.mock('schemastery', async (importOriginal) => {
  // `export =` in schemastery's types: the ESM namespace vitest hands over has the class on `default`.
  const mod = await importOriginal<{ default: typeof Schema }>();
  const Spied = new Proxy(mod.default, {
    construct(target, args, newTarget) {
      constructed.n += 1;
      return Reflect.construct(target, args, newTarget);
    },
  });
  return { ...mod, default: Spied };
});

const json = (s: Schema): unknown => JSON.parse(JSON.stringify(s));
const types: NodeTypeInfo[] = [
  { type: 'container', schema: json(Schema.object({})) },
  {
    type: 'image',
    schema: json(Schema.object({ src: Schema.string().required() })),
    assetProps: ['src'],
  },
  { type: 'scene', schema: json(Schema.object({ scene: Schema.string().required() })) },
  { type: 'reels', schema: json(Schema.object({ row: Schema.string().default('reels1') })) },
  {
    type: 'spritesheet',
    schema: json(Schema.object({ sheet: Schema.string().required() })),
    assetProps: ['sheet'],
  },
  {
    type: 'text',
    schema: json(
      Schema.object({
        text: Schema.string().default(''),
        size: Schema.number().default(24),
        font: Schema.string().default(''),
      }),
    ),
    assetProps: ['font'],
  },
  {
    type: 'spine',
    schema: json(Schema.object({ skeleton: Schema.string().required(), atlas: Schema.string() })),
    accept: { extensions: ['skel', 'json'], prop: 'skeleton', sibling: 'atlas' },
    assetProps: ['skeleton', 'atlas'],
  },
];
const doc = (
  id: string,
  nodes: SceneNode[],
  file = `scenes/${id}.scene.yml`,
  portrait?: SceneDoc['portrait'],
) => ({
  file,
  doc: { id, nodes, ...(portrait && { portrait }) },
});

describe('checkScenes', () => {
  it('is silent on a clean pair of documents', () => {
    expect(
      checkScenes(
        [
          doc('base', [
            { id: 'bg', type: 'image', props: { src: 'assets/bg.png', x: 1, visible: false } },
            { id: 'r', type: 'reels', props: {} },
            { id: 'bw', type: 'scene', props: { scene: 'big' } },
          ]),
          doc('big', []),
        ],
        types,
        (p) => p === 'assets/bg.png',
        true,
      ),
    ).toEqual([]);
  });
  it('id ≠ basename is a warning; duplicate node id, unknown type, missing scene, cycle, missing file, bad props are errors', () => {
    const out = checkScenes(
      [
        doc(
          'other',
          [
            { id: 'a', type: 'container', props: {} },
            { id: 'a', type: 'bogus', props: {} },
            { id: 'b', type: 'scene', props: { scene: 'nowhere' } },
            { id: 'c', type: 'image', props: { src: 'missing.png' } },
            { id: 'd', type: 'image', props: {} },
          ],
          'scenes/bad.scene.yml',
        ),
        doc('x', [{ id: 'toY', type: 'scene', props: { scene: 'y' } }]),
        doc('y', [{ id: 'toX', type: 'scene', props: { scene: 'x' } }]),
      ],
      types,
      () => false,
      false,
    );
    const wheres = out.map((d) => `${d.severity}:${d.where}`);
    expect(wheres).toEqual(
      expect.arrayContaining([
        'warning:bad',
        'error:bad/a',
        'error:bad/a',
        'error:bad/b',
        'error:bad/c',
        'error:bad/d',
        'error:x/toY',
      ]),
    );
    expect(out.every((d) => d.plugin === 'scenes')).toBe(true);
    // The props failure names the field.
    expect(out.find((d) => d.where === 'bad/d')?.message).toContain('src');
  });
  it('the common props the runtime applies all pass the check', () => {
    expect(
      checkScenes(
        [
          doc('a', [
            {
              id: 'n',
              type: 'container',
              props: {
                width: 100,
                height: 50,
                tint: '#ff8000',
                anchorX: 0.5,
                anchorY: 1,
                mask: true,
              },
            },
          ]),
        ],
        types,
        () => true,
        false,
      ),
    ).toEqual([]);
  });
  it('a common prop off its type is a props error naming the node and the field', () => {
    const out = checkScenes(
      [doc('a', [{ id: 'n', type: 'container', props: { x: 'abc' } }])],
      types,
      () => true,
      false,
    );
    expect(out).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'a/n',
        message: expect.stringContaining('x'),
      }),
    ]);
  });
  it('a colour prop the runtime could not read is a props error too, with no game running', () => {
    // The host runs the SAME `COMMON` the runtime applies, so a typo in a
    // colour is caught statically instead of half-applying at run time.
    expect(
      checkScenes(
        [doc('a', [{ id: 'n', type: 'container', props: { tint: 'nope' } }])],
        types,
        () => true,
        false,
      ),
    ).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'a/n',
        message: expect.stringContaining('tint'),
      }),
    ]);
    // A colour pixi DOES read — a CSS name, not just `#rrggbb` — is clean.
    expect(
      checkScenes(
        [doc('a', [{ id: 'n', type: 'container', props: { tint: 'rebeccapurple' } }])],
        types,
        () => true,
        false,
      ),
    ).toEqual([]);
  });
  // Slice 24: a symbol state's prop may be bound to the cell's data
  // (`'$cell.multiplier'`), resolved at bind time. A SCENE node has no cell —
  // nothing would resolve it, and the string would be drawn as-is — so the
  // same prop is refused here and accepted only by `checkSymbols`
  // (`symbols.test.ts` has that half).
  it('an ASSET prop bound to $cell is its own message: the file is preloaded from the document, so nothing could resolve it', () => {
    const image = types.find((t) => t.type === 'image')!;
    const out = checkNode(
      'symbols',
      'symbols/1/static',
      { type: 'image', props: { src: '$cell.symbol' } },
      image,
      true,
      () => true,
      true,
    );
    expect(out).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'symbols/1/static',
        message: 'an asset prop cannot be bound to $cell (assets are preloaded from the document)',
      }),
    ]);
  });

  it('checkNode rehydrates a type\'s schema once per NodeTypeInfo, not once per node', () => {
    // Fresh infos: the memo is by identity, and the shared `types` above may be cached already.
    const fresh: NodeTypeInfo = { type: 'container', schema: json(Schema.object({})) };
    constructed.n = 0;
    checkNode('scenes', 'a/one', { type: 'container', props: { x: 1 } }, fresh, true, () => true);
    checkNode('scenes', 'a/two', { type: 'container', props: { x: 2 } }, fresh, true, () => true);
    expect(constructed.n).toBe(1);
    // Another info of the same type name is another object: rehydrated on its own.
    const other: NodeTypeInfo = { type: 'container', schema: json(Schema.object({})) };
    checkNode('scenes', 'a/three', { type: 'container', props: {} }, other, true, () => true);
    expect(constructed.n).toBe(2);
  });

  it('a `$cell.<field>` binding is refused on a scene node — only a symbols.yml state reads a cell', () => {
    const out = checkScenes(
      [doc('a', [{ id: 'n', type: 'text', props: { text: '$cell.x' } }])],
      types,
      () => true,
      false,
    );
    expect(out).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'a/n',
        message: expect.stringContaining('$cell.'),
      }),
    ]);
  });

  // Slice 30: a scene document some `symbols.yml` state names is a CELL
  // scene — its nodes ARE mounted per cell, so a binding resolves there.
  it('a cell scene may bind $cell; the same document unnamed may not', () => {
    const one = () => [doc('a', [{ id: 'n', type: 'text', props: { text: '$cell.x' } }])];
    expect(checkScenes(one(), types, () => true, false, ['a'])).toEqual([]);
    expect(checkScenes(one(), types, () => true, false, ['b'])).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'a/n',
        message:
          'prop "text" binds "$cell." — only a cell scene (one a symbols.yml state names) reads a cell',
      }),
    ]);
  });

  it("a cell scene's portrait override may bind $cell too", () => {
    const one = doc('a', [{ id: 'n', type: 'text', props: { text: 'hi' } }], 'scenes/a.scene.yml', {
      nodes: { n: { text: '$cell.x' } },
    });
    expect(checkScenes([one], types, () => true, false, ['a'])).toEqual([]);
    expect(checkScenes([one], types, () => true, false, [])).toEqual([
      expect.objectContaining({ severity: 'error', where: 'a/n (portrait)' }),
    ]);
  });

  it('an ASSET prop bound to $cell stays an error in a cell scene too', () => {
    expect(
      checkScenes(
        [doc('a', [{ id: 'i', type: 'image', props: { src: '$cell.symbol' } }])],
        types,
        () => true,
        false,
        ['a'],
      ),
    ).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'a/i',
        message: 'an asset prop cannot be bound to $cell (assets are preloaded from the document)',
      }),
    ]);
  });

  it('only the `$cell.` prefix passes — any other string on a number prop is still refused', () => {
    const out = checkScenes(
      [doc('a', [{ id: 'n', type: 'text', props: { size: '$cellular' } }])],
      types,
      () => true,
      false,
    );
    expect(out).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'a/n',
        message: expect.stringContaining('size'),
      }),
    ]);
  });

  it('an empty image src (a fresh image) is one error, worded for it', () => {
    const out = checkScenes(
      [doc('a', [{ id: 'i', type: 'image', props: { src: '' } }])],
      types,
      () => false,
      false,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: 'error', where: 'a/i' });
    expect(out[0].message).toContain('src');
  });
  // Slice 24: `text.font` is an OPTIONAL asset prop (bitmap font; empty
  // means a web `Text`, same as the runtime's own `assets()` skip) — unlike
  // `image.src` (`required()`), an empty `font` is not an error.
  it('an empty text font (a web font, not a bitmap one) is not an error', () => {
    const out = checkScenes(
      [doc('a', [{ id: 't', type: 'text', props: { font: '' } }])],
      types,
      () => false,
      false,
    );
    expect(out).toEqual([]);
  });
  it('a text font naming a file not in the project is still reported', () => {
    const out = checkScenes(
      [doc('a', [{ id: 't', type: 'text', props: { font: 'assets/x.fnt' } }])],
      types,
      () => false,
      false,
    );
    expect(out).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'a/t',
        message: 'text.font "assets/x.fnt" is not in the project',
      }),
    ]);
  });
  it('a spritesheet with no sheet prop at all is `<type> has no <prop>`, naming spritesheet.sheet', () => {
    const out = checkScenes(
      [doc('a', [{ id: 's', type: 'spritesheet', props: {} }])],
      types,
      () => false,
      false,
    );
    // The schema also refuses the missing `sheet` (a `props:` error, same as
    // any other required field); the asset check names it besides.
    expect(out).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        where: 'a/s',
        message: 'spritesheet has no sheet',
      }),
    );
  });
  it("an empty spritesheet sheet is the same `<type> has no <prop>` message, with no schema error (required() lets '' through)", () => {
    const out = checkScenes(
      [doc('a', [{ id: 's', type: 'spritesheet', props: { sheet: '' } }])],
      types,
      () => false,
      false,
    );
    expect(out).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'a/s',
        message: 'spritesheet has no sheet',
      }),
    ]);
  });
  it('spine with an empty atlas checks the skeleton stem + .atlas', () => {
    const out = checkScenes(
      [doc('a', [{ id: 'p', type: 'spine', props: { skeleton: 'assets/hero.skel', atlas: '' } }])],
      types,
      (p) => p === 'assets/hero.skel',
      false,
    );
    expect(out).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'a/p',
        message: 'spine.atlas "assets/hero.atlas" is not in the project',
      }),
    ]);
  });
  it("a type's own `width` is checked by ITS schema, not by COMMON", () => {
    const own: NodeTypeInfo[] = [
      ...types,
      { type: 'shape', schema: json(Schema.object({ width: Schema.number().default(100) })) },
      // A `width` COMMON itself would refuse: it proves which schema saw the value.
      { type: 'gauge', schema: json(Schema.object({ width: Schema.union(['thin', 'thick']) })) },
    ];
    const check = (nodes: SceneNode[]) => checkScenes([doc('base', nodes)], own, () => true, false);
    expect(
      check([
        { id: 's', type: 'shape', props: { width: 40, x: 1 } },
        { id: 'g', type: 'gauge', props: { width: 'thick' } },
      ]),
    ).toEqual([]);
    // Still refused — by the type's schema now.
    expect(check([{ id: 'g', type: 'gauge', props: { width: 'huge' } }])).toEqual([
      expect.objectContaining({ severity: 'error', where: 'base/g' }),
    ]);
  });

  it('a type with no assetProps checks nothing, even with a path-shaped prop', () => {
    const local: NodeTypeInfo[] = [
      { type: 'thing', schema: json(Schema.object({ src: Schema.string() })) },
    ];
    const out = checkScenes(
      [doc('a', [{ id: 't', type: 'thing', props: { src: 'not-a-real-file.png' } }])],
      local,
      () => false,
      false,
    );
    expect(out).toEqual([]);
  });
  it('an asset that resolves against the project is not an error', () => {
    const out = checkScenes(
      [doc('a', [{ id: 's', type: 'spritesheet', props: { sheet: 'assets/coin.json' } }])],
      types,
      (p) => p === 'assets/coin.json',
      false,
    );
    expect(out).toEqual([]);
  });
  it('more than one reels node across the documents is a warning: the board can be on screen once', () => {
    const out = checkScenes(
      [
        doc('a', [{ id: 'r', type: 'reels', props: {} }]),
        doc('b', [{ id: 'r2', type: 'reels', props: {} }]),
      ],
      types,
      () => true,
      true,
    );
    expect(out).toEqual([
      expect.objectContaining({
        severity: 'warning',
        where: 'reels1',
        message: expect.stringContaining('a/r, b/r2'),
      }),
    ]);
  });
  it('unknown types are not reported until the game has reported its node types', () => {
    expect(
      checkScenes([doc('a', [{ id: 'n', type: 'spine', props: {} }])], [], () => true, false),
    ).toEqual([]);
  });
  it('a reels row with no reels node anywhere is a warning', () => {
    expect(checkScenes([doc('a', [])], types, () => true, true)).toEqual([
      expect.objectContaining({ severity: 'warning', where: 'reels1' }),
    ]);
  });
  it('children are checked too', () => {
    const out = checkScenes(
      [
        doc('a', [
          {
            id: 'wrap',
            type: 'container',
            props: {},
            children: [{ id: 'wrap', type: 'image', props: { src: 'nope.png' } }],
          },
        ]),
      ],
      types,
      () => false,
      false,
    );
    expect(out.map((d) => d.where).sort()).toEqual(['a/wrap', 'a/wrap']);
  });
  it('`pin` on a nested node is a warning; on a top-level node it passes; an unknown pin is a props error', () => {
    const out = checkScenes(
      [
        doc('a', [
          { id: 'top', type: 'container', props: { pin: 'bottom' } },
          {
            id: 'wrap',
            type: 'container',
            props: {},
            children: [{ id: 'kid', type: 'container', props: { pin: 'bottom', x: 5 } }],
          },
          { id: 'bad', type: 'container', props: { pin: 'middle' } },
          {
            id: 'wrap2',
            type: 'container',
            props: {},
            children: [{ id: 'typo', type: 'container', props: { pin: 'middle' } }],
          },
        ]),
      ],
      types,
      () => true,
      false,
    );
    expect(out).toEqual([
      {
        severity: 'warning',
        plugin: 'scenes',
        where: 'a/kid',
        message: 'pin on a nested node "kid" is ignored',
        fix: 'pin only top-level nodes',
      },
      expect.objectContaining({ severity: 'error', where: 'a/bad', message: expect.stringContaining('pin') }),
      // A nested typo is the schema's one error, not a warning on top of it.
      expect.objectContaining({ severity: 'error', where: 'a/typo', message: expect.stringContaining('pin') }),
    ]);
  });
  it('a `portrait` block: an unknown (or nested) id is a warning; each override is checked as the node, at `<where> (portrait)`', () => {
    const out = checkScenes(
      [
        doc(
          'a',
          [
            { id: 'bg', type: 'image', props: { src: 'assets/bg.png' } },
            { id: 'logo', type: 'image', props: { src: 'assets/logo.png' } },
            { id: 'tag', type: 'text', props: { text: 'hi' } },
            {
              id: 'wrap',
              type: 'container',
              props: {},
              children: [{ id: 'kid', type: 'container', props: {} }],
            },
          ],
          undefined,
          {
            nodes: {
              // Fine: leaves `src` alone, moves the node.
              bg: { x: 0, y: 40, pin: 'top' },
              // A portrait src not in the project, and a common prop off its type.
              logo: { src: 'assets/none.png', x: 'abc' },
              // A cell binding is refused on a scene node, portrait or not.
              tag: { text: '$cell.multiplier' },
              ghost: { x: 1 },
              kid: { x: 2 },
            },
          },
        ),
      ],
      types,
      (p) => p === 'assets/bg.png' || p === 'assets/logo.png',
      false,
    );
    expect(out).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'a/logo (portrait)',
        message: expect.stringContaining('$.x'),
      }),
      expect.objectContaining({
        severity: 'error',
        where: 'a/logo (portrait)',
        message: 'image.src "assets/none.png" is not in the project',
      }),
      expect.objectContaining({
        severity: 'error',
        where: 'a/tag (portrait)',
        message: expect.stringContaining('$cell.'),
      }),
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
  it('a portrait override pointing a `scene` node elsewhere is checked like the node\'s own target: missing, and a cycle', () => {
    const out = checkScenes(
      [
        doc('a', [{ id: 'x', type: 'scene', props: { scene: 'b' } }], undefined, {
          nodes: { x: { scene: 'nope' } },
        }),
        doc('b', [{ id: 'y', type: 'scene', props: { scene: 'c' } }], undefined, {
          nodes: { y: { scene: 'a' } },
        }),
        doc('c', []),
      ],
      types,
      () => true,
      false,
    );
    expect(out).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'a/x (portrait)',
        message: 'scene "nope" does not exist',
      }),
      // The cycle a → b (own) → a (portrait) is reported at both ends, each at the edge it names.
      expect.objectContaining({
        severity: 'error',
        where: 'a/x',
        message: 'scene "b" leads back to "a"',
      }),
      expect.objectContaining({
        severity: 'error',
        where: 'b/y (portrait)',
        message: 'scene "a" leads back to "b"',
      }),
    ]);
  });
});

/** A fixture copied to a temp dir with the repo's packages linked in — see `runtime-assets.test.ts`'s `e8BaseWorkspace`. */
function workspace(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ide-host-scenes-'));
  cpSync(join(__dirname, 'fixtures', fixture), dir, { recursive: true });
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(
    join(__dirname, '..', '..', '..', '..', 'node_modules', '@energy8engine'),
    join(dir, 'node_modules', '@energy8engine'),
    'dir',
  );
  return dir;
}
const e8BaseWorkspace = () => workspace('project-e8-base');
const scenesWorkspace = () => workspace('project-scenes');

const send = (url: string, path: string, method: string, body?: unknown) =>
  fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const post = (url: string, body: unknown) => send(url, '/api/scenes/preview', 'POST', body);

let host: IdeHost | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
});

/** A root `/ide` socket collecting every frame. */
async function listen(
  h: IdeHost,
): Promise<{ frames: ServerMessage[]; socket: WebSocket; close: () => void }> {
  const socket = new WebSocket(`${h.url.replace('http', 'ws')}/ide`);
  const frames: ServerMessage[] = [];
  socket.on('message', (data) => frames.push(JSON.parse(String(data)) as ServerMessage));
  await new Promise((resolve) => socket.once('open', resolve));
  return { frames, socket, close: () => socket.close() };
}

describe('/api/scenes', () => {
  it('GET lists the parsed documents (basename as id) with diagnostics and the node types the game reported', async () => {
    const root = scenesWorkspace();
    host = await createIdeHost({ root, port: 0 });
    const body = (await (await fetch(`${host.url}/api/scenes`)).json()) as ScenesResponse;
    expect(body.scenes.map((s) => s.id).sort()).toEqual(['bad', 'base_game', 'big_win']);
    expect(body.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', plugin: 'scenes', where: 'bad' }),
    );
    expect(body.diagnostics).toContainEqual(expect.objectContaining({ where: 'bad/a' }));
    expect(body.diagnostics).toContainEqual(expect.objectContaining({ where: 'bad/b' }));
    // No game has spoken: `spine` is not yet unknown, `image`'s missing
    // `src` (bad/c) is not yet checked either — `assetProps` travels on
    // the reported `NodeTypeInfo`, same gate as the props schema — and no
    // `reels1` warning (base_game has a reels node).
    expect(body.diagnostics).not.toContainEqual(expect.objectContaining({ where: 'bad/c' }));
    expect(body.diagnostics).not.toContainEqual(expect.objectContaining({ where: 'reels1' }));
    expect(body.nodeTypes).toEqual([]);
    // A project without a scenes/ dir has an empty set — and, with a reels
    // row composed, the one warning that no scene shows the board.
    await host.stop();
    host = await createIdeHost({ root: e8BaseWorkspace(), port: 0 });
    expect(await (await fetch(`${host.url}/api/scenes`)).json()).toEqual({
      scenes: [],
      diagnostics: [expect.objectContaining({ severity: 'warning', where: 'reels1' })],
      nodeTypes: [],
    });
  });

  it('PUT writes YAML, answers the refreshed set, broadcasts `scenes`; body id must match', async () => {
    const root = scenesWorkspace();
    host = await createIdeHost({ root, port: 0 });
    const { frames, close } = await listen(host);
    const nodes = [{ id: 'title', type: 'container', props: { x: 5 } }];
    const res = await send(host.url, '/api/scenes/base_game', 'PUT', { id: 'base_game', nodes });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ScenesResponse;
    expect(body.scenes.find((s) => s.id === 'base_game')).toEqual({ id: 'base_game', nodes });
    expect(readFileSync(join(root, 'scenes', 'base_game.scene.yml'), 'utf8')).toContain(
      'id: title',
    );
    await expect.poll(() => frames.some((f) => f.type === 'scenes')).toBe(true);
    const frame = frames.find((f) => f.type === 'scenes');
    expect(frame && 'scenes' in frame && frame.scenes.find((s) => s.id === 'base_game')).toEqual({
      id: 'base_game',
      nodes,
    });

    const bad = await send(host.url, '/api/scenes/base_game', 'PUT', { id: 'other', nodes: [] });
    expect(bad.status).toBe(400);
    expect((await bad.json()).diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', plugin: 'scenes', where: 'base_game' }),
    ]);
    for (const b of [{}, { id: 'base_game' }, { id: 'base_game', nodes: [{ id: 1 }] }, 'nope']) {
      expect((await send(host.url, '/api/scenes/base_game', 'PUT', b)).status).toBe(400);
    }
    expect((await send(host.url, '/api/scenes/Bad', 'PUT', { id: 'Bad', nodes: [] })).status).toBe(
      400,
    );
    close();
  });

  it('PUT keeps a `portrait` block through the YAML; GET reads it back; a malformed one is refused', async () => {
    const root = scenesWorkspace();
    host = await createIdeHost({ root, port: 0 });
    const nodes = [{ id: 'logo', type: 'container', props: { x: 5 } }];
    const portrait = { nodes: { logo: { x: 0, y: 40, pin: 'top' } } };
    const res = await send(host.url, '/api/scenes/base_game', 'PUT', { id: 'base_game', nodes, portrait });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ScenesResponse;
    expect(body.scenes.find((s) => s.id === 'base_game')).toEqual({ id: 'base_game', nodes, portrait });
    expect(readFileSync(join(root, 'scenes', 'base_game.scene.yml'), 'utf8')).toContain('portrait:');
    const got = (await (await fetch(`${host.url}/api/scenes`)).json()) as ScenesResponse;
    expect(got.scenes.find((s) => s.id === 'base_game')).toEqual({ id: 'base_game', nodes, portrait });
    // Without the block the file has no `portrait:` key at all.
    await send(host.url, '/api/scenes/base_game', 'PUT', { id: 'base_game', nodes });
    expect(readFileSync(join(root, 'scenes', 'base_game.scene.yml'), 'utf8')).not.toContain('portrait');
    for (const portrait of [[], { nodes: [] }, { nodes: { logo: 'x' } }, 'top']) {
      const bad = await send(host.url, '/api/scenes/base_game', 'PUT', { id: 'base_game', nodes, portrait });
      expect(bad.status).toBe(400);
    }
  });

  it('POST creates scenes/<id>.scene.yml with nodes: []; refuses an existing id or a bad one', async () => {
    const root = scenesWorkspace();
    host = await createIdeHost({ root, port: 0 });
    const res = await send(host.url, '/api/scenes', 'POST', { id: 'intro' });
    expect(res.status).toBe(200);
    expect(readFileSync(join(root, 'scenes', 'intro.scene.yml'), 'utf8')).toBe(
      'id: intro\nnodes: []\n',
    );
    expect((await res.json()).scenes.map((s: { id: string }) => s.id)).toContain('intro');
    const again = await send(host.url, '/api/scenes', 'POST', { id: 'intro' });
    expect(again.status).toBe(400);
    expect((await again.json()).diagnostics[0].message).toContain('exists');
    for (const b of [{ id: 'Bad Name' }, {}, 'nope']) {
      expect((await send(host.url, '/api/scenes', 'POST', b)).status).toBe(400);
    }
    // The first `+` in a project without scenes/ makes the directory.
    await host.stop();
    const bare = e8BaseWorkspace();
    host = await createIdeHost({ root: bare, port: 0 });
    expect((await send(host.url, '/api/scenes', 'POST', { id: 'first' })).status).toBe(200);
    expect(existsSync(join(bare, 'scenes', 'first.scene.yml'))).toBe(true);
  });

  it('DELETE removes the file and broadcasts', async () => {
    const root = scenesWorkspace();
    host = await createIdeHost({ root, port: 0 });
    const { frames, close } = await listen(host);
    const res = await send(host.url, '/api/scenes/big_win', 'DELETE');
    expect(res.status).toBe(200);
    expect(existsSync(join(root, 'scenes', 'big_win.scene.yml'))).toBe(false);
    const body = (await res.json()) as ScenesResponse;
    expect(body.scenes.map((s) => s.id).sort()).toEqual(['bad', 'base_game']);
    // base_game's `scene: big_win` node now dangles.
    expect(body.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', where: 'base_game/big_win' }),
    );
    await expect
      .poll(() =>
        frames.some((f) => f.type === 'scenes' && !f.scenes.some((s) => s.id === 'big_win')),
      )
      .toBe(true);
    expect((await send(host.url, '/api/scenes/big_win', 'DELETE')).status).toBe(404);
    close();
  });

  it('a write through /api/files under scenes/ re-reads and broadcasts too', async () => {
    const root = scenesWorkspace();
    host = await createIdeHost({ root, port: 0 });
    const { frames, close } = await listen(host);
    const yaml = 'id: big_win\nnodes:\n  - id: fresh\n    type: container\n    props: {}\n';
    const res = await send(host.url, '/api/files/scenes/big_win.scene.yml', 'PUT', {
      base64: Buffer.from(yaml).toString('base64'),
    });
    expect(res.status).toBe(200);
    await expect
      .poll(() =>
        frames.some(
          (f) =>
            f.type === 'scenes' &&
            f.scenes.some((s) => s.id === 'big_win' && s.nodes[0]?.id === 'fresh'),
        ),
      )
      .toBe(true);
    close();
  });

  it('POST /api/scenes/select broadcasts scene-select', async () => {
    host = await createIdeHost({ root: scenesWorkspace(), port: 0 });
    const { frames, close } = await listen(host);
    const res = await send(host.url, '/api/scenes/select', 'POST', {
      scene: 'base_game',
      node: 'bg',
    });
    expect(res.status).toBe(200);
    await expect
      .poll(() => frames)
      .toContainEqual({ type: 'scene-select', scene: 'base_game', node: 'bg' });
    const clear = await send(host.url, '/api/scenes/select', 'POST', {
      scene: 'base_game',
      node: null,
    });
    expect(clear.status).toBe(200);
    await expect
      .poll(() => frames)
      .toContainEqual({ type: 'scene-select', scene: 'base_game', node: null });
    for (const b of [{}, { scene: 'x' }, { scene: 1, node: null }, 'nope']) {
      const bad = await send(host.url, '/api/scenes/select', 'POST', b);
      expect(bad.status).toBe(400);
      expect((await bad.json()).diagnostics).toEqual([
        expect.objectContaining({ severity: 'error', plugin: 'scenes' }),
      ]);
    }
    close();
  });

  it('a `$cell` binding flips from error to clean when a symbols.yml state names the scene', async () => {
    host = await createIdeHost({ root: scenesWorkspace(), port: 0 });
    const { socket, close } = await listen(host);
    socket.send(JSON.stringify({ type: 'node-types', types }));
    await expect.poll(() => host!.ctx.ideRpc.nodeTypes().length).toBe(types.length);
    const at = async () =>
      (
        (await (await fetch(`${host!.url}/api/scenes`)).json()) as ScenesResponse
      ).diagnostics.filter((d) => d.where === 'big_win/t');
    const written = await send(host.url, '/api/scenes/big_win', 'PUT', {
      id: 'big_win',
      nodes: [{ id: 't', type: 'text', props: { text: '$cell.symbol' } }],
    });
    expect(written.status).toBe(200);
    expect(await at()).toEqual([
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('only a cell scene'),
      }),
    ]);
    // Naming it from a symbol state makes it a cell scene, with no restart:
    // the symbols write re-runs this plugin's check before it answers.
    const symbols = await send(host.url, '/api/symbols', 'PUT', {
      doc: {
        version: 1,
        symbols: [{ id: '1', static: { type: 'scene', props: { scene: 'big_win' } } }],
      },
    });
    expect(symbols.status).toBe(200);
    expect(await at()).toEqual([]);
    close();
  });

  it('the game reporting its node types re-checks and broadcasts', async () => {
    host = await createIdeHost({ root: scenesWorkspace(), port: 0 });
    const { frames, socket, close } = await listen(host);
    // The way a game reports: a `node-types` frame up its socket.
    socket.send(JSON.stringify({ type: 'node-types', types }));
    await expect
      .poll(() =>
        frames.some(
          (f) => f.type === 'scenes' && f.diagnostics.some((d) => d.message.includes('spine')),
        ),
      )
      .toBe(true);
    // Now known: the set answers with the types, and `spine` is an error.
    const body = (await (await fetch(`${host.url}/api/scenes`)).json()) as ScenesResponse;
    expect(body.nodeTypes).toEqual(types);
    expect(body.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', where: 'bad/a' }),
    );
    // `image`'s missing `src` (bad/c) is checked too, now that `image`'s
    // `assetProps` is known.
    expect(body.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', where: 'bad/c' }),
    );
    close();
  });
});

describe('scenes across a project switch', () => {
  it('a root socket that stays up across an open is told the new set', async () => {
    // Two projects under one root; the plugin boots per project inside
    // `project-scope` while the socket stays connected.
    const root = mkdtempSync(join(tmpdir(), 'ide-host-scenes-switch-'));
    for (const [id, fixture] of [
      ['one', 'project-scenes'],
      ['two', 'project-e8-base'],
    ] as const) {
      cpSync(join(__dirname, 'fixtures', fixture), join(root, id), { recursive: true });
      mkdirSync(join(root, id, 'node_modules'));
      symlinkSync(
        join(__dirname, '..', '..', '..', '..', 'node_modules', '@energy8engine'),
        join(root, id, 'node_modules', '@energy8engine'),
        'dir',
      );
    }
    host = await createIdeHost({ root, port: 0 });
    const { frames, close } = await listen(host);
    const ids = (f: ServerMessage) =>
      f.type === 'scenes' ? f.scenes.map((s) => s.id).sort() : null;
    expect(await host.ctx.workspace.open('one')).toEqual([]);
    await expect
      .poll(() => frames.some((f) => JSON.stringify(ids(f)) === '["bad","base_game","big_win"]'))
      .toBe(true);
    const seen = frames.length;
    expect(await host.ctx.workspace.open('two')).toEqual([]);
    await expect
      .poll(() => frames.slice(seen).some((f) => JSON.stringify(ids(f)) === '[]'))
      .toBe(true);
    close();
  });
});

describe('POST /api/scenes/preview', () => {
  it('pushes the scene to a preview /ide socket; says so when no preview is running', async () => {
    host = await createIdeHost({ root: e8BaseWorkspace(), port: 0 });
    const fiber = host.ctx.isolate('server').plugin(Server, { host: '127.0.0.1', port: 0 });
    await fiber;
    host.ctx.ideRpc.attach(fiber.ctx.server, { accept: ['game-diagnostics'] });
    const socket = new WebSocket(`ws://127.0.0.1:${fiber.ctx.server.port}/ide`);
    const frames: ServerMessage[] = [];
    socket.on('message', (data) => frames.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve) => socket.once('open', resolve));

    // No `dev-game` in this project (no game/ dir): the frame still goes
    // out, and the answer says nobody is there to show it.
    const res = await post(host.url, { scene: 'base_game' });
    expect(res.status).toBe(200);
    expect((await res.json()).diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', plugin: 'scenes', where: 'base_game' }),
    ]);
    await expect.poll(() => frames).toContainEqual({ type: 'scene-preview', scene: 'base_game' });

    // With a preview up, a clean 200.
    host.ctx.provide('devGamePreview', { url: 'http://127.0.0.1:1' });
    const ok = await post(host.url, { scene: 'base_game' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).diagnostics).toEqual([]);
    socket.close();
  });

  it('400s a body that is not { scene: string }', async () => {
    host = await createIdeHost({ root: e8BaseWorkspace(), port: 0 });
    for (const body of [{}, { scene: '' }, { scene: 5 }, 'not json']) {
      const res = await post(host.url, body);
      expect(res.status).toBe(400);
      expect((await res.json()).diagnostics).toEqual([
        expect.objectContaining({ severity: 'error', plugin: 'scenes' }),
      ]);
    }
  });
});
