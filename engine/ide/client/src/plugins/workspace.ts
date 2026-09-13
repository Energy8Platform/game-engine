import { useSyncExternalStore } from 'react';
import type { Context } from 'cordis';
import { type Diagnostic, type WorkspaceState, diagnostic } from '@energy8engine/contracts';
import type { ConnectionConfig, WebSocketLike } from './connection';
import type { FilesConfig } from './files';

/**
 * The browser's copy of the host's `WorkspaceState` (spec §8): which
 * projects the folder holds, which one is open, where its game is served.
 * Two sources, one store — `GET /api/workspace` once at boot, then every
 * `{type:'workspace'}` frame the host sends on `/ide` (its FIRST frame after
 * connecting, and one per change). A frame is always the newer fact: a boot
 * GET that resolves after a frame already landed does not overwrite it.
 *
 * Its own socket, for the reason `diagnostics.tsx`'s module doc gives:
 * `connection` filters strictly to `snapshot`/`diagnostics` by design, and
 * widening that filter from outside would blur the one guarantee the
 * protocol makes a reader — the frame TYPE is what tells them apart. Its
 * own fetch wrapper, after `files.ts`. Refusals (a 400/500 `{ diagnostics }`
 * from `open`, or a network that did not answer) are BOTH returned to the
 * caller and reported through `ctx.connection.report`, so the panel shows
 * them even when the caller does nothing with the return value.
 */
declare module 'cordis' {
  interface Context {
    workspace: WorkspaceClientService;
  }
}

export interface WorkspaceClientService {
  /** `null` before the first answer — absent is not "no project". */
  state(): WorkspaceState | null;
  /** `[]` on success; the host's refusals otherwise (also reported to `connection`). */
  open(id: string): Promise<Diagnostic[]>;
  subscribe(listener: () => void): () => void;
}

export type WorkspaceClientConfig = ConnectionConfig & FilesConfig;

export const name = 'workspace';
export const inject = ['connection'];

/** A 200 with the wrong shape is a failure like any other (see `game-composition`): one diagnostic, not `undefined.find` in a status item later. */
function isWorkspaceState(body: unknown): body is WorkspaceState {
  return (
    body !== null &&
    typeof body === 'object' &&
    Array.isArray((body as { projects?: unknown }).projects)
  );
}

const WRONG_SHAPE = 'the response has no "projects" array';

function ownDiagnostic(where: string, error: unknown): Diagnostic {
  return diagnostic(
    'error',
    'workspace',
    where,
    error instanceof Error ? error.message : String(error),
    'check that the host is running — `e8 dev` serves this route',
  );
}

export function apply(ctx: Context, config: WorkspaceClientConfig) {
  const listeners = new Set<() => void>();
  const fetchFn = config.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const socket = (config.socketFactory ?? ((url) => new WebSocket(url) as WebSocketLike))(
    config.url,
  );
  let state: WorkspaceState | null = null;

  function set(next: WorkspaceState) {
    state = next;
    for (const listener of listeners) listener();
  }

  function reportAll(diagnostics: Diagnostic[]): Diagnostic[] {
    for (const d of diagnostics) ctx.connection.report(d);
    return diagnostics;
  }

  const service: WorkspaceClientService = {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async open(id) {
      const where = '/api/workspace/open';
      let res: Response;
      try {
        res = await fetchFn(where, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        });
      } catch (error) {
        return reportAll([ownDiagnostic(where, error)]);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch (error) {
        return reportAll([ownDiagnostic(where, error)]);
      }
      if (res.ok) {
        if (!isWorkspaceState(body)) return reportAll([ownDiagnostic(where, WRONG_SHAPE)]);
        set(body);
        return [];
      }
      const carried = (body as { diagnostics?: unknown }).diagnostics;
      return reportAll(
        Array.isArray(carried)
          ? (carried as Diagnostic[])
          : [ownDiagnostic(where, `the host answered ${res.status} with no "diagnostics" array`)],
      );
    },
  };

  void (async () => {
    try {
      const res = await fetchFn('/api/workspace');
      if (!res.ok) throw new Error(`the host answered ${res.status}`);
      const body: unknown = await res.json();
      if (!isWorkspaceState(body)) throw new Error(WRONG_SHAPE);
      if (state === null) set(body);
    } catch (error) {
      ctx.connection.report(ownDiagnostic('/api/workspace', error));
    }
  })();

  socket.addEventListener('message', (event: { data: string }) => {
    let workspace: WorkspaceState;
    try {
      const parsed: unknown = JSON.parse(event.data);
      // Same guard as `connection`: `null`, an array or a primitive all
      // pass JSON.parse but would throw on `.type` outside this try.
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      if ((parsed as { type?: unknown }).type !== 'workspace') return;
      workspace = (parsed as { workspace: WorkspaceState }).workspace;
    } catch {
      return;
    }
    set(workspace);
  });

  ctx.effect(() => () => socket.close(), 'workspace-socket');
  ctx.provide('workspace', service);
}

/** Subscribe a component to the workspace. `null` before the first answer. */
export function useWorkspace(ctx: Context): WorkspaceState | null {
  return useSyncExternalStore(ctx.workspace.subscribe, ctx.workspace.state);
}
