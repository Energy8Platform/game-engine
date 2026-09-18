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
      { id: 'a', kind: 'if' },
      { id: 'b', kind: 'show' },
      { id: 'c', kind: 'show' },
    ],
    [
      { from: 'a', out: 'true', to: 'b' },
      { from: 'a', out: 'false', to: 'c' },
      { from: 'b', to: 'c' }, // no explicit `out` — defaults to 'next'
    ],
  );

  it('outEdges matches an explicit out label', () => {
    expect(outEdges(d, 'a', 'true')).toEqual([{ from: 'a', out: 'true', to: 'b' }]);
    expect(outEdges(d, 'a', 'false')).toEqual([{ from: 'a', out: 'false', to: 'c' }]);
  });

  it('outEdges treats a missing `out` as \'next\'', () => {
    expect(outEdges(d, 'b', 'next')).toEqual([{ from: 'b', to: 'c' }]);
  });

  it('inEdges finds every edge landing on a node', () => {
    expect(inEdges(d, 'c')).toEqual([
      { from: 'a', out: 'false', to: 'c' },
      { from: 'b', to: 'c' },
    ]);
  });
});
