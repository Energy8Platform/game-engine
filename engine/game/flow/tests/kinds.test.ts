import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { createEvents } from '../src/events';
import { BUILTIN_KINDS, createFlowNodes, type FlowNodeKind, type RunCtx } from '../src/kinds';

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

  it('ships the eleven built-ins with their ports', () => {
    expect(Object.fromEntries(BUILTIN_KINDS.map((k) => [k.kind, [...k.outs]]))).toEqual({
      boot: ['next'],
      on: ['next'],
      spin: ['result', 'failed'],
      present: ['next', 'failed'],
      show: ['next'],
      hide: ['next'],
      wait: ['next'],
      if: ['true', 'false'],
      set: ['next'],
      emit: ['next'],
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

  it('spin: a thrown fetch leaves by failed with the message', async () => {
    const { rc } = runCtx();
    rc.fetchFn = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await kind('spin').run!({}, rc)).toEqual({ out: 'failed', vars: { error: 'offline' } });
  });

  it('spin: no action/betLevel posts `{}`, same as before — `vars.request` mirrors the empty body', async () => {
    const { rc } = runCtx();
    const bodies: string[] = [];
    rc.fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(init!.body as string);
      return { ok: true, json: async () => ({ stage: 'base_game' }) };
    }) as unknown as typeof fetch;
    expect(await kind('spin').run!({}, rc)).toEqual({
      out: 'result',
      vars: { result: { stage: 'base_game' }, request: {} },
    });
    expect(bodies).toEqual(['{}']);
  });

  it('spin: a literal action/betLevel go in the POST body, and come back as `vars.request`', async () => {
    const { rc } = runCtx();
    const bodies: unknown[] = [];
    rc.fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return { ok: true, json: async () => ({ stage: 'base_game' }) };
    }) as unknown as typeof fetch;
    const out = await kind('spin').run!({ action: 'buy', betLevel: 5 }, rc);
    expect(bodies).toEqual([{ action: 'buy', betLevel: 5 }]);
    expect(out).toEqual({
      out: 'result',
      vars: { result: { stage: 'base_game' }, request: { action: 'buy', betLevel: 5 } },
    });
  });

  it('spin: `$path` action/betLevel read vars; an unset betLevel stays out of the body', async () => {
    const { rc } = runCtx({}, { chosen: { action: 'gamble' }, bet: 2 });
    const bodies: unknown[] = [];
    rc.fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const out = await kind('spin').run!({ action: '$chosen.action', betLevel: '$bet' }, rc);
    expect(bodies).toEqual([{ action: 'gamble', betLevel: 2 }]);
    expect(out).toEqual({ out: 'result', vars: { result: {}, request: { action: 'gamble', betLevel: 2 } } });

    // Only `action` is `$path`; `betLevel` is never set — omitted, not `null`.
    const out2 = await kind('spin').run!({ action: '$chosen.action' }, rc);
    expect(bodies.at(-1)).toEqual({ action: 'gamble' });
    expect(out2).toEqual({ out: 'result', vars: { result: {}, request: { action: 'gamble' } } });
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
