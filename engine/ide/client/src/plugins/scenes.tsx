import { useEffect, useState } from 'react';
import type { Context } from 'cordis';
import {
  diagnostic,
  type Diagnostic,
  type NodeTypeInfo,
  type SceneDoc,
  type ScenesResponse,
} from '@energy8engine/contracts';
import type { ConnectionConfig } from './connection';
import { valueStep } from './history';
import { ScenesSidebar } from '../shell/ScenesSidebar';
import { SceneDocument } from '../shell/SceneDocument';
import { PropertiesSidebar } from '../shell/PropertiesSidebar';

/**
 * The scene documents, client half: the set the host keeps
 * (`GET /api/scenes`, then every `scenes` frame), the node types the
 * running game registered (`node-types` frames), and the one selection
 * the sidebar, the viewer and the right-hand inspector share. Shaped
 * after `game-composition.tsx`: a plain service with `subscribe`, a hook
 * that bridges it into React, failures as diagnostics and never a throw.
 *
 * Frames arrive through `ctx.connection.onFrame` rather than a socket of
 * this plugin's own. The boot GET is the snapshot; a frame (or a write's
 * answer) that lands before it is the newer fact and wins.
 *
 * Writes (`create`/`update`/`remove`) answer the refreshed set, applied
 * here at once — the host's `scenes` frame that follows carries the same
 * set again, harmlessly. Refusals (`400 { diagnostics }`) come back as
 * the host's own diagnostics; a transport failure is ONE diagnostic of
 * this plugin's, returned AND reported to `connection` so the
 * diagnostics view sees it.
 *
 * The selection is told to the host (`POST /api/scenes/select`, which it
 * relays to the game as a `scene-select` frame). Clearing tells the host
 * `node: null` for the scene that was selected. A selection whose scene
 * tab (`f:scenes/<id>.scene.yml`) closes is cleared — only when a tab was
 * open for it: a selection made from the sidebar with no tab is left
 * alone.
 *
 * The sidebar, the viewer (`scenes/<id>.scene.yml` as a tab — the canvas,
 * `SceneDocument`) and the inspector (`shell.sideRight`, beside a scene
 * tab or the Scenes list while something is selected) register here too.
 *
 * Every node type the game reports with `accept` becomes one
 * `ctx.assetNodeTypes` registration (`derived:<type>`: its extensions,
 * its `sibling`, a node with the path in `accept.prop` at the drop
 * point), replaced whole on the next report. A project plugin that
 * registers its own afterwards outranks them — `pick` scans newest first.
 */
declare module 'cordis' {
  interface Context {
    scenes: ScenesService;
  }
}

export interface SceneSelection {
  scene: string;
  node: string | null;
}

/** Which layer an edit lands in: `'portrait'` = `portrait.nodes[<id>]`, `null` = the node's own props. */
export type SceneVariant = 'portrait' | null;

export interface ScenesService {
  docs(): readonly SceneDoc[];
  diagnostics(): readonly Diagnostic[];
  nodeTypes(): readonly NodeTypeInfo[];
  selected(): SceneSelection | null;
  /** `POST /api/scenes/select`; `null` clears — told to the host as `node: null` for the last selected scene. */
  select(sel: SceneSelection | null): void;
  /** `[]` on success; the host's refusal (or one transport diagnostic) otherwise. */
  create(id: string): Promise<Diagnostic[]>;
  remove(id: string): Promise<Diagnostic[]>;
  update(doc: SceneDoc): Promise<Diagnostic[]>;
  /** `POST /api/scenes/preview` — "show this scene" to the running game; the host warns when no preview is up. */
  preview(id: string): Promise<Diagnostic[]>;
  /** Opens `scenes/<id>.scene.yml` as a tab through the shell's file opener. */
  open(id: string): void;
  /**
   * The edit target of `scene`'s canvas, as its PAGE reports it (`ready`
   * carries the first orientation, an `orientation` event every flip; the
   * tab publishes them here, keyed by its scene, and deletes its entry on
   * unmount): `'portrait'` while that canvas' safe rect is taller than
   * wide, so the inspector writes `portrait.nodes[<id>]` too; `null` for
   * a scene with no canvas up, or a landscape one.
   */
  variant(scene: string): SceneVariant;
  setVariant(scene: string, variant: SceneVariant): void;
  subscribe(listener: () => void): () => void;
}

export interface ScenesConfig extends ConnectionConfig {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Where the host is. Defaults to the page origin, which the IDE's own vite proxies to it. */
  origin?: string;
}

export const name = 'scenes';
// `workspace` and `gameComposition` are the canvas' (`SceneDocument`): where
// the editor page is served, and the design size the `scenes1` row declares.
// `assetNodeTypes` and `files` are the canvas' too — turning a dropped asset
// into a node (`ctx.assetNodeTypes.pick`) and, for a raw `File`, writing it
// into the project first (`ctx.files.write`/`ctx.files.tree`).
export const inject = [
  'slots',
  'connection',
  'shell',
  'viewers',
  'workspace',
  'gameComposition',
  'assetNodeTypes',
  'files',
  'history',
];

function ownDiagnostic(where: string, message: string): Diagnostic {
  return diagnostic(
    'error',
    'scenes',
    where,
    message,
    'check that the host is running — `e8 dev` serves this route',
  );
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const tabKey = (id: string) => `f:scenes/${id}.scene.yml`;
const SCENE_TAB = /^f:scenes\/([a-z0-9_]+)\.scene\.yml$/;

export function apply(ctx: Context, config: ScenesConfig) {
  const listeners = new Set<() => void>();
  const fetchFn = config.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const origin = config.origin ?? '';

  let docs: SceneDoc[] = [];
  let diagnostics: Diagnostic[] = [];
  let nodeTypes: NodeTypeInfo[] = [];
  let selected: SceneSelection | null = null;
  const variants = new Map<string, SceneVariant>();
  // Whether a frame or a write's answer has filled each half — the boot
  // GET does not overwrite what is newer than it.
  let docsLive = false;
  let typesLive = false;
  // Whether the selected scene's tab has been seen open since it was
  // selected — the one case its closing clears the selection.
  let hadTab = false;
  // Writes currently in flight, service-wide — while any is pending, a
  // recorded step's undo/redo answers BUSY (its `pending`) before it ever
  // compares `docs`, which the write in flight is about to replace: the
  // step stays, to be taken once that write has landed.
  let pending = 0;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  function applyScenes(scenes: SceneDoc[], next: Diagnostic[]) {
    docs = scenes;
    diagnostics = next;
    docsLive = true;
  }
  let derived: (() => void)[] = [];
  // The boot GET can answer after this plugin is gone — nothing to register then.
  let disposed = false;
  function applyTypes(types: NodeTypeInfo[]) {
    nodeTypes = types;
    typesLive = true;
    for (const off of derived) off();
    if (disposed) return;
    derived = types.flatMap(({ type, accept }) =>
      accept
        ? [
            ctx.assetNodeTypes.register(`derived:${type}`, {
              extensions: accept.extensions,
              sibling: accept.sibling,
              node: (path, { x, y }) => ({
                type,
                props: { [accept.prop]: path, x, y, anchor: 0.5 },
              }),
            }),
          ]
        : [],
    );
  }
  ctx.effect(
    () => () => {
      disposed = true;
      for (const off of derived) off();
      derived = [];
    },
    'scenes:derived-asset-types',
  );

  /**
   * The one request shape every route shares. A 2xx whose body carries a
   * `scenes` array is a refreshed set and is applied; its `diagnostics`
   * (empty on a write, the host's warning on `select`/`preview`) are the
   * answer. Anything else is a refusal: the host's `diagnostics` if it
   * sent them, this plugin's own — reported — if the transport failed.
   */
  async function send(method: string, where: string, body?: unknown): Promise<Diagnostic[]> {
    let res: Response;
    let answer: Partial<ScenesResponse> & { diagnostics?: unknown };
    try {
      res = await fetchFn(`${origin}${where}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      answer = await res.json();
    } catch (error) {
      const own = ownDiagnostic(where, `${method} failed: ${reason(error)}`);
      ctx.connection.report(own);
      return [own];
    }
    const host = Array.isArray(answer.diagnostics) ? (answer.diagnostics as Diagnostic[]) : [];
    if (!res.ok) {
      if (host.length) return host;
      const own = ownDiagnostic(where, `${method} failed: the host answered ${res.status}`);
      ctx.connection.report(own);
      return [own];
    }
    if (Array.isArray(answer.scenes)) {
      applyScenes(answer.scenes, host);
      if (Array.isArray(answer.nodeTypes)) applyTypes(answer.nodeTypes);
      notify();
      return [];
    }
    return host;
  }

  const service: ScenesService = {
    docs: () => docs,
    diagnostics: () => diagnostics,
    nodeTypes: () => nodeTypes,
    selected: () => selected,
    select(sel) {
      const last = selected?.scene;
      // Clearing nothing is nothing: no notification, nothing to tell the host.
      if (sel === null && last === undefined) return;
      selected = sel;
      hadTab = sel !== null && ctx.shell.documents().some((d) => d.key === tabKey(sel.scene));
      notify();
      void send('POST', '/api/scenes/select', sel ?? { scene: last, node: null });
    },
    create: (id) => send('POST', '/api/scenes', { id }),
    remove: (id) => send('DELETE', `/api/scenes/${encodeURIComponent(id)}`),
    async update(doc) {
      // Read as this write starts: `true` only for an undo/redo's own write.
      const replayed = ctx.history.replaying();
      // Captured before the PUT: the docs the host resolves and applies
      // arrive INSIDE `send`, so `docs` is already the new set by the time
      // this `await` returns.
      // ponytail: captured at CALL time, not at this write's own turn the
      // way `symbols.tsx` captures it — two overlapping writes for the
      // same scene can both capture the same `before`, so undoing the
      // later-recorded step reverts both and the next undo then refuses
      // (diverged). Upgrade path: queue writes per scene id like Symbols.
      const before = docs.find((d) => d.id === doc.id);
      pending++;
      try {
        const diagnostics = await send('PUT', `/api/scenes/${encodeURIComponent(doc.id)}`, doc);
        // A scene this write CREATED has no "before" to go back to —
        // undoing it would need a delete, out of scope (design doc §3).
        if (diagnostics.length === 0 && before !== undefined && !replayed) {
          ctx.history.record(
            `scene:${doc.id}`,
            valueStep({
              label: `scene ${doc.id}`,
              before,
              after: doc,
              read: () => docs.find((d) => d.id === doc.id),
              // `true` while another write is in flight: this write's OWN
              // completion already dropped `pending` back to 0 by the time
              // anyone can call this, so a nonzero count here means an
              // UNRELATED write is racing this undo/redo — BUSY, not
              // diverged, so the step it would refuse stays undoable.
              pending: () => pending > 0,
              write: async (value) => ({
                error: (await service.update(value))[0]?.message ?? null,
              }),
              history: ctx.history,
            }),
          );
        }
        return diagnostics;
      } finally {
        pending--;
      }
    },
    preview: (id) => send('POST', '/api/scenes/preview', { scene: id }),
    open: (id) => ctx.shell.openPath(`scenes/${id}.scene.yml`),
    variant: (scene) => variants.get(scene) ?? null,
    setVariant(scene, next) {
      if ((variants.get(scene) ?? null) === next) return;
      if (next === null) variants.delete(scene);
      else variants.set(scene, next);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  void (async () => {
    try {
      const res = await fetchFn(`${origin}/api/scenes`);
      if (!res.ok) throw new Error(`the host answered ${res.status}`);
      const body = (await res.json()) as Partial<ScenesResponse>;
      if (!Array.isArray(body.scenes)) throw new Error('the response has no "scenes" array');
      if (!docsLive)
        applyScenes(body.scenes, Array.isArray(body.diagnostics) ? body.diagnostics : []);
      if (!typesLive && Array.isArray(body.nodeTypes)) applyTypes(body.nodeTypes);
    } catch (error) {
      if (docsLive) return;
      diagnostics = [ownDiagnostic('/api/scenes', `could not read the scenes: ${reason(error)}`)];
    }
    notify();
  })();

  ctx.effect(
    () =>
      ctx.connection.onFrame((frame) => {
        if (frame.type === 'scenes') applyScenes(frame.scenes, frame.diagnostics);
        else if (frame.type === 'node-types') applyTypes(frame.types);
        else return;
        notify();
      }),
    'scenes:frames',
  );

  ctx.effect(
    () =>
      ctx.shell.subscribe(() => {
        const sel = selected;
        if (!sel) return;
        if (ctx.shell.documents().some((d) => d.key === tabKey(sel.scene))) hadTab = true;
        else if (hadTab) service.select(null);
      }),
    'scenes:tab-closed',
  );

  ctx.effect(
    () =>
      ctx.slots.register({
        name: 'shell.activity',
        key: 'scenes',
        title: 'Scenes',
        icon: 'layers',
        order: 35,
        opens: 'sidebar',
      }),
    'scenes:activity',
  );

  ctx.effect(
    () =>
      ctx.slots.register(
        { name: 'shell.sidebar', key: 'scenes', title: 'Scenes', sideRight: 'scenes' },
        function ScenesView() {
          return <ScenesSidebar ctx={ctx} />;
        },
      ),
    'scenes:sidebar',
  );

  ctx.effect(
    () =>
      ctx.viewers.register({
        id: 'scene',
        match: (p) => /^scenes\/[a-z0-9_]+\.scene\.yml$/.test(p),
        component: SceneDocument,
        sideRight: 'scenes',
      }),
    'scenes:viewer',
  );

  ctx.effect(
    () =>
      ctx.history.scope((key) => {
        const match = SCENE_TAB.exec(key);
        return match ? [`scene:${match[1]}`] : undefined;
      }),
    'scenes:history-scope',
  );

  ctx.effect(
    () =>
      ctx.slots.register(
        { name: 'shell.sideRight', key: 'scenes', title: 'Properties' },
        function PropertiesView() {
          return <PropertiesSidebar ctx={ctx} />;
        },
      ),
    'scenes:side-right',
  );

  ctx.effect(
    () => service.subscribe(() => ctx.shell.setSideRight('scenes', !!selected)),
    'scenes:side-right-shown',
  );

  ctx.provide('scenes', service);
}

/** Subscribe a component to the scene set, its diagnostics, the node types and the selection. A variant change re-renders too (`ctx.scenes.variant(scene)` is read live). */
export function useScenes(ctx: Context): {
  docs: readonly SceneDoc[];
  diagnostics: readonly Diagnostic[];
  nodeTypes: readonly NodeTypeInfo[];
  selected: SceneSelection | null;
} {
  const read = () => ({
    docs: ctx.scenes.docs(),
    diagnostics: ctx.scenes.diagnostics(),
    nodeTypes: ctx.scenes.nodeTypes(),
    selected: ctx.scenes.selected(),
  });
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    return ctx.scenes.subscribe(() => setState(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  return state;
}
