import { useEffect, useState } from 'react';
import type { Context } from 'cordis';
import {
  diagnostic,
  type Diagnostic,
  type FlowDoc,
  type FlowKindInfo,
  type FlowResponse,
  type FlowTraceEntry,
} from '@energy8engine/contracts';
import type { ConnectionConfig } from './connection';
import { valueStep } from './history';
import { FlowDocument } from '../shell/FlowDocument';
import { FlowPalette } from '../shell/FlowPalette';
import { FlowProperties } from '../shell/FlowProperties';

/**
 * The flow document, client half — shaped after `scenes.tsx`: a plain
 * service with `subscribe`, a hook that bridges it into React, failures
 * as diagnostics and never a throw. One document only (`flows/flow.yml`
 * on the host, `GET`/`PUT /api/flow`), so there is no id to key a set by
 * the way `scenes` keys its `SceneDoc[]` — `doc()` is one value, `null`
 * until a project has a flow.yml at all.
 *
 * Frames arrive through `ctx.connection.onFrame`. The boot GET is the
 * snapshot; a `flow`/`flow-kinds` frame (or a write's answer) that lands
 * before it is the newer fact and wins — same `*Live` guard `scenes`
 * uses.
 *
 * `flow-trace` entries are the game's own run log, relayed down: they
 * APPEND rather than replace, capped at 500 so a long play session does
 * not grow the array without bound. An entry of a DIFFERENT run than the
 * one being traced drops the older run's entries first — the trace is
 * "this run's steps", not a history across runs. Different, not higher:
 * the interpreter's counter restarts at 1 on every `replace` (a node
 * drag, a preview reload), and runs never interleave (`on` refuses or
 * queues while a run is live).
 *
 * `select` is state only: unlike `scenes`, there is no iframe canvas to
 * tell — the canvas reads `selected()` straight off this service. A node
 * selected is what the Flow tab's right sidebar (`sideRight: 'flow'`)
 * has to show; it is independent of the `scenes` and `symbols` ones,
 * each shown beside its own tab.
 *
 * `requestAdd`/`onAddRequest` bridge the palette's click-add (`shell.sidebar`
 * `flow`) to the mounted canvas (`shell.document` `flow`): the two are
 * separate subtrees under `Shell`, so a click can't reach the canvas'
 * `screenToFlowPosition`/pane box through props the way it could when both
 * lived in one component. The document registers its handler while its
 * canvas is mounted; the palette only ever shows once that document is the
 * active tab, so a request never arrives with nothing listening.
 */
declare module 'cordis' {
  interface Context {
    flow: FlowClientService;
  }
}

export interface FlowClientService {
  doc(): FlowDoc | null;
  diagnostics(): readonly Diagnostic[];
  kinds(): readonly FlowKindInfo[];
  trace(): readonly FlowTraceEntry[];
  selected(): string | null;
  select(id: string | null): void;
  /** `PUT /api/flow`; `[]` on success, the host's refusal (or one transport diagnostic) otherwise. */
  update(doc: FlowDoc): Promise<Diagnostic[]>;
  subscribe(listener: () => void): () => void;
  /** The palette's click-add: forwarded to the mounted canvas' handler, if any. */
  requestAdd(kind: string): void;
  /** Registers the canvas' click-add handler; returns the disposer. */
  onAddRequest(handler: (kind: string) => void): () => void;
}

export interface FlowConfig extends ConnectionConfig {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Where the host is. Defaults to the page origin, which the IDE's own vite proxies to it. */
  origin?: string;
}

export const name = 'flow';
// `scenes` and `files` are the inspector's (`FlowProperties`): a `scene`
// field offers the scene ids, an `asset` field the project's files.
export const inject = ['slots', 'connection', 'shell', 'scenes', 'files', 'history'];

/** Entries kept in the trace, most-recent run only. */
const TRACE_CAP = 500;

function ownDiagnostic(where: string, message: string): Diagnostic {
  return diagnostic(
    'error',
    'flow',
    where,
    message,
    'check that the host is running — `e8 dev` serves this route',
  );
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function apply(ctx: Context, config: FlowConfig) {
  const listeners = new Set<() => void>();
  const fetchFn = config.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const origin = config.origin ?? '';

  let doc: FlowDoc | null = null;
  let diagnostics: Diagnostic[] = [];
  let kinds: FlowKindInfo[] = [];
  let trace: FlowTraceEntry[] = [];
  let traceRun: number | null = null;
  let selected: string | null = null;
  // Whether a frame or a write's answer has filled each half — the boot
  // GET does not overwrite what is newer than it.
  let docLive = false;
  let kindsLive = false;
  // The mounted canvas' click-add handler — see the module doc comment.
  let addHandler: ((kind: string) => void) | null = null;
  // Writes currently in flight — while any is pending, a recorded step's
  // `read()` answers `undefined` rather than the current (possibly stale)
  // `doc`, so an undo/redo racing a write it doesn't know about refuses as
  // diverged instead of overwriting it.
  let pending = 0;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  function applyFlow(nextDoc: FlowDoc | null, next: Diagnostic[]) {
    doc = nextDoc;
    diagnostics = next;
    docLive = true;
  }
  function applyKinds(next: FlowKindInfo[]) {
    kinds = next;
    kindsLive = true;
  }
  // A fresh array per frame: subscribers key their work on `trace()`'s
  // identity, and an in-place push would look like nothing changed.
  function appendTrace(entries: readonly FlowTraceEntry[]) {
    let next = trace.slice();
    for (const entry of entries) {
      if (entry.run !== traceRun) {
        next = [];
        traceRun = entry.run;
      }
      next.push(entry);
    }
    trace = next.length > TRACE_CAP ? next.slice(next.length - TRACE_CAP) : next;
  }

  const service: FlowClientService = {
    doc: () => doc,
    diagnostics: () => diagnostics,
    kinds: () => kinds,
    trace: () => trace,
    selected: () => selected,
    select(id) {
      if (id === selected) return;
      selected = id;
      notify();
    },
    async update(next) {
      // Captured before the PUT — `null` until a project has a flow.yml at
      // all, so a write that CREATES it has no "before" to go back to
      // (undoing it would need a delete, out of scope, design doc §3).
      // ponytail: captured at CALL time, not at this write's own turn the
      // way `symbols.tsx` captures it — two overlapping writes can both
      // capture the same `before`, so undoing the later-recorded step
      // reverts both and the next undo then refuses (diverged). Upgrade
      // path: queue writes like Symbols.
      const before = doc;
      pending++;
      try {
        let res: Response;
        let answer: Partial<FlowResponse> & { diagnostics?: unknown };
        try {
          res = await fetchFn(`${origin}/api/flow`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next),
          });
          answer = await res.json();
        } catch (error) {
          const own = ownDiagnostic('/api/flow', `PUT failed: ${reason(error)}`);
          ctx.connection.report(own);
          return [own];
        }
        const host = Array.isArray(answer.diagnostics) ? (answer.diagnostics as Diagnostic[]) : [];
        if (!res.ok) {
          if (host.length) return host;
          const own = ownDiagnostic('/api/flow', `PUT failed: the host answered ${res.status}`);
          ctx.connection.report(own);
          return [own];
        }
        applyFlow(answer.doc ?? null, host);
        if (Array.isArray(answer.kinds)) applyKinds(answer.kinds);
        // Recorded on every ACCEPTED write, warnings included — `host` here
        // is the host's own diagnostics on a 2xx (e.g. "no incoming edge"),
        // not a refusal; `!res.ok` above already sent refusals back.
        if (before !== null) {
          ctx.history.record(
            'flow',
            valueStep({
              label: 'flow',
              before,
              after: next,
              read: () => doc ?? undefined,
              // `true` while another write is in flight — see `pending`'s own comment.
              pending: () => pending > 0,
              write: async (value) => ({
                error: (await service.update(value))[0]?.message ?? null,
              }),
              history: ctx.history,
            }),
          );
        }
        notify();
        return [];
      } finally {
        pending--;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestAdd(kind) {
      addHandler?.(kind);
    },
    onAddRequest(handler) {
      addHandler = handler;
      return () => {
        if (addHandler === handler) addHandler = null;
      };
    },
  };

  void (async () => {
    try {
      const res = await fetchFn(`${origin}/api/flow`);
      if (!res.ok) throw new Error(`the host answered ${res.status}`);
      const body = (await res.json()) as Partial<FlowResponse>;
      if (!docLive)
        applyFlow(body.doc ?? null, Array.isArray(body.diagnostics) ? body.diagnostics : []);
      if (!kindsLive && Array.isArray(body.kinds)) applyKinds(body.kinds);
    } catch (error) {
      if (docLive) return;
      diagnostics = [ownDiagnostic('/api/flow', `could not read the flow: ${reason(error)}`)];
    }
    notify();
  })();

  ctx.effect(
    () =>
      ctx.connection.onFrame((frame) => {
        if (frame.type === 'flow') applyFlow(frame.doc, frame.diagnostics);
        else if (frame.type === 'flow-kinds') applyKinds(frame.kinds);
        else if (frame.type === 'flow-trace') appendTrace(frame.entries);
        else return;
        notify();
      }),
    'flow:frames',
  );

  ctx.effect(
    () =>
      ctx.slots.register({
        name: 'shell.activity',
        key: 'flow',
        title: 'Flow',
        icon: 'git-branch',
        order: 36,
        opens: 'document',
      }),
    'flow:activity',
  );

  ctx.effect(
    () =>
      ctx.slots.register(
        {
          name: 'shell.document',
          key: 'flow',
          title: 'Flow',
          closable: false,
          sidebar: 'flow',
          sideRight: 'flow',
        },
        FlowDocument,
      ),
    'flow:document',
  );

  ctx.effect(
    () => ctx.history.scope((key) => (key === 'flow' ? ['flow'] : undefined)),
    'flow:history-scope',
  );

  ctx.effect(
    () =>
      ctx.slots.register(
        { name: 'shell.sidebar', key: 'flow', title: 'Nodes' },
        function FlowPaletteView() {
          return <FlowPalette ctx={ctx} />;
        },
      ),
    'flow:sidebar',
  );

  ctx.effect(
    () =>
      ctx.slots.register(
        { name: 'shell.sideRight', key: 'flow', title: 'Properties' },
        function FlowPropertiesView() {
          return <FlowProperties ctx={ctx} />;
        },
      ),
    'flow:side-right',
  );

  ctx.effect(
    () => service.subscribe(() => ctx.shell.setSideRight('flow', selected !== null)),
    'flow:side-right-shown',
  );

  ctx.provide('flow', service);
}

/** Subscribe a component to the flow document, its diagnostics, kinds, trace and selection. */
export function useFlow(ctx: Context): {
  doc: FlowDoc | null;
  diagnostics: readonly Diagnostic[];
  kinds: readonly FlowKindInfo[];
  trace: readonly FlowTraceEntry[];
  selected: string | null;
} {
  const read = () => ({
    doc: ctx.flow.doc(),
    diagnostics: ctx.flow.diagnostics(),
    kinds: ctx.flow.kinds(),
    trace: ctx.flow.trace(),
    selected: ctx.flow.selected(),
  });
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    return ctx.flow.subscribe(() => setState(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  return state;
}
