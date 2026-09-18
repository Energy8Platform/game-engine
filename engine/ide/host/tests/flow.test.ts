import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Server from '@cordisjs/plugin-server';
import yaml from 'js-yaml';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { FlowDoc, FlowKindInfo, FlowResponse, ServerMessage } from '@energy8engine/contracts';
import { BUILTIN_KINDS } from '@energy8engine/flow';
import { createIdeHost, type IdeHost } from '../src/index';

/** A fixture copied to a temp dir with the repo's packages linked in — see `scenes.test.ts`. */
function workspace(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ide-host-flow-'));
  cpSync(join(__dirname, 'fixtures', fixture), dir, { recursive: true });
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(
    join(__dirname, '..', '..', '..', '..', 'node_modules', '@energy8engine'),
    join(dir, 'node_modules', '@energy8engine'),
    'dir',
  );
  return dir;
}
const flowWorkspace = () => workspace('project-flow');

const send = (url: string, path: string, method: string, body?: unknown) =>
  fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const get = async (url: string) => (await (await fetch(`${url}/api/flow`)).json()) as FlowResponse;
const put = (url: string, body: unknown) => send(url, '/api/flow', 'PUT', body);

/** The five-node loop the fixture's `flow.yml` holds (spec §3). */
const LOOP: FlowDoc = {
  version: 1,
  nodes: [
    { id: 'start', kind: 'boot', ui: { x: 40, y: 80 } },
    { id: 'base', kind: 'show', props: { scene: 'base_game' }, ui: { x: 220, y: 80 } },
    { id: 'idle', kind: 'on', props: { event: 'ui.spin' }, ui: { x: 400, y: 80 } },
    { id: 'spin', kind: 'spin', ui: { x: 580, y: 80 } },
    { id: 'draw', kind: 'present', ui: { x: 760, y: 80 } },
  ],
  edges: [
    { from: 'start', to: 'base' },
    { from: 'base', to: 'idle' },
    { from: 'idle', to: 'spin' },
    { from: 'spin', to: 'draw' },
    { from: 'draw', to: 'idle' },
  ],
};
const kind = (k: string, trigger = false): FlowKindInfo => ({
  kind: k,
  outs: ['next'],
  trigger,
  schema: {},
});
const KINDS: FlowKindInfo[] = [
  kind('boot', true),
  kind('show'),
  kind('on', true),
  kind('spin'),
  kind('present'),
  kind('set'),
];

/** What the host answers as `kinds` before any game has spoken: the eleven built-ins, by name. */
const BUILTIN_NAMES = BUILTIN_KINDS.map((k) => k.kind);
const builtins = () =>
  expect.arrayContaining(BUILTIN_NAMES.map((kind) => expect.objectContaining({ kind })));

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
const flowFrames = (frames: ServerMessage[]) =>
  frames.filter((f): f is Extract<ServerMessage, { type: 'flow' }> => f.type === 'flow');

describe('/api/flow', () => {
  it('GET answers the parsed document, clean, with the eleven built-in kinds until the game speaks; no flow.yml is doc: null', async () => {
    host = await createIdeHost({ root: flowWorkspace(), port: 0 });
    const body = await get(host.url);
    expect(body).toEqual({ doc: LOOP, diagnostics: [], kinds: builtins() });
    expect(body.kinds).toHaveLength(11);
    // As the game would report them: outs, trigger, and a JSON schema the editor can rebuild.
    expect(body.kinds.find((k) => k.kind === 'spin')).toEqual({
      kind: 'spin',
      outs: ['result', 'failed'],
      trigger: false,
      schema: expect.objectContaining({ uid: expect.any(Number) }),
    });
    expect(body.kinds.find((k) => k.kind === 'on')?.trigger).toBe(true);
    await host.stop();
    host = await createIdeHost({ root: workspace('project-scenes'), port: 0 });
    expect(await get(host.url)).toEqual({ doc: null, diagnostics: [], kinds: builtins() });
  });

  it('the built-in kinds check a document before any game speaks: an unknown kind is an error, an orphan a warning', async () => {
    host = await createIdeHost({ root: flowWorkspace(), port: 0 });
    const bad = await put(host.url, {
      version: 1,
      nodes: [
        { id: 'start', kind: 'boot' },
        { id: 'x', kind: 'mystery' },
      ],
      edges: [{ from: 'start', to: 'x' }],
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', where: 'x', message: "unknown kind 'mystery'" }),
    ]);
    const ok = await put(host.url, {
      version: 1,
      nodes: [
        { id: 'start', kind: 'boot' },
        { id: 'lonely', kind: 'set', props: { name: 'x', value: 1 } },
      ],
      edges: [],
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as FlowResponse).diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', where: 'lonely' }),
    ]);
  });

  it('PUT writes YAML, answers the refreshed state and broadcasts `flow`', async () => {
    const root = flowWorkspace();
    host = await createIdeHost({ root, port: 0 });
    const { frames, close } = await listen(host);
    const doc: FlowDoc = {
      version: 1,
      nodes: [{ id: 'start', kind: 'boot', ui: { x: 1, y: 2 } }],
      edges: [],
    };
    const res = await put(host.url, doc);
    expect(res.status).toBe(200);
    expect((await res.json()) as FlowResponse).toEqual({ doc, diagnostics: [], kinds: builtins() });
    expect(yaml.load(readFileSync(join(root, 'flow.yml'), 'utf8'))).toEqual(doc);
    await expect.poll(() => flowFrames(frames).some((f) => f.doc?.nodes.length === 1)).toBe(true);
    expect(flowFrames(frames).at(-1)).toEqual({ type: 'flow', doc, diagnostics: [] });
    close();
  });

  it('PUT refuses a malformed body with one error at flow.yml, and leaves the file alone', async () => {
    const root = flowWorkspace();
    host = await createIdeHost({ root, port: 0 });
    const before = readFileSync(join(root, 'flow.yml'), 'utf8');
    for (const body of [
      {},
      'nope',
      { version: 2, nodes: [], edges: [] },
      { version: 1, nodes: [{ id: 1, kind: 'boot' }], edges: [] },
      { version: 1, nodes: [{ id: 'a', kind: 'boot', props: 3 }], edges: [] },
      { version: 1, nodes: [{ id: 'a', kind: 'boot', ui: { x: 'a', y: 0 } }], edges: [] },
      { version: 1, nodes: [], edges: [{ from: 'a' }] },
      { version: 1, nodes: [], edges: [{ from: 'a', to: 'b', out: 1 }] },
    ]) {
      const res = await put(host.url, body);
      expect(res.status).toBe(400);
      expect((await res.json()).diagnostics).toEqual([
        expect.objectContaining({ severity: 'error', plugin: 'flow', where: 'flow.yml' }),
      ]);
    }
    expect(readFileSync(join(root, 'flow.yml'), 'utf8')).toBe(before);
    expect((await get(host.url)).doc).toEqual(LOOP);
  });

  it('PUT refuses a document the checks find errors in, with those diagnostics; warnings are written', async () => {
    const root = flowWorkspace();
    host = await createIdeHost({ root, port: 0 });
    const { socket, close } = await listen(host);
    const bad = await put(host.url, {
      version: 1,
      nodes: [{ id: 'start', kind: 'boot' }],
      edges: [{ from: 'start', to: 'nowhere' }],
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', plugin: 'flow', where: 'start→nowhere' }),
    ]);
    expect((await get(host.url)).doc).toEqual(LOOP);

    // With the kinds known, a `set` with no incoming edge is only a warning: written, and answered.
    socket.send(JSON.stringify({ type: 'flow-kinds', kinds: KINDS }));
    await expect.poll(() => host!.ctx.ideRpc.flowKinds()).toEqual(KINDS);
    const doc: FlowDoc = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'boot' },
        { id: 'lonely', kind: 'set', props: { var: 'x', value: 1 } },
      ],
      edges: [],
    };
    const ok = await put(host.url, doc);
    expect(ok.status).toBe(200);
    expect((await ok.json()) as FlowResponse).toEqual({
      doc,
      diagnostics: [expect.objectContaining({ severity: 'warning', where: 'lonely' })],
      kinds: KINDS,
    });
    expect(yaml.load(readFileSync(join(root, 'flow.yml'), 'utf8'))).toEqual(doc);
    close();
  });

  it('PUT with a bare `wait` (no event, no ms — fresh from the palette) is written and answers the warning', async () => {
    const root = flowWorkspace();
    host = await createIdeHost({ root, port: 0 });
    const doc: FlowDoc = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'boot' },
        { id: 'wait-1', kind: 'wait', ui: { x: 280, y: 280 } },
      ],
      edges: [{ from: 'start', to: 'wait-1' }],
    };
    const res = await put(host.url, doc);
    expect(res.status).toBe(200);
    expect((await res.json()) as FlowResponse).toEqual({
      doc,
      diagnostics: [
        expect.objectContaining({
          severity: 'warning',
          where: 'wait-1',
          message: "'wait' needs an 'event' or 'ms'",
        }),
      ],
      kinds: builtins(),
    });
    expect(yaml.load(readFileSync(join(root, 'flow.yml'), 'utf8'))).toEqual(doc);
  });

  it('a write through /api/files of flow.yml re-reads and broadcasts; an unparsable one is one error at flow.yml', async () => {
    host = await createIdeHost({ root: flowWorkspace(), port: 0 });
    const { frames, close } = await listen(host);
    const write = (text: string) =>
      send(host!.url, '/api/files/flow.yml', 'PUT', {
        base64: Buffer.from(text).toString('base64'),
      });
    expect((await write('version: 1\nnodes: []\nedges: []\n')).status).toBe(200);
    await expect.poll(() => flowFrames(frames).some((f) => f.doc?.nodes.length === 0)).toBe(true);
    expect((await write('version: 1\nnodes: 7\n')).status).toBe(200);
    await expect.poll(() => flowFrames(frames).some((f) => f.doc === null)).toBe(true);
    expect(flowFrames(frames).at(-1)?.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', plugin: 'flow', where: 'flow.yml' }),
    ]);
    expect(await get(host.url)).toMatchObject({ doc: null, diagnostics: [{ where: 'flow.yml' }] });
    close();
  });

  it('the game reporting its kinds re-checks and broadcasts: an unknown kind is now an error', async () => {
    host = await createIdeHost({ root: flowWorkspace(), port: 0 });
    const { frames, socket, close } = await listen(host);
    socket.send(
      JSON.stringify({ type: 'flow-kinds', kinds: KINDS.filter((k) => k.kind !== 'present') }),
    );
    await expect
      .poll(() => flowFrames(frames).some((f) => f.diagnostics.some((d) => d.where === 'draw')))
      .toBe(true);
    const body = await get(host.url);
    expect(body.kinds.map((k) => k.kind)).not.toContain('present');
    expect(body.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', plugin: 'flow', where: 'draw' }),
    ]);
    close();
  });

  it('removing the scene a `show` names re-checks: the node is now an error', async () => {
    host = await createIdeHost({ root: flowWorkspace(), port: 0 });
    const { frames, close } = await listen(host);
    expect((await send(host.url, '/api/scenes/base_game', 'DELETE')).status).toBe(200);
    await expect
      .poll(() => flowFrames(frames).some((f) => f.diagnostics.some((d) => d.where === 'base')))
      .toBe(true);
    expect((await get(host.url)).diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'base',
        message: expect.stringContaining('base_game'),
      }),
    ]);
    close();
  });

  it('a scene file that does not parse is not a scene: a `show` of it is an error', async () => {
    host = await createIdeHost({ root: flowWorkspace(), port: 0 });
    const { frames, close } = await listen(host);
    for (const [name, text] of [
      ['ghost', 'id: ghost\nnodes: 7\n'],
      ['husk', ': : not yaml ['],
    ] as const) {
      const res = await send(host.url, `/api/files/scenes/${name}.scene.yml`, 'PUT', {
        base64: Buffer.from(text).toString('base64'),
      });
      expect(res.status).toBe(200);
    }
    // The write under scenes/ re-checked; the loop is still clean (it shows base_game).
    await expect.poll(() => flowFrames(frames).length).toBeGreaterThanOrEqual(2);
    expect(flowFrames(frames).at(-1)?.diagnostics).toEqual([]);
    for (const scene of ['ghost', 'husk']) {
      const bad = await put(host.url, {
        version: 1,
        nodes: [
          { id: 'start', kind: 'boot' },
          { id: 'b', kind: 'show', props: { scene } },
        ],
        edges: [{ from: 'start', to: 'b' }],
      });
      expect(bad.status).toBe(400);
      expect((await bad.json()).diagnostics).toEqual([
        expect.objectContaining({
          severity: 'error',
          plugin: 'flow',
          where: 'b',
          message: expect.stringContaining(scene),
        }),
      ]);
    }
    // A parseable one is a scene, whatever the scenes checks say about it (`bad` says id: other).
    const ok = await put(host.url, {
      version: 1,
      nodes: [
        { id: 'start', kind: 'boot' },
        { id: 'b', kind: 'show', props: { scene: 'bad' } },
      ],
      edges: [{ from: 'start', to: 'b' }],
    });
    expect(ok.status).toBe(200);
    close();
  });

  it('serves GET /api/flow on the preview server too', async () => {
    host = await createIdeHost({ root: flowWorkspace(), port: 0 });
    const fiber = host.ctx.isolate('server').plugin(Server, { host: '127.0.0.1', port: 0 });
    await fiber;
    host.ctx.flowHost.attachGameRoutes(fiber.ctx.server);
    expect(await get(`http://127.0.0.1:${fiber.ctx.server.port}`)).toEqual({
      doc: LOOP,
      diagnostics: [],
      kinds: builtins(),
    });
  });
});

describe('flow across a project switch', () => {
  it('a root socket that stays up across an open is told the new document — the boot read broadcasts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ide-host-flow-switch-'));
    for (const [id, fixture] of [
      ['one', 'project-flow'],
      ['two', 'project-scenes'],
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
    expect(await host.ctx.workspace.open('one')).toEqual([]);
    await expect.poll(() => flowFrames(frames).some((f) => f.doc?.nodes.length === 5)).toBe(true);
    const seen = frames.length;
    expect(await host.ctx.workspace.open('two')).toEqual([]);
    await expect.poll(() => flowFrames(frames.slice(seen)).some((f) => f.doc === null)).toBe(true);
    close();
  });
});
