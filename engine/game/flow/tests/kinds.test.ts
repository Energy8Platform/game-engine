import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { createEvents } from '../src/events';
import { BUILTIN_KINDS, createFlowNodes, type FlowNodeKind, type RunCtx } from '../src/kinds';

const kind = (name: string): FlowNodeKind => BUILTIN_KINDS.find((k) => k.kind === name)!;

function runCtx(provide: Record<string, unknown> = {}, vars: Record<string, unknown> = {}) {
  const ctx = new Context();
  for (const [name, value] of Object.entries(provide)) ctx.provide(name, value);
  const controller = new AbortController();
  const rc: RunCtx = { vars, ctx, signal: controller.signal, fetchFn: vi.fn() as unknown as typeof fetch, report: vi.fn() };
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

  it('boot fires once on the next microtask, not when its signal is already aborted', async () => {
    const fire = vi.fn();
    const { rc, controller } = runCtx();
    kind('boot').arm!({}, fire, rc);
    expect(fire).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fire).toHaveBeenCalledTimes(1);
    controller.abort();
    kind('boot').arm!({}, fire, rc);
    await Promise.resolve();
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
