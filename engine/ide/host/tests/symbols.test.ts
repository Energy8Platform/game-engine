import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Server from '@cordisjs/plugin-server';
import Schema from 'schemastery';
import yaml from 'js-yaml';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NodeTypeInfo,
  ServerMessage,
  SymbolDef,
  SymbolsDoc,
  SymbolsResponse,
} from '@energy8engine/contracts';
import { Context } from 'cordis';
import { createIdeHost, type IdeHost } from '../src/index';
import * as symbolsPlugin from '../src/plugins/symbols';
import { checkSymbols } from '../src/plugins/symbols';

const json = (s: Schema): unknown => JSON.parse(JSON.stringify(s));
/** Same shape as `scenes.test.ts`'s own `types` — `checkNode` is the exact function both plugins call. */
const TYPES: NodeTypeInfo[] = [
  {
    type: 'image',
    schema: json(Schema.object({ src: Schema.string().required() })),
    assetProps: ['src'],
  },
  {
    type: 'spine',
    schema: json(Schema.object({ skeleton: Schema.string().required(), atlas: Schema.string() })),
    accept: { extensions: ['skel', 'json'], prop: 'skeleton', sibling: 'atlas' },
    assetProps: ['skeleton', 'atlas'],
  },
  {
    type: 'text',
    schema: json(
      Schema.object({ text: Schema.string().default(''), size: Schema.number().default(24) }),
    ),
  },
];
const KNOWN = [
  { id: '1', name: 'Cherry' },
  { id: '2', name: 'Bell' },
];
const doc = (symbols: SymbolDef[]): SymbolsDoc => ({ version: 1, symbols });

describe('checkSymbols', () => {
  it('is silent on a clean document, known ids all covered', () => {
    expect(
      checkSymbols(
        doc([
          { id: '1', name: 'Cherry', static: { type: 'image', props: { src: 'assets/1.png' } } },
          { id: '2', name: 'Bell', static: { type: 'image', props: { src: 'assets/1.png' } } },
        ]),
        TYPES,
        (p) => p === 'assets/1.png',
        KNOWN,
      ),
    ).toEqual([]);
  });

  it('an empty id and a duplicate id are errors at symbols/<id>', () => {
    const out = checkSymbols(
      doc([
        { id: '', static: { type: 'image', props: { src: 'x.png' } } },
        { id: '1', static: { type: 'image', props: { src: 'x.png' } } },
        { id: '1', static: { type: 'image', props: { src: 'x.png' } } },
      ]),
      TYPES,
      () => true,
      [],
    );
    expect(out).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        plugin: 'symbols',
        where: 'symbols/',
        message: 'a symbol needs an id',
      }),
    );
    expect(out).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        where: 'symbols/1',
        message: 'symbol id "1" is declared twice',
      }),
    );
  });

  it('a symbol with no static state is an error', () => {
    const out = checkSymbols(
      doc([{ id: '1', name: 'Cherry' } as SymbolDef]),
      TYPES,
      () => true,
      [],
    );
    expect(out).toEqual([
      expect.objectContaining({
        severity: 'error',
        where: 'symbols/1',
        message: 'symbol "1" has no static state',
      }),
    ]);
  });

  it('each state runs checkNode at symbols/<id>/<state>: an unknown type, once the game has reported types', () => {
    const out = checkSymbols(
      doc([{ id: '1', static: { type: 'bogus', props: {} } }]),
      TYPES,
      () => true,
      [],
    );
    expect(out).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        where: 'symbols/1/static',
        message: 'node type "bogus" is not one the game registered',
      }),
    );
  });

  // The other half of `scenes.test.ts`'s refusal: a state HAS a cell, so the
  // binding stands for a value of whatever type the prop declares (a number,
  // a string, a common prop) and no schema here may refuse it — the same rule
  // the symbols runtime's own schema pass applies (`view.ts`).
  it("a `$cell.<field>` binding passes any prop's schema on a symbol state", () => {
    expect(
      checkSymbols(
        doc([
          {
            id: '1',
            static: {
              type: 'text',
              props: { text: '$cell.symbol', size: '$cell.multiplier', x: '$cell.multiplier' },
            },
          },
        ]),
        TYPES,
        () => true,
        [],
      ),
    ).toEqual([]);
  });

  it('unknown types are not reported until the game has reported its node types', () => {
    expect(
      checkSymbols(doc([{ id: '1', static: { type: 'bogus', props: {} } }]), [], () => true, []),
    ).toEqual([]);
  });

  it('a missing asset prop is `<type> has no <prop>`, naming the state', () => {
    const out = checkSymbols(
      doc([{ id: '1', static: { type: 'image', props: {} } }]),
      TYPES,
      () => false,
      [],
    );
    expect(out).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        where: 'symbols/1/static',
        message: 'image has no src',
      }),
    );
  });

  it('checkNode is shared with scenes: a spine state with an empty atlas derives the sibling path', () => {
    const out = checkSymbols(
      doc([
        {
          id: '1',
          static: { type: 'spine', props: { skeleton: 'assets/hero.skel', atlas: '' } },
        },
      ]),
      TYPES,
      (p) => p === 'assets/hero.skel',
      [],
    );
    expect(out).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        where: 'symbols/1/static',
        message: 'spine.atlas "assets/hero.atlas" is not in the project',
      }),
    );
  });

  it('idle and win states are checked too, each at its own where', () => {
    const out = checkSymbols(
      doc([
        {
          id: '1',
          static: { type: 'image', props: { src: 'x.png' } },
          idle: { type: 'image', props: {} },
          win: { type: 'image', props: {} },
        },
      ]),
      TYPES,
      (p) => p === 'x.png',
      [],
    );
    // Each state's `image` with no `src` fails BOTH the schema (`required()`)
    // and the asset check — two diagnostics per state, same `where`; the
    // set of wheres is what proves idle/win are checked at their own place.
    expect([...new Set(out.map((d) => d.where))].sort()).toEqual([
      'symbols/1/idle',
      'symbols/1/win',
    ]);
  });

  it('a known id absent from the doc is a warning naming its spec.json name', () => {
    const out = checkSymbols(doc([]), TYPES, () => true, KNOWN);
    expect(out).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          plugin: 'symbols',
          where: 'symbols/1',
          message: 'symbol 1 (Cherry) has no entry',
        }),
        expect.objectContaining({
          severity: 'warning',
          where: 'symbols/2',
          message: 'symbol 2 (Bell) has no entry',
        }),
      ]),
    );
  });

  it('a doc id absent from a non-empty known is the reverse warning', () => {
    const out = checkSymbols(
      doc([{ id: '9', static: { type: 'image', props: { src: 'x.png' } } }]),
      TYPES,
      () => true,
      KNOWN,
    );
    expect(out).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        where: 'symbols/9',
        message: 'symbol 9 is not in game/spec.json',
      }),
    );
  });

  it('the reverse warning is skipped when known is empty — the game has not said what it wants yet', () => {
    const out = checkSymbols(
      doc([{ id: '9', static: { type: 'image', props: { src: 'x.png' } } }]),
      TYPES,
      () => true,
      [],
    );
    expect(out).toEqual([]);
  });
});

/** A fixture copied to a temp dir with the repo's packages linked in — see `flow.test.ts`. Reused here (not a fresh fixture) per the task brief; its `game/spec.json` (added for this task) is what makes `known` non-empty below. */
function workspace(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ide-host-symbols-'));
  cpSync(join(__dirname, 'fixtures', fixture), dir, { recursive: true });
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(
    join(__dirname, '..', '..', '..', '..', 'node_modules', '@energy8engine'),
    join(dir, 'node_modules', '@energy8engine'),
    'dir',
  );
  return dir;
}
const symbolsWorkspace = () => workspace('project-flow');

const send = (url: string, path: string, method: string, body?: unknown) =>
  fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const get = async (url: string) =>
  (await (await fetch(`${url}/api/symbols`)).json()) as SymbolsResponse;
/** `PUT /api/symbols` takes `{ doc }` — see `symbols.ts`'s own doc for why that differs from `flow.ts`'s bare body. */
const put = (url: string, document: unknown) => send(url, '/api/symbols', 'PUT', { doc: document });

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
const symbolsFrames = (frames: ServerMessage[]) =>
  frames.filter((f): f is Extract<ServerMessage, { type: 'symbols' }> => f.type === 'symbols');

describe('/api/symbols', () => {
  it('GET answers doc: null with no symbols.yml, known from game/spec.json, and a warning per known id', async () => {
    host = await createIdeHost({ root: symbolsWorkspace(), port: 0 });
    const body = await get(host.url);
    expect(body.doc).toBeNull();
    expect(body.known).toEqual(KNOWN);
    expect(body.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        plugin: 'symbols',
        where: 'symbols/1',
        message: 'symbol 1 (Cherry) has no entry',
      }),
      expect.objectContaining({
        severity: 'warning',
        where: 'symbols/2',
        message: 'symbol 2 (Bell) has no entry',
      }),
    ]);
    await host.stop();
    // A project with no `game/` at all: `known` is empty, no warnings.
    host = await createIdeHost({ root: workspace('project-scenes'), port: 0 });
    expect(await get(host.url)).toEqual({ doc: null, known: [], diagnostics: [] });
  });

  it('PUT writes YAML, answers the refreshed state and broadcasts `symbols`; a warning-only doc is written', async () => {
    const root = symbolsWorkspace();
    host = await createIdeHost({ root, port: 0 });
    const { frames, close } = await listen(host);
    const written: SymbolsDoc = {
      version: 1,
      symbols: [{ id: '1', name: 'Cherry', static: { type: 'container', props: {} } }],
    };
    const res = await put(host.url, written);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SymbolsResponse;
    expect(body.doc).toEqual(written);
    // `2` (Bell) is not in this doc: written anyway, warning comes back.
    expect(body.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        where: 'symbols/2',
        message: 'symbol 2 (Bell) has no entry',
      }),
    ]);
    expect(yaml.load(readFileSync(join(root, 'symbols.yml'), 'utf8'))).toEqual(written);
    await expect
      .poll(() => symbolsFrames(frames).some((f) => f.doc?.symbols.length === 1))
      .toBe(true);
    expect(symbolsFrames(frames).at(-1)).toEqual({
      type: 'symbols',
      doc: written,
      diagnostics: body.diagnostics,
    });
    close();
  });

  it('PUT refuses a malformed body with one error at symbols.yml, and leaves the file alone', async () => {
    const root = symbolsWorkspace();
    host = await createIdeHost({ root, port: 0 });
    for (const body of [
      {},
      { doc: 'nope' },
      { doc: { version: 2, symbols: [] } },
      { doc: { version: 1, symbols: [{ id: 1 }] } },
      { doc: { version: 1, symbols: [{ id: 'a', static: 3 }] } },
      { doc: { version: 1, symbols: [{ id: 'a', static: { type: 1, props: {} } }] } },
    ]) {
      const res = await send(host.url, '/api/symbols', 'PUT', body);
      expect(res.status).toBe(400);
      expect((await res.json()).diagnostics).toEqual([
        expect.objectContaining({ severity: 'error', plugin: 'symbols', where: 'symbols.yml' }),
      ]);
    }
    expect(await get(host.url)).toMatchObject({ doc: null });
  });

  it('PUT of a bare document (no `{ doc }` envelope) names the missing envelope, not the document', async () => {
    host = await createIdeHost({ root: symbolsWorkspace(), port: 0 });
    const res = await send(host.url, '/api/symbols', 'PUT', { version: 1, symbols: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        plugin: 'symbols',
        where: 'symbols.yml',
        message: expect.stringContaining('needs { doc: {...} }, not a bare document'),
      }),
    ]);
  });

  it('PUT writes a document the checks find errors in, answering 200 with the errors; they are broadcast too', async () => {
    const root = symbolsWorkspace();
    host = await createIdeHost({ root, port: 0 });
    const { frames, socket, close } = await listen(host);
    socket.send(JSON.stringify({ type: 'node-types', types: TYPES }));
    await expect.poll(() => host!.ctx.ideRpc.nodeTypes().length).toBe(TYPES.length);
    // What the IDE's Add produces: a static with no file yet, next to a symbol with no static at all.
    const doc: SymbolsDoc = {
      version: 1,
      symbols: [
        { id: '1', name: 'Cherry', static: { type: 'image', props: { src: '' } } },
        { id: '2', name: 'Bell' } as SymbolDef,
      ],
    };
    const res = await put(host.url, doc);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SymbolsResponse;
    expect(body.doc).toEqual(doc);
    expect(body.known).toEqual(KNOWN);
    expect(body.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        plugin: 'symbols',
        where: 'symbols/1/static',
        message: 'image has no src',
      }),
      expect.objectContaining({
        severity: 'error',
        plugin: 'symbols',
        where: 'symbols/2',
        message: 'symbol "2" has no static state',
      }),
    ]);
    expect(yaml.load(readFileSync(join(root, 'symbols.yml'), 'utf8'))).toEqual(doc);
    expect((await get(host.url)).doc).toEqual(doc);
    await expect
      .poll(() => symbolsFrames(frames).some((f) => f.doc?.symbols.length === 2))
      .toBe(true);
    expect(symbolsFrames(frames).at(-1)).toEqual({
      type: 'symbols',
      doc,
      diagnostics: body.diagnostics,
    });
    close();
  });

  it('a write through /api/files of symbols.yml re-reads and broadcasts; an unparsable one is one error at symbols.yml', async () => {
    host = await createIdeHost({ root: symbolsWorkspace(), port: 0 });
    const { frames, close } = await listen(host);
    const write = (text: string) =>
      send(host!.url, '/api/files/symbols.yml', 'PUT', {
        base64: Buffer.from(text).toString('base64'),
      });
    expect((await write('version: 1\nsymbols: []\n')).status).toBe(200);
    await expect
      .poll(() => symbolsFrames(frames).some((f) => f.doc?.symbols.length === 0))
      .toBe(true);
    expect((await write('version: 1\nsymbols: 7\n')).status).toBe(200);
    await expect.poll(() => symbolsFrames(frames).some((f) => f.doc === null)).toBe(true);
    expect(symbolsFrames(frames).at(-1)?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'error', plugin: 'symbols', where: 'symbols.yml' }),
      ]),
    );
    expect(await get(host.url)).toMatchObject({ doc: null, diagnostics: expect.any(Array) });
    close();
  });

  it('the game reporting its node types re-checks and broadcasts: a missing asset becomes an error', async () => {
    const root = symbolsWorkspace();
    writeFileSync(
      join(root, 'symbols.yml'),
      yaml.dump({
        version: 1,
        symbols: [{ id: '1', name: 'Cherry', static: { type: 'image', props: {} } }],
      }),
    );
    host = await createIdeHost({ root, port: 0 });
    const { frames, socket, close } = await listen(host);
    socket.send(JSON.stringify({ type: 'node-types', types: TYPES }));
    await expect
      .poll(() =>
        symbolsFrames(frames).some((f) =>
          f.diagnostics.some((d) => d.where === 'symbols/1/static'),
        ),
      )
      .toBe(true);
    const body = await get(host.url);
    expect(body.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        where: 'symbols/1/static',
        message: 'image has no src',
      }),
    );
    close();
  });

  it('serves GET /api/symbols on the preview server too', async () => {
    host = await createIdeHost({ root: symbolsWorkspace(), port: 0 });
    const fiber = host.ctx.isolate('server').plugin(Server, { host: '127.0.0.1', port: 0 });
    await fiber;
    host.ctx.symbolsHost.attachGameRoutes(fiber.ctx.server);
    const res = await fetch(`http://127.0.0.1:${fiber.ctx.server.port}/api/symbols`);
    expect(await res.json()).toEqual({
      doc: null,
      known: KNOWN,
      diagnostics: [
        expect.objectContaining({ where: 'symbols/1' }),
        expect.objectContaining({ where: 'symbols/2' }),
      ],
    });
  });
});

/**
 * The refresh generation guard (`gen`/`mine` in `apply`), against stubbed
 * `files`/`ideRpc`/`server` so ONE read can be held open — the real
 * `files.read` is sync-under-promise and cannot be made to finish late.
 * `flow.ts` and `scenes.ts` carry the same guard, line for line.
 */
describe('refresh generations', () => {
  it('an older refresh that read the pre-write bytes and finishes last neither overwrites the state nor broadcasts it', async () => {
    const OLD: SymbolsDoc = { version: 1, symbols: [{ id: '1', name: 'Old' } as SymbolDef] };
    const NEW: SymbolsDoc = { version: 1, symbols: [{ id: '2', name: 'New' } as SymbolDef] };
    const disk = new Map<string, string>([['symbols.yml', yaml.dump(OLD)]]);
    // Set for exactly one `read` — the older refresh's — and awaited AFTER
    // the bytes are taken, so it holds the pre-write document.
    let gate: Promise<void> | undefined;
    let release!: () => void;

    const ctx = new Context();
    type Put = (req: { json(): Promise<unknown>; path: string }, res: { status?: number; json(v: unknown): void }) => Promise<void>;
    let put!: Put;
    ctx.provide('server', { get() {}, put: (_path: string, handler: Put) => void (put = handler) });
    const broadcastSymbols = vi.fn();
    ctx.provide('ideRpc', { nodeTypes: () => [], reportGameDiagnostics() {}, broadcastSymbols });
    ctx.provide('files', {
      tree: async () => ({
        entries: [...disk.keys()].map((path) => ({ path, kind: 'file' as const, size: 0 })),
        diagnostics: [],
      }),
      read: async (path: string) => {
        const text = disk.get(path);
        await gate;
        return { bytes: text === undefined ? undefined : Buffer.from(text), diagnostics: [] };
      },
      write: async (path: string, bytes: Uint8Array) => {
        disk.set(path, Buffer.from(bytes).toString('utf8'));
        ctx.emit('files/written', { path });
        return { diagnostics: [] };
      },
    });
    await ctx.plugin(symbolsPlugin);
    await vi.waitFor(() => expect(ctx.symbolsHost.state().doc).toEqual(OLD));

    // The older refresh: a `game/node-types` frame, its read held open on the OLD bytes.
    gate = new Promise((resolve) => (release = resolve));
    ctx.emit('game/node-types', []);
    gate = undefined;

    // The newer: a PUT of NEW, which writes and refreshes to completion.
    let answered: SymbolsResponse | undefined;
    await put(
      { json: async () => ({ doc: NEW }), path: '/api/symbols' },
      { json: (v: unknown) => void (answered = v as SymbolsResponse) },
    );
    expect(answered?.doc).toEqual(NEW);
    expect(ctx.symbolsHost.state().doc).toEqual(NEW);
    expect(broadcastSymbols).toHaveBeenLastCalledWith(expect.objectContaining({ doc: NEW }));

    // The older one finishes now, with OLD in hand — and is dropped.
    release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(ctx.symbolsHost.state().doc).toEqual(NEW);
    expect(broadcastSymbols).toHaveBeenLastCalledWith(expect.objectContaining({ doc: NEW }));
    // OLD went out exactly once: the boot read, before any of this.
    expect(broadcastSymbols.mock.calls.filter(([f]) => (f as { doc: unknown }).doc).map(([f]) => (f as { doc: SymbolsDoc }).doc)).toEqual([OLD, NEW]);
    await ctx.fiber.dispose();
  });
});
