import { describe, expect, it } from 'vitest';
import type { FlowDoc } from '@energy8engine/contracts';
import { inEdges, outEdges, validateFlow, type KindShape } from '../src/graph';

const kinds: KindShape[] = [
  { kind: 'boot', outs: ['next'], trigger: true },
  { kind: 'on', outs: ['next'], trigger: true },
  { kind: 'show', outs: ['next'] },
  { kind: 'if', outs: ['true', 'false'] },
  { kind: 'wait', outs: ['next'] },
  { kind: 'spin', outs: ['result', 'failed'] },
];

const doc = (nodes: FlowDoc['nodes'], edges: FlowDoc['edges']): FlowDoc => ({ version: 1, nodes, edges });

describe('validateFlow', () => {
  it('a clean loop through `on` is silent', () =>
    expect(
      validateFlow(
        doc(
          [
            { id: 'a', kind: 'boot' },
            { id: 'b', kind: 'show', props: { scene: 's' } },
            { id: 'c', kind: 'on', props: { event: 'e' } },
            { id: 'd', kind: 'spin' },
          ],
          [
            { from: 'a', to: 'b' },
            { from: 'b', to: 'c' },
            { from: 'c', to: 'd' },
            { from: 'd', to: 'c' },
          ],
        ),
        kinds,
        ['s'],
      ),
    ).toEqual([]));

  it('reports duplicate ids, unknown kinds, dangling edges, bad ports, two boots, an orphan, a bad wait, a missing scene', () => {
    const out = validateFlow(
      doc(
        [
          { id: 'a', kind: 'boot' }, // boot #1
          { id: 'a', kind: 'boot' }, // duplicate id + boot #2
          { id: 'x', kind: 'mystery' }, // unknown kind
          { id: 'orphan', kind: 'show', props: { scene: 's' } }, // no incoming edge
          { id: 'w', kind: 'wait' }, // neither event nor ms
          { id: 'badscene', kind: 'show', props: { scene: 'nope' } }, // scene not in sceneIds
          { id: 'ifnode', kind: 'if', props: { when: 'x' } },
        ],
        [
          { from: 'a', to: 'ifnode' },
          { from: 'ifnode', out: 'maybe', to: 'badscene' }, // 'maybe' not in if's outs
          { from: 'ghost', to: 'a' }, // 'ghost' node doesn't exist
        ],
      ),
      kinds,
      ['s'],
    );

    expect(out).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'error', where: 'a', message: expect.stringContaining('duplicate') }),
        expect.objectContaining({ severity: 'error', where: 'x', message: expect.stringContaining('unknown kind') }),
        expect.objectContaining({ severity: 'error', where: 'ghost→a' }),
        expect.objectContaining({ severity: 'error', where: 'ifnode→badscene' }),
        expect.objectContaining({ severity: 'error', where: 'a', message: expect.stringContaining('boot') }),
        expect.objectContaining({ severity: 'warning', where: 'orphan' }),
        expect.objectContaining({ severity: 'error', where: 'w' }),
        expect.objectContaining({ severity: 'error', where: 'badscene' }),
      ]),
    );
  });

  it('a cycle with no on/wait is an error naming the cycle', () => {
    const out = validateFlow(
      doc(
        [
          { id: 'a', kind: 'boot' },
          { id: 'b', kind: 'show', props: { scene: 's' } },
          { id: 'c', kind: 'if', props: { when: 'x' } },
        ],
        [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
          { from: 'c', out: 'true', to: 'b' },
        ],
      ),
      kinds,
      ['s'],
    );
    expect(out).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        where: 'b',
        message: expect.stringContaining('cycle without a wait'),
      }),
    );
  });

  it('kinds null skips kind checks; sceneIds null skips scene checks', () => {
    const out = validateFlow(
      doc(
        [
          { id: 'a', kind: 'mystery' },
          { id: 'b', kind: 'show', props: { scene: 'nope' } },
        ],
        [{ from: 'a', out: 'weird', to: 'b' }],
      ),
      null,
      null,
    );
    expect(out).toEqual([]);
  });
});

describe('outEdges / inEdges', () => {
  const d = doc(
    [
      { id: 'a', kind: 'if' }, // two-port kind: outs = ['true', 'false']
      { id: 'b', kind: 'show' }, // single-port kind: outs = ['next']
      { id: 'c', kind: 'show' },
    ],
    [
      { from: 'a', out: 'true', to: 'b' },
      { from: 'a', out: 'false', to: 'c' },
      { from: 'b', to: 'c' }, // no explicit `out` — falls back to the caller's defaultOut
    ],
  );

  it('outEdges matches an explicit out label regardless of defaultOut', () => {
    expect(outEdges(d, 'a', 'true', 'true')).toEqual([{ from: 'a', out: 'true', to: 'b' }]);
    expect(outEdges(d, 'a', 'false', 'true')).toEqual([{ from: 'a', out: 'false', to: 'c' }]);
  });

  it("outEdges falls a missing `out` back to the caller's defaultOut (the kind's outs[0])", () => {
    expect(outEdges(d, 'b', 'next', 'next')).toEqual([{ from: 'b', to: 'c' }]);
    // asking for a port that isn't the resolved default must not match
    expect(outEdges(d, 'b', 'other', 'next')).toEqual([]);
  });

  it('outEdges applies defaultOut to a two-port kind too, when the edge omits `out`', () => {
    const twoPort = doc(
      [
        { id: 'x', kind: 'if' },
        { id: 'y', kind: 'show' },
      ],
      [{ from: 'x', to: 'y' }], // omits `out` even though `if` has two ports
    );
    expect(outEdges(twoPort, 'x', 'true', 'true')).toEqual([{ from: 'x', to: 'y' }]);
    expect(outEdges(twoPort, 'x', 'false', 'true')).toEqual([]);
  });

  it('inEdges finds every edge landing on a node, regardless of port', () => {
    expect(inEdges(d, 'c')).toEqual([
      { from: 'a', out: 'false', to: 'c' },
      { from: 'b', to: 'c' },
    ]);
  });
});

describe('validateFlow cycle enumeration (reconverging cycles)', () => {
  // Diamond: a→b, a→c, b→d, c→d, d→a — two DISTINCT elementary cycles
  // through the shared tail `d`: a,b,d and a,c,d. A DFS that marks nodes
  // globally visited (rather than per-root) finds only the first one it
  // reaches and silently drops the other.
  const diamond = (bKind: string, cKind: string) =>
    doc(
      [
        { id: 'a', kind: 'boot' },
        { id: 'b', kind: bKind, props: { event: 'e' } },
        { id: 'c', kind: cKind, props: { event: 'e' } },
        { id: 'd', kind: 'show' },
      ],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'd' },
        { from: 'c', to: 'd' },
        { from: 'd', to: 'a' },
      ],
    );

  const cycleMessages = (out: ReturnType<typeof validateFlow>) =>
    out.filter((d) => d.message.includes('cycle without a wait')).map((d) => d.message);

  it('one branch (`b`) waiting still lets the other (`c`) cycle report', () => {
    const out = validateFlow(diamond('wait', 'show'), kinds, null);
    expect(cycleMessages(out)).toEqual(['cycle without a wait: a → c → d → a']);
  });

  it('both branches waiting silences both cycles', () => {
    const out = validateFlow(diamond('wait', 'wait'), kinds, null);
    expect(cycleMessages(out)).toEqual([]);
  });

  it('a self-loop (non-wait) is an error', () => {
    const out = validateFlow(doc([{ id: 'a', kind: 'show' }], [{ from: 'a', to: 'a' }]), kinds, null);
    expect(out).toEqual([
      expect.objectContaining({ severity: 'error', where: 'a', message: 'cycle without a wait: a → a' }),
    ]);
  });

  it('two independent cycles each report their own error', () => {
    const twoCycles = doc(
      [
        { id: 'p', kind: 'show' },
        { id: 'q', kind: 'show' },
        { id: 'r', kind: 'show' },
        { id: 's', kind: 'show' },
      ],
      [
        { from: 'p', to: 'q' },
        { from: 'q', to: 'p' },
        { from: 'r', to: 's' },
        { from: 's', to: 'r' },
      ],
    );
    const out = validateFlow(twoCycles, kinds, null);
    expect(cycleMessages(out)).toEqual(
      expect.arrayContaining(['cycle without a wait: p → q → p', 'cycle without a wait: r → s → r']),
    );
    expect(cycleMessages(out)).toHaveLength(2);
  });
});
