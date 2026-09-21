/**
 * The symbols document, host half (spec §4). One file at the project root,
 * `symbols.yml`, read through `files` and kept parsed here; `checkSymbols`
 * is everything the host can say about it without running the game — a
 * parse failure, an empty or duplicate id, a missing `static` state, a
 * state whose type/props/assets `checkNode` (`scenes.ts`, shared) refuses,
 * and the two-way mismatch against `game/spec.json`'s own `symbols` list
 * (`known`). Reported through `ideRpc.reportGameDiagnostics('symbols', …)`,
 * replaced whole each time — the same shape `flow.ts` uses, down to the
 * `reported`-by-value dedupe rule (see that file's own doc).
 *
 * Re-read on `files/written`/`files/removed` of `symbols.yml` or
 * `game/spec.json` (the latter changes `known`, not the document), and on
 * `game/node-types` (a state's type/props/assets gate on the game's
 * report, exactly as `checkScenes` gates on it). Every read broadcasts the
 * document as a `symbols` frame to every `/ide` socket, the boot read too
 * — see `scenes.ts` for why (root sockets outlive a project switch).
 */
import type { Context } from 'cordis';
import type { Server } from '@cordisjs/plugin-server';
import yaml from 'js-yaml';
import {
  diagnostic,
  type Diagnostic,
  type DiagnosticsResponse,
  type NodeTypeInfo,
  type SymbolDef,
  type SymbolNode,
  type SymbolsDoc,
  type SymbolsResponse,
  type SymbolState,
} from '@energy8engine/contracts';
import { checkNode } from './scenes';

declare module 'cordis' {
  interface Context {
    symbolsHost: SymbolsHostService;
  }
}

export interface SymbolsHostService {
  /** Registers `GET /api/symbols` on another server — the preview's, so the game reads the document same-origin. */
  attachGameRoutes(server: Server): void;
  /** The last read document, as `GET /api/symbols` answers it. */
  state(): SymbolsResponse;
}

export const name = 'symbols';
export const inject = ['server', 'ideRpc', 'files'];

const FILE = 'symbols.yml';
const STATES: SymbolState[] = ['static', 'idle', 'win'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const parseSymbolNode = (
  id: string,
  state: SymbolState,
  value: unknown,
): { node?: SymbolNode; reason?: string } => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return { reason: `symbol "${id}": ${state} is not { type: string, props?: {...} }` };
  }
  if (value.props !== undefined && !isRecord(value.props)) {
    return { reason: `symbol "${id}": ${state}.props is not a map` };
  }
  return { node: { type: value.type, props: (value.props as Record<string, unknown>) ?? {} } };
};

/**
 * `{ id, name?, fit?, static?, idle?, win? }`, or the reason it is not.
 *
 * `static` is NOT required to parse — `SymbolDef.static` says it always is,
 * but that is `checkSymbols`'s rule to enforce (spec §4: "`static` present"
 * is a CHECK, not a shape refusal — a fresh def with none of the three
 * states yet is still a legal document, written and reported as missing
 * one). The cast below is the same shape of lie
 * `parseDoc` in `flow.ts` never has to tell (`FlowNode`'s required fields
 * are both always present here too) — kept local and named so it is not
 * mistaken for a guarantee.
 */
const parseSymbolDef = (value: Record<string, unknown>): { def?: SymbolDef; reason?: string } => {
  if (typeof value.id !== 'string') {
    return { reason: 'a symbol is { id: string, name?, fit?, static?, idle?, win? }' };
  }
  const def = { id: value.id } as SymbolDef;
  if (typeof value.name === 'string') def.name = value.name;
  if (value.fit === 'contain' || value.fit === 'none') def.fit = value.fit;
  for (const state of STATES) {
    const raw = value[state];
    if (raw === undefined) continue;
    const { node, reason } = parseSymbolNode(value.id, state, raw);
    if (!node) return { reason };
    def[state] = node;
  }
  return { def };
};

/** `{ version: 1, symbols: [...] }` with every symbol `{ id, name?, fit?, static?, idle?, win? }`, or the reason it is not. */
export function parseDoc(value: unknown): { doc?: SymbolsDoc; reason?: string } {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.symbols)) {
    return { reason: 'a symbols document is { version: 1, symbols: [...] }' };
  }
  const symbols: SymbolDef[] = [];
  for (const v of value.symbols) {
    if (!isRecord(v))
      return { reason: 'a symbol is { id: string, name?, fit?, static?, idle?, win? }' };
    const { def, reason } = parseSymbolDef(v);
    if (!def) return { reason };
    symbols.push(def);
  }
  return { doc: { version: 1, symbols } };
}

/**
 * Everything the host can say about a symbols document without running
 * the game — spec §4's list. `known` is `game/spec.json`'s own `symbols`
 * (`[]` when the file or the field is absent — see `known()` in `apply`);
 * both mismatch warnings are skipped when it's empty, the same "the game
 * hasn't spoken yet" gate `checkScenes` applies to an unknown node type.
 */
export function checkSymbols(
  doc: SymbolsDoc,
  nodeTypes: NodeTypeInfo[],
  hasFile: (path: string) => boolean,
  known: { id: string; name: string }[],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const err = (where: string, message: string, fix?: string) =>
    out.push(diagnostic('error', 'symbols', where, message, fix));
  const warn = (where: string, message: string, fix?: string) =>
    out.push(diagnostic('warning', 'symbols', where, message, fix));
  const infos = new Map(nodeTypes.map((t) => [t.type, t]));
  const seen = new Set<string>();
  const docIds = new Set<string>();

  for (const def of doc.symbols) {
    const where = `symbols/${def.id}`;
    if (def.id === '') err(where, 'a symbol needs an id', 'give it one');
    else if (seen.has(def.id))
      err(where, `symbol id "${def.id}" is declared twice`, 'give each symbol one id');
    seen.add(def.id);
    docIds.add(def.id);
    if (!def.static) err(where, `symbol "${def.id}" has no static state`, 'add a static state');
    for (const state of STATES) {
      const node = def[state];
      if (!node) continue;
      out.push(
        ...checkNode(
          'symbols',
          `${where}/${state}`,
          node,
          infos.get(node.type),
          nodeTypes.length > 0,
          hasFile,
          true,
        ),
      );
    }
  }

  for (const k of known) {
    if (!docIds.has(k.id))
      warn(`symbols/${k.id}`, `symbol ${k.id} (${k.name}) has no entry`, 'add it to symbols.yml');
  }
  if (known.length) {
    for (const id of docIds) {
      if (!known.some((k) => k.id === id))
        warn(
          `symbols/${id}`,
          `symbol ${id} is not in game/spec.json`,
          'remove it, or add it to game/spec.json',
        );
    }
  }
  return out;
}

const fileError = (reason: string): Diagnostic =>
  diagnostic('error', 'symbols', FILE, `"${FILE}" is skipped: ${reason}`, 'fix the file');

export function apply(ctx: Context): void {
  let state: SymbolsResponse = { doc: null, known: [], diagnostics: [] };
  // The last list handed to `ideRpc`, by value — see `scenes.ts` for the rule.
  let reported = '';
  // Refresh generation — see `scenes.ts` for the rule.
  let gen = 0;

  /** `game/spec.json`'s own `symbols` — `[]` on any failure (missing file, bad JSON, no/wrong-shaped field). */
  const known = async (): Promise<{ id: string; name: string }[]> => {
    try {
      const { bytes } = await ctx.files.read('game/spec.json');
      if (!bytes) return [];
      const spec = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
        symbols?: { id?: unknown; name?: unknown }[];
      };
      if (!Array.isArray(spec.symbols)) return [];
      return spec.symbols
        .filter((s): s is { id: unknown; name?: unknown } => isRecord(s) && s.id !== undefined)
        .map((s) => ({
          id: String(s.id),
          name: typeof s.name === 'string' ? s.name : String(s.id),
        }));
    } catch {
      return [];
    }
  };

  const refresh = async (): Promise<void> => {
    const mine = ++gen;
    const { bytes } = await ctx.files.read(FILE);
    let doc: SymbolsDoc | null = null;
    const found: Diagnostic[] = [];
    // A missing file is no document and no diagnostic: a project without symbols is fine.
    if (bytes) {
      try {
        const parsed = parseDoc(yaml.load(Buffer.from(bytes).toString('utf8')));
        if (parsed.doc) doc = parsed.doc;
        else found.push(fileError(parsed.reason ?? 'not a symbols document'));
      } catch (error) {
        found.push(fileError(error instanceof Error ? error.message : String(error)));
      }
    }
    const paths = new Set((await ctx.files.tree()).entries.map((e) => e.path));
    const knownList = await known();
    // The known-vs-doc mismatch warnings run even with no `doc` (an empty
    // one stands in) — a fresh project with `spec.json` symbols but no
    // `symbols.yml` yet should still nudge "no entry" for each, same as
    // it would once the file exists and simply lists none of them.
    found.push(
      ...checkSymbols(
        doc ?? { version: 1, symbols: [] },
        ctx.ideRpc.nodeTypes(),
        (p) => paths.has(p),
        knownList,
      ),
    );
    if (mine !== gen) return;
    state = { doc, known: knownList, diagnostics: found };
    const key = found.length ? JSON.stringify(found) : '';
    if (key !== reported) ctx.ideRpc.reportGameDiagnostics('symbols', found);
    reported = key;
    ctx.ideRpc.broadcastSymbols({ doc, diagnostics: found });
  };
  const again = () => void refresh().catch(() => {});
  const onFile = ({ path }: { path: string }) => {
    if (path === FILE || path === 'game/spec.json') again();
  };
  again();
  ctx.on('files/written', onFile);
  ctx.on('files/removed', onFile);
  ctx.on('game/node-types', again);

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
    // A bare document (no `{ doc }` envelope) parses fine as a document on
    // its own — `body.doc` is simply absent, same as any other body with no
    // `doc` key — so the generic "not a symbols document" reason below
    // would describe the shape the caller actually sent and mislead them
    // into "fixing" a document that was never wrong. Named specifically.
    if (isRecord(body) && body.doc === undefined && parseDoc(body).doc) {
      return refuse(res, [fileError('PUT /api/symbols needs { doc: {...} }, not a bare document')]);
    }
    const parsedBody = isRecord(body) ? body.doc : undefined;
    const { doc, reason } = parseDoc(parsedBody);
    if (!doc) return refuse(res, [fileError(`PUT ${req.path}: ${reason}`)]);
    // Only a non-document is refused. Every check diagnostic — a state with
    // no file yet (`src: ''`, what the IDE's Add/Create/Clear produce), an
    // unknown type, a duplicate id — is written, reported and answered: the
    // scenes rule, so the user sees what to fill in next rather than a
    // create path that is dead while a game is connected.
    const write = await ctx.files.write(FILE, Buffer.from(yaml.dump(doc, { noRefs: true })));
    if (write.diagnostics.length) return refuse(res, write.diagnostics);
    await refresh();
    res.json(state);
  };

  ctx.server.get('/api/symbols', get);
  ctx.server.put('/api/symbols', put);
  ctx.provide('symbolsHost', {
    attachGameRoutes: (server) => server.get('/api/symbols', get),
    state: () => state,
  });
}
