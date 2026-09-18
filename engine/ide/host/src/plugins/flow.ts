/**
 * The flow document, host half (spec: flow editor §6). One file at the
 * project root, `flow.yml`, read through `files` and kept parsed here;
 * the checks are `validateFlow` from `@energy8engine/flow` (pixi-free —
 * the package has no renderer dependency), fed the kinds the game last
 * registered (`ideRpc.flowKinds()`, `null` until it has) and the scene ids
 * the project holds. Reported through
 * `ideRpc.reportGameDiagnostics('flow', …)`, replaced whole each time.
 *
 * Scene ids come from the TREE (`scenes/<id>.scene.yml` — the file name
 * is the id, `scenes.ts`'s own rule), not from `scenesHost.state()`: both
 * plugins re-read on the same `files/written`, and `scenes` needs one
 * more tick per document before its state moves, so reading it here
 * would check a `show` against the ids from BEFORE the write (measured
 * against `files.ts`: `tree`/`read` are sync under a promise, the order
 * is deterministic and wrong). A scene whose document does not parse
 * still counts as existing here; `scenes` already reports that file.
 *
 * Re-read on `files/written`/`files/removed` of `flow.yml` or anything
 * under `scenes/`, and on `game/flow-kinds`. Every read broadcasts the
 * document as a `flow` frame to every `/ide` socket, the boot read too —
 * see `scenes.ts` for why (root sockets outlive a project switch).
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
  type FlowNode,
  type FlowResponse,
} from '@energy8engine/contracts';
import { validateFlow } from '@energy8engine/flow';
import { SCENE_FILE } from './scenes';

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

const fileError = (reason: string): Diagnostic =>
  diagnostic('error', 'flow', FILE, `"${FILE}" is skipped: ${reason}`, 'fix the file');

export function apply(ctx: Context): void {
  let state: FlowResponse = { doc: null, diagnostics: [], kinds: [] };
  // The last list handed to `ideRpc`, by value — see `scenes.ts` for the rule.
  let reported = '';

  /** `validateFlow` over a parsed document, against what the host knows right now. */
  const check = async (doc: FlowDoc): Promise<Diagnostic[]> => {
    const kinds = ctx.ideRpc.flowKinds();
    const sceneIds = (await ctx.files.tree()).entries
      .map((e) => SCENE_FILE.exec(e.path)?.[1])
      .filter((id): id is string => id !== undefined);
    return validateFlow(doc, kinds.length ? kinds : null, sceneIds);
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
    state = { doc, diagnostics: found, kinds: ctx.ideRpc.flowKinds() };
    const key = found.length ? JSON.stringify(found) : '';
    if (key !== reported) ctx.ideRpc.reportGameDiagnostics('flow', found);
    reported = key;
    if (broadcast) ctx.ideRpc.broadcastFlow({ doc, diagnostics: found });
  };
  const again = () => void refresh(true).catch(() => {});
  const onFile = ({ path }: { path: string }) => {
    if (path === FILE || path.startsWith('scenes/')) again();
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
