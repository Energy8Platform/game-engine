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
    report: vi.fn(),
    busy: () => false,
    idle: async () => {},
  };
  return { rc, controller };
}

/** A `session` seam whose `play` answers `answer` — `{ result: {} }` by default; `{ diagnostics }` alone for a play with no result. */
function fakeSession(answer: { result?: unknown; diagnostics?: { severity: string; message: string }[] } = { result: {} }) {
  return {
    init: { balance: 1000, currency: { code: 'USD', symbol: '$', decimals: 2, position: 'left' }, betLevels: [1], defaultBet: 1 },
    play: vi.fn(async () => ({ diagnostics: [], ...answer })),
  };
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

  it('ships the fifteen built-ins with their ports, `shell` and `ack` between `prop` and `merge`', () => {
    expect(BUILTIN_KINDS.map((k) => k.kind)).toEqual([
      'boot', 'on', 'spin', 'step', 'present', 'show', 'hide', 'wait', 'if', 'set', 'emit', 'prop', 'shell', 'ack', 'merge',
    ]);
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
      shell: ['next'],
      ack: ['next'],
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

  it('spin: no session row in the composition reports and leaves by failed', async () => {
    const { rc } = runCtx();
    expect(await kind('spin').run!(spinProps(), rc)).toEqual({ out: 'failed', vars: { error: 'no session' } });
    expect(rc.report).toHaveBeenCalledWith('no session row in this composition');
  });

  it("spin: a bare node defaults `action` to 'spin' via the schema; no `betLevel` omits the key", async () => {
    const session = fakeSession({ result: { stage: 'base_game' } });
    const { rc } = runCtx({ session });
    expect(await kind('spin').run!(spinProps(), rc)).toEqual({
      out: 'result',
      vars: { result: { stage: 'base_game' }, request: { action: 'spin' } },
    });
    expect(session.play).toHaveBeenCalledWith({ action: 'spin' });
  });

  it('spin: a literal action/betLevel go to session.play (betLevel converted to a number), and come back as `vars.request`', async () => {
    const session = fakeSession({ result: { stage: 'base_game' } });
    const { rc } = runCtx({ session });
    const out = await kind('spin').run!(spinProps({ action: 'buy', betLevel: '5' }), rc);
    expect(session.play).toHaveBeenCalledWith({ action: 'buy', betLevel: 5 });
    expect(out).toEqual({
      out: 'result',
      vars: { result: { stage: 'base_game' }, request: { action: 'buy', betLevel: 5 } },
    });
  });

  it('spin: a non-numeric literal betLevel reports and is omitted from the request', async () => {
    const session = fakeSession();
    const { rc } = runCtx({ session });
    const out = await kind('spin').run!(spinProps({ betLevel: 'abc' }), rc);
    expect(rc.report).toHaveBeenCalledWith('betLevel "abc" is not a number');
    expect(session.play).toHaveBeenLastCalledWith({ action: 'spin' });
    expect(out).toEqual({ out: 'result', vars: { result: {}, request: { action: 'spin' } } });

    // An empty string is "not a number" too, not `Number('') === 0`.
    await kind('spin').run!(spinProps({ betLevel: '' }), rc);
    expect(rc.report).toHaveBeenLastCalledWith('betLevel "" is not a number');
    expect(session.play).toHaveBeenLastCalledWith({ action: 'spin' });
  });

  it('spin: `$path` action/betLevel read vars (`$shell.bet` off a live root included); an unset betLevel stays out of the request', async () => {
    const session = fakeSession();
    const vars = Object.create({ shell: { bet: 2 } }) as Record<string, unknown>;
    vars.chosen = { action: 'gamble' };
    const { rc } = runCtx({ session }, vars);
    const out = await kind('spin').run!(spinProps({ action: '$chosen.action', betLevel: '$shell.bet' }), rc);
    expect(session.play).toHaveBeenLastCalledWith({ action: 'gamble', betLevel: 2 });
    expect(out).toEqual({ out: 'result', vars: { result: {}, request: { action: 'gamble', betLevel: 2 } } });

    // Only `action` is `$path`; `betLevel` is never set — omitted, not `null`.
    const out2 = await kind('spin').run!(spinProps({ action: '$chosen.action' }), rc);
    expect(session.play).toHaveBeenLastCalledWith({ action: 'gamble' });
    expect(out2).toEqual({ out: 'result', vars: { result: {}, request: { action: 'gamble' } } });

    // An `action` that resolves to nothing is `failed` on the node (a `PlayRequest` needs one), not a play of `null`.
    expect(await kind('spin').run!(spinProps({ action: '$missing' }), rc)).toEqual({
      out: 'failed',
      vars: { error: "'spin' has no action" },
    });
    expect(rc.report).toHaveBeenLastCalledWith("'spin' has no action to send (resolved from '$missing')");
    expect(session.play).toHaveBeenCalledTimes(2);
  });

  it('spin: a `$expr` betLevel computes (`$shell.bet * 2` doubles the live bet); a template action is a string and goes on the wire', async () => {
    const session = fakeSession();
    const { rc } = runCtx({ session }, { shell: { bet: 2 }, kind: 'bonus' });
    await kind('spin').run!(spinProps({ action: 'buy_{$kind}', betLevel: '$shell.bet * 2' }), rc);
    expect(session.play).toHaveBeenLastCalledWith({ action: 'buy_bonus', betLevel: 4 });
    expect(rc.report).not.toHaveBeenCalled();
  });

  it('spin: a `$expr` that does not parse is a warning on the node and the string goes as written', async () => {
    const session = fakeSession();
    const { rc } = runCtx({ session }, { shell: { bet: 2 } });
    await kind('spin').run!(spinProps({ betLevel: '$shell.bet | bogus' }), rc);
    expect(rc.report).toHaveBeenCalledWith(expect.stringMatching(/^bad value '\$shell.bet \| bogus': unknown format 'bogus'/), 'warning');
    expect(rc.report).toHaveBeenLastCalledWith('betLevel "$shell.bet | bogus" is not a number');
    expect(session.play).toHaveBeenLastCalledWith({ action: 'spin' });
  });

  it('spin: a `$path` action that resolves to a non-string (a number, an object) is refused the same way — never on the wire', async () => {
    const session = fakeSession();
    const { rc } = runCtx({ session }, { n: 5, chosen: { action: 'gamble' } });
    expect(await kind('spin').run!(spinProps({ action: '$n' }), rc)).toEqual({
      out: 'failed',
      vars: { error: "'spin' has no action" },
    });
    expect(rc.report).toHaveBeenLastCalledWith("'spin' has no action to send (resolved from '$n')");
    expect(await kind('spin').run!(spinProps({ action: '$chosen' }), rc)).toEqual({
      out: 'failed',
      vars: { error: "'spin' has no action" },
    });
    expect(rc.report).toHaveBeenLastCalledWith("'spin' has no action to send (resolved from '$chosen')");
    expect(session.play).not.toHaveBeenCalled();
  });

  it("spin: a play without a result leaves by failed with the diagnostics joined, each re-reported with its severity; none at all is 'no result'", async () => {
    const session = fakeSession({
      diagnostics: [
        { severity: 'error', message: 'POST /api/spin → 500' },
        { severity: 'warning', message: 'and a note' },
      ],
    });
    const { rc } = runCtx({ session });
    expect(await kind('spin').run!(spinProps(), rc)).toEqual({
      out: 'failed',
      vars: { error: 'POST /api/spin → 500; and a note' },
    });
    expect(rc.report).toHaveBeenCalledWith('POST /api/spin → 500', 'error');
    expect(rc.report).toHaveBeenCalledWith('and a note', 'warning');

    const { rc: quiet } = runCtx({ session: fakeSession({ diagnostics: [] }) });
    expect(await kind('spin').run!(spinProps(), quiet)).toEqual({ out: 'failed', vars: { error: 'no result' } });
  });

  it('spin: a play that throws leaves by failed with the message (the flow still reaches its `failed` edge)', async () => {
    const session = fakeSession();
    session.play.mockRejectedValueOnce(new Error('offline'));
    const { rc } = runCtx({ session });
    expect(await kind('spin').run!(spinProps(), rc)).toEqual({ out: 'failed', vars: { error: 'offline' } });
    expect(rc.report).toHaveBeenCalledWith('offline');
  });

  const stepProps = (props: Record<string, unknown> = {}) =>
    kind('step').schema(props) as { roundId: string; action: string };

  it("step: a bare node defaults roundId/action off vars.result (`nextActions.0` through the array)", async () => {
    const session = fakeSession({ result: { roundId: 'r-1', roundComplete: false } });
    const { rc } = runCtx({ session }, { result: { roundId: 'r-1', nextActions: ['free_spin', 'spin'] } });
    const out = await kind('step').run!(stepProps(), rc);
    expect(session.play).toHaveBeenCalledWith({ action: 'free_spin', roundId: 'r-1' });
    expect(out).toEqual({
      out: 'result',
      vars: {
        result: { roundId: 'r-1', roundComplete: false },
        request: { action: 'free_spin', roundId: 'r-1' },
      },
    });
  });

  it('step: a literal roundId/action go to session.play, not read off vars.result', async () => {
    const session = fakeSession();
    const { rc } = runCtx({ session }, { result: { roundId: 'wrong', nextActions: ['wrong-too'] } });
    const out = await kind('step').run!(stepProps({ roundId: 'r-9', action: 'buy_bonus' }), rc);
    expect(session.play).toHaveBeenCalledWith({ action: 'buy_bonus', roundId: 'r-9' });
    expect(out).toEqual({
      out: 'result',
      vars: { result: {}, request: { action: 'buy_bonus', roundId: 'r-9' } },
    });
  });

  it('step: a missing vars.result resolves roundId to null and leaves by failed, reporting — no play is made', async () => {
    const session = fakeSession();
    const { rc } = runCtx({ session });
    const out = await kind('step').run!(stepProps(), rc);
    expect(rc.report).toHaveBeenCalledTimes(1);
    expect(session.play).not.toHaveBeenCalled();
    expect(out).toEqual({ out: 'failed', vars: { error: "'step' has no roundId" } });

    // A round known but no next action offered fails the same way, on `action` instead.
    const { rc: rc2 } = runCtx({ session }, { result: { roundId: 'r-1', nextActions: [] } });
    const out2 = await kind('step').run!(stepProps(), rc2);
    expect(rc2.report).toHaveBeenCalledTimes(1);
    expect(session.play).not.toHaveBeenCalled();
    expect(out2).toEqual({ out: 'failed', vars: { error: "'step' has no action" } });
  });

  it('step: a `$path` roundId that resolves to a non-string (a number) is refused the same way — never on the wire (slice 28)', async () => {
    const session = fakeSession();
    const { rc } = runCtx({ session }, { result: { roundId: 7, nextActions: ['spin'] } });
    expect(await kind('step').run!(stepProps(), rc)).toEqual({ out: 'failed', vars: { error: "'step' has no roundId" } });
    expect(rc.report).toHaveBeenCalledWith("'step' has no roundId to send (resolved from '$result.roundId')");
    expect(session.play).not.toHaveBeenCalled();
  });

  it('step: a `$path` action that resolves to a non-string is refused, same as spin — no play is made', async () => {
    const session = fakeSession();
    const { rc } = runCtx({ session }, { result: { roundId: 'r-1', nextActions: [{ id: 'free_spin' }] } });
    expect(await kind('step').run!(stepProps(), rc)).toEqual({ out: 'failed', vars: { error: "'step' has no action" } });
    expect(rc.report).toHaveBeenCalledWith("'step' has no action to send (resolved from '$result.nextActions.0')");
    expect(session.play).not.toHaveBeenCalled();
  });

  it('step: no session row reports and leaves by failed, same as spin', async () => {
    const { rc } = runCtx({}, { result: { roundId: 'r-1', nextActions: ['spin'] } });
    expect(await kind('step').run!(stepProps(), rc)).toEqual({ out: 'failed', vars: { error: 'no session' } });
    expect(rc.report).toHaveBeenCalledWith('no session row in this composition');
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

  it('present: warnings alone leave by next and the log keeps the plan; an error leaves by failed with []', async () => {
    const plan = [{ kind: 'spinTo', board: [[1]] }];
    const mechanics = { present: vi.fn(() => ({ plan, diagnostics: [] })) };
    const result = { stage: 'base_game', data: {} };
    const warning = { severity: 'warning', source: 'play-loop', where: 'plan[0]', message: 'step "playState" failed: nope' };
    const error = { ...warning, severity: 'error', message: 'step "playState" did not settle in 30 s' };

    const warned = { execute: vi.fn(async () => [warning]), record: vi.fn() };
    const { rc: rcWarned } = runCtx({ mechanics, play: warned }, { result });
    expect(await kind('present').run!({}, rcWarned)).toEqual({ out: 'next', vars: { plan } });
    expect(warned.record).toHaveBeenCalledWith({ request: {}, result, plan });

    const broke = { execute: vi.fn(async () => [warning, error]), record: vi.fn() };
    const { rc: rcBroke } = runCtx({ mechanics, play: broke }, { result });
    expect(await kind('present').run!({}, rcBroke)).toEqual({
      out: 'failed',
      vars: { plan, error: `${warning.message}; ${error.message}` },
    });
    expect(broke.record).toHaveBeenCalledWith({ request: {}, result, plan: [] });
  });

  describe('present: turbo', () => {
    /** Schema-filled props, the way the interpreter always calls `run` — same device `propProps` below uses. */
    const presentProps = (props: Record<string, unknown> = {}) =>
      kind('present').schema(props) as { turbo: string };

    it("resolves a literal 'true' to turbo: true", async () => {
      const mechanics = { present: vi.fn(() => ({ plan: [], diagnostics: [] })) };
      const play = { execute: vi.fn(async () => []), record: vi.fn() };
      const result = { stage: 'base_game', data: {} };
      const { rc } = runCtx({ mechanics, play }, { result });

      await kind('present').run!(presentProps({ turbo: 'true' }), rc);
      expect(play.execute).toHaveBeenCalledWith([], undefined, undefined, { turbo: true });
    });

    it('resolves a $path var to turbo: true', async () => {
      const mechanics = { present: vi.fn(() => ({ plan: [], diagnostics: [] })) };
      const play = { execute: vi.fn(async () => []), record: vi.fn() };
      const result = { stage: 'base_game', data: {} };
      // The schema's own default is '$turbo' — no `turbo` prop needed.
      const { rc } = runCtx({ mechanics, play }, { result, turbo: true });

      await kind('present').run!(presentProps(), rc);
      expect(play.execute).toHaveBeenCalledWith([], undefined, undefined, { turbo: true });
    });

    it('an absent var resolves through null to turbo: false', async () => {
      const mechanics = { present: vi.fn(() => ({ plan: [], diagnostics: [] })) };
      const play = { execute: vi.fn(async () => []), record: vi.fn() };
      const result = { stage: 'base_game', data: {} };
      const { rc } = runCtx({ mechanics, play }, { result }); // no `turbo` var at all

      await kind('present').run!(presentProps(), rc);
      expect(play.execute).toHaveBeenCalledWith([], undefined, undefined, { turbo: false });
    });

    it("a number > 0 is turbo (the shell's level, `$shell.turbo`); 0 is not", async () => {
      const mechanics = { present: vi.fn(() => ({ plan: [], diagnostics: [] })) };
      const play = { execute: vi.fn(async () => []), record: vi.fn() };
      const result = { stage: 'base_game', data: {} };

      await kind('present').run!(presentProps(), runCtx({ mechanics, play }, { result, turbo: 1 }).rc);
      expect(play.execute).toHaveBeenLastCalledWith([], undefined, undefined, { turbo: true });

      await kind('present').run!(presentProps(), runCtx({ mechanics, play }, { result, turbo: 0 }).rc);
      expect(play.execute).toHaveBeenLastCalledWith([], undefined, undefined, { turbo: false });
    });

    it("a literal other than 'true'/'false', or a `$path` to a non-boolean/non-number, is a warning and no turbo (slice 28)", async () => {
      const mechanics = { present: vi.fn(() => ({ plan: [], diagnostics: [] })) };
      const play = { execute: vi.fn(async () => []), record: vi.fn() };
      const result = { stage: 'base_game', data: {} };

      const { rc } = runCtx({ mechanics, play }, { result });
      await kind('present').run!(presentProps({ turbo: 'yes' }), rc);
      expect(play.execute).toHaveBeenLastCalledWith([], undefined, undefined, { turbo: false });
      expect(rc.report).toHaveBeenCalledWith('turbo "yes" is not true/false', 'warning');

      const { rc: viaPath } = runCtx({ mechanics, play }, { result, turbo: { level: 1 } });
      await kind('present').run!(presentProps(), viaPath);
      expect(play.execute).toHaveBeenLastCalledWith([], undefined, undefined, { turbo: false });
      expect(viaPath.report).toHaveBeenCalledWith('turbo "[object Object]" is not true/false', 'warning');

      // The silent falses: `'false'`, `false`, `0`, `null`, an absent var, and the form's empty `''`.
      for (const turbo of ['false', false, 0, null, undefined, '']) {
        const { rc: quiet } = runCtx({ mechanics, play }, { result, turbo });
        await kind('present').run!(presentProps({ turbo: '$turbo' }), quiet);
        expect(play.execute).toHaveBeenLastCalledWith([], undefined, undefined, { turbo: false });
        expect(quiet.report).not.toHaveBeenCalled();
      }
      const { rc: emptyLiteral } = runCtx({ mechanics, play }, { result });
      await kind('present').run!(presentProps({ turbo: '' }), emptyLiteral);
      expect(emptyLiteral.report).not.toHaveBeenCalled();
    });
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

    it('a dynamic value ($expr) that resolves to NaN into a number prop is refused with the same message as a bad literal', async () => {
      const setProps = vi.fn(() => true);
      const scenes = { setProps, nodeSchema: nodeSchema({ x: { type: 'number' } }) };
      const { rc } = runCtx({ scenes });
      expect(
        await kind('prop').run!({ target: 'base_game/win', prop: 'x', value: '$missing * 2' }, rc),
      ).toEqual({ out: 'next' });
      expect(rc.report).toHaveBeenCalledWith(`value "$missing * 2" is not a number for 'x'`);
      expect(setProps).not.toHaveBeenCalled();
    });

    it('a `{…}` template into a number prop reaches setProps as the resolved STRING — setProps refusing it is what reports', async () => {
      const setProps = vi.fn(() => false);
      const scenes = { setProps, nodeSchema: nodeSchema({ x: { type: 'number' } }) };
      const { rc } = runCtx({ scenes }, { result: { win: 12.5 } });
      expect(
        await kind('prop').run!({ target: 'a/b', prop: 'x', value: '{$result.win}' }, rc),
      ).toEqual({ out: 'next' });
      expect(setProps).toHaveBeenCalledWith({ scene: 'a', node: 'b' }, { x: '12.5' });
      expect(rc.report).toHaveBeenCalledWith(`could not set 'x' on "a/b"`);
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

    it('a `$path` boolean value into a `string` prop is stringified too — "true"/"false", not `Boolean(value)`', async () => {
      const setProps = vi.fn(() => true);
      const scenes = { setProps, nodeSchema: nodeSchema({ text: { type: 'string' } }) };
      const { rc } = runCtx({ scenes }, { flag: true });
      expect(
        await kind('prop').run!({ target: 'a/b', prop: 'text', value: '$flag' }, rc),
      ).toEqual({ out: 'next' });
      expect(setProps).toHaveBeenCalledWith({ scene: 'a', node: 'b' }, { text: 'true' });
      expect(rc.report).not.toHaveBeenCalled();
    });

    it('a `{…}` template into a `string` prop is the joined string; a `$expr` into a `number` prop is the computed number', async () => {
      const setProps = vi.fn(() => true);
      const scenes = { setProps, nodeSchema: nodeSchema({ text: { type: 'string' }, x: { type: 'number' } }) };
      const { rc } = runCtx({ scenes }, { result: { data: { mult_running: 48 } }, a: 10, b: 4 });
      await kind('prop').run!({ target: 'a/b', prop: 'text', value: 'x{$result.data.mult_running}' }, rc);
      expect(setProps).toHaveBeenLastCalledWith({ scene: 'a', node: 'b' }, { text: 'x48' });
      await kind('prop').run!({ target: 'a/b', prop: 'x', value: '$a - $b' }, rc);
      expect(setProps).toHaveBeenLastCalledWith({ scene: 'a', node: 'b' }, { x: 6 });
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

      // And a prop named after something every object inherits: `in` would
      // have said the node has it, and handed schemastery a prop it does not.
      expect(
        await kind('prop').run!(propProps({ target: 'a/b', prop: 'constructor', value: '1' }), rc),
      ).toEqual({ out: 'next' });
      expect(rc.report).toHaveBeenCalledWith(`node "a/b" has no prop "constructor"`);
      expect(setProps).not.toHaveBeenCalled();
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

  /**
   * Slice 26 — `shell`: the flow's one door to the shell's readouts. Every
   * prop is a string (`''` = leave untouched, a literal is coerced by the
   * setter's type, a `$path` resolves first); a value that cannot be set is
   * a diagnostic on the node and the OTHER props still apply — a readout
   * that cannot be set does not stop the round.
   */
  describe('shell', () => {
    /** The `Shell` handle as the kind reaches it: `state.autoplay` plus spy setters; `setAutoplay` writes `state` back the way the real one does, so `tick` can be applied twice. */
    function fakeShell(
      autoplay = { active: false, remaining: 0 },
      freeSpins: { current?: number | null; total: number; totalWin: number } = { current: 0, total: 0, totalWin: 0 },
      bonus: { label: string; value: string } | null = null,
    ) {
      const state = { autoplay, freeSpins, bonus };
      return {
        state,
        setBalance: vi.fn(),
        setWin: vi.fn(),
        setBet: vi.fn(),
        setMode: vi.fn(),
        setBusy: vi.fn(),
        setTurbo: vi.fn(),
        setBuyBonusEnabled: vi.fn(),
        setFreeSpins: vi.fn(),
        setBonus: vi.fn(),
        setAutoplay: vi.fn((a: { active: boolean; remaining: number }) => {
          state.autoplay = a;
        }),
      };
    }
    /** Schema-filled props, the way the interpreter always calls `run`. */
    const shellProps = (props: Record<string, unknown> = {}) => kind('shell').schema(props) as Record<string, string>;
    const setters = (shell: ReturnType<typeof fakeShell>) =>
      Object.entries(shell)
        .filter(([k, v]) => k.startsWith('set') && (v as ReturnType<typeof vi.fn>).mock.calls.length)
        .map(([k]) => k);

    it("every prop defaults to '' (untouched); the enumerated ones refuse a literal outside their union at the schema", () => {
      expect(shellProps()).toEqual({
        balance: '', win: '', bet: '', mode: '', busy: '', turbo: '', buyBonusEnabled: '', freeSpins: '',
        freeSpinsCurrent: '', freeSpinsTotalWin: '', bonus: '', bonusTotalWin: '', autoplay: '',
      });
      expect(shellProps({ mode: 'bonus', busy: 'true', buyBonusEnabled: 'false' })).toMatchObject({
        mode: 'bonus', busy: 'true', buyBonusEnabled: 'false',
      });
      expect(() => shellProps({ mode: 'nope' })).toThrow();
      expect(() => shellProps({ busy: 'yes' })).toThrow();
      expect(() => shellProps({ buyBonusEnabled: '1' })).toThrow();
      // …a `$path` included: the IDE draws these three as dropdowns, so the
      // union is the literals alone (`run` re-checks a value that bypassed it).
      expect(() => shellProps({ mode: '$m' })).toThrow();
    });

    it('no shell row in the composition: a warning, and next', async () => {
      const { rc } = runCtx();
      expect(await kind('shell').run!(shellProps({ balance: '1' }), rc)).toEqual({ out: 'next' });
      expect(rc.report).toHaveBeenCalledWith('no shell row in this composition', 'warning');
    });

    it('a bare node touches nothing', async () => {
      const shell = fakeShell();
      const { rc } = runCtx({ shell });
      expect(await kind('shell').run!(shellProps(), rc)).toEqual({ out: 'next' });
      expect(setters(shell)).toEqual([]);
      expect(rc.report).not.toHaveBeenCalled();
    });

    it('numbers: a literal is Number()ed, a `$path` reads the var; `win` animates; applied in schema order', async () => {
      const shell = fakeShell();
      const { rc } = runCtx({ shell }, { result: { balance: 990, winAmount: 2.5 } });
      expect(
        await kind('shell').run!(shellProps({ balance: '$result.balance', win: '$result.winAmount', bet: '2', turbo: '3' }), rc),
      ).toEqual({ out: 'next' });
      expect(shell.setBalance).toHaveBeenCalledWith(990);
      expect(shell.setWin).toHaveBeenCalledWith(2.5, { animate: true });
      expect(shell.setBet).toHaveBeenCalledWith(2);
      expect(shell.setTurbo).toHaveBeenCalledWith(3);
      const order = [shell.setBalance, shell.setWin, shell.setBet, shell.setTurbo].map((s) => s.mock.invocationCallOrder[0]);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(rc.report).not.toHaveBeenCalled();
    });

    it('`win: 0` snaps — a clear at spin start, not a count-down from the last win', async () => {
      const shell = fakeShell();
      const { rc } = runCtx({ shell });
      expect(await kind('shell').run!(shellProps({ busy: 'true', win: '0' }), rc)).toEqual({ out: 'next' });
      expect(shell.setWin).toHaveBeenCalledWith(0, { animate: false });
      expect(shell.setBusy).toHaveBeenCalledWith(true);
      expect(rc.report).not.toHaveBeenCalled();
    });

    it('a NaN (literal or resolved) reports `shell: <prop> <resolved> (from "<raw>") is not a number`, skips that prop, and the rest still apply', async () => {
      const shell = fakeShell();
      const { rc } = runCtx({ shell }, { nope: 'abc' });
      expect(await kind('shell').run!(shellProps({ balance: 'abc', win: '$nope', bet: '2', turbo: '$missing' }), rc)).toEqual({
        out: 'next',
      });
      expect(rc.report).toHaveBeenCalledWith('shell: balance "abc" (from "abc") is not a number');
      expect(rc.report).toHaveBeenCalledWith('shell: win "abc" (from "$nope") is not a number');
      // A missing var reads as `null` — told apart from a var holding the wrong thing.
      expect(rc.report).toHaveBeenCalledWith('shell: turbo null (from "$missing") is not a number');
      expect(setters(shell)).toEqual(['setBet']);
      expect(shell.setBet).toHaveBeenCalledWith(2);
    });

    it('mode/busy/buyBonusEnabled: a literal is already validated; a value that reached `run` unvalidated must be the enum (a boolean or its string for the flags)', async () => {
      const shell = fakeShell();
      const { rc } = runCtx({ shell });
      await kind('shell').run!(shellProps({ mode: 'bonus', busy: 'true', buyBonusEnabled: 'false' }), rc);
      expect(shell.setMode).toHaveBeenCalledWith('bonus');
      expect(shell.setBusy).toHaveBeenCalledWith(true);
      expect(shell.setBuyBonusEnabled).toHaveBeenCalledWith(false);
      expect(rc.report).not.toHaveBeenCalled();

      // Raw props, past the schema — the shape a project kind wrapping this one could hand in.
      const { rc: rc2 } = runCtx({ shell }, { m: 'freeSpins', b: true, s: 'false' });
      await kind('shell').run!({ ...shellProps(), mode: '$m', busy: '$b', buyBonusEnabled: '$s' } as never, rc2);
      expect(shell.setMode).toHaveBeenLastCalledWith('freeSpins');
      expect(shell.setBusy).toHaveBeenLastCalledWith(true);
      expect(shell.setBuyBonusEnabled).toHaveBeenLastCalledWith(false);
      expect(rc2.report).not.toHaveBeenCalled();

      const { rc: rc3 } = runCtx({ shell }, { m: 'nope', b: 1 });
      await kind('shell').run!({ ...shellProps(), mode: '$m', busy: '$b', buyBonusEnabled: '$missing' } as never, rc3);
      expect(rc3.report).toHaveBeenCalledWith('shell: mode "nope" (from "$m") is not a mode (base|bonus|freeSpins|replay)');
      expect(rc3.report).toHaveBeenCalledWith('shell: busy 1 (from "$b") is not a boolean');
      expect(rc3.report).toHaveBeenCalledWith('shell: buyBonusEnabled null (from "$missing") is not a boolean');
      expect(shell.setMode).toHaveBeenCalledTimes(2);
      expect(shell.setBusy).toHaveBeenCalledTimes(2);
      expect(shell.setBuyBonusEnabled).toHaveBeenCalledTimes(2);
    });

    it('freeSpins: an object goes through as is; a number (or numeric string) is `{ total, totalWin: 0 }`; anything else reports', async () => {
      const shell = fakeShell();
      const fs = { current: 2, total: 10, totalWin: 4 };
      const { rc } = runCtx({ shell }, { fs, n: 3, bad: 'abc' });
      await kind('shell').run!(shellProps({ freeSpins: '$fs' }), rc);
      expect(shell.setFreeSpins).toHaveBeenLastCalledWith(fs);
      expect(shell.setFreeSpins.mock.calls.at(-1)![0]).toBe(fs);
      await kind('shell').run!(shellProps({ freeSpins: '10' }), rc);
      expect(shell.setFreeSpins).toHaveBeenLastCalledWith({ total: 10, totalWin: 0 });
      await kind('shell').run!(shellProps({ freeSpins: '$n' }), rc);
      expect(shell.setFreeSpins).toHaveBeenLastCalledWith({ total: 3, totalWin: 0 });
      expect(rc.report).not.toHaveBeenCalled();
      await kind('shell').run!(shellProps({ freeSpins: '$bad' }), rc);
      expect(rc.report).toHaveBeenCalledWith('shell: freeSpins "abc" (from "$bad") is not a number or a free-spins object');
      expect(shell.setFreeSpins).toHaveBeenCalledTimes(3);
    });

    it('bonus: an object only', async () => {
      const shell = fakeShell();
      const b = { label: 'Adventure', value: '3/5', totalWin: 1 };
      const { rc } = runCtx({ shell }, { b });
      await kind('shell').run!(shellProps({ bonus: '$b' }), rc);
      expect(shell.setBonus).toHaveBeenCalledWith(b);
      await kind('shell').run!(shellProps({ bonus: 'x' }), rc);
      expect(rc.report).toHaveBeenCalledWith('shell: bonus "x" (from "x") is not a bonus object');
      expect(shell.setBonus).toHaveBeenCalledTimes(1);
    });

    it('freeSpinsCurrent/freeSpinsTotalWin: merged over the current free-spins readout, one setFreeSpins; NaN reports and sets nothing', async () => {
      const shell = fakeShell(undefined, { current: 1, total: 8, totalWin: 2 });
      const { rc } = runCtx({ shell }, { result: { winAmount: 4.6 } });
      await kind('shell').run!(shellProps({ freeSpinsCurrent: '3' }), rc);
      expect(shell.setFreeSpins).toHaveBeenLastCalledWith({ current: 3, total: 8, totalWin: 2 });
      await kind('shell').run!(shellProps({ freeSpinsTotalWin: '$result.winAmount' }), rc);
      expect(shell.setFreeSpins).toHaveBeenLastCalledWith({ current: 1, total: 8, totalWin: 4.6 });
      await kind('shell').run!(shellProps({ freeSpinsCurrent: '$result.winAmount + 1', freeSpinsTotalWin: '9' }), rc);
      expect(shell.setFreeSpins).toHaveBeenLastCalledWith({ current: 5.6, total: 8, totalWin: 9 });
      expect(shell.setFreeSpins).toHaveBeenCalledTimes(3);
      expect(rc.report).not.toHaveBeenCalled();
      await kind('shell').run!(shellProps({ freeSpinsCurrent: 'abc', freeSpinsTotalWin: '1' }), rc);
      expect(rc.report).toHaveBeenCalledWith('shell: freeSpinsCurrent "abc" (from "abc") is not a number');
      expect(shell.setFreeSpins).toHaveBeenCalledTimes(3);
    });

    it('bonusTotalWin: merged over the bonus readout set earlier; no bonus is a warning and nothing set', async () => {
      const shell = fakeShell();
      const { rc } = runCtx({ shell }, { result: { winAmount: 4.6 } });
      await kind('shell').run!(shellProps({ bonusTotalWin: '$result.winAmount' }), rc);
      expect(rc.report).toHaveBeenCalledWith('shell: bonusTotalWin: no bonus to update', 'warning');
      expect(setters(shell)).toEqual([]);
      shell.state.bonus = { label: 'Adventure', value: '3/5' };
      await kind('shell').run!(shellProps({ bonusTotalWin: '$result.winAmount' }), rc);
      expect(shell.setBonus).toHaveBeenCalledWith({ label: 'Adventure', value: '3/5', totalWin: 4.6 });
      await kind('shell').run!(shellProps({ bonusTotalWin: 'x' }), rc);
      expect(rc.report).toHaveBeenLastCalledWith('shell: bonusTotalWin "x" (from "x") is not a number');
      expect(shell.setBonus).toHaveBeenCalledTimes(1);
    });

    it('a `{…}` template resolves before the type check, and a bad `$expr` is a warning naming the value', async () => {
      const shell = fakeShell();
      const { rc } = runCtx({ shell }, { n: 4 });
      await kind('shell').run!(shellProps({ bet: '{$n}', turbo: '$n |' }), rc);
      expect(shell.setBet).toHaveBeenCalledWith(4);
      expect(rc.report).toHaveBeenCalledWith(expect.stringMatching(/^bad value '\$n \|':/), 'warning');
      expect(rc.report).toHaveBeenLastCalledWith('shell: turbo "$n |" (from "$n |") is not a number');
      expect(shell.setTurbo).not.toHaveBeenCalled();
    });

    it("autoplay: a number is `{ active: n > 0, remaining: n }`; 'stop' ends it; 'tick' counts one down and stops at 0; Infinity is left alone; NaN reports", async () => {
      const shell = fakeShell({ active: true, remaining: 2 });
      const { rc } = runCtx({ shell }, { n: 5 });
      await kind('shell').run!(shellProps({ autoplay: 'tick' }), rc);
      expect(shell.setAutoplay).toHaveBeenLastCalledWith({ active: true, remaining: 1 });
      await kind('shell').run!(shellProps({ autoplay: 'tick' }), rc);
      expect(shell.setAutoplay).toHaveBeenLastCalledWith({ active: false, remaining: 0 });
      // …and a tick past 0 stays at 0 (no negative counts, still inactive).
      await kind('shell').run!(shellProps({ autoplay: 'tick' }), rc);
      expect(shell.setAutoplay).toHaveBeenLastCalledWith({ active: false, remaining: 0 });

      await kind('shell').run!(shellProps({ autoplay: '$n' }), rc);
      expect(shell.setAutoplay).toHaveBeenLastCalledWith({ active: true, remaining: 5 });
      await kind('shell').run!(shellProps({ autoplay: '0' }), rc);
      expect(shell.setAutoplay).toHaveBeenLastCalledWith({ active: false, remaining: 0 });
      await kind('shell').run!(shellProps({ autoplay: '3' }), rc);
      await kind('shell').run!(shellProps({ autoplay: 'stop' }), rc);
      expect(shell.setAutoplay).toHaveBeenLastCalledWith({ active: false, remaining: 0 });
      expect(rc.report).not.toHaveBeenCalled();

      // An unbounded autoplay (`remaining: Infinity`) is not counted down.
      const forever = fakeShell({ active: true, remaining: Infinity });
      const { rc: rc2 } = runCtx({ shell: forever });
      await kind('shell').run!(shellProps({ autoplay: 'tick' }), rc2);
      expect(forever.setAutoplay).not.toHaveBeenCalled();
      expect(rc2.report).not.toHaveBeenCalled();

      await kind('shell').run!(shellProps({ autoplay: 'abc' }), rc2);
      expect(rc2.report).toHaveBeenCalledWith("shell: autoplay \"abc\" (from \"abc\") is not a number, 'tick' or 'stop'");
      expect(forever.setAutoplay).not.toHaveBeenCalled();
    });

    it('a setter that throws is reported, and the props after it still apply', async () => {
      const shell = fakeShell();
      shell.setWin.mockImplementation(() => {
        throw new Error('boom');
      });
      const { rc } = runCtx({ shell });
      expect(
        await kind('shell').run!(shellProps({ balance: '1', win: '5', bet: '2', turbo: '3', autoplay: '4' }), rc),
      ).toEqual({ out: 'next' });
      expect(rc.report).toHaveBeenCalledTimes(1);
      expect(rc.report).toHaveBeenCalledWith('shell: win: boom');
      expect(shell.setBalance).toHaveBeenCalledWith(1);
      // Everything after the throw, in schema order, still landed.
      expect(shell.setBet).toHaveBeenCalledWith(2);
      expect(shell.setTurbo).toHaveBeenCalledWith(3);
      expect(shell.setAutoplay).toHaveBeenCalledWith({ active: true, remaining: 4 });
      const order = [shell.setWin, shell.setBet, shell.setTurbo, shell.setAutoplay].map((f) => f.mock.invocationCallOrder[0]);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });
  });

  /** Slice 26 — `ack`: "the result was shown", to a session provider that has a credit hook. */
  describe('set / emit', () => {
    it('set: a `{…}` template is a string, a `$expr` its value, a literal itself', async () => {
      const { rc } = runCtx({}, { result: { data: { fs_total: 10, fs_remaining: 4 } } });
      const value = async (v: unknown) => (await kind('set').run!({ name: 'x', value: v }, rc)).vars!.x;
      expect(await value('{$result.data.fs_total - $result.data.fs_remaining}/{$result.data.fs_total}')).toBe('6/10');
      expect(await value('$result.data.fs_total - $result.data.fs_remaining')).toBe(6);
      expect(await value('tapped')).toBe('tapped');
      expect(await value(3)).toBe(3);
      expect(rc.report).not.toHaveBeenCalled();
      expect(await value('{$result.data.fs_total +}')).toBe('{$result.data.fs_total +}');
      expect(rc.report).toHaveBeenCalledWith(expect.stringMatching(/^bad value /), 'warning');
    });

    it('emit: a `{…}` template payload reaches the bus as a string', async () => {
      const events = createEvents();
      const heard = vi.fn();
      events.on('hello', heard);
      const { rc } = runCtx({ events }, { n: 48 });
      await kind('emit').run!({ event: 'hello', payload: 'x{$n}', wait: false }, rc);
      expect(heard).toHaveBeenCalledWith('x48');
    });
  });

  describe('ack', () => {
    it('calls session.ack with vars.result and leaves by next', async () => {
      const session = { ...fakeSession(), ack: vi.fn() };
      const result = { win: 1 };
      const { rc } = runCtx({ session }, { result });
      expect(await kind('ack').run!({}, rc)).toEqual({ out: 'next' });
      expect(session.ack).toHaveBeenCalledWith(result);
      expect(rc.report).not.toHaveBeenCalled();
      expect(kind('ack').schema({})).toEqual({});
    });

    it("no session, or no vars.result: a warning 'nothing to ack', and next", async () => {
      const { rc: none } = runCtx({}, { result: {} });
      expect(await kind('ack').run!({}, none)).toEqual({ out: 'next' });
      expect(none.report).toHaveBeenCalledWith('nothing to ack', 'warning');

      const session = { ...fakeSession(), ack: vi.fn() };
      const { rc: noResult } = runCtx({ session });
      expect(await kind('ack').run!({}, noResult)).toEqual({ out: 'next' });
      expect(noResult.report).toHaveBeenCalledWith('nothing to ack', 'warning');
      expect(session.ack).not.toHaveBeenCalled();
    });

    it('a session without the (optional) hook — `session-host` — is silence: no report, next', async () => {
      const { rc } = runCtx({ session: fakeSession() }, { result: {} });
      expect(await kind('ack').run!({}, rc)).toEqual({ out: 'next' });
      expect(rc.report).not.toHaveBeenCalled();
    });

    it('an ack that throws is an error on the node, and still next', async () => {
      const session = {
        ...fakeSession(),
        ack: vi.fn(() => {
          throw new Error('wallet down');
        }),
      };
      const { rc } = runCtx({ session }, { result: {} });
      expect(await kind('ack').run!({}, rc)).toEqual({ out: 'next' });
      expect(rc.report).toHaveBeenCalledWith('wallet down');
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

  it('boot fires once on the next microtask; present, wait and emit opt out of the run timeout', async () => {
    const fire = vi.fn();
    const { rc } = runCtx();
    kind('boot').arm!({}, fire, rc);
    expect(fire).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fire).toHaveBeenCalledTimes(1);
    expect(kind('present').timeout).toBe(false);
    expect(kind('wait').timeout).toBe(false);
    expect(BUILTIN_KINDS.filter((k) => k.timeout === false).map((k) => k.kind)).toEqual(['present', 'wait', 'emit']);
  });
});
