import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Server from '@cordisjs/plugin-server';
import Schema from 'schemastery';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  NodeTypeInfo,
  SceneNode,
  ScenesResponse,
  ServerMessage,
} from '@energy8engine/contracts';
import { createIdeHost, type IdeHost } from '../src/index';
import { checkScenes } from '../src/plugins/scenes';

const json = (s: Schema): unknown => JSON.parse(JSON.stringify(s));
const types: NodeTypeInfo[] = [
  { type: 'container', schema: json(Schema.object({})) },
  { type: 'image', schema: json(Schema.object({ src: Schema.string().required() })) },
  { type: 'scene', schema: json(Schema.object({ scene: Schema.string().required() })) },
  { type: 'reels', schema: json(Schema.object({ row: Schema.string().default('reels1') })) },
];
const doc = (id: string, nodes: SceneNode[], file = `scenes/${id}.scene.yml`) => ({
  file,
  doc: { id, nodes },
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
            { id: 'a', type: 'spine', props: {} },
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
    expect(body.diagnostics).toContainEqual(expect.objectContaining({ where: 'bad/c' }));
    // No game has spoken: `spine` is not yet unknown, and no `reels1` warning (base_game has a reels node).
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
