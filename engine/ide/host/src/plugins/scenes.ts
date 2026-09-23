/**
 * The scene documents, host half (spec: scene editor §6). One file per
 * scene, `scenes/<id>.scene.yml`, read through `files` and kept parsed
 * here; `checkScenes` is everything the host can say about the set
 * without running the game (a parse failure, an id off its file name, a
 * duplicate node, a dangling or circular `scene` reference, an image
 * whose file is not in the tree, props the type's schema refuses, an
 * unknown type — the last two only once the game has reported its
 * `node-types`, since the schemas travel in that frame). Reported through
 * `ideRpc.reportGameDiagnostics('scenes', …)`, replaced whole each time.
 *
 * A `$cell` binding is the one check that depends on ANOTHER document:
 * only a CELL scene — one a `symbols.yml` state names, which the runtime
 * mounts once per cell — has a cell to read. That set is
 * `symbolsHost.cellScenes()`, read leniently at check time (the symbols
 * plugin is plugged after this one), and the symbols plugin calls
 * `recheck()` here when its own write changes it.
 *
 * Re-read on ANY `files/written`/`files/removed` (an image may have
 * appeared, not only a document), on `game/node-types`, and on a game row
 * write (`game-composition/written` — the `reels1` warning depends on the
 * rows). Every read broadcasts the set as a `scenes` frame to every
 * `/ide` socket, root and preview alike — the boot read too: the plugin
 * boots once per project inside `project-scope` while root sockets stay
 * up across a switch, and only that frame tells them the new set.
 *
 * `POST /api/scenes/preview { scene }` is the sidebar's "show me": the
 * frame goes to every `/ide` socket (`broadcastScenePreview`), and the
 * answer carries a warning when no preview is up to receive it — the
 * frame still goes, harmlessly, to whoever is listening.
 */
import { basename } from 'node:path';
import type { Context } from 'cordis';
import type { Server } from '@cordisjs/plugin-server';
import yaml from 'js-yaml';
import Schema from 'schemastery';
// pixi-free: `./common-schema` imports schemastery and nothing else.
import { COMMON, PINS, emptyProp, isCellBinding } from '@energy8engine/scenes/common-schema';
import {
  diagnostic,
  type Diagnostic,
  type DiagnosticsResponse,
  type NodeTypeInfo,
  type SceneDoc,
  type SceneNode,
  type ScenesResponse,
} from '@energy8engine/contracts';
import type { FilesService } from './files';

declare module 'cordis' {
  interface Context {
    scenesHost: ScenesHostService;
  }
}

export interface ScenesHostService {
  /** Registers `GET /api/scenes` on another server — the preview's, so the game reads the set same-origin. */
  attachGameRoutes(server: Server): void;
  /** The last read set, as `GET /api/scenes` answers it. */
  state(): ScenesResponse;
  /**
   * Re-read and re-check, for `symbols.ts` to call when ITS write changed
   * which scenes are cell scenes. Idempotent, and deliberately one-way:
   * nothing in here calls back into the symbols plugin.
   */
  recheck(): Promise<void>;
}

export const name = 'scenes';
export const inject = ['server', 'ideRpc', 'project', 'files'];

/** A scene document's path; group 1 is the id (the file name wins — see `checkScenes`). Also `flow.ts`'s. */
export const SCENE_FILE = /^scenes\/([a-z0-9_]+)\.scene\.yml$/;
const ID = /^[a-z0-9_]+$/;
/**
 * The props every node accepts, applied by the runtime — a type's own
 * schema never lists them, so they are split off before the schema sees
 * the props, and checked through `COMMON` itself.
 */
const COMMON_PROPS = Object.keys(COMMON.dict ?? {});

type Dict = Record<string, { type?: string; meta?: { required?: boolean } } | undefined>;
/**
 * A type's schema rehydrated ONCE per `NodeTypeInfo` (the props travel as
 * schemastery JSON, and only a `Schema` has a readable `dict`): `checkNode`
 * runs per node, and a set's nodes share their few types. Keyed by the
 * info's identity — a fresh `game/node-types` frame is a fresh object.
 */
const schemas = new WeakMap<NodeTypeInfo, Schema>();
const schemaOf = (info: NodeTypeInfo): Schema => {
  let s = schemas.get(info);
  if (!s) schemas.set(info, (s = new Schema(info.schema as Schema)));
  return s;
};

export interface ParsedDoc {
  /** Project-relative, `scenes/<id>.scene.yml`. */
  file: string;
  doc: SceneDoc;
}

const sceneId = (file: string): string => basename(file, '.scene.yml');

/** Every node in draw order, children after their parent. Also `flow.ts`'s (`prop.target`'s node list). */
export function* walk(nodes: SceneNode[]): Generator<SceneNode> {
  for (const n of nodes) {
    yield n;
    if (n.children) yield* walk(n.children);
  }
}

/**
 * What the host can say about ONE node without running the game — shared
 * by `checkScenes` (a scene document's nodes) and `symbols.ts` (a symbol
 * def's `static`/`idle`/`win` states, which are `SymbolNode`s: a `SceneNode`
 * without `id`/`children`, same `{ type, props }` shape this only reads).
 * `checkScenes` keeps what this does NOT cover — duplicate ids, `reels`
 * bookkeeping, `scene` reference resolution — none of which apply to a
 * symbol state.
 *
 * `reported` is `nodeTypes.length > 0` at the call site: an unknown type is
 * only an error once the game has actually spoken (same gate `checkScenes`
 * always applied inline).
 */
export function checkNode(
  plugin: string,
  where: string,
  node: { type: string; props: Record<string, unknown> },
  info: NodeTypeInfo | undefined,
  reported: boolean,
  hasFile: (path: string) => boolean,
  /** `$cell.<field>` props are accepted — only a `symbols.yml` state, and a cell scene one names, has a cell to read them from. */
  cellBindings = false,
  /** The node is a child of another (below the scene root), where the runtime ignores a `pin`. */
  nested = false,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const err = (message: string, fix?: string) =>
    out.push(diagnostic('error', plugin, where, message, fix));
  // The same warning the scenes runtime raises at mount (`scenes.ts`'s
  // `nestedPin`): a pin measures from the safe rect in the ROOT's
  // coordinates, which a child does not share. Only for a value that IS a
  // pin — a typo is the schema's one error below, not two diagnostics.
  if (nested && (PINS as readonly unknown[]).includes(node.props?.pin))
    out.push(
      diagnostic(
        'warning',
        plugin,
        where,
        `pin on a nested node "${where.slice(where.lastIndexOf('/') + 1)}" is ignored`,
        'pin only top-level nodes',
      ),
    );
  const schema = info?.schema;
  // Populated below when there's a schema to rehydrate; read again by the
  // `assetProps` loop past the end of this branch, so a REQUIRED asset prop
  // (`image.src`) still needs a value and an OPTIONAL one (`text.font`) does
  // not — one rehydration, both readers.
  let dict: Dict = {};
  if (reported && schema === undefined) {
    err(`node type "${node.type}" is not one the game registered`, 'use a registered type');
  } else if (schema !== undefined) {
    const own: Record<string, unknown> = {};
    const common: Record<string, unknown> = {};
    try {
      // Rehydrated (`schemaOf`, memoised per info). The TYPE's own prop wins
      // the name — `shape` declares `width`/`height` itself (the geometry), so
      // those go to its schema, not to `COMMON`; the runtime splits them the
      // same way (`applyCommon`'s `commonOf`).
      const ownSchema = schemaOf(info!);
      dict = (ownSchema as unknown as { dict?: Dict }).dict ?? {};
      for (const [k, v] of Object.entries(node.props)) {
        const target = COMMON_PROPS.includes(k) && !(k in dict) ? common : own;
        // A symbol state's `$cell` binding — a bare field, or any expression
        // over one (`'x{$cell.mv}'`, `'$cell.mv * 2'`) — stands for a value of
        // whatever type the prop declares, resolved against the cell's data at
        // run time, so no schema ever validates it (the flow's `$path` strings
        // are not validated either). That prop's EMPTY is checked in its place,
        // exactly as the symbols runtime does before the first `update`
        // (`symbols/src/view.ts`).
        //
        // Only where there IS a cell, though: an ordinary scene node is not
        // mounted per cell, nothing resolves the binding there, and the
        // string would be drawn as-is. A CELL scene is the exception — a
        // `scene`-typed symbol state names it, and the runtime mounts it
        // once per cell. Substituted either way, so the schema does not pile
        // a second complaint on top of this one.
        const bound = isCellBinding(v);
        if (bound && !cellBindings)
          err(
            `prop "${k}" binds "$cell." — only a cell scene (one a symbols.yml state names) reads a cell`,
            'use a literal value',
          );
        target[k] = bound ? emptyProp(dict[k] ?? COMMON.dict?.[k]) : v;
      }
      COMMON(common as never);
      ownSchema(own);
    } catch (error) {
      err(`props: ${error instanceof Error ? error.message : String(error)}`, 'fix the value');
    }
  }
  // Every prop the type's `assetProps` names holds a project-relative
  // path (the `image.src` special case, generalised): `required()`
  // lets `''` through the schema check above (a fresh node), so an
  // empty REQUIRED value is its own message. An OPTIONAL asset prop
  // (`text.font`, `.default('')`) is legitimate empty — the runtime's
  // `assets()` skips it the same way (`props.font ? [props.font] : []`)
  // — so it is only checked once it names something. A type the host
  // does not know yet (no `NodeTypeInfo` — the game hasn't reported, or
  // the type is unregistered) checks nothing; the unknown-type error
  // above already covers a registered set missing it.
  for (const prop of info?.assetProps ?? []) {
    let v = node.props?.[prop];
    // A type's sibling prop (`spine`'s atlas) defaults to its main
    // asset's stem with the sibling's extension when left empty —
    // same rule as `spine.ts`'s `atlasOf`, generalised to any type
    // that declares `accept.sibling`.
    if (info?.accept?.sibling === prop && !v && typeof node.props[info.accept.prop] === 'string') {
      v = (node.props[info.accept.prop] as string).replace(/\.[^./]+$/, `.${prop}`);
    }
    if (typeof v !== 'string' || v === '') {
      if (dict[prop]?.meta?.required === true) {
        err(`${node.type} has no ${prop}`, 'pick a file under the project');
      }
    } else if (isCellBinding(v)) {
      // A state's asset is loaded from the DOCUMENT before any cell is
      // known (the runtime's `assets()` reads the props as written), so
      // there is no moment a bound path could resolve to a file.
      err(
        `an asset prop cannot be bound to $cell (assets are preloaded from the document)`,
        'name the file itself',
      );
    } else if (!hasFile(v)) {
      err(`${node.type}.${prop} "${v}" is not in the project`, 'pick a file under the project');
    }
  }
  return out;
}

/**
 * `cellScenes` is `symbolsHost.cellScenes()` — the documents some symbol
 * state names, which the runtime mounts once per cell. Only those may
 * carry a `$cell` binding; everywhere else the string is drawn as written.
 */
export function checkScenes(
  docs: ParsedDoc[],
  nodeTypes: NodeTypeInfo[],
  hasFile: (path: string) => boolean,
  hasReelsRow: boolean,
  cellScenes: readonly string[] = [],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const err = (where: string, message: string, fix?: string) =>
    out.push(diagnostic('error', 'scenes', where, message, fix));
  const ids = new Set(docs.map((d) => sceneId(d.file)));
  const infos = new Map(nodeTypes.map((t) => [t.type, t]));
  // scene → the scenes its `scene` nodes name (known ones only).
  const refs = new Map<string, Set<string>>();
  const reelsNodes: string[] = [];
  /**
   * A `scene` node's targets, each with where it is named: its own, and
   * the one its portrait override swaps in (a root's only — the block
   * addresses roots) at `<where> (portrait)`. Both go through the same
   * exists and cycle checks: the override is an edge of the graph the
   * runtime's `refsOf`/`assetsOf` follow.
   */
  const targetsOf = (doc: SceneDoc, node: SceneNode, scene: string): [string, string][] => {
    if (node.type !== 'scene') return [];
    const where = `${scene}/${node.id}`;
    const out: [string, string][] = [];
    if (typeof node.props.scene === 'string') out.push([node.props.scene, where]);
    const o = doc.nodes.includes(node) ? doc.portrait?.nodes?.[node.id]?.scene : undefined;
    if (typeof o === 'string') out.push([o, `${where} (portrait)`]);
    return out;
  };

  for (const { file, doc } of docs) {
    const scene = sceneId(file);
    const cell = cellScenes.includes(scene);
    if (doc.id !== scene) {
      out.push(
        diagnostic(
          'warning',
          'scenes',
          scene,
          `"${file}" says id "${doc.id}"; the file name wins, so it is "${scene}"`,
          `set id: ${scene}`,
        ),
      );
    }
    const seen = new Set<string>();
    const targets = new Set<string>();
    refs.set(scene, targets);
    for (const node of walk(doc.nodes)) {
      const where = `${scene}/${node.id}`;
      if (seen.has(node.id))
        err(where, `node "${node.id}" is declared twice`, 'give each node one id');
      seen.add(node.id);
      if (node.type === 'reels') reelsNodes.push(where);
      out.push(
        ...checkNode(
          'scenes',
          where,
          node,
          infos.get(node.type),
          nodeTypes.length > 0,
          hasFile,
          cell,
          // `walk` flattens the tree; the root list itself says which nodes are top-level.
          !doc.nodes.includes(node),
        ),
      );
      for (const [target, at] of targetsOf(doc, node, scene)) {
        if (ids.has(target)) targets.add(target);
        else err(at, `scene "${target}" does not exist`, 'create it, or name one that exists');
      }
    }
    // The portrait block (spec §6): roots only, and each override checked
    // as the node it lays over — MERGED with the node's props, since the
    // rules read the whole dict (an image override that leaves `src` alone
    // must not read as "image has no src"). A node broken on its own is
    // reported again here; the `(portrait)` tag tells the two apart.
    for (const [id, override] of Object.entries(doc.portrait?.nodes ?? {})) {
      const node = doc.nodes.find((n) => n.id === id);
      if (!node) {
        out.push(
          diagnostic(
            'warning',
            'scenes',
            `${scene}/${id}`,
            `portrait override for unknown node "${id}"`,
            'name a top-level node of this scene',
          ),
        );
        continue;
      }
      out.push(
        ...checkNode(
          'scenes',
          `${scene}/${id} (portrait)`,
          { type: node.type, props: { ...node.props, ...override } },
          infos.get(node.type),
          nodeTypes.length > 0,
          hasFile,
          cell,
        ),
      );
    }
  }

  // ponytail: a DFS per `scene` node — O(n²) over a handful of documents.
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean =>
    from === to ||
    [...(refs.get(from) ?? [])].some(
      (next) => !seen.has(next) && reaches(next, to, seen.add(next)),
    );
  for (const { file, doc } of docs) {
    const scene = sceneId(file);
    for (const node of walk(doc.nodes))
      for (const [target, at] of targetsOf(doc, node, scene))
        if (refs.get(scene)?.has(target) && reaches(target, scene))
          err(at, `scene "${target}" leads back to "${scene}"`, 'a scene cannot contain itself');
  }

  if (reelsNodes.length > 1) {
    out.push(
      diagnostic(
        'warning',
        'scenes',
        'reels1',
        `${reelsNodes.length} nodes are \`reels\` (${reelsNodes.join(', ')}) — the board can be on screen once`,
        'keep one `reels` node',
      ),
    );
  }
  if (hasReelsRow && reelsNodes.length === 0) {
    out.push(
      diagnostic(
        'warning',
        'scenes',
        'reels1',
        'a reels row is composed, but no scene has a `reels` node — the board is never shown',
        'add a `reels` node to a scene',
      ),
    );
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `{ id, nodes[], portrait? }` with every node `{ id, type, props?, children? }`, or the reason it is not. */
export function parseDoc(value: unknown): { doc?: SceneDoc; reason?: string } {
  if (!isRecord(value) || typeof value.id !== 'string' || !Array.isArray(value.nodes)) {
    return { reason: 'a scene document is { id: string, nodes: [...] }' };
  }
  const nodes = parseNodes(value.nodes);
  if (typeof nodes === 'string') return { reason: nodes };
  const doc: SceneDoc = { id: value.id, nodes };
  if (value.portrait !== undefined) {
    const p = value.portrait;
    if (!isRecord(p) || !isRecord(p.nodes) || !Object.values(p.nodes).every(isRecord)) {
      return { reason: 'portrait is { nodes: { <node id>: { ...props } } }' };
    }
    doc.portrait = { nodes: p.nodes as Record<string, Record<string, unknown>> };
  }
  return { doc };
}

function parseNodes(list: unknown[]): SceneNode[] | string {
  const out: SceneNode[] = [];
  for (const v of list) {
    if (!isRecord(v) || typeof v.id !== 'string' || typeof v.type !== 'string') {
      return 'a node is { id: string, type: string, props?: {...}, children?: [...] }';
    }
    if (v.props !== undefined && !isRecord(v.props)) return `node "${v.id}": props is not a map`;
    const node: SceneNode = { id: v.id, type: v.type, props: v.props ?? {} };
    if (v.children !== undefined) {
      if (!Array.isArray(v.children)) return `node "${v.id}": children is not a list`;
      const children = parseNodes(v.children);
      if (typeof children === 'string') return children;
      node.children = children;
    }
    out.push(node);
  }
  return out;
}

async function readAll(
  files: FilesService,
  paths: string[],
): Promise<{ docs: ParsedDoc[]; diagnostics: Diagnostic[] }> {
  const docs: ParsedDoc[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of paths.filter((p) => SCENE_FILE.test(p))) {
    const { bytes } = await files.read(file);
    let reason: string | undefined;
    if (bytes) {
      try {
        const parsed = parseDoc(yaml.load(Buffer.from(bytes).toString('utf8')));
        if (parsed.doc) docs.push({ file, doc: parsed.doc });
        reason = parsed.reason;
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
    } else reason = 'cannot read the file';
    if (reason) {
      diagnostics.push(
        diagnostic(
          'error',
          'scenes',
          sceneId(file),
          `"${file}" is skipped: ${reason}`,
          'fix the file',
        ),
      );
    }
  }
  return { docs, diagnostics };
}

export function apply(ctx: Context): void {
  let state: ScenesResponse = { scenes: [], diagnostics: [], nodeTypes: [] };
  // The last list handed to `ideRpc`, by value; `''` before anything was
  // said. A report is a frame to every client, so an unchanged list is not
  // repeated (a `.spin` save must not re-send the same standing warning),
  // and an empty one is only said once something was said (an empty frame
  // says "nothing wrong", which a client with no game yet must not hear
  // from a speaker that never spoke).
  let reported = '';
  // Refreshes are re-entrant and unordered: a `game/node-types`-triggered
  // refresh that read the OLD bytes can finish after a PUT's own refresh
  // read the new ones, and would then broadcast the pre-write set over
  // the written one. The newest call wins — an older one that finishes
  // last drops its result. Which is why every refresh broadcasts, a
  // route's own included: `files.write` emits `files/written` before it
  // returns, so the refresh that event triggers is always the OLDER of
  // the pair and is dropped; the route's is the one that speaks.
  // `symbols.ts`/`flow.ts` guard the same way.
  let gen = 0;

  const refresh = async (): Promise<void> => {
    const mine = ++gen;
    const paths = new Set((await ctx.files.tree()).entries.map((e) => e.path));
    const { docs, diagnostics } = await readAll(ctx.files, [...paths]);
    const hasReelsRow = ctx.project.composition.rows.some(
      (r) => r.name === '@energy8engine/reels' || r.id === 'reels1',
    );
    const nodeTypes = ctx.ideRpc.nodeTypes();
    // Lenient, and read HERE rather than captured at apply time: the
    // symbols plugin is plugged after this one (`project-scope`), so at the
    // boot read there is no service yet — an empty list then, and the
    // symbols plugin's own first read calls `recheck` once it has one.
    const cells = ctx.get('symbolsHost')?.cellScenes() ?? [];
    const found = [
      ...diagnostics,
      ...checkScenes(docs, nodeTypes, (p) => paths.has(p), hasReelsRow, cells),
    ];
    // The file name wins for lookup — the mismatch is already a warning above.
    const scenes = docs.map((d) => ({ ...d.doc, id: sceneId(d.file) }));
    if (mine !== gen) return;
    state = { scenes, diagnostics: found, nodeTypes };
    const key = found.length ? JSON.stringify(found) : '';
    if (key !== reported) ctx.ideRpc.reportGameDiagnostics('scenes', found);
    reported = key;
    ctx.ideRpc.broadcastScenes({ scenes, diagnostics: found });
  };
  // Every refresh broadcasts, the boot one too: a project
  // switch re-applies this plugin while root sockets stay connected, and
  // the frame is what replaces their stale set (to zero sockets it is a
  // no-op). `refresh` itself never throws (`tree`/`read` do not); the
  // catch covers a refresh racing a dispose.
  const again = () => void refresh().catch(() => {});
  again();
  ctx.on('files/written', again);
  ctx.on('files/removed', again);
  ctx.on('game/node-types', again);
  ctx.on('game-composition/written', again);

  type Handler = Parameters<Server['get']>[1];
  type Req = Parameters<Handler>[0];
  type Res = Parameters<Handler>[1];
  const refuse = (res: Res, status: number, where: string, message: string, fix?: string) => {
    res.status = status;
    const refusal: DiagnosticsResponse = {
      diagnostics: [diagnostic('error', 'scenes', where, message, fix)],
    };
    res.json(refusal);
  };
  const bodyOf = async (req: Req): Promise<unknown> => {
    try {
      return await req.json();
    } catch {
      return undefined;
    }
  };
  /** Files' own refusal, in the shape and status `files.ts` would have given it. */
  const relay = (res: Res, diagnostics: Diagnostic[]): boolean => {
    if (!diagnostics.length) return false;
    res.status = diagnostics[0].code === 'not-found' ? 404 : 400;
    res.json({ diagnostics } satisfies DiagnosticsResponse);
    return true;
  };
  const file = (id: string) => `scenes/${id}.scene.yml`;

  const get: Handler = async (_req, res) => {
    res.json(state);
  };

  const put = async (req: Req, res: Res) => {
    const { id } = req.params;
    if (!ID.test(id)) return refuse(res, 400, id, `"${id}" is not a scene id`, 'use [a-z0-9_]+');
    const { doc, reason } = parseDoc(await bodyOf(req));
    if (!doc) return refuse(res, 400, id, `PUT ${req.path}: ${reason}`);
    if (doc.id !== id) {
      return refuse(
        res,
        400,
        id,
        `the body says id "${doc.id}", the route "${id}"`,
        `set id: ${id}`,
      );
    }
    const bytes = Buffer.from(
      yaml.dump({ id, nodes: doc.nodes, ...(doc.portrait && { portrait: doc.portrait }) }, { noRefs: true }),
    );
    if (relay(res, (await ctx.files.write(file(id), bytes)).diagnostics)) return;
    await refresh();
    res.json(state);
  };

  const post = async (req: Req, res: Res) => {
    const id = (await bodyOf(req)) as { id?: unknown } | null | undefined;
    if (!isRecord(id) || typeof id.id !== 'string' || !ID.test(id.id)) {
      return refuse(
        res,
        400,
        req.path,
        `POST ${req.path} needs {"id": string} matching [a-z0-9_]+`,
      );
    }
    const path = file(id.id);
    if ((await ctx.files.read(path)).bytes) {
      return refuse(res, 400, id.id, `"${path}" already exists`, 'pick another id');
    }
    const write = await ctx.files.write(path, Buffer.from(`id: ${id.id}\nnodes: []\n`));
    if (relay(res, write.diagnostics)) return;
    await refresh();
    res.json(state);
  };

  const del = async (req: Req, res: Res) => {
    const { id } = req.params;
    if (!ID.test(id)) return refuse(res, 404, id, `"${id}" is not a scene id`);
    if (relay(res, (await ctx.files.remove(file(id))).diagnostics)) return;
    await refresh();
    res.json(state);
  };

  const select = async (req: Req, res: Res) => {
    const body = await bodyOf(req);
    if (
      !isRecord(body) ||
      typeof body.scene !== 'string' ||
      (body.node !== null && typeof body.node !== 'string')
    ) {
      return refuse(
        res,
        400,
        req.path,
        `POST ${req.path} needs {"scene": string, "node": string | null}`,
      );
    }
    ctx.ideRpc.broadcastSceneSelect({ scene: body.scene, node: body.node });
    res.json({ diagnostics: [] } satisfies DiagnosticsResponse);
  };

  const preview = async (req: Req, res: Res) => {
    const scene = ((await bodyOf(req)) as { scene?: unknown } | null | undefined)?.scene;
    if (typeof scene !== 'string' || scene === '') {
      return refuse(
        res,
        400,
        req.path,
        `POST ${req.path} needs a JSON body shaped {"scene": string}`,
      );
    }
    ctx.ideRpc.broadcastScenePreview({ scene });
    const response: DiagnosticsResponse = {
      diagnostics: ctx.get('devGamePreview')?.url
        ? []
        : [
            diagnostic(
              'warning',
              'scenes',
              scene,
              'no preview is running, so nothing is showing the scene',
              'open a project with a game/ directory, or free the preview port',
            ),
          ],
    };
    res.json(response);
  };

  ctx.server.get('/api/scenes', get);
  ctx.server.post('/api/scenes', post);
  // The literal routes before `:id` — measured in `scenes.test.ts`
  // (`POST /api/scenes/select` must not be a `:id`).
  ctx.server.post('/api/scenes/preview', preview);
  ctx.server.post('/api/scenes/select', select);
  ctx.server.put('/api/scenes/:id', put);
  ctx.server.delete('/api/scenes/:id', del);
  ctx.provide('scenesHost', {
    attachGameRoutes: (server) => server.get('/api/scenes', get),
    state: () => state,
    recheck: refresh,
  });
}
