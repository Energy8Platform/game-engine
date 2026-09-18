import { diagnostic, type Diagnostic, type FlowDoc, type FlowEdge, type FlowNode } from '@energy8engine/contracts';

/** The shape of a registered node kind that `validateFlow` needs to know about. */
export interface KindShape {
  kind: string;
  outs: readonly string[];
  trigger?: boolean;
}

/** Edges leaving `from` on port `out`. A missing `out` on the edge defaults to `'next'`. */
export function outEdges(doc: FlowDoc, from: string, out: string): FlowEdge[] {
  return doc.edges.filter((e) => e.from === from && (e.out ?? 'next') === out);
}

/** Every edge landing on `to`, regardless of port. */
export function inEdges(doc: FlowDoc, to: string): FlowEdge[] {
  return doc.edges.filter((e) => e.to === to);
}

/**
 * Finds cycles in the `from → to` graph via one DFS forest (a fresh DFS
 * root at every not-yet-visited node, so disconnected components are all
 * covered) — O(n + e), well inside the brief's O(n·e) budget for these
 * tiny graphs. Each cycle is reported once, as the list of node ids from
 * where the back-edge closes the loop back to itself, deduped by its
 * sorted id set (so the same cycle found from two different roots only
 * counts once).
 */
function findCycles(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (adjacency.has(edge.from)) adjacency.get(edge.from)!.push(edge.to);
  }

  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const seenCycles = new Set<string>();
  const cycles: string[][] = [];

  function visit(id: string): void {
    visited.add(id);
    stack.push(id);
    onStack.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (onStack.has(next)) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join(',');
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(cycle);
        }
      } else if (!visited.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    onStack.delete(id);
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) visit(node.id);
  }
  return cycles;
}

/** Rotates a cycle's node list so it starts at its lexicographically smallest id. */
function rotateToSmallest(cycle: readonly string[]): string[] {
  let minIndex = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIndex]) minIndex = i;
  }
  return [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)];
}

/**
 * Checks a flow document for the problems the interpreter and the editor
 * both care about. `kinds: null` means the node-kind registry isn't known
 * yet (e.g. no game connected) — kind-dependent checks (unknown kind, bad
 * port, orphan trigger check) are skipped. `sceneIds: null` similarly
 * skips the `show`/`hide` scene check. The cycle check needs neither: it
 * only cares whether a cycle's node KINDS (raw strings) include `on` or
 * `wait`, which every node already carries on itself.
 */
export function validateFlow(
  doc: FlowDoc,
  kinds: readonly KindShape[] | null,
  sceneIds: readonly string[] | null,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const kindByName = kinds ? new Map(kinds.map((k) => [k.kind, k])) : null;

  const nodesById = new Map<string, FlowNode>();
  for (const node of doc.nodes) {
    if (nodesById.has(node.id)) {
      out.push(diagnostic('error', 'flow', node.id, `duplicate node id '${node.id}'`));
    } else {
      nodesById.set(node.id, node);
    }
  }

  if (kindByName) {
    for (const node of doc.nodes) {
      if (!kindByName.has(node.kind)) {
        out.push(diagnostic('error', 'flow', node.id, `unknown kind '${node.kind}'`));
      }
    }
  }

  for (const edge of doc.edges) {
    const where = `${edge.from}→${edge.to}`;
    const fromNode = nodesById.get(edge.from);
    if (!fromNode) out.push(diagnostic('error', 'flow', where, `edge from a missing node '${edge.from}'`));
    if (!nodesById.has(edge.to)) out.push(diagnostic('error', 'flow', where, `edge to a missing node '${edge.to}'`));
    if (fromNode && edge.out !== undefined && kindByName) {
      const shape = kindByName.get(fromNode.kind);
      if (shape && !shape.outs.includes(edge.out)) {
        out.push(
          diagnostic('error', 'flow', where, `out '${edge.out}' is not one of '${fromNode.kind}'s outs`),
        );
      }
    }
  }

  const boots = doc.nodes.filter((n) => n.kind === 'boot');
  if (boots.length > 1) {
    for (const boot of boots) out.push(diagnostic('error', 'flow', boot.id, `more than one boot node`));
  }

  if (kindByName) {
    for (const node of doc.nodes) {
      const shape = kindByName.get(node.kind);
      if (!shape || shape.trigger) continue;
      const hasIncoming = doc.edges.some((e) => e.to === node.id);
      if (!hasIncoming) out.push(diagnostic('warning', 'flow', node.id, `node '${node.id}' has no incoming edge`));
    }
  }

  for (const node of doc.nodes) {
    if (node.kind !== 'on' && node.kind !== 'wait') continue;
    if (node.props?.event === undefined && node.props?.ms === undefined) {
      out.push(diagnostic('error', 'flow', node.id, `'${node.kind}' needs an 'event' or 'ms'`));
    }
  }

  if (sceneIds) {
    const sceneSet = new Set(sceneIds);
    for (const node of doc.nodes) {
      if (node.kind !== 'show' && node.kind !== 'hide') continue;
      const scene = node.props?.scene;
      if (typeof scene === 'string' && !sceneSet.has(scene)) {
        out.push(diagnostic('error', 'flow', node.id, `unknown scene '${scene}'`));
      }
    }
  }

  for (const cycle of findCycles(doc.nodes, doc.edges)) {
    const hasWait = cycle.some((id) => {
      const kind = nodesById.get(id)?.kind;
      return kind === 'on' || kind === 'wait';
    });
    if (hasWait) continue;
    const rotated = rotateToSmallest(cycle);
    out.push(
      diagnostic(
        'error',
        'flow',
        rotated[0],
        `cycle without a wait: ${rotated.join(' → ')} → ${rotated[0]}`,
      ),
    );
  }

  return out;
}
