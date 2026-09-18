/**
 * The flow node-kind registry (`ctx.flowNodes`) and the eleven built-in
 * kinds. Last-wins like the scene node-type registry, so a project plugin
 * (or a hot re-apply) can replace a built-in; subscribers hear every change.
 *
 * Built-ins reach the game's services LENIENTLY (`ctx.reflect.get(name,
 * false)`): a flow that names a service the composition does not provide
 * throws from `run`, and the interpreter turns that into a diagnostic on
 * the node rather than a crash of the page.
 */
import type { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, PresentationStep, Severity } from '@energy8engine/contracts';
import type { PlayService } from '@energy8engine/play-loop/runtime';
import type { ScenesService } from '@energy8engine/scenes';
import { createRegistry } from '@energy8engine/registry';
import type { EventsService } from './events';
import { evaluate, readPath } from './expr';

declare global {
  namespace Schemastery {
    interface Meta {
      /** IDE hint: render this string field as a picker of the named thing's ids (`'scene'`). */
      pick?: string;
    }
  }
}

export interface RunCtx {
  /** One object per run, shared by every concurrent branch of it (last writer wins). */
  vars: Record<string, unknown>;
  ctx: Context;
  /** Aborted by `stop()`/`replace()`; a `run` that waits must give up on it. */
  signal: AbortSignal;
  fetchFn: typeof fetch;
  /** A diagnostic on this node that does NOT end the branch (a bad `if` expression, say). */
  report(message: string, severity?: Severity): void;
  /** Whether any run of this document still has a live branch. */
  busy(): boolean;
  /** Resolves once no run has a live branch (at once when already idle). */
  idle(): Promise<void>;
}

export interface FlowNodeKind<P = Record<string, unknown>> {
  kind: string;
  schema: Schema<P>;
  /** Output port names in order; the first is what an edge with no `out` means. */
  outs: readonly string[];
  /** A trigger starts a run: the interpreter calls `arm` once per doc and never `run`. */
  trigger?: boolean;
  /** `false` opts `run` out of the interpreter's 30 s limit (a `wait` for a human, say). */
  timeout?: false;
  arm?(props: P, fire: (vars?: Record<string, unknown>) => void, ctx: RunCtx): () => void;
  run?(props: P, ctx: RunCtx): Promise<{ out: string; vars?: Record<string, unknown> }>;
}

export interface FlowNodesService {
  /** Last-wins; notifies. The disposer takes back only its own registration. */
  register(k: FlowNodeKind<any>): () => void;
  get(kind: string): FlowNodeKind | undefined;
  list(): FlowNodeKind[];
  subscribe(fn: () => void): () => void;
}

export function createFlowNodes(): FlowNodesService {
  const registry = createRegistry<FlowNodeKind>({ policy: 'last-wins' });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  return {
    register(k) {
      const off = registry.add(k.kind, k);
      notify();
      return () => {
        off();
        notify();
      };
    },
    get: (kind) => registry.get(kind),
    list: () => registry.keys().map((k) => registry.get(k)!),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const service = <T>(ctx: Context, name: string): T => {
  const s = ctx.reflect.get(name, false) as T | undefined;
  if (!s) throw new Error(`no '${name}' service in this composition`);
  return s;
};

/** A prop value: a `$path` string reads a var, anything else is the literal. */
const resolve = (value: unknown, vars: Record<string, unknown>) =>
  typeof value === 'string' && value.startsWith('$') ? readPath(value, vars) : value;

const none = Schema.object({});

interface MechanicsLike {
  present(stage: string, data: Record<string, unknown>): { plan: PresentationStep[]; diagnostics: Diagnostic[] };
}

const boot: FlowNodeKind = {
  kind: 'boot',
  schema: none,
  outs: ['next'],
  trigger: true,
  arm(_p, fire) {
    queueMicrotask(fire);
    return () => {};
  },
};

const on: FlowNodeKind<{ event: string; busy: 'ignore' | 'queue' }> = {
  kind: 'on',
  schema: Schema.object({
    event: Schema.string().required().description('event name'),
    busy: Schema.union(['ignore', 'queue'])
      .default('ignore')
      .description('a fire while a run is live: drop it, or fire once after the runs drain'),
  }),
  outs: ['next'],
  trigger: true,
  arm(p, fire, { ctx, busy, idle }) {
    let queued: Record<string, unknown> | undefined;
    // Fires the queued payload once the runs drain; a run that slipped in
    // between `idle` resolving and this running means one more wait.
    const drain = (): void =>
      void idle().then(() => {
        if (busy()) return drain();
        const vars = queued;
        queued = undefined;
        fire(vars);
      });
    return service<EventsService>(ctx, 'events').on(p.event, (event) => {
      if (!busy()) return fire({ event });
      if (p.busy !== 'queue') return;
      if (queued === undefined) drain();
      queued = { event }; // coalesce: the latest payload wins
    });
  },
};

const spin: FlowNodeKind = {
  kind: 'spin',
  schema: none,
  outs: ['result', 'failed'],
  async run(_p, { ctx, fetchFn }) {
    try {
      const res = await fetchFn('/api/spin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(`POST /api/spin → ${res.status}`);
      const result: unknown = await res.json();
      // ponytail: the log's `plan` stays [] here — `present` runs later and keeps its plan in vars.plan only.
      (ctx.reflect.get('play', false) as PlayService | undefined)?.record({ request: {}, result, plan: [] });
      return { out: 'result', vars: { result } };
    } catch (e) {
      return { out: 'failed', vars: { error: e instanceof Error ? e.message : String(e) } };
    }
  },
};

const present: FlowNodeKind = {
  kind: 'present',
  schema: none,
  outs: ['next', 'failed'],
  async run(_p, { ctx, vars }) {
    const result = vars.result as { stage: string; data: Record<string, unknown> } | undefined;
    if (!result) throw new Error('vars.result is missing — run `spin` first');
    const { plan, diagnostics } = service<MechanicsLike>(ctx, 'mechanics').present(result.stage, result.data);
    const problems = diagnostics.length
      ? diagnostics
      : await service<PlayService>(ctx, 'play').execute(plan, ctx.reflect.get('board', false));
    if (problems.length) return { out: 'failed', vars: { plan, error: problems.map((d) => d.message).join('; ') } };
    return { out: 'next', vars: { plan } };
  },
};

const show: FlowNodeKind<{ scene: string; transition?: string }> = {
  kind: 'show',
  schema: Schema.object({
    scene: Schema.string().required().extra('pick', 'scene').description('scene id'),
    transition: Schema.string().description('transition id; the scene default when empty'),
  }),
  outs: ['next'],
  async run(p, { ctx }) {
    await service<ScenesService>(ctx, 'scenes').show(p.scene, { transition: p.transition });
    return { out: 'next' };
  },
};

const hide: FlowNodeKind<{ scene: string }> = {
  kind: 'hide',
  schema: Schema.object({ scene: Schema.string().required().extra('pick', 'scene').description('scene id') }),
  outs: ['next'],
  async run(p, { ctx }) {
    await service<ScenesService>(ctx, 'scenes').hide(p.scene);
    return { out: 'next' };
  },
};

const wait: FlowNodeKind<{ ms?: number; event?: string }> = {
  kind: 'wait',
  schema: Schema.object({
    ms: Schema.number().description('milliseconds'),
    event: Schema.string().description('event name'),
  }),
  outs: ['next'],
  timeout: false,
  run(p, { ctx, signal }) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const offs: (() => void)[] = [];
      const settle = (fn: () => void) => () => {
        offs.forEach((off) => off());
        fn();
      };
      const done = settle(() => resolve({ out: 'next' }));
      const abort = settle(() => reject(signal.reason));
      // Events first: a missing service throws before any timer is set.
      if (p.event !== undefined) offs.push(service<EventsService>(ctx, 'events').on(p.event, done));
      if (p.ms !== undefined) {
        const t = setTimeout(done, p.ms);
        offs.push(() => clearTimeout(t));
      }
      signal.addEventListener('abort', abort);
      offs.push(() => signal.removeEventListener('abort', abort));
    });
  },
};

const ifKind: FlowNodeKind<{ when: string }> = {
  kind: 'if',
  schema: Schema.object({ when: Schema.string().required().description('condition over vars') }),
  outs: ['true', 'false'],
  async run(p, { vars, report }) {
    try {
      return { out: String(evaluate(p.when, vars)) };
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      report(`bad expression '${p.when}': ${e.message}`);
      return { out: 'false' };
    }
  },
};

const set: FlowNodeKind<{ name: string; value?: unknown }> = {
  kind: 'set',
  schema: Schema.object({
    name: Schema.string().required().description('var name'),
    value: Schema.any().description('literal, or `$path` to read a var'),
  }),
  outs: ['next'],
  async run(p, { vars }) {
    return { out: 'next', vars: { [p.name]: resolve(p.value, vars) } };
  },
};

const emit: FlowNodeKind<{ event: string; payload?: unknown }> = {
  kind: 'emit',
  schema: Schema.object({
    event: Schema.string().required().description('event name'),
    payload: Schema.any().description('literal, or `$path` to read a var'),
  }),
  outs: ['next'],
  async run(p, { ctx, vars }) {
    service<EventsService>(ctx, 'events').emit(p.event, resolve(p.payload, vars));
    return { out: 'next' };
  },
};

/** Special-cased by the interpreter: passes once every incoming edge has arrived this run. */
const merge: FlowNodeKind = { kind: 'merge', schema: none, outs: ['next'] };

export const BUILTIN_KINDS: FlowNodeKind<any>[] = [boot, on, spin, present, show, hide, wait, ifKind, set, emit, merge];
