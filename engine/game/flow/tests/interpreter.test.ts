import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import type { FlowDoc, FlowTraceEntry } from '@energy8engine/contracts';
import { createEvents } from '../src/events';
import { BUILTIN_KINDS, createFlowNodes, type FlowNodeKind } from '../src/kinds';
import { createFlow, type CreateFlowOptions } from '../src/interpreter';

const doc = (nodes: FlowDoc['nodes'], edges: FlowDoc['edges']): FlowDoc => ({ version: 1, nodes, edges });
const okBody = { stage: 'base_game', data: {}, win: 0 };

function harness(opts: Partial<CreateFlowOptions> = {}, extraKinds: FlowNodeKind[] = []) {
  const ctx = new Context();
  const events = createEvents();
  ctx.provide('events', events);
  const scenes = { show: vi.fn(async () => {}), hide: vi.fn(async () => {}) };
  ctx.provide('scenes', scenes);
  const mechanics = { present: vi.fn(() => ({ plan: [{ kind: 'x' }], diagnostics: [] as unknown[] })) };
  ctx.provide('mechanics', mechanics);
  const play = { execute: vi.fn(async () => [] as unknown[]), record: vi.fn() };
  ctx.provide('play', play);
  const board = { tag: 'board' };
  ctx.provide('board', board);
  const kinds = createFlowNodes();
  for (const k of [...BUILTIN_KINDS, ...extraKinds]) kinds.register(k);
  const report = vi.fn();
  const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => okBody }));
  const flow = createFlow({ kinds, ctx, report, fetchFn: fetchFn as unknown as typeof fetch, ...opts });
  const exits = () => flow.trace().filter((e) => e.out !== null).map((e) => `${e.node}.${e.out}`);
  return { ctx, events, scenes, mechanics, play, board, kinds, report, fetchFn, flow, exits };
}

/** A flow that has settled: no branch will trace anything more. */
const settled = (f: ReturnType<typeof harness>, want: string[]) =>
  vi.waitFor(() => expect(f.exits()).toEqual(want));

afterEach(() => vi.useRealTimers());

describe('createFlow', () => {
  it('boot → show → on: boot fires once, show is called, on is armed; an event starts a new branch each time', async () => {
    const f = harness();
    f.flow.replace(
      doc(
        [
          { id: 'start', kind: 'boot' },
          { id: 'base', kind: 'show', props: { scene: 'base_game' } },
          { id: 'idle', kind: 'on', props: { event: 'ui.spin' } },
          { id: 'hideIt', kind: 'hide', props: { scene: 'base_game' } },
        ],
        [
          { from: 'start', to: 'base' },
          { from: 'base', to: 'idle' },
          { from: 'idle', to: 'hideIt' },
        ],
      ),
    );
    expect(f.flow.doc()?.nodes).toHaveLength(4);
    await settled(f, ['start.next', 'base.next']);
    expect(f.scenes.show).toHaveBeenCalledWith('base_game', { transition: undefined });
    // Entering `on` traces the arrival and the branch ends there.
    expect(f.flow.trace().at(-1)).toMatchObject({ run: 1, node: 'idle', out: null });
    f.events.emit('ui.spin');
    await settled(f, ['start.next', 'base.next', 'idle.next', 'hideIt.next']);
    f.events.emit('ui.spin', { bet: 2 });
    await settled(f, ['start.next', 'base.next', 'idle.next', 'hideIt.next', 'idle.next', 'hideIt.next']);
    expect(f.flow.trace().at(-1)).toMatchObject({ run: 3, node: 'hideIt', out: 'next' });
    expect(f.scenes.hide).toHaveBeenCalledTimes(2);
    expect(f.report).not.toHaveBeenCalled();
  });

  it('spin puts result in vars and records; a 500 leaves by failed with vars.error', async () => {
    const f = harness();
    let seen: Record<string, unknown> = {};
    f.kinds.register({
      kind: 'peek',
      schema: BUILTIN_KINDS[0].schema,
      outs: ['next'],
      run: async (_p, c) => {
        seen = { ...c.vars };
        return { out: 'next' };
      },
    });
    const d = doc(
      [
        { id: 'start', kind: 'boot' },
        { id: 'spin', kind: 'spin' },
        { id: 'ok', kind: 'peek' },
        { id: 'bad', kind: 'peek' },
      ],
      [
        { from: 'start', to: 'spin' },
        { from: 'spin', out: 'result', to: 'ok' },
        { from: 'spin', out: 'failed', to: 'bad' },
      ],
    );
    f.flow.replace(d);
    await settled(f, ['start.next', 'spin.result', 'ok.next']);
    expect(f.fetchFn).toHaveBeenCalledWith('/api/spin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(seen.result).toEqual(okBody);
    expect(f.play.record).toHaveBeenCalledWith({ request: {}, result: okBody, plan: [] });

    f.fetchFn.mockResolvedValueOnce({ ok: false, status: 500, json: async () => okBody });
    f.flow.replace(d);
    await settled(f, ['start.next', 'spin.failed', 'bad.next']);
    expect(seen.error).toMatch(/500/);
    expect(f.play.record).toHaveBeenCalledTimes(1);
  });

  it('present calls mechanics.present + play.execute; diagnostics leave by failed', async () => {
    const f = harness();
    const d = doc(
      [
        { id: 'start', kind: 'boot' },
        { id: 'spin', kind: 'spin' },
        { id: 'draw', kind: 'present' },
      ],
      [
        { from: 'start', to: 'spin' },
        { from: 'spin', to: 'draw' },
      ],
    );
    f.flow.replace(d);
    await settled(f, ['start.next', 'spin.result', 'draw.next']);
    expect(f.mechanics.present).toHaveBeenCalledWith('base_game', {});
    expect(f.play.execute).toHaveBeenCalledWith([{ kind: 'x' }], f.board);

    f.mechanics.present.mockReturnValueOnce({ plan: [], diagnostics: [{ message: 'no mechanic' }] });
    f.flow.replace(d);
    await settled(f, ['start.next', 'spin.result', 'draw.failed']);
    expect(f.play.execute).toHaveBeenCalledTimes(1);

    f.play.execute.mockResolvedValueOnce([{ message: 'step blew up' }]);
    f.flow.replace(d);
    await settled(f, ['start.next', 'spin.result', 'draw.failed']);
  });

  it('if takes true/false; a bad expression is a diagnostic and false', async () => {
    const f = harness();
    const d = (when: string) =>
      doc(
        [
          { id: 'start', kind: 'boot' },
          { id: 'setX', kind: 'set', props: { name: 'x', value: 3 } },
          { id: 'q', kind: 'if', props: { when } },
          { id: 'yes', kind: 'set', props: { name: 'took', value: 'yes' } },
          { id: 'no', kind: 'set', props: { name: 'took', value: 'no' } },
        ],
        [
          { from: 'start', to: 'setX' },
          { from: 'setX', to: 'q' },
          { from: 'q', out: 'true', to: 'yes' },
          { from: 'q', out: 'false', to: 'no' },
        ],
      );
    f.flow.replace(d('x > 2'));
    await settled(f, ['start.next', 'setX.next', 'q.true', 'yes.next']);
    f.flow.replace(d('x > 5'));
    await settled(f, ['start.next', 'setX.next', 'q.false', 'no.next']);
    expect(f.report).not.toHaveBeenCalled();
    f.flow.replace(d('x >'));
    await settled(f, ['start.next', 'setX.next', 'q.false', 'no.next']);
    expect(f.report).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', plugin: 'flow', where: 'q' }));
  });

  it('fan-out runs both branches; merge waits for both, passes once per run', async () => {
    const f = harness();
    f.flow.replace(
      doc(
        [
          { id: 'start', kind: 'boot' },
          { id: 'a', kind: 'set', props: { name: 'a', value: 1 } },
          { id: 'b', kind: 'wait', props: { ms: 5 } },
          { id: 'm', kind: 'merge' },
          { id: 'after', kind: 'set', props: { name: 'done', value: true } },
          { id: 'idle', kind: 'on', props: { event: 'again' } },
        ],
        [
          { from: 'start', to: 'a' },
          { from: 'start', to: 'b' },
          { from: 'a', to: 'm' },
          { from: 'b', to: 'm' },
          { from: 'm', to: 'after' },
          { from: 'after', to: 'idle' },
          { from: 'idle', to: 'a' },
          { from: 'idle', to: 'b' },
        ],
      ),
    );
    await settled(f, ['start.next', 'a.next', 'b.next', 'm.next', 'after.next']);
    // `m` was entered twice (once per incoming edge) and left once.
    expect(f.flow.trace().filter((e) => e.node === 'm')).toHaveLength(3);
    f.events.emit('again');
    await settled(f, [
      'start.next', 'a.next', 'b.next', 'm.next', 'after.next',
      'idle.next', 'a.next', 'b.next', 'm.next', 'after.next',
    ]);
    expect(f.flow.trace().filter((e) => e.node === 'm' && e.run === 2 && e.out === 'next')).toHaveLength(1);
  });

  it('wait ms resolves; wait event resolves on emit; replace() mid-wait aborts the branch (no trace after)', async () => {
    const f = harness();
    f.flow.replace(
      doc(
        [
          { id: 'start', kind: 'boot' },
          { id: 'w1', kind: 'wait', props: { ms: 5 } },
          { id: 'w2', kind: 'wait', props: { event: 'go' } },
          { id: 'end', kind: 'set', props: { name: 'x', value: 1 } },
        ],
        [
          { from: 'start', to: 'w1' },
          { from: 'w1', to: 'w2' },
          { from: 'w2', to: 'end' },
        ],
      ),
    );
    await settled(f, ['start.next', 'w1.next']);
    f.events.emit('go');
    await settled(f, ['start.next', 'w1.next', 'w2.next', 'end.next']);

    const empty = doc([{ id: 'start', kind: 'boot' }], []);
    f.flow.replace(
      doc(
        [
          { id: 'start', kind: 'boot' },
          { id: 'w', kind: 'wait', props: { ms: 10_000, event: 'never' } },
          { id: 'end', kind: 'set', props: { name: 'x', value: 1 } },
        ],
        [
          { from: 'start', to: 'w' },
          { from: 'w', to: 'end' },
        ],
      ),
    );
    await vi.waitFor(() => expect(f.flow.trace().at(-1)).toMatchObject({ node: 'w', out: null }));
    f.flow.replace(empty);
    f.events.emit('never');
    await settled(f, ['start.next']);
    await new Promise((r) => setTimeout(r, 20));
    expect(f.exits()).toEqual(['start.next']);
    expect(f.report).not.toHaveBeenCalled();
  });

  it('a throwing run and a 30 s run (fake timers) report a diagnostic naming the node; the branch ends', async () => {
    vi.useFakeTimers();
    const boom: FlowNodeKind = {
      kind: 'boom',
      schema: BUILTIN_KINDS[0].schema,
      outs: ['next'],
      run: async () => {
        throw new Error('kaboom');
      },
    };
    const slow: FlowNodeKind = {
      kind: 'slow',
      schema: BUILTIN_KINDS[0].schema,
      outs: ['next'],
      run: () => new Promise(() => {}),
    };
    const f = harness({}, [boom, slow]);
    f.flow.replace(
      doc(
        [
          { id: 'start', kind: 'boot' },
          { id: 'x', kind: 'boom' },
          { id: 'y', kind: 'slow' },
          { id: 'never', kind: 'set', props: { name: 'n', value: 1 } },
        ],
        [
          { from: 'start', to: 'x' },
          { from: 'start', to: 'y' },
          { from: 'x', to: 'never' },
          { from: 'y', to: 'never' },
        ],
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(f.report).toHaveBeenCalledWith(
      expect.objectContaining({ plugin: 'flow', where: 'x', message: expect.stringContaining('kaboom') }),
    );
    expect(f.report).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.report).toHaveBeenCalledWith(
      expect.objectContaining({ plugin: 'flow', where: 'y', message: 'node "y" (slow) did not finish in 30 s' }),
    );
    expect(f.exits()).toEqual(['start.next']);
    expect(f.flow.trace().filter((e) => e.node === 'never')).toEqual([]);
  });

  it('an unknown kind on a node is reported and the branch ends', async () => {
    const f = harness();
    const off = f.kinds.register({
      kind: 'ghost',
      schema: BUILTIN_KINDS[0].schema,
      outs: ['next'],
      run: async () => ({ out: 'next' }),
    });
    f.flow.replace(
      doc(
        [
          { id: 'start', kind: 'boot' },
          { id: 'x', kind: 'ghost' },
          { id: 'y', kind: 'set', props: { name: 'b', value: 1 } },
        ],
        [
          { from: 'start', to: 'x' },
          { from: 'x', to: 'y' },
        ],
      ),
    );
    off(); // gone between validation and the boot microtask
    await vi.waitFor(() =>
      expect(f.report).toHaveBeenCalledWith(
        expect.objectContaining({ plugin: 'flow', where: 'x', message: expect.stringContaining('ghost') }),
      ),
    );
    expect(f.exits()).toEqual(['start.next']);
    expect(f.flow.trace().filter((e) => e.node === 'y')).toEqual([]);
  });

  it('replace with a cycle-without-wait reports and starts nothing; a warning-only doc runs', async () => {
    const f = harness();
    const bad = doc(
      [
        { id: 'start', kind: 'boot' },
        { id: 'a', kind: 'set', props: { name: 'a', value: 1 } },
        { id: 'b', kind: 'set', props: { name: 'b', value: 1 } },
      ],
      [
        { from: 'start', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    );
    f.flow.replace(bad);
    expect(f.flow.doc()).toBe(bad);
    expect(f.report).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('cycle without a wait') }));
    await new Promise((r) => setTimeout(r, 5));
    expect(f.flow.trace()).toEqual([]);

    f.report.mockClear();
    const warned = doc(
      [
        { id: 'start', kind: 'boot' },
        { id: 'orphan', kind: 'set', props: { name: 'o', value: 1 } },
      ],
      [],
    );
    f.flow.replace(warned);
    expect(f.report).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning', where: 'orphan' }));
    await settled(f, ['start.next']);
  });

  it('trace keeps the last 500 entries; onTrace hears each; stop() disarms `on`', async () => {
    const f = harness();
    const heard: FlowTraceEntry[] = [];
    const off = f.flow.onTrace((e) => heard.push(e));
    f.flow.replace(
      doc(
        [
          { id: 'idle', kind: 'on', props: { event: 'e' } },
          { id: 's', kind: 'set', props: { name: 'x', value: 1 } },
        ],
        [{ from: 'idle', to: 's' }],
      ),
    );
    // Each event: idle enter, idle leave, s enter, s leave = 4 entries.
    for (let i = 0; i < 150; i++) f.events.emit('e');
    await vi.waitFor(() => expect(heard).toHaveLength(600));
    expect(f.flow.trace()).toHaveLength(500);
    expect(f.flow.trace()[0]).toEqual(heard[100]);
    expect(f.flow.trace().at(-1)).toMatchObject({ run: 150, node: 's', out: 'next' });
    off();
    f.flow.stop();
    f.events.emit('e');
    await new Promise((r) => setTimeout(r, 5));
    expect(heard).toHaveLength(600);
    expect(f.flow.doc()).not.toBeNull();
  });

  it('set writes a literal and a $path; emit reaches events.on', async () => {
    const f = harness();
    const got = vi.fn();
    f.events.on('out', got);
    let seen: Record<string, unknown> = {};
    f.kinds.register({
      kind: 'peek',
      schema: BUILTIN_KINDS[0].schema,
      outs: ['next'],
      run: async (_p, c) => {
        seen = { ...c.vars };
        return { out: 'next' };
      },
    });
    f.flow.replace(
      doc(
        [
          { id: 'start', kind: 'boot' },
          { id: 'lit', kind: 'set', props: { name: 'cfg', value: { bet: 2 } } },
          { id: 'path', kind: 'set', props: { name: 'bet', value: '$cfg.bet' } },
          { id: 'say', kind: 'emit', props: { event: 'out', payload: '$bet' } },
          { id: 'p', kind: 'peek' },
        ],
        [
          { from: 'start', to: 'lit' },
          { from: 'lit', to: 'path' },
          { from: 'path', to: 'say' },
          { from: 'say', to: 'p' },
        ],
      ),
    );
    await settled(f, ['start.next', 'lit.next', 'path.next', 'say.next', 'p.next']);
    expect(seen).toMatchObject({ cfg: { bet: 2 }, bet: 2 });
    expect(got).toHaveBeenCalledWith(2);
    expect(f.flow.ready).toBeInstanceOf(Promise);
  });
});
