/**
 * The flow document, host half (spec: flow editor §6). One file at the
 * project root, `flow.yml`, read through `files` and kept parsed here;
 * the checks are `validateFlow` from `@energy8engine/flow` (pixi-free —
 * the package has no renderer dependency), fed the scene ids the project
 * holds and — for the KIND checks specifically — `lastKinds`: the last
 * NON-EMPTY list a game reported (`ideRpc.flowKinds()`), or `null` before
 * any game ever has. `validateFlow`'s own `null` skips every kind-
 * dependent check entirely, on purpose: a project the host is merely
 * holding open (nothing running, `dev-game` not even booted, a headless
 * `ide-host`-only test) must not paint every non-built-in node red just
 * because no one has told this process what `@energy8engine/flow-fx`
 * (or any other row) actually registers — only a RUNNING game knows
 * that. `state.kinds` (the palette) is a different question and keeps
 * its own built-ins fallback (`kinds()`, below) — a project with nothing
 * running still gets a palette of the built-ins to drag from; it just
 * isn't told a `sound`/`tween` node is wrong before anything has said
 * otherwise. Reported through `ideRpc.reportGameDiagnostics('flow', …)`,
 * replaced whole each time.
 *
 * Scene ids are read from the TREE (`scenes/<id>.scene.yml` — the file
 * name is the id, `scenes.ts`'s own rule), each file parsed with scenes'
 * own `parseDoc`, not taken from `scenesHost.state()`: both plugins
 * re-read on the same `files/written`, and `scenes` needs one more tick
 * per document before its state moves, so reading it here would check a
 * `show` against the ids from BEFORE the write (measured against
 * `files.ts`: `tree`/`read` are sync under a promise, the order is
 * deterministic and wrong). A file that does not parse is not a scene —
 * a `show` of it is an error here, and `scenes` reports the file itself.
 *
 * Re-read on `files/written`/`files/removed` of `flow.yml`, `game/spec.json`
 * (the `spin` action-name check's own source, same shape as `symbols.ts`'s
 * `known`) or anything under `scenes/`, and on `game/flow-kinds`. Every
 * read broadcasts the document as a `flow` frame to every `/ide` socket,
 * the boot read too — see `scenes.ts` for why (root sockets outlive a
 * project switch).
 */
import type { Context } from 'cordis';
import type { Server } from '@cordisjs/plugin-server';
import yaml from 'js-yaml';
import {
  diagnostic,
  type Diagnostic,
  type DiagnosticsResponse,
  type FlowDoc,
  type FlowEdge,
  type FlowKindInfo,
  type FlowNode,
  type FlowResponse,
  type SceneDoc,
} from '@energy8engine/contracts';
import { BUILTIN_KINDS, validateFlow } from '@energy8engine/flow';
import { SCENE_FILE, parseDoc as parseScene, walk } from './scenes';

declare module 'cordis' {
  interface Context {
    flowHost: FlowHostService;
  }
}

export interface FlowHostService {
  /** Registers `GET /api/flow` on another server — the preview's, so the game reads the document same-origin. */
  attachGameRoutes(server: Server): void;
  /** The last read document, as `GET /api/flow` answers it. */
  state(): FlowResponse;
}

export const name = 'flow';
export const inject = ['server', 'ideRpc', 'files'];

const FILE = 'flow.yml';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `{ version: 1, nodes[], edges[] }` with every node `{ id, kind, props?, ui? }` and edge `{ from, to, out? }`, or the reason it is not. */
export function parseDoc(value: unknown): { doc?: FlowDoc; reason?: string } {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges)
  ) {
    return { reason: 'a flow document is { version: 1, nodes: [...], edges: [...] }' };
  }
  const nodes: FlowNode[] = [];
  for (const v of value.nodes) {
    if (!isRecord(v) || typeof v.id !== 'string' || typeof v.kind !== 'string') {
      return { reason: 'a node is { id: string, kind: string, props?: {...}, ui?: { x, y } }' };
    }
    if (v.props !== undefined && !isRecord(v.props))
      return { reason: `node "${v.id}": props is not a map` };
    if (
      v.ui !== undefined &&
      (!isRecord(v.ui) || typeof v.ui.x !== 'number' || typeof v.ui.y !== 'number')
    ) {
      return { reason: `node "${v.id}": ui is not { x: number, y: number }` };
    }
    const node: FlowNode = { id: v.id, kind: v.kind };
    if (v.props !== undefined) node.props = v.props;
    if (v.ui !== undefined) node.ui = { x: v.ui.x as number, y: v.ui.y as number };
    nodes.push(node);
  }
  const edges: FlowEdge[] = [];
  for (const v of value.edges) {
    if (
      !isRecord(v) ||
      typeof v.from !== 'string' ||
      typeof v.to !== 'string' ||
      (v.out !== undefined && typeof v.out !== 'string')
    ) {
      return { reason: 'an edge is { from: string, to: string, out?: string }' };
    }
    const edge: FlowEdge = { from: v.from, to: v.to };
    if (v.out !== undefined) edge.out = v.out;
    edges.push(edge);
  }
  return { doc: { version: 1, nodes, edges } };
}

/** The thirteen built-ins, as the game would report them — what the checks and the editor use until a game speaks (a project plugin may add kinds; only a running game knows those). */
const BUILTIN_KIND_INFO: FlowKindInfo[] = BUILTIN_KINDS.map((k) => ({
  kind: k.kind,
  outs: [...k.outs],
  trigger: !!k.trigger,
  schema: JSON.parse(JSON.stringify(k.schema)) as unknown,
}));

const fileError = (reason: string): Diagnostic =>
  diagnostic('error', 'flow', FILE, `"${FILE}" is skipped: ${reason}`, 'fix the file');

export function apply(ctx: Context): void {
  let state: FlowResponse = { doc: null, diagnostics: [], kinds: [] };
  // The last list handed to `ideRpc`, by value — see `scenes.ts` for the rule.
  let reported = '';

  /**
   * Every scene document that parses, with its id — what `check`'s own
   * `sceneIds` (the `show`/`hide` check) and `nodeIds` (the `prop.target`
   * check, `<scene>/<node>` per node, nested ones included via `walk`)
   * both read off, one tree read and one parse per file rather than one
   * each. See the header for why this reads the files itself.
   */
  const parsedScenes = async (): Promise<{ id: string; doc: SceneDoc }[]> => {
    const out: { id: string; doc: SceneDoc }[] = [];
    for (const { path } of (await ctx.files.tree()).entries) {
      const id = SCENE_FILE.exec(path)?.[1];
      if (id === undefined) continue;
      const { bytes } = await ctx.files.read(path);
      try {
        if (!bytes) continue;
        const { doc } = parseScene(yaml.load(Buffer.from(bytes).toString('utf8')));
        if (doc) out.push({ id, doc });
      } catch {
        // not YAML: not a scene
      }
    }
    return out;
  };

  /** The running game's kinds, or the built-ins until it has spoken — the PALETTE's list. */
  const kinds = (): FlowKindInfo[] => {
    const reported = ctx.ideRpc.flowKinds();
    return reported.length ? reported : BUILTIN_KIND_INFO;
  };

  /**
   * The last NON-EMPTY kind list a game reported — the CHECK's own list,
   * `null` until one has. An empty `ideRpc.flowKinds()` (the mirror
   * clears on a preview reload) does NOT reset this: the last real list
   * still stands until a new one replaces it, so a reloading preview
   * does not flash every node red for the gap.
   */
  let lastKinds: FlowKindInfo[] | null = null;

  /** `game/spec.json`'s own `actions` keys — `null` when the file is absent, unparsable, or has no `actions`. */
  const actions = async (): Promise<string[] | null> => {
    try {
      const { bytes } = await ctx.files.read('game/spec.json');
      if (!bytes) return null;
      const spec = JSON.parse(Buffer.from(bytes).toString('utf8')) as { actions?: unknown };
      if (!isRecord(spec.actions)) return null;
      return Object.keys(spec.actions);
    } catch {
      return null;
    }
  };

  /** `validateFlow` over a parsed document — kind checks skip entirely (`null`) until a game has reported at least once. */
  const check = async (doc: FlowDoc): Promise<Diagnostic[]> => {
    const reported = ctx.ideRpc.flowKinds();
    if (reported.length) lastKinds = reported;
    const scenes = await parsedScenes();
    return validateFlow(
      doc,
      lastKinds,
      scenes.map((s) => s.id),
      await actions(),
      scenes.flatMap(({ id, doc: d }) => [...walk(d.nodes)].map((n) => `${id}/${n.id}`)),
    );
  };

  const refresh = async (broadcast: boolean): Promise<void> => {
    const { bytes } = await ctx.files.read(FILE);
    let doc: FlowDoc | null = null;
    const found: Diagnostic[] = [];
    // A missing file is no document and no diagnostic: a project without a flow is fine.
    if (bytes) {
      try {
        const parsed = parseDoc(yaml.load(Buffer.from(bytes).toString('utf8')));
        if (parsed.doc) doc = parsed.doc;
        else found.push(fileError(parsed.reason ?? 'not a flow document'));
      } catch (error) {
        found.push(fileError(error instanceof Error ? error.message : String(error)));
      }
    }
    if (doc) found.push(...(await check(doc)));
    state = { doc, diagnostics: found, kinds: kinds() };
    const key = found.length ? JSON.stringify(found) : '';
    if (key !== reported) ctx.ideRpc.reportGameDiagnostics('flow', found);
    reported = key;
    if (broadcast) ctx.ideRpc.broadcastFlow({ doc, diagnostics: found });
  };
  const again = () => void refresh(true).catch(() => {});
  const onFile = ({ path }: { path: string }) => {
    if (path === FILE || path === 'game/spec.json' || path.startsWith('scenes/')) again();
  };
  again();
  ctx.on('files/written', onFile);
  ctx.on('files/removed', onFile);
  ctx.on('game/flow-kinds', again);

  type Handler = Parameters<Server['get']>[1];
  type Req = Parameters<Handler>[0];
  type Res = Parameters<Handler>[1];
  const refuse = (res: Res, diagnostics: Diagnostic[]) => {
    res.status = 400;
    res.json({ diagnostics } satisfies DiagnosticsResponse);
  };

  const get: Handler = async (_req, res) => {
    res.json(state);
  };

  const put = async (req: Req, res: Res) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
    const { doc, reason } = parseDoc(body);
    if (!doc) return refuse(res, [fileError(`PUT ${req.path}: ${reason}`)]);
    const found = await check(doc);
    // Errors refuse the write; warnings are written and come back in the answer.
    if (found.some((d) => d.severity === 'error')) return refuse(res, found);
    const write = await ctx.files.write(FILE, Buffer.from(yaml.dump(doc, { noRefs: true })));
    if (write.diagnostics.length) return refuse(res, write.diagnostics);
    await refresh(false);
    res.json(state);
  };

  ctx.server.get('/api/flow', get);
  ctx.server.put('/api/flow', put);
  ctx.provide('flowHost', {
    attachGameRoutes: (server) => server.get('/api/flow', get),
    state: () => state,
  });
}
