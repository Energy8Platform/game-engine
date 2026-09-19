/**
 * The flow interpreter: arms a document's triggers, and runs a branch per
 * edge from wherever a node leaves. A run is a set of branches sharing one
 * `vars`; branches are fire-and-forget async functions interleaving on the
 * microtask queue, and nothing joins them except `merge`, which counts
 * arrivals per run and passes once every incoming edge has arrived.
 *
 * A node that throws, times out, has no kind, or fails its schema is a
 * diagnostic (`plugin: 'flow'`, `where: <node id>`) and the end of that
 * branch — the trace shows the node entered and never left.
 */
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type FlowDoc, type FlowEdge, type FlowNode, type FlowTraceEntry } from '@energy8engine/contracts';
import { inEdges, outEdges, validateFlow } from './graph';
import type { FlowNodeKind, FlowNodesService, RunCtx } from './kinds';

export interface CreateFlowOptions {
  kinds: FlowNodesService;
  ctx: Context;
  report(d: Diagnostic): void;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** A `run` past this is reported and abandoned. */
  timeoutMs?: number;
}

export interface FlowService {
  /**
   * Validates, stops the current run, arms the triggers. Errors report and
   * start nothing; the doc is kept either way. A doc equal to the armed one
   * except for `ui` only updates `doc()` — nothing stops or restarts (the
   * host re-broadcasts the document on every node drag). `null` stops and
   * clears the doc.
   */
  replace(doc: FlowDoc | null): void;
  doc(): FlowDoc | null;
  /** The last 500 entries since the last `replace`. */
  trace(): readonly FlowTraceEntry[];
  onTrace(fn: (e: FlowTraceEntry) => void): () => void;
  /** Whether any run of the current document still has a live branch. */
  busy(): boolean;
  /** Resolved here; the runtime row swaps in its boot fetch. */
  ready: Promise<void>;
  /** Aborts every in-flight branch and disarms the triggers; the doc and the trace stay. */
  stop(): void;
}

const TRACE_LIMIT = 500;

/** `v` with every object's keys sorted, so two docs that differ only in key order stringify the same. */
const stable = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
        )
      : v;
/** What a run depends on: the nodes without their `ui`, and the edges. */
const shape = (doc: FlowDoc) =>
  JSON.stringify(stable({ nodes: doc.nodes.map(({ ui: _ui, ...n }) => n), edges: doc.edges }));

export function createFlow(o: CreateFlowOptions): FlowService {
  const { kinds, report } = o;
  const fetchFn = o.fetchFn ?? fetch;
  const now = o.now ?? Date.now;
  const timeoutMs = o.timeoutMs ?? 30_000;

  /** Everything `stop()` throws away: the abort signal, the live-branch count, whoever waits for idle. */
  interface Epoch {
    controller: AbortController;
    live: number;
    idlers: (() => void)[];
  }
  const fresh = (): Epoch => ({ controller: new AbortController(), live: 0, idlers: [] });

  let current: FlowDoc | null = null;
  /** The last `replace` armed its triggers without an error, and no `stop()` came since. */
  let armed = false;
  let epoch = fresh();
  let disposers: (() => void)[] = [];
  let runNo = 0;
  const trace: FlowTraceEntry[] = [];
  const listeners = new Set<(e: FlowTraceEntry) => void>();

  const record = (run: number, node: string, out: string | null) => {
    const entry = { run, node, out, at: now() };
    trace.push(entry);
    if (trace.length > TRACE_LIMIT) trace.shift();
    for (const fn of listeners) {
      try {
        fn(entry);
      } catch {
        // a listener's bug is not the branch's
      }
    }
  };
  const fail = (node: FlowNode, message: string, severity: Diagnostic['severity'] = 'error') =>
    report(diagnostic(severity, 'flow', node.id, message));

  interface Run {
    no: number;
    vars: Record<string, unknown>;
    epoch: Epoch;
    /** `merge` arrivals this run, by node: the edges that have landed since its last pass. */
    arrived: Map<string, Set<FlowEdge>>;
  }

  const runCtx = (run: Run, node: FlowNode): RunCtx => ({
    vars: run.vars,
    ctx: o.ctx,
    signal: run.epoch.controller.signal,
    fetchFn,
    report: (message, severity) => fail(node, message, severity),
    busy: () => run.epoch.live > 0,
    idle: () => (run.epoch.live > 0 ? new Promise((resolve) => run.epoch.idlers.push(resolve)) : Promise.resolve()),
  });

  const branch = async (doc: FlowDoc, run: Run, node: FlowNode, via: FlowEdge): Promise<void> => {
    run.epoch.live++;
    try {
      await step(doc, run, node, via);
    } finally {
      if (--run.epoch.live === 0) run.epoch.idlers.splice(0).forEach((fn) => fn());
    }
  };

  const step = async (doc: FlowDoc, run: Run, node: FlowNode, via: FlowEdge): Promise<void> => {
    const { signal } = run.epoch.controller;
    record(run.no, node.id, null);
    const kind = kinds.get(node.kind);
    if (!kind) return fail(node, `unknown kind '${node.kind}'`);
    if (kind.trigger) return; // a branch reaching a trigger ends; the trigger fires its own runs
    if (kind.kind === 'merge') {
      let set = run.arrived.get(node.id);
      if (!set) run.arrived.set(node.id, (set = new Set()));
      set.add(via);
      if (set.size < inEdges(doc, node.id).length) return;
      run.arrived.delete(node.id);
      return leave(doc, run, node, kind, kind.outs[0], undefined);
    }
    if (!kind.run) return fail(node, `kind '${node.kind}' has no run`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const props = kind.schema(node.props ?? {}) as Record<string, unknown>;
      const pending = kind.run(props, runCtx(run, node));
      const result =
        kind.timeout === false
          ? await pending
          : await Promise.race([
              pending,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error(`node "${node.id}" (${node.kind}) did not finish in ${timeoutMs / 1000} s`)),
                  timeoutMs,
                );
              }),
            ]);
      if (signal.aborted) return;
      if (!kind.outs.includes(result.out)) return fail(node, `kind "${kind.kind}" returned unknown port "${result.out}"`);
      leave(doc, run, node, kind, result.out, result.vars);
    } catch (e) {
      if (signal.aborted) return;
      fail(node, e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
  };

  const leave = (
    doc: FlowDoc,
    run: Run,
    node: FlowNode,
    kind: FlowNodeKind,
    out: string,
    vars: Record<string, unknown> | undefined,
  ) => {
    Object.assign(run.vars, vars);
    record(run.no, node.id, out);
    for (const edge of outEdges(doc, node.id, out, kind.outs[0])) {
      const next = doc.nodes.find((n) => n.id === edge.to);
      if (next) void branch(doc, run, next, edge);
    }
  };

  const arm = (doc: FlowDoc) => {
    const own = epoch;
    for (const node of doc.nodes) {
      const kind = kinds.get(node.kind);
      if (!kind?.trigger) continue;
      if (!kind.arm) {
        fail(node, `trigger kind "${kind.kind}" has no arm`);
        continue;
      }
      const start = (vars: Record<string, unknown> | undefined) => {
        if (own.controller.signal.aborted) return; // fired after stop()
        const run: Run = { no: ++runNo, vars: {}, epoch: own, arrived: new Map() };
        record(run.no, node.id, null);
        leave(doc, run, node, kind, kind.outs[0], vars);
      };
      try {
        const props = kind.schema(node.props ?? {}) as Record<string, unknown>;
        disposers.push(kind.arm(props, start, runCtx({ no: 0, vars: {}, epoch: own, arrived: new Map() }, node)));
      } catch (e) {
        fail(node, e instanceof Error ? e.message : String(e));
      }
    }
  };

  const stop = () => {
    armed = false;
    epoch.controller.abort();
    epoch = fresh();
    disposers.forEach((off) => off());
    disposers = [];
  };

  /** The last refusal named a kind nothing had registered — the one refusal a later registration can lift. */
  let missingKind = false;
  const doReplace = (doc: FlowDoc | null): void => {
    if (doc && armed && current && shape(doc) === shape(current)) {
      current = doc;
      return;
    }
    stop();
    current = doc;
    trace.length = 0;
    runNo = 0;
    if (!doc) return;
    const problems = validateFlow(doc, kinds.list(), null);
    for (const d of problems) report(d);
    missingKind = problems.some((d) => d.message.startsWith('unknown kind'));
    if (problems.some((d) => d.severity === 'error')) return;
    arm(doc);
    armed = true;
  };

  // A doc that names a kind nothing has registered yet (a project row after
  // `flow1` — `fx1`'s `tween`/`sound`, say — still importing when the boot
  // GET wins the race `runtime.ts`/`e8.bundle.yml` describe) is reported
  // once by `doReplace` above and stays unarmed. `report` has no retraction
  // (`DiagnosticsService` only ever appends — see its doc comment), so that
  // first "unknown kind" diagnostic is never taken back; this only stops
  // the doc from staying stuck. Re-running `doReplace` on every registry
  // change catches it up the moment the missing kind lands. Guarded by
  // `current && !armed && missingKind`: `current` null means nothing was
  // ever handed to `replace` (nothing to catch up), `armed` true means a
  // LIVE run is in progress — an unrelated kind registering elsewhere must
  // not stop and restart it — and a doc refused for some OTHER reason (a
  // cycle, a bad edge) would only be re-reported, never armed, so it is
  // left alone. Subscribed here, once, for the service's whole life,
  // via `o.ctx.effect` rather than inside `stop`/`doReplace`: those run on
  // every ordinary doc swap, but this subscription has to outlive all of
  // them and only die with the row itself — `o.ctx` is the exact fiber
  // scope `runtime.ts`'s own `flow:run` effect (`flow.stop()` on dispose)
  // is torn down on, so both go together.
  o.ctx.effect(
    () =>
      kinds.subscribe(() => {
        if (current && !armed && missingKind) doReplace(current);
      }),
    'flow:kinds-watch',
  );

  return {
    replace: doReplace,
    doc: () => current,
    trace: () => trace,
    onTrace(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    busy: () => epoch.live > 0,
    ready: Promise.resolve(),
    stop,
  };
}
