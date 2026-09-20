import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { createEvents } from '../src/events';
import {
  BUILTIN_KINDS,
  createFlowNodes,
  parseTarget,
  type FlowNodeKind,
  type RunCtx,
} from '../src/kinds';

const kind = (name: string): FlowNodeKind => BUILTIN_KINDS.find((k) => k.kind === name)!;

function runCtx(provide: Record<string, unknown> = {}, vars: Record<string, unknown> = {}) {
  const ctx = new Context();
  for (const [name, value] of Object.entries(provide)) ctx.provide(name, value);
  const controller = new AbortController();
  const rc: RunCtx = {
    vars,
    ctx,
    signal: controller.signal,
    fetchFn: vi.fn() as unknown as typeof fetch,
    report: vi.fn(),
    busy: () => false,
    idle: async () => {},
  };
  return { rc, controller };
}

describe('createFlowNodes', () => {
  it('registers last-wins, lists, notifies on register and dispose; a replaced disposer is a no-op', () => {
    const nodes = createFlowNodes();
    const heard = vi.fn();
    nodes.subscribe(heard);
    const a: FlowNodeKind = { kind: 'x', schema: kind('boot').schema, outs: ['a'] };
    const b: FlowNodeKind = { kind: 'x', schema: kind('boot').schema, outs: ['b'] };
    const offA = nodes.register(a);
    const offB = nodes.register(b);
    expect(nodes.get('x')).toBe(b);
    expect(nodes.list()).toEqual([b]);
    offA();
    expect(nodes.get('x')).toBe(b);
    offB();
    expect(nodes.get('x')).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(4);
  });

  it('ships the thirteen built-ins with their ports', () => {
    expect(Object.fromEntries(BUILTIN_KINDS.map((k) => [k.kind, [...k.outs]]))).toEqual({
      boot: ['next'],
      on: ['next'],
      spin: ['result', 'failed'],
      step: ['result', 'failed'],
      present: ['next', 'failed'],
      show: ['next'],
      hide: ['next'],
      wait: ['next'],
      if: ['true', 'false'],
      set: ['next'],
      emit: ['next'],
      prop: ['next'],
      merge: ['next'],
    });
    expect(BUILTIN_KINDS.filter((k) => k.trigger).map((k) => k.kind)).toEqual(['boot', 'on']);
    expect(kind('show').schema.meta).toBeDefined();
    expect((kind('show').schema.dict!.scene.meta as { pick?: string }).pick).toBe('scene');
  });
});

describe('built-in kinds', () => {
  it('show/hide reach scenes', async () => {
    const scenes = { show: vi.fn(async () => {}), hide: vi.fn(async () => {}) };
    const { rc } = runCtx({ scenes });
    expect(await kind('show').run!({ scene: 'a', transition: 'fade' }, rc)).toEqual({ out: 'next' });
    expect(scenes.show).toHaveBeenCalledWith('a', { transition: 'fade' });
    expect(await kind('hide').run!({ scene: 'a' }, rc)).toEqual({ out: 'next' });
    expect(scenes.hide).toHaveBeenCalledWith('a');
  });

  it('show/hide wait for scenes.ready before touching the scenes (the boot race with GET /api/scenes)', async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const scenes = { ready, show: vi.fn(async () => {}), hide: vi.fn(async () => {}) };
    const { rc } = runCtx({ scenes });
    const shown = kind('show').run!({ scene: 'a' }, rc);
    const hidden = kind('hide').run!({ scene: 'a' }, rc);
    await new Promise((r) => setTimeout(r, 0));
    expect(scenes.show).not.toHaveBeenCalled();
    expect(scenes.hide).not.toHaveBeenCalled();
    resolveReady();
    expect(await shown).toEqual({ out: 'next' });
    expect(await hidden).toEqual({ out: 'next' });
    expect(scenes.show).toHaveBeenCalledWith('a', { transition: undefined });
    expect(scenes.hide).toHaveBeenCalledWith('a');
    // A rejected `ready` (the GET failed) does not block: the show itself answers.
    const down = { ready: Promise.reject(new Error('down')), show: vi.fn(async () => {}) };
    expect(await kind('show').run!({ scene: 'a' }, runCtx({ scenes: down }).rc)).toEqual({ out: 'next' });
  });

  it('show without a scenes service throws (the interpreter reports it)', async () => {
    const { rc } = runCtx();
    await expect(kind('show').run!({ scene: 'a' }, rc)).rejects.toThrow(/scenes/);
  });

  /**
   * The interpreter fills schema defaults before calling `run`
   * (`kind.schema(node.props ?? {})`, see `interpreter.ts`'s `step`/`arm`)
   * — every test below goes through the schema too, so `action`'s
   * `default('spin')` is exercised the same way a real run exercises it,
   * not bypassed by handing `run` raw, unfilled props.
   */
  const spinProps = (props: Record<string, unknown> = {}) =>
    kind('spin').schema(props) as { action: string; betLevel?: string };

  it('spin: a thrown fetch leaves by failed with the message', async () => {
    const { rc } = runCtx();
    rc.fetchFn = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await kind('spin').run!(spinProps(), rc)).toEqual({ out: 'failed', vars: { error: 'offline' } });
  });

  it("spin: a bare node defaults `action` to 'spin' via the schema; no `betLevel` omits the key", async () => {
    const { rc } = runCtx();
    const bodies: unknown[] = [];
    rc.fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return { ok: true, json: async () => ({ stage: 'base_game' }) };
    }) as unknown as typeof fetch;
    expect(await kind('spin').run!(spinProps(), rc)).toEqual({
      out: 'result',
      vars: { result: { stage: 'base_game' }, request: { action: 'spin' } },
    });
    expect(bodies).toEqual([{ action: 'spin' }]);
  });

  it('spin: a literal action/betLevel go in the POST body (betLevel converted to a number), and come back as `vars.request`', async () => {
    const { rc } = runCtx();
    const bodies: unknown[] = [];
    rc.fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return { ok: true, json: async () => ({ stage: 'base_game' }) };
    }) as unknown as typeof fetch;
    const out = await kind('spin').run!(spinProps({ action: 'buy', betLevel: '5' }), rc);
    expect(bodies).toEqual([{ action: 'buy', betLevel: 5 }]);
    expect(out).toEqual({
      out: 'result',
      vars: { result: { stage: 'base_game' }, request: { action: 'buy', betLevel: 5 } },
    });
  });

  it('spin: a non-numeric literal betLevel reports and is omitted from the body', async () => {
    const { rc } = runCtx();
    const bodies: unknown[] = [];
    rc.fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const out = await kind('spin').run!(spinProps({ betLevel: 'abc' }), rc);
    expect(rc.report).toHaveBeenCalledWith('betLevel "abc" is not a number');
    expect(bodies).toEqual([{ action: 'spin' }]);
    expect(out).toEqual({ out: 'result', vars: { result: {}, request: { action: 'spin' } } });

    // An empty string is "not a number" too, not `Number('') === 0`.
    await kind('spin').run!(spinProps({ betLevel: '' }), rc);
    expect(rc.report).toHaveBeenLastCalledWith('betLevel "" is not a number');
    expect(bodies.at(-1)).toEqual({ action: 'spin' });
  });

  it('spin: `$path` action/betLevel read vars; an unset betLevel stays out of the body', async () => {
    const { rc } = runCtx({}, { chosen: { action: 'gamble' }, bet: 2 });
    const bodies: unknown[] = [];
    rc.fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const out = await kind('spin').run!(spinProps({ action: '$chosen.action', betLevel: '$bet' }), rc);
    expect(bodies).toEqual([{ action: 'gamble', betLevel: 2 }]);
    expect(out).toEqual({ out: 'result', vars: { result: {}, request: { action: 'gamble', betLevel: 2 } } });

    // Only `action` is `$path`; `betLevel` is never set — omitted, not `null`.
    const out2 = await kind('spin').run!(spinProps({ action: '$chosen.action' }), rc);
    expect(bodies.at(-1)).toEqual({ action: 'gamble' });
    expect(out2).toEqual({ out: 'result', vars: { result: {}, request: { action: 'gamble' } } });
  });

  const stepProps = (props: Record<string, unknown> = {}) =>
    kind('step').schema(props) as { roundId: string; action: string };

  it("step: a bare node defaults roundId/action off vars.result (`nextActions.0` through the array)", async () => {
    const { rc } = runCtx({}, { result: { roundId: 'r-1', nextActions: ['free_spin', 'spin'] } });
    const bodies: unknown[] = [];
    rc.fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return { ok: true, json: async () => ({ roundId: 'r-1', roundComplete: false }) };
    }) as unknown as typeof fetch;
    const out = await kind('step').run!(stepProps(), rc);
    expect(bodies).toEqual([{ action: 'free_spin', roundId: 'r-1' }]);
    expect(out).toEqual({
      out: 'result',
      vars: {
        result: { roundId: 'r-1', roundComplete: false },
        request: { action: 'free_spin', roundId: 'r-1' },
      },
    });
  });

  it('step: a literal roundId/action go in the POST body, not read off vars.result', async () => {
    const { rc } = runCtx({}, { result: { roundId: 'wrong', nextActions: ['wrong-too'] } });
    const bodies: unknown[] = [];
    rc.fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const out = await kind('step').run!(stepProps({ roundId: 'r-9', action: 'buy_bonus' }), rc);
    expect(bodies).toEqual([{ action: 'buy_bonus', roundId: 'r-9' }]);
    expect(out).toEqual({
      out: 'result',
      vars: { result: {}, request: { action: 'buy_bonus', roundId: 'r-9' } },
    });
  });

  it('step: a missing vars.result resolves roundId to null and leaves by failed, reporting — no fetch is made', async () => {
    const { rc } = runCtx();
    const out = await kind('step').run!(stepProps(), rc);
    expect(rc.report).toHaveBeenCalledTimes(1);
    expect(rc.fetchFn).not.toHaveBeenCalled();
    expect(out).toEqual({ out: 'failed', vars: { error: "'step' has no roundId" } });

    // A round known but no next action offered fails the same way, on `action` instead.
    const { rc: rc2 } = runCtx({}, { result: { roundId: 'r-1', nextActions: [] } });
    const out2 = await kind('step').run!(stepProps(), rc2);
    expect(rc2.report).toHaveBeenCalledTimes(1);
    expect(rc2.fetchFn).not.toHaveBeenCalled();
    expect(out2).toEqual({ out: 'failed', vars: { error: "'step' has no action" } });
  });

  it('step: a thrown fetch leaves by failed with the message, same as spin', async () => {
    const { rc } = runCtx({}, { result: { roundId: 'r-1', nextActions: ['spin'] } });
    rc.fetchFn = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await kind('step').run!(stepProps(), rc)).toEqual({
      out: 'failed',
      vars: { error: 'offline' },
    });
  });

  it("present: records the spin log with spin's own request — `{}` when spin carried none", async () => {
    const mechanics = { present: vi.fn(() => ({ plan: [], diagnostics: [] })) };
    const play = { execute: vi.fn(async () => []), record: vi.fn() };
    const result = { stage: 'base_game', data: {} };

    const { rc: withRequest } = runCtx({ mechanics, play }, { result, request: { action: 'buy', betLevel: 5 } });
    await kind('present').run!({}, withRequest);
    expect(play.record).toHaveBeenCalledWith({
      request: { action: 'buy', betLevel: 5 },
      result,
      plan: [],
    });

    const { rc: withoutRequest } = runCtx({ mechanics, play }, { result });
    await kind('present').run!({}, withoutRequest);
    expect(play.record).toHaveBeenLastCalledWith({ request: {}, result, plan: [] });
  });

  describe('parseTarget', () => {
    it('splits on the first "/"; a node id with its own "/" stays intact; no "/" at all is null', () => {
      expect(parseTarget('a/b')).toEqual({ scene: 'a', node: 'b' });
      expect(parseTarget('a/b/c')).toEqual({ scene: 'a', node: 'b/c' });
      expect(parseTarget('nope')).toBeNull();
      expect(parseTarget('')).toBeNull();
    });
  });

  describe('prop', () => {
    /** A fake `ScenesService.nodeSchema` — only `.dict` is read (a prop's `.type`, and prop-name membership), so a plain object stands in for a real `Schema`. */
    const nodeSchema = (dict: Record<string, { type: string }>) => vi.fn(() => ({ dict }));
    /** Schema-filled props, the way the interpreter always calls `run` (`kind.schema(node.props ?? {})`) — same pattern as `spinProps`/`stepProps` above. */
    const propProps = (props: Record<string, unknown> = {}) =>
      kind('prop').schema(props) as { target: string; prop: string; value: string };

    it('no `scenes` service in the composition: reports and leaves by next, without throwing', async () => {
      const { rc } = runCtx();
      expect(await kind('prop').run!({ target: 'a/b', prop: 'x', value: '1' }, rc)).toEqual({ out: 'next' });
      expect(rc.report).toHaveBeenCalledWith("no 'scenes' service in this composition");
    });

    it('a literal target splits on the first "/"; a literal value is coerced by the node schema type', async () => {
      const setProps = vi.fn(() => true);
      const scenes = {
        setProps,
        nodeSchema: nodeSchema({ x: { type: 'number' }, on: { type: 'boolean' }, label: { type: 'string' } }),
      };
      const { rc } = runCtx({ scenes });

      expect(await kind('prop').run!({ target: 'a/b', prop: 'x', value: '5' }, rc)).toEqual({ out: 'next' });
      expect(setProps).toHaveBeenLastCalledWith({ scene: 'a', node: 'b' }, { x: 5 });

      expect(await kind('prop').run!({ target: 'a/b', prop: 'on', value: 'true' }, rc)).toEqual({ out: 'next' });
      expect(setProps).toHaveBeenLastCalledWith({ scene: 'a', node: 'b' }, { on: true });
      expect(await kind('prop').run!({ target: 'a/b', prop: 'on', value: 'nope' }, rc)).toEqual({ out: 'next' });
      expect(setProps).toHaveBeenLastCalledWith({ scene: 'a', node: 'b' }, { on: false });

      expect(await kind('prop').run!({ target: 'a/b', prop: 'label', value: 'hi' }, rc)).toEqual({ out: 'next' });
      expect(setProps).toHaveBeenLastCalledWith({ scene: 'a', node: 'b' }, { label: 'hi' });
      expect(rc.report).not.toHaveBeenCalled();
    });

    it('a non-numeric literal value for a number prop reports and never reaches setProps', async () => {
      const setProps = vi.fn(() => true);
      const scenes = { setProps, nodeSchema: nodeSchema({ x: { type: 'number' } }) };
      const { rc } = runCtx({ scenes });
      expect(await kind('prop').run!({ target: 'a/b', prop: 'x', value: 'abc' }, rc)).toEqual({ out: 'next' });
      expect(rc.report).toHaveBeenCalledWith(`value "abc" is not a number for 'x'`);
      expect(setProps).not.toHaveBeenCalled();
    });

    it('`$path` target/value read vars — the value skips schema coercion entirely', async () => {
      const setProps = vi.fn(() => true);
      const scenes = { setProps, nodeSchema: nodeSchema({ x: { type: 'number' } }) };
      const { rc } = runCtx({ scenes }, { ref: 'a/b', amount: 'not-a-number' });
      expect(await kind('prop').run!({ target: '$ref', prop: 'x', value: '$amount' }, rc)).toEqual({ out: 'next' });
      expect(setProps).toHaveBeenCalledWith({ scene: 'a', node: 'b' }, { x: 'not-a-number' });
      expect(rc.report).not.toHaveBeenCalled();
    });

    it('a `$path` value into a `string` prop is stringified — Schema.string() refuses a raw number/boolean outright', async () => {
      const setProps = vi.fn(() => true);
      const scenes = { setProps, nodeSchema: nodeSchema({ text: { type: 'string' } }) };
      const { rc } = runCtx({ scenes }, { result: { win: 1.5 } });
      expect(
        await kind('prop').run!({ target: 'a/b', prop: 'text', value: '$result.win' }, rc),
      ).toEqual({ out: 'next' });
      expect(setProps).toHaveBeenCalledWith({ scene: 'a', node: 'b' }, { text: '1.5' });
      expect(rc.report).not.toHaveBeenCalled();
    });

    it('a missing node: `setProps` false reports (setProps already reported its own diagnostic elsewhere) and still leaves by next', async () => {
      const setProps = vi.fn(() => false);
      const scenes = { setProps, nodeSchema: vi.fn(() => undefined) };
      const { rc } = runCtx({ scenes });
      expect(await kind('prop').run!({ target: 'a/nope', prop: 'x', value: '1' }, rc)).toEqual({ out: 'next' });
      expect(rc.report).toHaveBeenCalledWith(`could not set 'x' on "a/nope"`);
    });

    it('a refused value: `setProps` false reports and still leaves by next', async () => {
      const setProps = vi.fn(() => false);
      const scenes = { setProps, nodeSchema: nodeSchema({ x: { type: 'number' } }) };
      const { rc } = runCtx({ scenes });
      expect(await kind('prop').run!({ target: 'a/b', prop: 'x', value: '5' }, rc)).toEqual({ out: 'next' });
      expect(setProps).toHaveBeenCalledWith({ scene: 'a', node: 'b' }, { x: 5 });
      expect(rc.report).toHaveBeenCalledWith(`could not set 'x' on "a/b"`);
    });

    it("a bare node (no `value` in props): the schema defaults it to '' — a number prop gets 0, a string prop gets '', not a dropped key", async () => {
      const setProps = vi.fn(() => true);
      const scenes = {
        setProps,
        nodeSchema: nodeSchema({ x: { type: 'number' }, label: { type: 'string' } }),
      };
      const { rc } = runCtx({ scenes });

      expect(await kind('prop').run!(propProps({ target: 'a/b', prop: 'x' }), rc)).toEqual({
        out: 'next',
      });
      expect(setProps).toHaveBeenLastCalledWith({ scene: 'a', node: 'b' }, { x: 0 });
      expect(rc.report).not.toHaveBeenCalled();

      expect(await kind('prop').run!(propProps({ target: 'a/b', prop: 'label' }), rc)).toEqual({
        out: 'next',
      });
      expect(setProps).toHaveBeenLastCalledWith({ scene: 'a', node: 'b' }, { label: '' });
    });

    it('waits for scenes.ready before touching nodeSchema/setProps (the boot race with GET /api/scenes), same as show/hide', async () => {
      let resolveReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      const setProps = vi.fn(() => true);
      const scenes = { ready, setProps, nodeSchema: nodeSchema({ x: { type: 'number' } }) };
      const { rc } = runCtx({ scenes });
      const pending = kind('prop').run!(propProps({ target: 'a/b', prop: 'x', value: '5' }), rc);
      await new Promise((r) => setTimeout(r, 0));
      expect(setProps).not.toHaveBeenCalled();
      resolveReady();
      expect(await pending).toEqual({ out: 'next' });
      expect(setProps).toHaveBeenCalledWith({ scene: 'a', node: 'b' }, { x: 5 });

      // A rejected `ready` (the GET failed) does not block: `prop` still runs.
      const down = {
        ready: Promise.reject(new Error('down')),
        setProps,
        nodeSchema: nodeSchema({ x: { type: 'number' } }),
      };
      expect(
        await kind('prop').run!(
          propProps({ target: 'a/b', prop: 'x', value: '5' }),
          runCtx({ scenes: down }).rc,
        ),
      ).toEqual({ out: 'next' });
    });

    it('a prop name absent from the node schema reports and never reaches setProps (schemastery would otherwise pass it through unvalidated)', async () => {
      const setProps = vi.fn(() => true);
      const scenes = { setProps, nodeSchema: nodeSchema({ x: { type: 'number' } }) };
      const { rc } = runCtx({ scenes });
      expect(
        await kind('prop').run!(propProps({ target: 'a/b', prop: 'nope', value: '1' }), rc),
      ).toEqual({ out: 'next' });
      expect(rc.report).toHaveBeenCalledWith(`node "a/b" has no prop "nope"`);
      expect(setProps).not.toHaveBeenCalled();

      // A missing NODE (no schema at all) is a different case — that's the
      // "missing node" test above, and does not trip this check.
    });

    it('a target with no "/" reports and never reaches nodeSchema/setProps', async () => {
      const setProps = vi.fn(() => true);
      const nodeSchemaFn = vi.fn();
      const scenes = { setProps, nodeSchema: nodeSchemaFn };
      const { rc } = runCtx({ scenes });
      expect(
        await kind('prop').run!(propProps({ target: 'nope', prop: 'x', value: '1' }), rc),
      ).toEqual({ out: 'next' });
      expect(rc.report).toHaveBeenCalledWith('target must be <scene>/<node>');
      expect(nodeSchemaFn).not.toHaveBeenCalled();
      expect(setProps).not.toHaveBeenCalled();

      // Same for a `$path` target that resolves to a slash-less string.
      const { rc: rc2 } = runCtx({ scenes }, { ref: 'nope' });
      expect(
        await kind('prop').run!(propProps({ target: '$ref', prop: 'x', value: '1' }), rc2),
      ).toEqual({ out: 'next' });
      expect(rc2.report).toHaveBeenCalledWith('target must be <scene>/<node>');
    });
  });

  it('wait on a signal already aborted rejects at once; abort mid-wait rejects and clears the timer', async () => {
    vi.useFakeTimers();
    try {
      const { rc, controller } = runCtx({ events: createEvents() });
      const pending = kind('wait').run!({ ms: 1000 }, rc);
      controller.abort();
      await expect(pending).rejects.toBeDefined();
      await expect(kind('wait').run!({ ms: 1000 }, rc)).rejects.toBeDefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('wait with neither event nor ms rejects instead of hanging; on without an event reports and arms nothing', async () => {
    const events = createEvents();
    const { rc } = runCtx({ events });
    await expect(kind('wait').run!({}, rc)).rejects.toThrow("'wait' needs an 'event' or 'ms'");
    // `''` — what the form's empty option commits — is absent, not an event named ''.
    await expect(kind('wait').run!({ event: '' }, rc)).rejects.toThrow("'wait' needs an 'event' or 'ms'");
    const fire = vi.fn();
    const off = kind('on').arm!({ busy: 'ignore' }, fire, rc);
    expect(rc.report).toHaveBeenCalledWith("'on' needs an 'event'");
    events.emit('undefined');
    expect(fire).not.toHaveBeenCalled();
    expect(() => off()).not.toThrow();
    kind('on').arm!({ event: '', busy: 'ignore' }, fire, rc);
    expect(rc.report).toHaveBeenCalledTimes(2);
    events.emit('');
    expect(fire).not.toHaveBeenCalled();
  });

  it('wait { event: "", ms } waits the ms and subscribes to no event', async () => {
    vi.useFakeTimers();
    try {
      const events = createEvents();
      const on = vi.spyOn(events, 'on');
      const { rc } = runCtx({ events });
      const pending = kind('wait').run!({ event: '', ms: 10 }, rc);
      expect(on).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10);
      expect(await pending).toEqual({ out: 'next' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('boot fires once on the next microtask; wait opts out of the run timeout', async () => {
    const fire = vi.fn();
    const { rc } = runCtx();
    kind('boot').arm!({}, fire, rc);
    expect(fire).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fire).toHaveBeenCalledTimes(1);
    expect(kind('wait').timeout).toBe(false);
    expect(BUILTIN_KINDS.filter((k) => k.timeout === false).map((k) => k.kind)).toEqual(['wait']);
  });
});
