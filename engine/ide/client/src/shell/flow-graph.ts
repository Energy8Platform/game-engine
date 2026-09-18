import Schema from 'schemastery';
import type { Edge, Node } from '@xyflow/react';
import type { FlowDoc, FlowEdge, FlowKindInfo, FlowTraceEntry } from '@energy8engine/contracts';

/**
 * The pure half of the Flow canvas: reducers over `FlowDoc` (each returns
 * a new document; the input is never touched) and `toReactFlow`, the one
 * projection into React Flow's `nodes`/`edges`. `FlowDocument` calls
 * these and PUTs the result; nothing here knows about the service.
 */

/** What the `e8` node component reads. */
export interface E8NodeData extends Record<string, unknown> {
  id: string;
  kind: string;
  outs: string[];
  trigger: boolean;
  /** Entered in the latest run. */
  ran: boolean;
  /** The latest run's last entry is this node. */
  active: boolean;
}
export type E8Node = Node<E8NodeData, 'e8'>;
/** The doc edge rides along so a delete can name it exactly (`out` absent and `out` given differ). */
export type E8Edge = Edge<{ edge: FlowEdge }>;

/** `<kind>-<n>`, the smallest free n ≥ 1. */
export function nextId(doc: FlowDoc, kind: string): string {
  const taken = new Set(doc.nodes.map((n) => n.id));
  let n = 1;
  while (taken.has(`${kind}-${n}`)) n++;
  return `${kind}-${n}`;
}

/** The schema's defaults for `{}`; nothing when the schema is missing, malformed, or refuses `{}` (a required field). */
function defaults(schema: unknown): Record<string, unknown> | undefined {
  if (schema == null) return undefined;
  try {
    const props = new Schema(schema as never)({}) as Record<string, unknown>;
    return Object.keys(props).length ? props : undefined;
  } catch {
    return undefined;
  }
}

export function addNode(
  doc: FlowDoc,
  kind: string,
  info: FlowKindInfo,
  at: { x: number; y: number },
): FlowDoc {
  const props = defaults(info.schema);
  return {
    ...doc,
    nodes: [...doc.nodes, { id: nextId(doc, kind), kind, ...(props && { props }), ui: at }],
  };
}

const sameEdge = (a: FlowEdge, b: FlowEdge) =>
  a.from === b.from && a.to === b.to && a.out === b.out;

/** Appends `{ from, out, to }`; the same edge already there is a no-op (the input comes back as is). */
export function connect(doc: FlowDoc, from: string, out: string, to: string): FlowDoc {
  const edge: FlowEdge = { from, out, to };
  if (doc.edges.some((e) => sameEdge(e, edge))) return doc;
  return { ...doc, edges: [...doc.edges, edge] };
}

/** Drops the nodes and every edge touching them. */
export function removeNodes(doc: FlowDoc, ids: readonly string[]): FlowDoc {
  const gone = new Set(ids);
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !gone.has(n.id)),
    edges: doc.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
  };
}

/** Drops exactly the given edges. */
export function removeEdges(doc: FlowDoc, edges: readonly FlowEdge[]): FlowDoc {
  return { ...doc, edges: doc.edges.filter((e) => !edges.some((g) => sameEdge(e, g))) };
}

/** The node under `newId`, every edge naming it rewritten to follow. */
export function renameNode(doc: FlowDoc, id: string, newId: string): FlowDoc {
  const re = (x: string) => (x === id ? newId : x);
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === id ? { ...n, id: newId } : n)),
    edges: doc.edges.map((e) => ({ ...e, from: re(e.from), to: re(e.to) })),
  };
}

export function moveNode(doc: FlowDoc, id: string, at: { x: number; y: number }): FlowDoc {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? { ...n, ui: at } : n)) };
}

/**
 * The doc as React Flow sees it. A node without `ui` sits on a diagonal
 * by index. An unregistered kind (the game not running yet) has no ports,
 * so its outgoing edges are left out — React Flow logs an error for every
 * edge whose source handle it cannot find. The trace (the service keeps
 * the newest run only) paints on: `ran` = entered, `active` = the last
 * entry, an edge `animated` when the run left `from` by that port and
 * entered `to`.
 */
export function toReactFlow(
  doc: FlowDoc,
  kinds: readonly FlowKindInfo[],
  trace: readonly FlowTraceEntry[],
  selected: string | null,
): { nodes: E8Node[]; edges: E8Edge[] } {
  const info = new Map(kinds.map((k) => [k.kind, k]));
  const outsOf = new Map(doc.nodes.map((n) => [n.id, info.get(n.kind)?.outs]));
  const ran = new Set(trace.map((e) => e.node));
  const left = new Set(trace.filter((e) => e.out !== null).map((e) => `${e.node}:${e.out}`));
  const active = trace.at(-1)?.node;

  const nodes = doc.nodes.map((n, i): E8Node => ({
    id: n.id,
    type: 'e8',
    position: n.ui ?? { x: 80 + 40 * i, y: 80 + 40 * i },
    data: {
      id: n.id,
      kind: n.kind,
      outs: outsOf.get(n.id) ?? [],
      trigger: info.get(n.kind)?.trigger ?? false,
      ran: ran.has(n.id),
      active: n.id === active,
    },
    selected: n.id === selected,
  }));
  const edges = doc.edges.flatMap((e): E8Edge[] => {
    const outs = outsOf.get(e.from);
    if (!outs) return [];
    const out = e.out ?? outs[0];
    return [
      {
        id: `${e.from}:${out}:${e.to}`,
        source: e.from,
        sourceHandle: out,
        target: e.to,
        animated: left.has(`${e.from}:${out}`) && ran.has(e.to),
        data: { edge: e },
      },
    ];
  });
  return { nodes, edges };
}
