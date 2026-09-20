import { diagnostic, type Diagnostic, type FlowDoc, type FlowEdge, type FlowNode } from '@energy8engine/contracts';

/** The shape of a registered node kind that `validateFlow` needs to know about. */
export interface KindShape {
  kind: string;
  outs: readonly string[];
  trigger?: boolean;
}

/**
 * Edges leaving `from` on port `out`. An edge with no explicit `out` falls
 * back to `defaultOut` — the caller (the interpreter, in Task 3) passes the
 * source node's kind's first port (`kind.outs[0]`), since that's the port a
 * document is allowed to leave implicit on an edge.
 */
export function outEdges(doc: FlowDoc, from: string, out: string, defaultOut: string): FlowEdge[] {
  return doc.edges.filter((e) => e.from === from && (e.out ?? defaultOut) === out);
}

/** Every edge landing on `to`, regardless of port. */
export function inEdges(doc: FlowDoc, to: string): FlowEdge[] {
  return doc.edges.filter((e) => e.to === to);
}

/**
 * Enumerates elementary cycles in the `from → to` graph: for every node as
 * a candidate root, DFS explores every SIMPLE path leading out of it (a
 * node already on the current path, other than the root, is never
 * revisited — that's what "simple" means here), and each edge that lands
 * back on the root closes a cycle, recorded as the path at that point.
 *
 * A single shared "visited" set across the whole forest is NOT enough:
 * once a node is marked fully explored from one branch, a DIFFERENT
 * branch that reaches it is refused a re-descent, so a second, merely
 * RECONVERGING cycle through that node is silently dropped. Concretely,
 * `a→b, a→c, b→d, c→d, d→a` has two distinct cycles through `d` — one via
 * `b`, one via `c` — and a global-visited walk that meets `d` through `b`
 * first would never explore `d`'s outgoing `d→a` edge again from `c`, so
 * the `a,c,d` cycle would go unreported even though it closes a real
 * loop. Restarting the search from every root, and only pruning nodes
 * already on THAT root's current path (not a global set), finds both.
 *
 * Cycles are deduped by their sorted id set, since the same cycle is
 * rediscovered — rotated — once per node that sits on it (each becomes a
 * root in turn). Re-walking every simple path from every root is
 * exponential in the worst case, but the brief calls for exactly this
 * approach: the flow graphs it runs against are tiny.
 */
function findCycles(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (adjacency.has(edge.from)) adjacency.get(edge.from)!.push(edge.to);
  }

  const seenCycles = new Set<string>();
  const cycles: string[][] = [];

  for (const root of nodes) {
    const path: string[] = [root.id];
    const onPath = new Set<string>([root.id]);

    const walk = (id: string): void => {
      for (const next of adjacency.get(id) ?? []) {
        if (next === root.id) {
          const key = [...path].sort().join(',');
          if (!seenCycles.has(key)) {
            seenCycles.add(key);
            cycles.push([...path]);
          }
          continue;
        }
        if (onPath.has(next)) continue; // would revisit a non-root node: not a simple path
        path.push(next);
        onPath.add(next);
        walk(next);
        path.pop();
        onPath.delete(next);
      }
    };

    walk(root.id);
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
 * `wait`, which every node already carries on itself. `actions: null`
 * similarly skips the `spin` action check — a literal `action` prop the
 * game's `game/spec.json` doesn't declare is a warning, not an error (the
 * game may still accept it; the spec is descriptive metadata, see
 * `kinds.ts`'s `spin`), and a `$path` action is never checked, since its
 * value isn't known until the flow runs. `nodeIds: null` similarly skips
 * the `prop` target check — every `<scene>/<node>` of every scene, same
 * shape a literal `prop.target` names; a `$path` target is never checked,
 * for the same reason a `$path` action isn't.
 */
export function validateFlow(
  doc: FlowDoc,
  kinds: readonly KindShape[] | null,
  sceneIds: readonly string[] | null,
  actions: readonly string[] | null = null,
  nodeIds: readonly string[] | null = null,
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
    const toNode = nodesById.get(edge.to);
    if (!toNode) out.push(diagnostic('error', 'flow', where, `edge to a missing node '${edge.to}'`));
    // A branch reaching a trigger ends there; `boot` fires once, by itself, so nothing ever follows this edge.
    if (toNode?.kind === 'boot') out.push(diagnostic('warning', 'flow', where, `an edge into 'boot' does nothing`));
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
    // A warning, not an error: a node fresh from the palette has neither yet,
    // and the write must land for the form to fill it in. The runtime guards
    // itself (`wait.run` throws, `on.arm` reports) when it is reached like this.
    // `''` is what the form's empty option commits: absent, like `undefined`.
    if (!node.props?.event && node.props?.ms === undefined) {
      out.push(diagnostic('warning', 'flow', node.id, `'${node.kind}' needs an 'event' or 'ms'`));
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

  if (actions) {
    const actionSet = new Set(actions);
    for (const node of doc.nodes) {
      if (node.kind !== 'spin') continue;
      // `?? 'spin'`: the default the kind's schema fills in — a bare `spin`
      // node asks for the `spin` action, and warns when the game declares no
      // such action, exactly as a written-out `action: spin` does.
      const action = node.props?.action ?? 'spin';
      // Only a LITERAL action names a specific game action; `$path` isn't known until the flow runs.
      if (typeof action === 'string' && !action.startsWith('$') && !actionSet.has(action)) {
        out.push(diagnostic('warning', 'flow', node.id, `action "${action}" is not in game/spec.json`));
      }
    }
  }

  if (nodeIds) {
    const nodeSet = new Set(nodeIds);
    for (const node of doc.nodes) {
      if (node.kind !== 'prop') continue;
      const target = node.props?.target;
      if (typeof target === 'string' && !target.startsWith('$') && !nodeSet.has(target)) {
        out.push(diagnostic('warning', 'flow', node.id, `node "${target}" is not in any scene`));
      }
    }
  }

  for (const cycle of findCycles(doc.nodes, doc.edges)) {
    // `step` yields too: its `run` awaits a POST before the edge out of it
    // ever fires, the same real yield `wait`'s timer/event or `on`'s next
    // event gives — so a cycle running only through synchronous nodes plus
    // `step` (draw → done → step → draw, say, stepping a round to
    // completion) is not the CPU-spinning hang this check exists to catch.
    const hasWait = cycle.some((id) => {
      const kind = nodesById.get(id)?.kind;
      return kind === 'on' || kind === 'wait' || kind === 'step';
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
