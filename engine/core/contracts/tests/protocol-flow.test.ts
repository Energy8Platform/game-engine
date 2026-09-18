import { describe, expect, it } from 'vitest';
import type {
  ClientMessage,
  FlowDoc,
  FlowEdge,
  FlowKindsMessage,
  FlowMessage,
  FlowNode,
  FlowResponse,
  FlowTraceEntry,
  FlowTraceMessage,
  ServerMessage,
} from '../src';

/** Compile-time shapes: a value of each type assigns; the unions carry the new members. */
describe('flow contracts', () => {
  it('shapes assign and the unions carry the three new frames', () => {
    const node: FlowNode = { id: 'n1', kind: 'trigger', props: { delay: 100 }, ui: { x: 10, y: 20 } };
    const edge: FlowEdge = { from: 'n1', out: 'success', to: 'n2' };
    const doc: FlowDoc = {
      version: 1,
      nodes: [node, { id: 'n2', kind: 'action', props: {} }],
      edges: [edge],
    };
    const response: FlowResponse = { doc, diagnostics: [], kinds: [] };
    const frames: ServerMessage[] = [
      { type: 'flow', doc, diagnostics: [] } satisfies FlowMessage,
      { type: 'flow-kinds', kinds: [] } satisfies FlowKindsMessage,
      { type: 'flow-trace', entries: [] } satisfies FlowTraceMessage,
    ];
    const up: ClientMessage[] = [
      { type: 'flow-kinds', kinds: [] } satisfies FlowKindsMessage,
      { type: 'flow-trace', entries: [{ run: 1, node: 'n1', out: null, at: 0 }] } satisfies FlowTraceMessage,
    ];
    const entry: FlowTraceEntry = { run: 0, node: 'n1', out: 'success', at: 123 };
    expect(doc.nodes.length).toBe(2);
    expect(doc.edges.length).toBe(1);
    expect(response.doc?.version).toBe(1);
    expect(frames.map((f) => f.type)).toEqual(['flow', 'flow-kinds', 'flow-trace']);
    expect(up.map((f) => f.type)).toEqual(['flow-kinds', 'flow-trace']);
    expect(entry.out).toBe('success');
  });
});
