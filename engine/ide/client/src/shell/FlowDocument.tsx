import { useCallback, useEffect, useReducer, useRef, useState, type DragEvent } from 'react';
import type { Context } from 'cordis';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Diagnostic, FlowDoc, FlowKindInfo, FlowTraceEntry } from '@energy8engine/contracts';
import { useFlow } from '../plugins/flow';
import {
  addNode,
  connect,
  moveNode,
  removeEdges,
  removeNodes,
  toReactFlow,
  type E8Edge,
  type E8Node,
} from './flow-graph';

/**
 * The Flow document — registered under `shell.document` key `flow`.
 *
 * `doc() === null` is two different situations the host answers the same
 * shape for (`GET`/`PUT /api/flow`'s `FlowResponse`) and this view must
 * not conflate: no `flow.yml` at all (`diagnostics: []`) is `flow-empty`,
 * one button away from the smallest doc that parses; an EXISTING but
 * unparseable `flow.yml` (`engine/ide/host`'s flow route answers `doc:
 * null` with one error `where: 'flow.yml'`, see its own
 * `flow.test.ts:174-190`) is `flow-broken` — no create button, because
 * clicking it would silently overwrite whatever the user has half-written
 * in the file with the one-boot starter doc.
 *
 * With a doc: a palette (one button per registered kind — click adds on a
 * diagonal, drag drops where the pointer is) and the React Flow canvas.
 * The doc is the source of truth; `flow-graph.ts` projects it and every
 * edit is a reducer over it PUT through `ctx.flow.update`. React Flow
 * still needs its own copy of the nodes (`measured` sizes, drag
 * positions, selection live there between renders), so the projection is
 * merged into local state whenever the doc, kinds, trace or selection
 * change — keeping a node's measurement, and its dragged position while
 * that move is still waiting for its debounced PUT. Structure (connect,
 * delete, add) writes at once; positions coalesce for 250 ms into one
 * `moveNode` per moved node.
 *
 * Every write is a REDUCER over the doc, not a doc: `commit` runs them one
 * after another through a single promise chain, each over `ctx.flow.doc()`
 * as it is when its turn comes — so a node added while a move's PUT is
 * still in flight reduces the MOVED doc, not the one the handler was
 * rendered with, and neither write overwrites the other. A refusal shows
 * inline as `flow-error` and makes the canvas re-project from the doc:
 * React Flow has already applied a delete (or a drag) locally by the time
 * the host says no, and the doc, unchanged, would not have re-run the
 * projection by itself.
 */
const NEW_FLOW: FlowDoc = {
  version: 1,
  nodes: [{ id: 'start', kind: 'boot', ui: { x: 40, y: 80 } }],
  edges: [],
};
const KIND_MIME = 'application/e8-flow-kind';
const MOVE_DEBOUNCE_MS = 250;

function E8NodeView({ data }: NodeProps<E8Node>) {
  const cls = ['e8-flow-node', data.ran && 'e8-flow-ran', data.active && 'e8-flow-active']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} data-testid={`flow-node-${data.id}`}>
      {!data.trigger && <Handle type="target" position={Position.Left} id="in" />}
      <div className="e8-flow-node-kind">{data.kind}</div>
      <div className="e8-flow-node-id">{data.id}</div>
      <div className="e8-flow-node-outs">
        {data.outs.map((out) => (
          <div key={out} className="e8-flow-node-out">
            {out}
            <Handle
              type="source"
              position={Position.Right}
              id={out}
              data-testid={`flow-port-${data.id}-${out}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
const NODE_TYPES = { e8: E8NodeView };

interface CanvasProps {
  ctx: Context;
  doc: FlowDoc;
  kinds: readonly FlowKindInfo[];
  trace: readonly FlowTraceEntry[];
  selected: string | null;
  /** Queues one write; resolves `true` once the host took it. The document shows a refusal. */
  commit: (reduce: Reduce) => Promise<boolean>;
}
type Reduce = (doc: FlowDoc) => FlowDoc;

/** Inside `ReactFlowProvider` so `useReactFlow` (the drop's coordinates) is in reach. */
function Canvas({ ctx, doc, kinds, trace, selected, commit }: CanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes] = useState<E8Node[]>([]);
  const [edges, setEdges] = useState<E8Edge[]>([]);
  // Moves whose PUT has not answered yet: id → position. The projection
  // keeps the dragged position for these so a trace frame landing mid
  // round-trip does not snap the node back to where the doc still has it.
  const pending = useRef(new Map<string, { x: number; y: number }>());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Bumped on a refusal: the projection below re-runs and the local
  // nodes/edges are rebuilt from the doc the host still has.
  const [refusals, refused] = useReducer((n: number) => n + 1, 0);
  const write = useCallback(
    (reduce: Reduce) =>
      commit(reduce).then((ok) => {
        if (!ok) refused();
      }),
    [commit],
  );

  useEffect(() => {
    const projected = toReactFlow(doc, kinds, trace, selected);
    setNodes((prev) => {
      const before = new Map(prev.map((n) => [n.id, n]));
      return projected.nodes.map((n) => {
        const was = before.get(n.id);
        if (!was) return n;
        return {
          ...n,
          measured: was.measured,
          position: pending.current.has(n.id) ? was.position : n.position,
        };
      });
    });
    setEdges((prev) => {
      const picked = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return projected.edges.map((e) => (picked.has(e.id) ? { ...e, selected: true } : e));
    });
  }, [doc, kinds, trace, selected, refusals]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onNodesChange = useCallback(
    (changes: NodeChange<E8Node>[]) => {
      setNodes((prev) => applyNodeChanges(changes, prev));
      let moved = false;
      for (const c of changes) {
        if (c.type !== 'position' || !c.position) continue;
        pending.current.set(c.id, c.position);
        moved = true;
      }
      if (!moved) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const moves = [...pending.current];
        void commit((d) => moves.reduce((acc, [id, at]) => moveNode(acc, id, at), d)).then((ok) => {
          // A drag that started meanwhile has a newer entry; that one stays.
          for (const [id, at] of moves)
            if (pending.current.get(id) === at) pending.current.delete(id);
          if (!ok) refused();
        });
      }, MOVE_DEBOUNCE_MS);
    },
    [commit],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<E8Edge>[]) => setEdges((prev) => applyEdgeChanges(changes, prev)),
    [],
  );
  const onConnect = useCallback(
    ({ source, sourceHandle, target }: Connection) => {
      const out = sourceHandle ?? nodes.find((n) => n.id === source)?.data.outs[0];
      if (!out) return;
      if (edges.some((e) => e.source === source && e.sourceHandle === out && e.target === target))
        return;
      void write((d) => connect(d, source, out, target));
    },
    [nodes, edges, write],
  );
  const onDelete = useCallback(
    ({ nodes: gone, edges: cut }: { nodes: E8Node[]; edges: E8Edge[] }) => {
      const ids = gone.map((n) => n.id);
      const edges = cut.flatMap((e) => (e.data ? [e.data.edge] : []));
      if (selected !== null && ids.includes(selected)) ctx.flow.select(null);
      void write((d) => removeEdges(removeNodes(d, ids), edges));
    },
    [ctx, selected, write],
  );
  const onDrop = useCallback(
    (event: DragEvent) => {
      const kind = event.dataTransfer.getData(KIND_MIME);
      const info = kinds.find((k) => k.kind === kind);
      if (!info) return;
      event.preventDefault();
      const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      void write((d) => addNode(d, kind, info, at));
    },
    [kinds, write, screenToFlowPosition],
  );

  return (
    <div
      className="e8-flow-canvas"
      data-testid="flow-canvas"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDelete={onDelete}
        onNodeClick={(_, node) => ctx.flow.select(node.id)}
        onPaneClick={() => ctx.flow.select(null)}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
      />
    </div>
  );
}

export function FlowDocument({ ctx }: { ctx: Context }) {
  const { doc, diagnostics, kinds, trace, selected } = useFlow(ctx);
  const [error, setError] = useState<Diagnostic | null>(null);
  const broken = doc === null ? diagnostics.find((d) => d.where === 'flow.yml') : undefined;
  // The write queue: one PUT at a time, each reducing the doc as it stands then.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const commit = useCallback(
    (reduce: Reduce) => {
      const run = chain.current.then(async () => {
        const current = ctx.flow.doc();
        if (!current) return false;
        const next = reduce(current);
        if (next === current) return true;
        const answer = await ctx.flow.update(next);
        setError(answer[0] ?? null);
        return answer.length === 0;
      });
      // A reducer that throws must not jam the queue for every write after it.
      chain.current = run.catch(() => {});
      return run;
    },
    [ctx],
  );

  return (
    <div className="e8-explorer e8-flow-doc" data-testid="flow-screen">
      {doc === null && broken ? (
        <div className="e8-empty" data-testid="flow-broken">
          <p>{broken.message}</p>
          <p>fix flow.yml in the editor or delete it</p>
        </div>
      ) : doc === null ? (
        <div className="e8-empty" data-testid="flow-empty">
          <p>no flow.yml — create one</p>
          <button
            type="button"
            className="e8-primary"
            data-testid="flow-create"
            onClick={() => void ctx.flow.update(NEW_FLOW)}
          >
            create flow.yml
          </button>
        </div>
      ) : (
        <div className="e8-flow">
          <div className="e8-flow-palette" data-testid="flow-palette">
            <div className="e8-explorer-header">
              <span className="e8-explorer-title">nodes</span>
            </div>
            {kinds.length === 0 && <p className="e8-empty">no kinds yet — run the game</p>}
            {kinds.map((info) => (
              <button
                key={info.kind}
                type="button"
                className="e8-explorer-entry e8-flow-add"
                data-testid={`flow-add-${info.kind}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(KIND_MIME, info.kind);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() =>
                  void commit((d) => {
                    const n = d.nodes.length;
                    return addNode(d, info.kind, info, { x: 80 + 40 * n, y: 80 + 40 * n });
                  })
                }
              >
                {info.kind}
              </button>
            ))}
          </div>
          <div className="e8-flow-main">
            {error && (
              <p className="e8-explorer-diagnostic e8-canvas-error" data-testid="flow-error">
                {`${error.where} — ${error.message}`}
              </p>
            )}
            <ReactFlowProvider>
              <Canvas
                ctx={ctx}
                doc={doc}
                kinds={kinds}
                trace={trace}
                selected={selected}
                commit={commit}
              />
            </ReactFlowProvider>
            <ul className="e8-explorer-tree" data-testid="flow-diagnostics">
              {diagnostics.map((d, i) => (
                <li key={i} className="e8-explorer-diagnostic" data-severity={d.severity}>
                  {`${d.severity}: ${d.where} — ${d.message}`}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
