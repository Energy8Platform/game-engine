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
  /** Validates, stops the current run, arms the triggers. Errors report and start nothing; the doc is kept either way. */
  replace(doc: FlowDoc): void;
  doc(): FlowDoc | null;
  /** The last 500 entries since the last `replace`. */
  trace(): readonly FlowTraceEntry[];
  onTrace(fn: (e: FlowTraceEntry) => void): () => void;
  /** Resolved here; the runtime row swaps in its boot fetch. */
  ready: Promise<void>;
  /** Aborts every in-flight branch and disarms the triggers; the doc and the trace stay. */
  stop(): void;
}

const TRACE_LIMIT = 500;

export function createFlow(o: CreateFlowOptions): FlowService {
  const { kinds, report } = o;
  const fetchFn = o.fetchFn ?? fetch;
  const now = o.now ?? Date.now;
  const timeoutMs = o.timeoutMs ?? 30_000;

  let current: FlowDoc | null = null;
  let controller = new AbortController();
  let disposers: (() => void)[] = [];
  let runNo = 0;
  const trace: FlowTraceEntry[] = [];
  const listeners = new Set<(e: FlowTraceEntry) => void>();

  const record = (run: number, node: string, out: string | null) => {
    const entry = { run, node, out, at: now() };
    trace.push(entry);
    if (trace.length > TRACE_LIMIT) trace.shift();
    listeners.forEach((fn) => fn(entry));
  };
  const fail = (node: FlowNode, message: string, severity: Diagnostic['severity'] = 'error') =>
    report(diagnostic(severity, 'flow', node.id, message));

  interface Run {
    no: number;
    vars: Record<string, unknown>;
    signal: AbortSignal;
    /** `merge` arrivals this run, by node: the edges that have landed since its last pass. */
    arrived: Map<string, Set<FlowEdge>>;
  }

  const runCtx = (run: Run, node: FlowNode): RunCtx => ({
    vars: run.vars,
    ctx: o.ctx,
    signal: run.signal,
    fetchFn,
    report: (message, severity) => fail(node, message, severity),
  });

  const branch = async (doc: FlowDoc, run: Run, node: FlowNode, via: FlowEdge): Promise<void> => {
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
      const result = await Promise.race([
        kind.run(props, runCtx(run, node)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`node "${node.id}" (${node.kind}) did not finish in ${timeoutMs / 1000} s`)), timeoutMs);
        }),
      ]);
      if (run.signal.aborted) return;
      leave(doc, run, node, kind, result.out, result.vars);
    } catch (e) {
      if (run.signal.aborted) return;
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

  const start = (doc: FlowDoc, trigger: FlowNode, kind: FlowNodeKind, vars: Record<string, unknown> | undefined) => {
    const run: Run = { no: ++runNo, vars: {}, signal: controller.signal, arrived: new Map() };
    record(run.no, trigger.id, null);
    leave(doc, run, trigger, kind, kind.outs[0], vars);
  };

  const arm = (doc: FlowDoc) => {
    for (const node of doc.nodes) {
      const kind = kinds.get(node.kind);
      if (!kind?.trigger || !kind.arm) continue;
      const armed: Run = { no: 0, vars: {}, signal: controller.signal, arrived: new Map() };
      try {
        const props = kind.schema(node.props ?? {}) as Record<string, unknown>;
        disposers.push(kind.arm(props, (vars) => start(doc, node, kind, vars), runCtx(armed, node)));
      } catch (e) {
        fail(node, e instanceof Error ? e.message : String(e));
      }
    }
  };

  const stop = () => {
    controller.abort();
    controller = new AbortController();
    disposers.forEach((off) => off());
    disposers = [];
  };

  return {
    replace(doc) {
      stop();
      current = doc;
      trace.length = 0;
      runNo = 0;
      const problems = validateFlow(doc, kinds.list(), null);
      for (const d of problems) report(d);
      if (problems.some((d) => d.severity === 'error')) return;
      arm(doc);
    },
    doc: () => current,
    trace: () => trace,
    onTrace(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    ready: Promise.resolve(),
    stop,
  };
}
