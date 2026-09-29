/**
 * A postMessage RPC client for the scene canvas iframe. Port of `IdeClient`
 * from `apps/ide/src/rpc.ts` (feat/slot-ide-ir): `seq`/`pending`/`evtHandlers`/
 * `onMessage` kept as-is; `RemoteSceneHandle` and the flow types dropped —
 * this module owns only the wire protocol, not a SceneDoc mirror.
 *
 * Wire frames: `{ type: 'e8:ide:req', id, method, params }` (out),
 * `{ type: 'e8:ide:res', id, ok, result|error }` (in),
 * `{ type: 'e8:ide:evt', event, payload }` (in).
 */

const TIMEOUT_MS = 5000;

/**
 * The canvas' `edit` event: one node's changed props, rounded by the tab
 * before they are written. `variant: 'portrait'` says the canvas was in a
 * portrait safe rect — the edit belongs in `portrait.nodes[node]`, not in
 * the node's own props (spec §7). Absent or `null`: the node itself.
 * `nudge`: an arrow key moved it, not a pointer gesture — the tab writes a
 * run of these once, after the last.
 */
export interface EditPayload {
  node: string;
  props: Record<string, unknown>;
  variant?: 'portrait' | null;
  nudge?: boolean;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

/** The `window`/`iframe.contentWindow` surface this module needs — injectable for tests. */
export interface RpcWindow {
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
}

/** The minimal shape `attach` needs from `contentWindow` — real `Window` satisfies it, so do test fakes. */
export interface Postable {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface CanvasRpc {
  /**
   * `target.contentWindow` is where requests post to and what a frame's
   * `source` must be; `origin` gates both directions ('*' in tests). The
   * TARGET is held and its `contentWindow` read on every use: a browser
   * keeps one WindowProxy across a navigation (a `src` change — the
   * viewport preset's `safeBottom`), jsdom does not, and the element is
   * the stable handle either way.
   */
  attach(target: { contentWindow: Postable | null }, origin: string): void;
  /** Rejects when the canvas has not answered within `opts.timeout` ms (5 s by default) — a reel lab spin can take longer. */
  call<T = unknown>(method: string, params?: unknown, opts?: { timeout?: number }): Promise<T>;
  on(event: string, handler: (payload: unknown) => void): () => void;
  dispose(): void;
}

export function createCanvasRpc(win: RpcWindow = window): CanvasRpc {
  let seq = 0;
  const pending = new Map<number, Pending>();
  const evtHandlers = new Map<string, Set<(payload: unknown) => void>>();
  let target: { contentWindow: Postable | null } | null = null;
  let origin = '*';

  const onMessage = (e: MessageEvent): void => {
    // Before attach() there is no window to legitimately claim as the source: every frame is rejected.
    if (!target || (e.source as unknown) !== target.contentWindow) return;
    if (origin !== '*' && e.origin !== origin) return;
    const data = e.data as {
      type?: string;
      id?: number;
      ok?: boolean;
      result?: unknown;
      error?: string;
      event?: string;
      payload?: unknown;
    };
    if (data?.type === 'e8:ide:res' && typeof data.id === 'number') {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
    } else if (data?.type === 'e8:ide:evt' && data.event) {
      evtHandlers.get(data.event)?.forEach((h) => h(data.payload));
    }
  };

  win.addEventListener('message', onMessage);

  return {
    attach(next, attachOrigin) {
      // A second attach (a new preview iframe) orphans anything still
      // waiting on the old one — reject now rather than let it time out.
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(new Error('canvas was replaced'));
      }
      target = next;
      origin = attachOrigin;
    },

    call<T = unknown>(method: string, params?: unknown, opts?: { timeout?: number }): Promise<T> {
      const win = target?.contentWindow;
      if (!win) return Promise.reject(new Error('canvas not attached'));
      const id = ++seq;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`canvas did not answer "${method}"`));
          }
        }, opts?.timeout ?? TIMEOUT_MS);
        pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v as T);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        win.postMessage({ type: 'e8:ide:req', id, method, params }, origin);
      });
    },

    on(event, handler) {
      (evtHandlers.get(event) ?? evtHandlers.set(event, new Set()).get(event)!).add(handler);
      return () => evtHandlers.get(event)?.delete(handler);
    },

    dispose() {
      win.removeEventListener('message', onMessage);
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(new Error('canvas-rpc disposed'));
      }
    },
  };
}
