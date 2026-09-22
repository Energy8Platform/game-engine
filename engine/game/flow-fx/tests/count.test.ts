import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { createEvents, type RunCtx } from '@energy8engine/flow';
import type { Clock } from '../src/audio-state';
import { createCount, type CountProps } from '../src/count';

function runCtx(provide: Record<string, unknown> = {}) {
  const ctx = new Context();
  for (const [name, value] of Object.entries(provide)) ctx.provide(name, value);
  const controller = new AbortController();
  const rc: RunCtx = {
    vars: {},
    ctx,
    signal: controller.signal,
    report: vi.fn(),
    busy: () => false,
    idle: async () => {},
  };
  return { rc, controller };
}

/** The `audio`/`sound` tests' clock, verbatim: steps the count by hand instead of waiting on frames. */
function fakeClock(): { clock: Clock; advance(ms: number): void } {
  let time = 0;
  const fns = new Set<() => void>();
  return {
    clock: {
      now: () => time,
      tick(fn) {
        fns.add(fn);
        return () => fns.delete(fn);
      },
    },
    advance(ms: number) {
      time += ms;
      for (const fn of [...fns]) fn();
    },
  };
}

/** A mounted `text` node, unless `dict` says otherwise. */
function fakeScenes(dict: Record<string, { type: string }> | undefined = { text: { type: 'string' } }) {
  return {
    nodeSchema: vi.fn(() => (dict ? { dict } : undefined)),
    setProps: vi.fn(() => true),
  };
}

const CURRENCY = { session: { currency: { symbol: '$', decimals: 2, position: 'left' } } };

function props(p: Partial<CountProps> = {}): CountProps {
  return {
    target: 'base_game/win',
    from: '0',
    to: '10',
    ms: 1000,
    easing: 'linear',
    format: '',
    wait: true,
    ...p,
  };
}

/** Every `text` written, in order. */
const written = (scenes: ReturnType<typeof fakeScenes>): unknown[] =>
  scenes.setProps.mock.calls.map((c) => (c as unknown as [unknown, { text: unknown }])[1].text);

describe('createCount', () => {
  it('one out, `target` required (with an IDE node picker), from "0", ms 600, easeOutQuad, no format, wait true, no timeout', () => {
    const kind = createCount();
    expect(kind.outs).toEqual(['next']);
    expect(kind.timeout).toBe(false);
    const parsed = kind.schema({ target: 'a/b', to: '1' } as never) as CountProps;
    expect(parsed.from).toBe('0');
    expect(parsed.ms).toBe(600);
    expect(parsed.easing).toBe('easeOutQuad');
    expect(parsed.format).toBe('');
    expect(parsed.wait).toBe(true);
    expect(() => kind.schema({ target: 'a/b' } as never)).toThrow(); // `to` is required
    expect(() => kind.schema({ to: '1' } as never)).toThrow(); // and so is `target`
    expect((kind.schema.dict!.target.meta as { pick?: string }).pick).toBe('node');
  });

  it('writes a formatted value every tick and the EXACT end value last', async () => {
    const { clock, advance } = fakeClock();
    const scenes = fakeScenes();
    const kind = createCount({ clock });
    const { rc } = runCtx({ scenes });
    Object.assign(rc.vars, CURRENCY);
    const pending = kind.run!(props({ to: '4.604', format: 'currency' }), rc);
    expect(written(scenes)).toEqual(['$0.00']);
    advance(500);
    expect(written(scenes)).toEqual(['$0.00', '$2.30']);
    advance(500);
    await expect(pending).resolves.toEqual({ out: 'next' });
    // The last write is the end value itself, not the tick's interpolation.
    expect(written(scenes).at(-1)).toBe('$4.60');
    expect(scenes.setProps).toHaveBeenCalledWith({ scene: 'base_game', node: 'win' }, { text: '$4.60' });
  });

  it('an explicit `from` starts there; `$expr` resolves on both ends', async () => {
    const { clock, advance } = fakeClock();
    const scenes = fakeScenes();
    const kind = createCount({ clock });
    const { rc } = runCtx({ scenes });
    rc.vars.result = { win: 20 };
    const pending = kind.run!(props({ from: '$result.win', to: '$result.win * 2', format: 'int' }), rc);
    expect(written(scenes)).toEqual(['20']);
    advance(500);
    expect(written(scenes)).toEqual(['20', '30']);
    advance(500);
    await pending;
    expect(written(scenes).at(-1)).toBe('40');
  });

  it('format "" writes String(n); `int` rounds; `fixed:2` takes the digit count from the name', async () => {
    const run = async (format: string) => {
      const { clock, advance } = fakeClock();
      const scenes = fakeScenes();
      const { rc } = runCtx({ scenes });
      const pending = createCount({ clock }).run!(props({ to: '4.604', format }), rc);
      advance(1000);
      await pending;
      return written(scenes).at(-1);
    };
    expect(await run('')).toBe('4.604');
    expect(await run('int')).toBe('5');
    expect(await run('fixed:2')).toBe('4.60');
  });

  it('a `to` that is not a number reports and leaves by next, without touching the node', async () => {
    const scenes = fakeScenes();
    const { rc } = runCtx({ scenes });
    const result = await createCount({ clock: fakeClock().clock }).run!(props({ to: 'soon' }), rc);
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith('to "soon" is not a number');
    expect(scenes.setProps).not.toHaveBeenCalled();
  });

  it('a target with no "/" reports and leaves by next', async () => {
    const scenes = fakeScenes();
    const { rc } = runCtx({ scenes });
    const result = await createCount({ clock: fakeClock().clock }).run!(props({ target: 'nope' }), rc);
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith('target must be <scene>/<node>');
    expect(scenes.setProps).not.toHaveBeenCalled();
  });

  it('a node whose schema has no `text` prop reports and leaves by next', async () => {
    const scenes = fakeScenes({ src: { type: 'string' } });
    const { rc } = runCtx({ scenes });
    const result = await createCount({ clock: fakeClock().clock }).run!(props(), rc);
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith('node "base_game/win" has no prop "text"');
    expect(scenes.setProps).not.toHaveBeenCalled();
  });

  it('a first write the scene refuses reports and leaves by next, without counting on', async () => {
    const { clock, advance } = fakeClock();
    const scenes = fakeScenes(undefined); // nothing mounted at that ref
    scenes.setProps.mockReturnValue(false);
    const { rc } = runCtx({ scenes });
    const result = await createCount({ clock }).run!(props(), rc);
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith(`could not set 'text' on "base_game/win"`);
    advance(1000);
    expect(scenes.setProps).toHaveBeenCalledTimes(1);
  });

  it('no `scenes` service at all reports and leaves by next', async () => {
    const { rc } = runCtx();
    const result = await createCount({ clock: fakeClock().clock }).run!(props(), rc);
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith(`no 'scenes' service in this composition`);
  });

  it('wait: false leaves at once and the count keeps writing', async () => {
    const { clock, advance } = fakeClock();
    const scenes = fakeScenes();
    const { rc } = runCtx({ scenes });
    const result = await createCount({ clock }).run!(props({ wait: false, format: 'int' }), rc);
    expect(result).toEqual({ out: 'next' });
    expect(written(scenes)).toEqual(['0']);
    advance(500);
    advance(500);
    expect(written(scenes).at(-1)).toBe('10');
  });

  it('an abort stops the count where it is — nothing more is written, and the reason is rethrown', async () => {
    const { clock, advance } = fakeClock();
    const scenes = fakeScenes();
    const { rc, controller } = runCtx({ scenes });
    const pending = createCount({ clock }).run!(props({ format: 'int' }), rc);
    advance(500);
    expect(written(scenes)).toEqual(['0', '5']);
    const reason = new Error('stopped');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    advance(500);
    expect(written(scenes)).toEqual(['0', '5']); // no end value, no further ticks
  });

  it('a `ui.skip` on the flow bus jumps to the end value and finishes', async () => {
    const { clock, advance } = fakeClock();
    const scenes = fakeScenes();
    const bus = createEvents();
    const { rc } = runCtx({ scenes, events: bus });
    const pending = createCount({ clock }).run!(props({ format: 'int' }), rc);
    advance(250);
    await bus.emit('ui.skip');
    await expect(pending).resolves.toEqual({ out: 'next' });
    expect(written(scenes).at(-1)).toBe('10');
    const writes = written(scenes).length;
    advance(1000);
    expect(written(scenes).length).toBe(writes);
  });
});
