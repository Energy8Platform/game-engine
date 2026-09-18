/**
 * Runtime half of `flow` — the `flow1` row in `e8-base`. See `./index`'s
 * module doc for what the package underneath it is.
 *
 * **`inject: []` — deliberately, unlike `scenes`'s `['renderer']`.** A flow
 * document can touch `scenes`/`mechanics`/`play`/`board` (`./kinds.ts`'s
 * built-ins reach every one of them), but only inside a node's own `run`,
 * looked up leniently (`ctx.reflect.get(name, false)`) at the moment that
 * node fires — never at composition time. So this row has nothing it must
 * wait for: it composes first if a project lists it first, last if listed
 * last, and a flow that names a service nothing provided is a diagnostic on
 * the node that tried to use it, not a row stuck PENDING forever.
 *
 * Like `scenes`, this row pulls its own document: on apply it GETs
 * `/api/flow` (the host route the plan's later host task adds) and calls
 * `flow.replace()` with what comes back. A failed GET is one error
 * diagnostic — the row still applies, running nothing, rather than failing
 * the whole composition over a route that is down.
 */
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type FlowResponse } from '@energy8engine/contracts';
import type { DiagnosticsService } from '@energy8engine/diagnostics';
import { createEvents } from './events';
import { createFlow, type FlowService } from './interpreter';
import { BUILTIN_KINDS, createFlowNodes, type FlowNodesService } from './kinds';

declare module 'cordis' {
  interface Context {
    // Not `events` — that key is cordis's OWN built-in pub/sub
    // (`node_modules/cordis/lib/context.d.ts`'s `events: EventsService`,
    // a different `EventsService` than `./events`'s). Redeclaring it here
    // with this package's type is a TS2717 error (interface merging
    // requires identical types), and re-using the slot would shadow
    // cordis's own event bus at the type level while doing nothing to it
    // at runtime — `ctx.provide('events', …)`/`ctx.reflect.get('events')`
    // below still work, untyped, exactly as `kinds.ts`'s `service()`
    // helper already reads them (see its own `reflect.get` calls).
    flowNodes: FlowNodesService;
    flow: FlowService;
  }
}

export interface FlowConfig {
  /** Tests only; the page's `fetch` otherwise. */
  fetchFn?: typeof fetch;
}

export const name = 'flow';
export const inject = [];

export function apply(ctx: Context, config: FlowConfig = {}): void {
  const report = (d: Diagnostic) =>
    (ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.report(d);

  const events = createEvents();
  ctx.provide('events', events);

  const flowNodes = createFlowNodes();
  for (const k of BUILTIN_KINDS) flowNodes.register(k);
  ctx.provide('flowNodes', flowNodes);

  const fetchFn = config.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const flow = createFlow({ kinds: flowNodes, ctx, report, fetchFn });

  // Same race, same fix, as `scenes/runtime.ts`'s own `replaced`/`alive`
  // pair — see that module's doc for the full argument. `ide-bridge`'s own
  // `flow` frame handler is the other thing that can call `replace` first.
  let replaced = false;
  let alive = true;
  const originalReplace = flow.replace;
  flow.replace = (doc) => {
    replaced = true;
    originalReplace(doc);
  };

  ctx.effect(
    () => () => {
      alive = false;
      flow.stop();
    },
    'flow:run',
  );
  ctx.provide('flow', flow);

  // `flow.ready` is this GET, the same device `scenes.ready` is: a reader
  // that needs the boot document (`useFlow`, later) awaits it instead of
  // polling `doc()`. A frame's earlier `replace` counts as ready even when
  // the GET then fails; nobody else awaiting it is fine too (the `catch`
  // below keeps a rejection from surfacing as unhandled).
  flow.ready = (async () => {
    try {
      const res = await fetchFn('/api/flow');
      if (!res.ok) throw new Error(`the host answered ${res.status}`);
      const body = (await res.json()) as Partial<FlowResponse>;
      if (!('doc' in body)) throw new Error('the response has no "doc"');
      // `doc: null` — nothing to run, and not an error: a project may
      // genuinely have no flow document yet. `ready` resolves either way.
      if (!replaced && alive && body.doc) flow.replace(body.doc);
    } catch (error) {
      if (!alive) return;
      const message = `could not read the flow document: ${error instanceof Error ? error.message : String(error)}`;
      report(diagnostic('error', 'flow', '/api/flow', message,
        'the host serves this route; the game runs no flow until it answers'));
      if (!replaced) throw new Error(message);
    }
  })();
  flow.ready.catch(() => {});
}
