import { useEffect, useState } from 'react';
import type { Context } from 'cordis';
import {
  diagnostic,
  type Diagnostic,
  type SymbolState,
  type SymbolsDoc,
  type SymbolsResponse,
} from '@energy8engine/contracts';
import type { ConnectionConfig } from './connection';
import { SymbolsDocument } from '../shell/SymbolsDocument';
import { SymbolsProperties } from '../shell/SymbolsProperties';

/**
 * The symbols document (`symbols.yml`), client half — `flow.tsx` with
 * `symbols` in place of `flow`: one document (`GET`/`PUT /api/symbols`),
 * `null` until the project has the file, its diagnostics, and `known` —
 * the reel board's registered symbol ids/names (`game/spec.json`), which
 * only the GET and a write's answer carry (a `symbols` frame has the doc
 * and diagnostics alone). The boot GET is the snapshot; a frame or a
 * write's answer that lands before it is the newer fact and wins.
 *
 * `PUT` sends an envelope, `{ doc }` — the host refuses a bare document.
 *
 * `select` is state only, as flow's: the document's canvas reads
 * `selected()` off this service. The three inspectors share the right
 * sidebar, so the selections are mutually exclusive — same rule as flow
 * vs scenes, and placed the same way: this plugin (the newest) clears the
 * other two when it selects, and clears itself when either of them
 * selects. Each side only ever clears the OTHER, and only when its own
 * selection is non-null, so nothing ping-pongs. (Neither `flow` nor
 * `scenes` learns of `symbols`: this plugin injects both, and an inject
 * the other way would never resolve.)
 */
declare module 'cordis' {
  interface Context {
    symbols: SymbolsClientService;
  }
}

export interface SymbolSelection {
  id: string;
  state: SymbolState;
}

export interface SymbolsClientService {
  doc(): SymbolsDoc | null;
  known(): readonly { id: string; name: string }[];
  diagnostics(): readonly Diagnostic[];
  selected(): SymbolSelection | null;
  select(sel: SymbolSelection | null): void;
  /** `PUT /api/symbols` `{ doc }`; `[]` on success, the host's refusal (or one transport diagnostic) otherwise. */
  update(doc: SymbolsDoc): Promise<Diagnostic[]>;
  subscribe(listener: () => void): () => void;
}

export interface SymbolsConfig extends ConnectionConfig {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Where the host is. Defaults to the page origin, which the IDE's own vite proxies to it. */
  origin?: string;
}

export const name = 'symbols';
// `scenes`: the deselect, the node types (state types, `hasLoop`) and the
// `scene`/`node` pickers; `flow`: the deselect; `files`/`assetNodeTypes`:
// the document's drop and the inspector's `asset` picker.
export const inject = ['slots', 'connection', 'shell', 'scenes', 'flow', 'files', 'assetNodeTypes'];

function ownDiagnostic(where: string, message: string): Diagnostic {
  return diagnostic(
    'error',
    'symbols',
    where,
    message,
    'check that the host is running — `e8 dev` serves this route',
  );
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const same = (a: SymbolSelection | null, b: SymbolSelection | null) =>
  a === b || (a !== null && b !== null && a.id === b.id && a.state === b.state);

export function apply(ctx: Context, config: SymbolsConfig) {
  const listeners = new Set<() => void>();
  const fetchFn = config.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const origin = config.origin ?? '';

  let doc: SymbolsDoc | null = null;
  let known: { id: string; name: string }[] = [];
  let diagnostics: Diagnostic[] = [];
  let selected: SymbolSelection | null = null;
  // Whether a frame or a write's answer has filled each half — the boot
  // GET does not overwrite what is newer than it.
  let docLive = false;
  let knownLive = false;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  function applyDoc(nextDoc: SymbolsDoc | null, next: Diagnostic[]) {
    doc = nextDoc;
    diagnostics = next;
    docLive = true;
  }
  function applyKnown(next: { id: string; name: string }[]) {
    known = next;
    knownLive = true;
  }

  const service: SymbolsClientService = {
    doc: () => doc,
    known: () => known,
    diagnostics: () => diagnostics,
    selected: () => selected,
    select(sel) {
      if (same(sel, selected)) return;
      selected = sel;
      notify();
      if (sel !== null) {
        ctx.scenes.select(null);
        ctx.flow.select(null);
      }
    },
    async update(next) {
      let res: Response;
      let answer: Partial<SymbolsResponse> & { diagnostics?: unknown };
      try {
        res = await fetchFn(`${origin}/api/symbols`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ doc: next }),
        });
        answer = await res.json();
      } catch (error) {
        const own = ownDiagnostic('/api/symbols', `PUT failed: ${reason(error)}`);
        ctx.connection.report(own);
        return [own];
      }
      const host = Array.isArray(answer.diagnostics) ? (answer.diagnostics as Diagnostic[]) : [];
      if (!res.ok) {
        if (host.length) return host;
        const own = ownDiagnostic('/api/symbols', `PUT failed: the host answered ${res.status}`);
        ctx.connection.report(own);
        return [own];
      }
      applyDoc(answer.doc ?? null, host);
      if (Array.isArray(answer.known)) applyKnown(answer.known);
      notify();
      return [];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  void (async () => {
    try {
      const res = await fetchFn(`${origin}/api/symbols`);
      if (!res.ok) throw new Error(`the host answered ${res.status}`);
      const body = (await res.json()) as Partial<SymbolsResponse>;
      if (!docLive)
        applyDoc(body.doc ?? null, Array.isArray(body.diagnostics) ? body.diagnostics : []);
      if (!knownLive && Array.isArray(body.known)) applyKnown(body.known);
    } catch (error) {
      if (docLive) return;
      diagnostics = [ownDiagnostic('/api/symbols', `could not read the symbols: ${reason(error)}`)];
    }
    notify();
  })();

  ctx.effect(
    () =>
      ctx.connection.onFrame((frame) => {
        if (frame.type !== 'symbols') return;
        applyDoc(frame.doc, frame.diagnostics);
        notify();
      }),
    'symbols:frames',
  );

  ctx.effect(
    () =>
      ctx.slots.register({
        name: 'shell.activity',
        key: 'symbols',
        title: 'Symbols',
        icon: 'symbol-misc',
        order: 37,
        opens: 'document',
      }),
    'symbols:activity',
  );

  ctx.effect(
    () =>
      ctx.slots.register(
        { name: 'shell.document', key: 'symbols', title: 'Symbols', closable: false },
        SymbolsDocument,
      ),
    'symbols:document',
  );

  ctx.effect(
    () =>
      ctx.slots.register(
        { name: 'shell.sideRight', key: 'symbols', title: 'Properties' },
        function SymbolsPropertiesView() {
          return <SymbolsProperties ctx={ctx} />;
        },
      ),
    'symbols:side-right',
  );

  ctx.effect(
    () =>
      service.subscribe(() => {
        const shown = ctx.shell.sideRight() === 'symbols';
        if (selected !== null && !shown) ctx.shell.showSideRight('symbols');
        else if (selected === null && shown) ctx.shell.hideSideRight();
      }),
    'symbols:side-right-shown',
  );

  ctx.effect(
    () =>
      ctx.scenes.subscribe(() => {
        if (selected !== null && ctx.scenes.selected() !== null) service.select(null);
      }),
    'symbols:scenes-deselect',
  );

  ctx.effect(
    () =>
      ctx.flow.subscribe(() => {
        if (selected !== null && ctx.flow.selected() !== null) service.select(null);
      }),
    'symbols:flow-deselect',
  );

  ctx.provide('symbols', service);
}

/** Subscribe a component to the symbols document, `known`, the diagnostics and the selection. */
export function useSymbols(ctx: Context): {
  doc: SymbolsDoc | null;
  known: readonly { id: string; name: string }[];
  diagnostics: readonly Diagnostic[];
  selected: SymbolSelection | null;
} {
  const read = () => ({
    doc: ctx.symbols.doc(),
    known: ctx.symbols.known(),
    diagnostics: ctx.symbols.diagnostics(),
    selected: ctx.symbols.selected(),
  });
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    return ctx.symbols.subscribe(() => setState(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  return state;
}
