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
 * `SceneDocument`) and the inspector (`shell.sideRight`, shown while
 * something is selected and hidden when the selection clears) register
 * here too.
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

export function apply(ctx: Context, config: ScenesConfig) {
  const listeners = new Set<() => void>();
  const fetchFn = config.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const origin = config.origin ?? '';

  let docs: SceneDoc[] = [];
  let diagnostics: Diagnostic[] = [];
  let nodeTypes: NodeTypeInfo[] = [];
  let selected: SceneSelection | null = null;
  // Whether a frame or a write's answer has filled each half — the boot
  // GET does not overwrite what is newer than it.
  let docsLive = false;
  let typesLive = false;
  // Whether the selected scene's tab has been seen open since it was
  // selected — the one case its closing clears the selection.
  let hadTab = false;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  function applyScenes(scenes: SceneDoc[], next: Diagnostic[]) {
    docs = scenes;
    diagnostics = next;
    docsLive = true;
  }
  let derived: (() => void)[] = [];
  function applyTypes(types: NodeTypeInfo[]) {
    nodeTypes = types;
    typesLive = true;
    for (const off of derived) off();
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
      for (const off of derived) off();
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
    update: (doc) => send('PUT', `/api/scenes/${encodeURIComponent(doc.id)}`, doc),
    preview: (id) => send('POST', '/api/scenes/preview', { scene: id }),
    open: (id) => ctx.shell.openPath(`scenes/${id}.scene.yml`),
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
        { name: 'shell.sidebar', key: 'scenes', title: 'Scenes' },
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
      }),
    'scenes:viewer',
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
    () =>
      service.subscribe(() => {
        const shown = ctx.shell.sideRight() === 'scenes';
        if (selected && !shown) ctx.shell.showSideRight('scenes');
        else if (!selected && shown) ctx.shell.hideSideRight();
      }),
    'scenes:side-right-shown',
  );

  ctx.provide('scenes', service);
}

/** Subscribe a component to the scene set, its diagnostics, the node types and the selection. */
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
