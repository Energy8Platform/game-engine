import { describe, expect, it } from 'vitest';
import Schema from 'schemastery';
import type { FlowDoc, FlowKindInfo, FlowTraceEntry } from '@energy8engine/contracts';
import {
  addNode,
  connect,
  moveNode,
  nextId,
  removeEdges,
  removeNodes,
  toReactFlow,
} from '../src/shell/flow-graph';
import { FIVE, FIVE_KINDS } from './flow-harness';

/**
 * The pure half of the canvas: reducers over `FlowDoc` and the one
 * projection into React Flow's `nodes`/`edges`. Every reducer returns a
 * new document and leaves its input alone.
 */
const entry = (node: string, out: string | null, at: number, run = 1): FlowTraceEntry => ({
  run,
  node,
  out,
  at,
});
const waitInfo: FlowKindInfo = {
  kind: 'wait',
  outs: ['next'],
  trigger: false,
  schema: JSON.parse(JSON.stringify(Schema.object({ ms: Schema.number().default(500) }))),
};

describe('flow-graph reducers', () => {
  it('nextId is <kind>-<n> for the smallest free n ≥ 1', () => {
    expect(nextId(FIVE, 'wait')).toBe('wait-1');
    const doc: FlowDoc = {
      ...FIVE,
      nodes: [...FIVE.nodes, { id: 'wait-1', kind: 'wait' }, { id: 'wait-3', kind: 'wait' }],
    };
    expect(nextId(doc, 'wait')).toBe('wait-2');
  });

  it("addNode appends <kind>-<n> at the point with the schema's defaults as props", () => {
    const next = addNode(FIVE, 'wait', waitInfo, { x: 1, y: 2 });
    expect(next.nodes.at(-1)).toEqual({
      id: 'wait-1',
      kind: 'wait',
      props: { ms: 500 },
      ui: { x: 1, y: 2 },
    });
    expect(FIVE.nodes).toHaveLength(5);
    // A schema that cannot be rebuilt, or that refuses `{}` (a required field), adds no props at all.
    const bare = addNode(FIVE, 'wait', { ...waitInfo, schema: null }, { x: 0, y: 0 });
    expect(bare.nodes.at(-1)).toEqual({ id: 'wait-1', kind: 'wait', ui: { x: 0, y: 0 } });
    const required = JSON.parse(
      JSON.stringify(Schema.object({ scene: Schema.string().required() })),
    );
    expect(
      addNode(FIVE, 'show', { ...waitInfo, schema: required }, { x: 0, y: 0 }).nodes.at(-1),
    ).toEqual({
      id: 'show-1',
      kind: 'show',
      ui: { x: 0, y: 0 },
    });
  });

  it('connect appends { from, out, to }; the same edge twice is a no-op', () => {
    const next = connect(FIVE, 'spin', 'failed', 'idle');
    expect(next.edges.at(-1)).toEqual({ from: 'spin', out: 'failed', to: 'idle' });
    expect(FIVE.edges).toHaveLength(5);
    expect(connect(next, 'spin', 'failed', 'idle')).toBe(next);
  });

  it('removeNodes drops the nodes and every edge touching them', () => {
    const next = removeNodes(FIVE, ['spin']);
    expect(next.nodes.map((n) => n.id)).toEqual(['start', 'base', 'idle', 'draw']);
    expect(next.edges).toEqual([
      { from: 'start', to: 'base' },
      { from: 'base', to: 'idle' },
      { from: 'draw', to: 'idle' },
    ]);
  });

  it('removeEdges drops exactly the given edges — `out` absent and `out` given are different edges', () => {
    const doc = connect(FIVE, 'spin', 'failed', 'idle');
    const next = removeEdges(doc, [
      { from: 'spin', to: 'draw' },
      { from: 'spin', out: 'failed', to: 'idle' },
    ]);
    expect(next.edges).toEqual([
      { from: 'start', to: 'base' },
      { from: 'base', to: 'idle' },
      { from: 'idle', to: 'spin' },
      { from: 'draw', to: 'idle' },
    ]);
    expect(removeEdges(doc, [{ from: 'spin', out: 'result', to: 'draw' }]).edges).toHaveLength(6);
  });

  it('moveNode sets ui', () => {
    const next = moveNode(FIVE, 'spin', { x: 5, y: 6 });
    expect(next.nodes.find((n) => n.id === 'spin')).toEqual({
      id: 'spin',
      kind: 'spin',
      ui: { x: 5, y: 6 },
    });
    expect(FIVE.nodes.find((n) => n.id === 'spin')?.ui).toEqual({ x: 580, y: 80 });
  });
});

describe('toReactFlow', () => {
  it("projects nodes (type e8, ui or a staggered default position, the kind's ports) and edges (sourceHandle = out ?? outs[0])", () => {
    const doc: FlowDoc = {
      ...FIVE,
      nodes: [...FIVE.nodes, { id: 'wait-1', kind: 'wait' }, { id: 'x', kind: 'mystery' }],
    };
    const { nodes, edges } = toReactFlow(doc, FIVE_KINDS, [], 'spin');
    expect(nodes[3]).toEqual({
      id: 'spin',
      type: 'e8',
      position: { x: 580, y: 80 },
      data: {
        id: 'spin',
        kind: 'spin',
        outs: ['result', 'failed'],
        trigger: false,
        ran: false,
        active: false,
      },
      selected: true,
    });
    expect(nodes[0].data).toMatchObject({ trigger: true, outs: ['next'] });
    expect(nodes[0].selected).toBe(false);
    expect(nodes[5].position).toEqual({ x: 80 + 40 * 5, y: 80 + 40 * 5 });
    // An unregistered kind has no ports yet.
    expect(nodes[6].data).toMatchObject({ outs: [], trigger: false });
    expect(edges[3]).toEqual({
      id: 'spin:result:draw',
      source: 'spin',
      sourceHandle: 'result',
      target: 'draw',
      animated: false,
      data: { edge: { from: 'spin', to: 'draw' } },
    });
  });

  it('paints the latest run: ran, active and the edges taken', () => {
    const trace = [
      entry('start', null, 0),
      entry('start', 'next', 1),
      entry('base', null, 2),
      entry('base', 'next', 3),
      entry('idle', null, 4),
    ];
    const { nodes, edges } = toReactFlow(FIVE, FIVE_KINDS, trace, null);
    expect(nodes.map((n) => [n.data.ran, n.data.active])).toEqual([
      [true, false],
      [true, false],
      [true, true],
      [false, false],
      [false, false],
    ]);
    expect(edges.map((e) => e.animated)).toEqual([true, true, false, false, false]);
  });

  it('a stale older run in the trace is ignored', () => {
    const trace = [
      entry('spin', null, 0, 1),
      entry('spin', 'result', 1, 1),
      entry('draw', null, 2, 1),
      entry('start', null, 3, 2),
    ];
    const { nodes, edges } = toReactFlow(FIVE, FIVE_KINDS, trace, null);
    expect(nodes.filter((n) => n.data.ran).map((n) => n.id)).toEqual(['start']);
    expect(edges.every((e) => !e.animated)).toBe(true);
  });
});
