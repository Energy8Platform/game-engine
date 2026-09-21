# Presentation steps, value expressions, small debts — implementation plan (slice 29)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mechanic can put beats on the flow bus between board steps and hold the plan for them; every flow prop that took a `$path` takes an expression or a template with formats; the dev wallet, `e8 spin`, `e8 build`, the reels node and the shell's game info close their round-2 debts.

**Architecture:** One new known step kind, `emit`, joins the contracts vocabulary without touching `BoardApi`; the play loop serves it with a built-in handler that fires the flow bus and awaits the branches an `on { busy: parallel }` started (the bus's `emit` and the interpreter's `fire` return promises). One `resolveValue` in `@energy8engine/flow` (templates, `|` formats, arithmetic in `expr.ts`) replaces the per-kind `$path` reads. Small host/CLI/row changes close N6/N7.

**Tech Stack:** TypeScript, cordis 4, schemastery, vitest per package, Playwright (`engine/apps/web/tests/e2e`), pixi.js v8.

**Spec:** `docs/superpowers/specs/2026-09-21-presentation-steps-design.md`

## Global Constraints

- `packages/*` is never edited or staged. Never stage `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`, nor anything under `engine/examples/paper-duel`.
- A string prop refuses an unquoted YAML scalar; `''` means "untouched".
- A value that cannot be resolved is a **warning on the node**; the value is left as written; the branch continues.
- `KNOWN_STEP_KINDS` and `BoardApi` do not gain `emit`.
- Every fix carries a unit test in its package. Run one workspace per command: `npm test -w @energy8engine/<pkg>` (the CLI workspace is `@energy8engine/e8`, the IDE host `@energy8engine/ide-host`, the IDE client `@energy8engine/ide-client`, the web app `@energy8engine/ide-web`).
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- The Playwright suite runs ALONE (nothing else on the machine), never in parallel with unit suites; do not kill processes you did not start.

---

## File map

| Area | File | Change |
|---|---|---|
| contracts | `engine/core/contracts/src/presentation.ts` | `EmitStep`; `KnownPresentationStep` union; `isPresentationStep` case |
| contracts | `engine/core/contracts/src/session.ts` | `SessionInit.actions?` |
| flow | `engine/game/flow/src/events.ts` | `emit` returns `Promise<void>`; listener may return a promise |
| flow | `engine/game/flow/src/interpreter.ts` | per-run live count; `fire` returns a promise; `stop()` settles them |
| flow | `engine/game/flow/src/kinds.ts` | `on.busy: parallel`; `emit.wait`; `resolveValue` everywhere; `shell` siblings |
| flow | `engine/game/flow/src/expr.ts` | tokens `+ - * / \| :`, numeric path segments, `evaluateValue`, formats |
| flow | `engine/game/flow/src/value.ts` (new) | `resolveValue` |
| flow | `engine/game/flow/src/index.ts` | export `evaluateValue`, `resolveValue` |
| flow-fx | `engine/game/flow-fx/src/audio.ts` | `volume` through `resolveValue` |
| play-loop | `engine/game/play-loop/src/runtime.ts` | built-in `emit` handler |
| session-host | `engine/game/session-host/src/index.ts` | charge `× actions[action]` |
| ide-host | `engine/ide/host/src/plugins/dev-game.ts` | `/api/session.actions`; attach `gameSpecHost` |
| ide-host | `engine/ide/host/src/plugins/game-spec.ts` (new) | `GET /api/spec` |
| ide-host | `engine/ide/host/src/plugins/project-scope.ts` | compose `game-spec` |
| ide-host | `engine/ide/host/src/compute/build.ts` | freeze `spec`; default-target info |
| ide-host | `engine/ide/host/src/compute/spin.ts` | `cost`, `rtp / cost` |
| cli | `engine/apps/cli/src/run.ts` | help lines |
| reels | `engine/game/reels/src/index.ts`, `src/runtime.ts` | `GridLike.geometry?`; `origin` prop |
| shell-pixi | `engine/game/shell-pixi/src/paytable.ts` (new), `src/index.ts` | derived paytable |
| example | `engine/examples/first-slot/flow.yml`, `engine/templates/slot-basic/flow.yml` | `'{$result.winAmount \| currency}'` |
| e2e | `engine/apps/web/tests/e2e/text.spec.ts` | currency assertion; parallel-`on` case |

---

### Task 1: Contracts — `EmitStep` and `SessionInit.actions`

**Files:**
- Modify: `engine/core/contracts/src/presentation.ts`
- Modify: `engine/core/contracts/src/session.ts`
- Test: `engine/core/contracts/tests/presentation.test.ts` (existing file; add cases)

**Interfaces:**
- Produces: `EmitStep { kind: 'emit'; event: string; payload?: unknown; wait?: boolean }` in `KnownPresentationStep`; `SessionInit.actions?: Record<string, number>`.

- [ ] **Step 1: Write the failing tests** — append to `engine/core/contracts/tests/presentation.test.ts`:

```ts
describe('emit — a beat on the bus, not a board step', () => {
  it('is well-formed with an event; payload is anything; wait is a boolean when present', () => {
    expect(isPresentationStep({ kind: 'emit', event: 'pd.round' })).toBe(true);
    expect(isPresentationStep({ kind: 'emit', event: 'pd.round', payload: { n: 1 }, wait: true })).toBe(true);
    expect(isPresentationStep({ kind: 'emit', event: '' })).toBe(false);
    expect(isPresentationStep({ kind: 'emit', event: 3 })).toBe(false);
    expect(isPresentationStep({ kind: 'emit', event: 'x', wait: 'yes' })).toBe(false);
  });
  it('is NOT one of the board kinds', () => {
    expect(KNOWN_STEP_KINDS).not.toContain('emit');
  });
  it('type-checks in a PresentationPlan', () => {
    const plan: PresentationPlan = [{ kind: 'emit', event: 'x', wait: true }];
    expect(plan).toHaveLength(1);
  });
});
```

Import `KNOWN_STEP_KINDS`, `isPresentationStep`, `type PresentationPlan` from `../src/presentation` (match the file's existing imports).

- [ ] **Step 2: Run** `npm test -w @energy8engine/contracts -- presentation` → FAIL (`emit` with `event: ''` is `true` today: the default branch accepts any unknown kind).

- [ ] **Step 3: Implement** in `presentation.ts`, after `TumbleStep`:

```ts
/**
 * A beat on the flow bus, not a board step: `event` fires with `payload`
 * (data the mechanic computed — never a scene or shell name), and
 * `wait: true` holds the plan until every flow branch that event started
 * has ended (an `on { busy: parallel }` node). Served by the play loop's
 * built-in handler (`@energy8engine/play-loop`), never by a board — so it
 * is in `KnownPresentationStep` (a mechanic's plan may carry it, typed)
 * but NOT in `KNOWN_STEP_KINDS`/`BoardApi` (no board is obliged to know it).
 */
export interface EmitStep {
  kind: 'emit';
  event: string;
  payload?: unknown;
  wait?: boolean;
}
```

- `KnownPresentationStep` gains `| EmitStep` (update its doc's count: "It was six, then four, then five … `emit` (slice 29) is the sixth, the first that is not a board step").
- `KNOWN_STEP_KINDS` unchanged (add one sentence to its doc: `emit` is deliberately absent — the play loop serves it).
- `isPresentationStep` gains, before `default`:

```ts
    case 'emit':
      return (
        typeof value.event === 'string' &&
        value.event.length > 0 &&
        (value.wait === undefined || typeof value.wait === 'boolean')
      );
```

In `session.ts`, after `device?`:

```ts
  /**
   * The bet multiplier per action name (`{ spin: 1, tournament: 100 }`) —
   * what a dev wallet charges on an opening play. Absent when the provider
   * has no opinion (`session-sdk`: the platform charges server-side); a
   * missing action reads as `1`.
   */
  actions?: Record<string, number>;
```

- [ ] **Step 4: Run** `npm test -w @energy8engine/contracts` → PASS. `npm run typecheck -w @energy8engine/contracts` clean.

- [ ] **Step 5: Commit** `git add engine/core/contracts && git commit -m "Contracts: emit is a known step that no board performs; SessionInit.actions"`

---

### Task 2: Flow — a promise-returning bus, `fire`, `on { busy: parallel }`, `emit { wait }`

**Files:**
- Modify: `engine/game/flow/src/events.ts`
- Modify: `engine/game/flow/src/interpreter.ts`
- Modify: `engine/game/flow/src/kinds.ts` (`on`, `emit` only — the resolver change is Task 4)
- Test: `engine/game/flow/tests/events.test.ts`, `engine/game/flow/tests/interpreter.test.ts`

**Interfaces:**
- Produces: `EventsService.emit(name, payload?): Promise<void>`; `on(name, fn: (payload) => void | Promise<void>)`; `FlowNodeKind.arm(props, fire: (vars?) => Promise<void>, ctx)`.
- Consumed by: Task 3 (play-loop awaits `emit`'s promise).

- [ ] **Step 1: Failing tests.** `events.test.ts`:

```ts
  it('emit returns a promise that settles after every listener promise — a rejection included', async () => {
    const bus = createEvents();
    const order: string[] = [];
    bus.on('x', () => new Promise<void>((r) => setTimeout(() => { order.push('a'); r(); }, 10)));
    bus.on('x', () => { order.push('sync'); });
    bus.on('x', () => Promise.reject(new Error('nope')));
    await bus.emit('x');
    expect(order).toEqual(['sync', 'a']);
  });
  it('emit with no listener resolves at once', async () => {
    await expect(createEvents().emit('none')).resolves.toBeUndefined();
  });
```

`interpreter.test.ts` (use the file's `harness`, `gated`, `settled`, `spinDoc` helpers — read them first):

```ts
  it('on { busy: parallel } fires while a run is live; the branch sees $event and the live roots, not the parent run’s vars', async () => {
    const { f, play, release } = gated();
    f.flow.provideRoot('shell', () => ({ bet: 2 }));
    const d = spinDoc('ignore');
    d.nodes.push(
      { id: 'beat', kind: 'on', props: { event: 'pd.round', busy: 'parallel' } },
      { id: 'note', kind: 'set', props: { name: 'seen', value: '$event.n' } },
      { id: 'root', kind: 'set', props: { name: 'bet', value: '$shell.bet' } },
      { id: 'parent', kind: 'set', props: { name: 'res', value: '$result' } },
    );
    d.edges.push({ from: 'beat', to: 'note' }, { from: 'note', to: 'root' }, { from: 'root', to: 'parent' });
    f.flow.replace(d);
    f.events.emit('ui.spin');
    expect(f.flow.busy()).toBe(true);
    const done = f.events.emit('pd.round', { n: 7 });
    await done;
    const runs = f.flow.trace().filter((e) => e.node === 'beat');
    expect(runs).toHaveLength(1);
    // the parallel run's own vars: `seen` and `bet` set, `res` null (no `$result` here)
    // (assert through a probe kind registered in extraKinds that records its vars — see the file's existing probe pattern)
    release[0]();
    await settled(f, [...]); // fill from the doc's node ids in file order
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('the promise a listener returns settles when the run it started has no live branch; stop() settles the rest', async () => {
    const f = harness();
    let release!: () => void;
    const hold = new Promise<{ out: string }>((r) => (release = () => r({ out: 'next' })));
    f.kinds.register({ kind: 'hold', schema: Schema.object({}), outs: ['next'], timeout: false, run: () => hold });
    f.flow.replace(doc(
      [{ id: 'go', kind: 'on', props: { event: 'x' } }, { id: 'h', kind: 'hold' }],
      [{ from: 'go', to: 'h' }],
    ));
    let settledAt = 0;
    const p = f.events.emit('x').then(() => (settledAt = Date.now()));
    await new Promise((r) => setTimeout(r, 20));
    expect(settledAt).toBe(0);
    release();
    await p;
    expect(settledAt).toBeGreaterThan(0);
    // a second run held, then stop(): the promise settles without the node finishing
    const hold2 = new Promise<{ out: string }>(() => {});
    f.kinds.register({ kind: 'hold', schema: Schema.object({}), outs: ['next'], timeout: false, run: () => hold2 });
    f.flow.replace(doc(
      [{ id: 'go', kind: 'on', props: { event: 'x' } }, { id: 'h', kind: 'hold' }],
      [{ from: 'go', to: 'h' }],
    ));
    const p2 = f.events.emit('x');
    f.flow.stop();
    await expect(p2).resolves.toBeUndefined();
  });

  it('emit { wait: true } holds its branch until the listeners’ runs end; wait: false does not', async () => {
    // doc: boot → emit { event: 'beat', wait: true } → set { name: 'after', value: 1 }
    //      on { event: 'beat', busy: 'parallel' } → wait { ms: 30 } → set { name: 'inner', value: 1 }
    // assert trace order: the inner `set` leaves BEFORE the outer `set` records; with wait: false the outer set records first.
  });
```

Write the three as full tests (fill the `settled` lists from the docs you write; the file's `gated()` returns `{ f, play, release }`).

- [ ] **Step 2: Run** `npm test -w @energy8engine/flow -- events interpreter` → FAIL.

- [ ] **Step 3: Implement.**

`events.ts`:

```ts
export interface EventsService {
  /** Dispatches synchronously; the promise settles once every listener's returned promise has (a rejection is the listener's, not the emitter's). */
  emit(name: string, payload?: unknown): Promise<void>;
  on(name: string, fn: (payload: unknown) => void | Promise<void>): () => void;
}
```

```ts
    emit(name, payload) {
      const set = listeners.get(name);
      if (!set) return Promise.resolve();
      const pending: Promise<unknown>[] = [];
      for (const fn of [...set]) {
        const r = fn(payload);
        if (r && typeof (r as Promise<unknown>).then === 'function') pending.push(r as Promise<unknown>);
      }
      return Promise.allSettled(pending).then(() => undefined);
    },
```

`interpreter.ts`:
- `Run` gains `live: number; settlers: (() => void)[]`.
- `branch()`: `run.live++` beside `run.epoch.live++`; in `finally`, `if (--run.live === 0) run.settlers.splice(0).forEach((fn) => fn());` beside the epoch idlers.
- `start(vars)` returns `Promise<void>`: aborted epoch → `Promise.resolve()`; otherwise create the run with `live: 0, settlers: []`, call `leave(...)`, then `return run.live === 0 ? Promise.resolve() : new Promise((resolve) => run.settlers.push(resolve))`. Keep a `Set<Run>` of live runs on the epoch (`Epoch.runs`), remove in `branch`'s finally when `run.live` hits 0.
- `stop()`: before `epoch = fresh()`, `for (const run of epoch.runs) run.settlers.splice(0).forEach((fn) => fn());`.
- `FlowNodeKind.arm`'s `fire` type in `kinds.ts`: `fire: (vars?: Record<string, unknown>) => Promise<void>`.

`kinds.ts` `on`:

```ts
    busy: Schema.union(['ignore', 'queue', 'parallel'])
      .default('ignore')
      .description('a fire while a run is live: drop it, fire once after the runs drain, or start a concurrent run at once'),
```

```ts
    return service<EventsService>(ctx, 'events').on(p.event, (event) => {
      if (!busy() || p.busy === 'parallel') return fire({ event });
      if (p.busy !== 'queue') return undefined;
      if (queued === undefined) drain();
      queued = { event };
      return undefined;
    });
```

(`arm`'s return type from the listener is `void | Promise<void>` — returning `fire(...)`'s promise is what the bus awaits.)

`emit` kind:

```ts
const emit: FlowNodeKind<{ event: string; payload?: unknown; wait: boolean }> = {
  kind: 'emit',
  schema: Schema.object({
    event: Schema.string().required().description('event name'),
    payload: Schema.any().description('literal, or `$path` to read a var'),
    wait: Schema.boolean().default(false).description('hold this branch until every run the event started has ended'),
  }),
  outs: ['next'],
  timeout: false,
  async run(p, { ctx, vars }) {
    const done = service<EventsService>(ctx, 'events').emit(p.event, resolve(p.payload, vars));
    if (p.wait) await done;
    return { out: 'next' };
  },
};
```

(`timeout: false` only matters with `wait`; a `wait` for a human-paced branch must not hit the 30 s limit.) Update `kinds.test.ts`'s "ships the fifteen built-ins" case if it pins `on`'s schema or `emit`'s props.

- [ ] **Step 4: Run** `npm test -w @energy8engine/flow` → PASS; `npm run typecheck -w @energy8engine/flow`.

- [ ] **Step 5: Commit** `git add engine/game/flow && git commit -m "Flow: emit returns a promise, fire settles when a run drains, on { busy: parallel }, emit { wait }"`

---

### Task 3: Play-loop — the built-in `emit` handler

**Files:**
- Modify: `engine/game/play-loop/src/runtime.ts`
- Test: `engine/game/play-loop/tests/runtime.test.ts`

**Interfaces:**
- Consumes: `EmitStep` (Task 1); a bus whose `emit` may return a promise (Task 2 — structural `FlowBus`).
- Produces: `ctx.steps.get('emit')` registered at `apply`.

- [ ] **Step 1: Failing tests** (append; the file's `fakeBus()` `emit` is synchronous — extend the fake so `service.emit` returns `Promise.allSettled` of listener results, as `createEvents` does):

```ts
describe('play-loop runtime half: the built-in emit step', () => {
  it('registers `emit` at apply; a plugin registering it collides and the built-in keeps it', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);
    expect(ctx.steps.kinds()).toEqual(['emit']);
    ctx.steps.register({ kind: 'emit', run: async () => {} });
    expect(ctx.steps.collisions()).toHaveLength(1);
    await ctx.fiber.dispose();
  });
  it('fires the bus with the payload; wait: true holds until the listener’s promise settles; wait absent does not hold', async () => {
    const ctx = new Context();
    const bus = fakeBus();
    await ctx.plugin(busPlugin(bus));
    await ctx.plugin(runtime);
    let release!: () => void;
    const seen: unknown[] = [];
    bus.service.on('pd.round', (p) => { seen.push(p); return new Promise<void>((r) => (release = r)); });
    const order: string[] = [];
    const board = { spinTo: async () => { order.push('spinTo'); } } as unknown as BoardApi;
    const running = ctx.play.execute(
      [{ kind: 'emit', event: 'pd.round', payload: { n: 1 }, wait: true }, { kind: 'spinTo', board: [[1]] }],
      board,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([{ n: 1 }]);
    expect(order).toEqual([]);
    release();
    expect(await running).toEqual([]);
    expect(order).toEqual(['spinTo']);
    // wait absent: the next step runs without waiting
    const held = new Promise<void>(() => {});
    bus.service.on('free', () => held);
    expect(await ctx.play.execute([{ kind: 'emit', event: 'free' }, { kind: 'spinTo', board: [[1]] }], board)).toEqual([]);
    expect(order).toEqual(['spinTo', 'spinTo']);
    await ctx.fiber.dispose();
  });
  it('skip() releases a pending wait', async () => { /* hold a wait: true emit, call ctx.play.skip(), expect execute to finish */ });
  it('no events service is a `step "emit" failed` diagnostic naming it', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);
    const problems = await ctx.play.execute([{ kind: 'emit', event: 'x' }], fakeBoard() as unknown as BoardApi);
    expect(problems.map((d) => d.message)).toEqual([expect.stringContaining("no 'events' service")]);
    await ctx.fiber.dispose();
  });
});
```

Existing cases that assert `ctx.steps.kinds()).toEqual([])` or the "known kinds" list text must now include `emit` — update them.

- [ ] **Step 2: Run** `npm test -w @energy8engine/play-loop -- runtime` → FAIL.

- [ ] **Step 3: Implement** in `runtime.ts` `apply`, after `const steps = createBoardStepRegistry();`:

```ts
  // The one step no board performs: a beat on the flow bus. `wait: true`
  // holds the plan until the runs the event started have drained (the
  // bus's `emit` promise — `@energy8engine/flow`); `skip()` lets go of
  // every pending hold at once, the branches keep running on their own.
  const holds = new Set<() => void>();
  steps.register({
    kind: 'emit',
    async run(step) {
      const bus = ctx.reflect.get('events', false) as FlowBus | undefined;
      if (!bus) throw new Error("no 'events' service in this composition");
      const { event, payload, wait } = step as unknown as EmitStep;
      const done = bus.emit(event, payload);
      if (!wait || !done || typeof done.then !== 'function') return;
      await new Promise<void>((resolve) => {
        const release = () => {
          holds.delete(release);
          resolve();
        };
        holds.add(release);
        void done.then(release, release);
      });
    },
    skip() {
      for (const release of [...holds]) release();
    },
  });
```

`FlowBus` gains `emit(name: string, payload?: unknown): void | Promise<void>`. Import `type EmitStep` from contracts.

- [ ] **Step 4: Run** `npm test -w @energy8engine/play-loop` → PASS; typecheck.

- [ ] **Step 5: Commit** `git add engine/game/play-loop && git commit -m "Play-loop: the built-in emit step fires the bus and holds the plan on wait"`

---

### Task 4: Flow expressions — arithmetic, `evaluateValue`, formats, numeric path segments

**Files:**
- Modify: `engine/game/flow/src/expr.ts`
- Test: `engine/game/flow/tests/expr.test.ts`

**Interfaces:**
- Produces: `evaluateValue(expr: string, vars: Record<string, unknown>): unknown`; `evaluate` unchanged in signature (`Boolean(evaluateValue(...))`).

- [ ] **Step 1: Failing tests** (append to `expr.test.ts`):

```ts
describe('evaluateValue', () => {
  const v = {
    result: { win: 12.5, winAmount: 4.604, data: { cascades: [{ step_win: 3 }], fs_total: 10, fs_remaining: 4, mult_running: 48 } },
    session: { currency: { code: 'USD', symbol: '$', decimals: 2, position: 'left' } },
  };
  it.each<[string, unknown]>([
    ['$result.data.fs_total - $result.data.fs_remaining', 6],
    ['$result.win * 2 + 1', 26],
    ['($result.win + 1) * 2', 27],
    ['-$result.win', -12.5],
    ['10 / 4', 2.5],
    ['1 + 2 * 3', 7],
    ['$result.data.cascades.0.step_win', 3],
    ['$result.win - 2 > 10', true],
    ["$result.win + 'x'", NaN],
    ['$missing + 1', NaN],
  ])('%s → %s', (expr, out) => {
    const got = evaluateValue(expr, v);
    Number.isNaN(out as number) ? expect(got).toBeNaN() : expect(got).toBe(out);
  });
  it.each<[string, string]>([
    ['$result.winAmount | currency', '$4.60'],
    ['$result.winAmount | fixed:1', '4.6'],
    ['$result.winAmount | int', '5'],
    ['$result.data.mult_running | multiplier', 'x48'],
    ['2.5 | multiplier', 'x2.5'],
    ['$result.win || 0 | int', '13'],
  ])('%s → %s', (expr, out) => expect(evaluateValue(expr, v)).toBe(out));
  it('currency follows position: right puts the symbol after a space', () => {
    const right = { ...v, session: { currency: { code: 'EUR', symbol: '€', decimals: 2, position: 'right' } } };
    expect(evaluateValue('$result.winAmount | currency', right)).toBe('4.60 €');
  });
  it('currency with no session root is toFixed(2), no symbol', () =>
    expect(evaluateValue('$result.winAmount | currency', { result: v.result })).toBe('4.60'));
  it('an unknown format is a SyntaxError naming it', () =>
    expect(() => evaluateValue('1 | bogus', v)).toThrow(/unknown format 'bogus'/));
  it('evaluate is Boolean(evaluateValue): arithmetic reaches if', () =>
    expect(evaluate('$result.data.fs_total - $result.data.fs_remaining > 5', v)).toBe(true));
});
```

- [ ] **Step 2: Run** `npm test -w @energy8engine/flow -- expr` → FAIL.

- [ ] **Step 3: Implement** in `expr.ts`:

Tokenizer:
- the path continuation loop accepts a digit segment: `while (src[i] === '.' && /[A-Za-z_$0-9]/.test(src[i + 1] ?? ''))` and the inner scan `/[\w$]/` (digits already match `\w`);
- the single-char op set becomes `'()!<>|:+-*/'`; keep the two-char check first (`||`, `&&`, comparisons), and note `|` is single only when the next char is not `|`.

Parser — replace `parse`/`parseComparison`/`parsePrimary` per the spec grammar:

```ts
  parse(): unknown {
    const value = this.parsePipes();
    if (this.i < this.toks.length) throw new SyntaxError(`unexpected token at position ${this.endPos()}`);
    return value;
  }
  private parsePipes(): unknown {
    let value = this.parseOr();
    while (this.isOp('|')) {
      this.next();
      const name = this.next();
      if (!name || name.type !== 'path') throw new SyntaxError(`expected a format name at position ${name?.pos ?? this.srcLen}`);
      let arg: unknown;
      if (this.isOp(':')) {
        this.next();
        arg = this.parsePrimary();
      }
      value = format(name.value, value, arg, this.vars, name.pos);
    }
    return value;
  }
  private parseComparison(): unknown {
    const left = this.parseAdditive();
    const t = this.peek();
    if (t?.type === 'op' && COMPARE_OPS.includes(t.value)) {
      this.next();
      return compare(t.value, left, this.parseAdditive(), t.pos);
    }
    return left;
  }
  private parseAdditive(): unknown {
    let left = this.parseMultiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next()!.value;
      const right = this.parseMultiplicative();
      left = op === '+' ? Number(left) + Number(right) : Number(left) - Number(right);
    }
    return left;
  }
  private parseMultiplicative(): unknown {
    let left = this.parseUnary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = this.next()!.value;
      const right = this.parseUnary();
      left = op === '*' ? Number(left) * Number(right) : Number(left) / Number(right);
    }
    return left;
  }
  private parseUnary(): unknown {
    if (this.isOp('-')) {
      this.next();
      return -Number(this.parseUnary());
    }
    return this.parsePrimary();
  }
  private isOp(value: string): boolean {
    const t = this.peek();
    return t?.type === 'op' && t.value === value;
  }
```

`parsePrimary`'s parenthesised branch calls `this.parseOr()` (not pipes — a pipe binds loosest). Note `Number(null)` is `0`: `readPath` answers `null` for a missing var, so `$missing + 1` must be `NaN` — in `parseAdditive`/`parseMultiplicative`/`parseUnary` use a local `num = (x: unknown) => (x === null || x === undefined || x === '' ? NaN : Number(x))` instead of bare `Number()`.

Formats:

```ts
/** The pipe formats; each returns a string. `vars` is for `currency`'s `$session.currency`. */
function format(name: string, value: unknown, arg: unknown, vars: Record<string, unknown>, pos: number): string {
  const n = Number(value);
  switch (name) {
    case 'currency': {
      const c = readPath('$session.currency', vars) as
        { symbol?: string; decimals?: number; position?: string } | null;
      const decimals = typeof c?.decimals === 'number' ? c.decimals : 2;
      const text = n.toFixed(decimals);
      if (!c?.symbol) return text;
      return c.position === 'right' ? `${text} ${c.symbol}` : `${c.symbol}${text}`;
    }
    case 'int':
      return String(Math.round(n));
    case 'fixed':
      return n.toFixed(Number(arg ?? 0));
    case 'multiplier':
      return `x${String(Number(n.toFixed(4)))}`;
    default:
      throw new SyntaxError(`unknown format '${name}' at position ${pos}`);
  }
}
```

```ts
export function evaluateValue(expr: string, vars: Record<string, unknown>): unknown {
  return new Parser(tokenize(expr), vars, expr.length).parse();
}
export function evaluate(expr: string, vars: Record<string, unknown>): boolean {
  return Boolean(evaluateValue(expr, vars));
}
```

Update the module doc comment (the grammar, the formats, the `null → NaN` rule).

- [ ] **Step 4: Run** `npm test -w @energy8engine/flow` → PASS (every earlier `evaluate` case still green).

- [ ] **Step 5: Commit** `git add engine/game/flow && git commit -m "Flow expressions: arithmetic, formats, numeric path segments, evaluateValue"`

---

### Task 5: `resolveValue` — templates + expressions in every kind; `shell` siblings; flow-fx `audio.volume`

**Files:**
- Create: `engine/game/flow/src/value.ts`
- Modify: `engine/game/flow/src/index.ts`, `engine/game/flow/src/kinds.ts`
- Modify: `engine/game/flow-fx/src/audio.ts`
- Test: `engine/game/flow/tests/value.test.ts` (new), `engine/game/flow/tests/kinds.test.ts`, `engine/game/flow-fx/tests/audio.test.ts` (existing — find the volume `$path` case)

**Interfaces:**
- Consumes: `evaluateValue` (Task 4).
- Produces: `resolveValue(value: unknown, vars: Record<string, unknown>, report?: (message: string) => void): unknown` exported from `@energy8engine/flow`.

- [ ] **Step 1: Failing tests.** `value.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { resolveValue } from '../src/value';

const vars = { result: { win: 12.5, winAmount: 4.6, data: { mult_running: 48, fs_total: 10, fs_remaining: 4 } }, session: { currency: { symbol: '$', decimals: 2, position: 'left' } } };

describe('resolveValue', () => {
  it('a bare $path is the typed value, as before', () => expect(resolveValue('$result.win', vars)).toBe(12.5));
  it('a $expression computes', () => expect(resolveValue('$result.data.fs_total - $result.data.fs_remaining', vars)).toBe(6));
  it('a template joins literal text and {expr}s into a string', () => {
    expect(resolveValue('x{$result.data.mult_running}', vars)).toBe('x48');
    expect(resolveValue('{$result.data.fs_total - $result.data.fs_remaining}/{$result.data.fs_total}', vars)).toBe('6/10');
    expect(resolveValue('{$result.winAmount | currency} won', vars)).toBe('$4.60 won');
  });
  it('a literal (no $, no braces) and a non-string pass through', () => {
    expect(resolveValue('tapped', vars)).toBe('tapped');
    expect(resolveValue(3, vars)).toBe(3);
    expect(resolveValue({ a: 1 }, vars)).toEqual({ a: 1 });
  });
  it('a syntax error or an unknown format reports and leaves the string as written', () => {
    const report = vi.fn();
    expect(resolveValue('{$result.win +}', vars, report)).toBe('{$result.win +}');
    expect(resolveValue('$result.win | bogus', vars, report)).toBe('$result.win | bogus');
    expect(resolveValue('{', vars, report)).toBe('{');
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1][0]).toMatch(/unknown format 'bogus'/);
  });
  it('a missing var in a template reads as an empty string, not "null"', () =>
    expect(resolveValue('[{$nothing}]', vars)).toBe('[]'));
});
```

`kinds.test.ts` — add:
- `prop`: `value: 'x{$result.data.mult_running}'` reaches `setProps` as `'x48'` on a string prop; `value: '$a - $b'` on a number prop reaches it as a number;
- `shell`: `freeSpinsCurrent: '3'` with `state.freeSpins = { current: 1, total: 8, totalWin: 2 }` calls `setFreeSpins({ current: 3, total: 8, totalWin: 2 })` once; `freeSpinsTotalWin: '$result.winAmount'` likewise; `bonusTotalWin` with `state.bonus = null` reports `shell: bonusTotalWin: no bonus to update` and calls nothing; with a bonus set calls `setBonus({ ...state.bonus, totalWin })`;
- `set`/`emit`: a template payload resolves to a string;
- `spin`: `action: '{$shell.activeFeature.id}'`-style template still refused when it resolves to `''`? — no: a template always yields a string; `spin` sends it. Cover: `betLevel: '$shell.bet * 2'` → `request.betLevel` doubled.

`flow-fx/tests/audio.test.ts` — the existing `$path` volume case plus `volume: '{$x}'`-free arithmetic: `volume: '$v / 2'`.

- [ ] **Step 2: Run** `npm test -w @energy8engine/flow -- value kinds` → FAIL.

- [ ] **Step 3: Implement.** `value.ts`:

```ts
import { evaluateValue, readPath } from './expr';

const TEMPLATE = /\{([^{}]*)\}/g;

/**
 * A prop value: a string with `{…}` spans is a template (each span an
 * expression, `String()`ed — a missing var reads as `''`, not `null`),
 * a string starting with `$` is an expression, anything else the literal.
 * A `SyntaxError` (an unknown format included) calls `report` and answers
 * the string AS WRITTEN — the kind's own type check then names the prop.
 */
export function resolveValue(
  value: unknown,
  vars: Record<string, unknown>,
  report?: (message: string) => void,
): unknown {
  if (typeof value !== 'string') return value;
  try {
    if (/\{[^{}]*\}/.test(value)) {
      return value.replace(TEMPLATE, (_m, expr: string) => {
        const v = evaluateValue(expr, vars);
        return v === null || v === undefined ? '' : String(v);
      });
    }
    if (value.startsWith('$')) return evaluateValue(value, vars);
    return value;
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    report?.(`bad value '${value}': ${e.message}`);
    return value;
  }
}

export { readPath };
```

(`'{'` alone: no complete span, no `$` → literal, no report — matches the test.)

`index.ts`: export `evaluateValue` and `resolveValue`.

`kinds.ts`:
- replace the local `resolve` with `const resolve = (value: unknown, vars, report?: RunCtx['report']) => resolveValue(value, vars, report && ((m) => report(m, 'warning')));` and pass `report` at every call site (`spin`, `step`, `present`, `prop`, `set`, `emit`, `shell`); `prop`'s `$path` branch becomes "a string starting with `$` or containing a template" — simplest: `const raw = resolve(p.value, vars, report); const dynamic = raw !== p.value;` then the existing stringify-for-string-prop rule applies when `dynamic`.
- descriptions: every "or `$path`" → "or `$expr` / a `{…}` template".
- `shell` schema adds (after `freeSpins`):

```ts
    freeSpinsCurrent: Schema.string().default('').description('spins played so far (a number) — merged over the current free-spins readout'),
    freeSpinsTotalWin: Schema.string().default('').description('free-spins total win, currency units — merged over the current readout'),
```

and after `bonus`:

```ts
    bonusTotalWin: Schema.string().default('').description('bonus total win, currency units — merged over the bonus readout set earlier'),
```

`ShellLike.state` gains `freeSpins: { current?: number | null; total: number; totalWin: number }; bonus: { label: string; value: string; totalWin: number } | null`. In `run`, after the `freeSpins` block:

```ts
    const fsCurrent = value('freeSpinsCurrent');
    const fsTotalWin = value('freeSpinsTotalWin');
    if (fsCurrent !== undefined || fsTotalWin !== undefined) {
      const next = { ...shell.state.freeSpins };
      let ok = true;
      if (fsCurrent !== undefined) {
        const n = asNumber(fsCurrent);
        if (Number.isNaN(n)) { bad('freeSpinsCurrent', fsCurrent, 'a number'); ok = false; } else next.current = n;
      }
      if (fsTotalWin !== undefined) {
        const n = asNumber(fsTotalWin);
        if (Number.isNaN(n)) { bad('freeSpinsTotalWin', fsTotalWin, 'a number'); ok = false; } else next.totalWin = n;
      }
      if (ok) apply('freeSpins', () => shell.setFreeSpins(next));
    }
```

and after the `bonus` block:

```ts
    const bonusTotalWin = value('bonusTotalWin');
    if (bonusTotalWin !== undefined) {
      const n = asNumber(bonusTotalWin);
      if (Number.isNaN(n)) bad('bonusTotalWin', bonusTotalWin, 'a number');
      else if (!shell.state.bonus) report('shell: bonusTotalWin: no bonus to update', 'warning');
      else apply('bonusTotalWin', () => shell.setBonus({ ...shell.state.bonus!, totalWin: n }));
    }
```

Fake shells in `kinds.test.ts` need `state.freeSpins`/`state.bonus`.

`flow-fx/src/audio.ts` line 48: `resolveValue(p.volume, vars, (m) => report(m, 'warning'))` in place of the inline `readPath` (import `resolveValue` from `@energy8engine/flow`).

- [ ] **Step 4: Run** `npm test -w @energy8engine/flow` and `npm test -w @energy8engine/flow-fx` → PASS; typecheck both.

- [ ] **Step 5: Commit** `git add engine/game/flow engine/game/flow-fx && git commit -m "Flow values: one resolver with templates and formats; shell free-spins/bonus siblings"`

---

### Task 6: The dev wallet charges an action's cost; `/api/session` carries `actions`

**Files:**
- Modify: `engine/game/session-host/src/index.ts`
- Modify: `engine/ide/host/src/plugins/dev-game.ts` (`/api/session`)
- Test: `engine/game/session-host/tests/*.test.ts` (existing file — find the charge case), `engine/ide/host/tests/dev-game.test.ts`

- [ ] **Step 1: Failing tests.**

session-host (mirror the file's existing `fetchFn` fake of `/api/session` + `/api/spin`):

```ts
  it('an opening play charges betLevel × the action’s cost from init.actions; an unknown action × 1; a step charges nothing', async () => {
    // init: { balance: 1000, betLevels: [1], defaultBet: 1, currency, actions: { spin: 1, tournament: 100 } }
    // play({ action: 'tournament', betLevel: 2 }) → result.balance === 1000 - 200 + winAmount
    // play({ action: 'mystery', betLevel: 2 }) → charged 2
    // play({ action: 'free_spin', betLevel: 2, roundId: 'r' }) → charged 0
  });
```

dev-game (`bare()` composes no `spinSchema` — `actions` absent; add a second composition with a stub `spinSchema`):

```ts
  it('/api/session carries `actions` from the spin schema (name → cost) and omits it with no schema', async () => {
    await bare();
    await ctx!.plugin({ name: 'spin-schema-stub', apply(c: Context) {
      c.provide('spinSchema', { schema: { actions: [{ name: 'spin', stage: 'base_game', cost: 1 }, { name: 'tournament', stage: 'free_spins', cost: 100 }] }, diagnostics: [], reload: async () => {} });
    } });
    await ctx!.plugin(devGame, { root: WEB_ROOT, gamesDir: GAME, gameId: 'first-slot', betLevel: 1, betLevels: [1], port: 0, previewPort: 0 });
    const body = await (await fetch(`${preview(ctx!)}/api/session`)).json();
    expect(body.actions).toEqual({ spin: 1, tournament: 100 });
  });
```

The existing `/api/session` `toEqual` case stays exact (no `actions` key without a schema).

- [ ] **Step 2: Run** both suites' files → FAIL.

- [ ] **Step 3: Implement.** session-host `play`:

```ts
    if (req.roundId === undefined) balance -= (req.betLevel ?? 0) * (init.actions?.[req.action] ?? 1);
```

(check `PlayRequest.action`'s name in `contracts/session.ts`; the module doc's wallet paragraph gains one sentence on `actions`).

dev-game `/api/session`:

```ts
    const schema = (ctx.reflect.get('spinSchema', false) as { schema?: { actions?: { name: string; cost: number }[] } | null } | undefined)?.schema;
    const actions = schema?.actions?.length
      ? Object.fromEntries(schema.actions.map((a) => [a.name, a.cost]))
      : undefined;
    res.json({ gameId: config.gameId, balance: 1000, currency: {…}, betLevels, defaultBet: betLevels[0], ...(actions ? { actions } : {}) });
```

- [ ] **Step 4: Run** `npm test -w @energy8engine/session-host`; `npm test -w @energy8engine/ide-host -- dev-game` → PASS.

- [ ] **Step 5: Commit** `git add engine/game/session-host engine/ide/host && git commit -m "Dev wallet: an opening play charges the action's cost; /api/session carries actions"`

---

### Task 7: `GET /api/spec`, frozen by `e8 build`; the default-target info line

**Files:**
- Create: `engine/ide/host/src/plugins/game-spec.ts`
- Modify: `engine/ide/host/src/plugins/project-scope.ts`, `engine/ide/host/src/plugins/dev-game.ts`, `engine/ide/host/src/compute/build.ts`
- Test: `engine/ide/host/tests/game-spec.test.ts` (new), `engine/ide/host/tests/build.test.ts`

- [ ] **Step 1: Failing tests.** `game-spec.test.ts` (compose `Server` + the plugin with `{ cwd }` on `fixtures/project-spec`, then on `fixtures/project-simple` whose `spec.json` is descriptive, then on a temp dir with no `spec.json`):

```ts
  it('answers { spec } with game/spec.json as written; null when absent or not JSON', …)
```

`build.test.ts`:
- "writes index.html, the **five** api/ documents" — `api/spec` joins the list;
- "api/flow, api/scenes and api/symbols are byte-identical" — add `spec`;
- "a default build bakes no target…" — assert `result.diagnostics` contains `{ severity: 'info', where: '--target', message: expect.stringContaining('the default target has no session') }` on the default build and NOT on `--target platform`.

- [ ] **Step 2: Run** `npm test -w @energy8engine/ide-host -- game-spec build` → FAIL.

- [ ] **Step 3: Implement.** `game-spec.ts`:

```ts
/**
 * `GET /api/spec` — `game/spec.json` as written (`{ spec }`, `null` when
 * absent or not JSON), on the root server and, through `attachGameRoutes`,
 * the game preview. A document the rows read (the shell derives a paytable
 * from `symbols[].pay`) — so `e8 build` freezes it beside flow/scenes/symbols.
 * Read per request: the dev host has no cache to keep fresh.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from 'cordis';
import type { Server } from '../server';

export interface GameSpecHost { attachGameRoutes(server: Server): void; }
declare module 'cordis' { interface Context { gameSpecHost: GameSpecHost } }

export const name = 'game-spec';
export const inject = ['server'];

export function apply(ctx: Context, config: { cwd: string }): void {
  const get = async (_req: unknown, res: { json(body: unknown): void }) => {
    let spec: unknown = null;
    try { spec = JSON.parse(await readFile(join(config.cwd, 'game', 'spec.json'), 'utf8')); } catch { spec = null; }
    res.json({ spec });
  };
  ctx.server.get('/api/spec', get);
  ctx.provide('gameSpecHost', { attachGameRoutes: (server) => server.get('/api/spec', get) });
}
```

(match `Server`'s import path and handler types to `symbols.ts`'s.) `project-scope.ts`: `await ctx.plugin(gameSpec, { cwd });` after `symbols`. `dev-game.ts` line ~335: `ctx.get('gameSpecHost')?.attachGameRoutes(preview);`. `build.ts`: `DOCUMENTS = ['flow', 'scenes', 'symbols', 'spec']`; after the target is known, when `input.target` is undefined:

```ts
  diagnostics.push(diagnostic('info', 'build', '--target',
    'the default target has no session: serve /api/session and /api/spin from a host, or build with --target platform'));
```

The CLI's `build` printer already prints every diagnostic; check `run.ts` treats `info` as non-fatal (exit 0).

- [ ] **Step 4: Run** `npm test -w @energy8engine/ide-host -- game-spec build dev-game` → PASS.

- [ ] **Step 5: Commit** `git add engine/ide/host && git commit -m "Host: GET /api/spec, frozen by e8 build; the default target says it has no session"`

---

### Task 8: `e8 spin` divides rtp by the action's cost

**Files:**
- Modify: `engine/ide/host/src/compute/spin.ts`, `engine/apps/cli/src/run.ts` (help lines 66–72)
- Test: `engine/ide/host/tests/compute-spin.test.ts`

- [ ] **Step 1: Failing test** — in `describe('summarise')` add `cost`: `summarise(rounds, 100)` → `rtp = mean / 100`, `cost: 100`; in "plays n spins and reports them" expect `report.cost === 1`. A real-server case with a costed action needs a fixture action with `cost = 100` — add one to `fixtures/project-spec/game/script.spin` only if an action can be added without changing its other tests' expectations; otherwise the `summarise` unit case is the proof and the integration reads `cost` from `parseSpinSchema(await readFile(assembled.spinFile))`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** `SpinReport.cost: number` (doc: "the played action's bet multiplier from the .spin schema; 1 when unknown"); `summarise(rounds, cost = 1)` sets `rtp: wins.length ? sum / wins.length / cost : 0` and `cost`; in `spin()`, after `assemble`: 

```ts
  let cost = 1;
  try {
    const { schema } = parseSpinSchema(await readFile(assembled.spinFile, 'utf8'));
    cost = schema?.actions.find((a) => a.name === (input.action ?? 'spin'))?.cost ?? 1;
  } catch { /* no schema: cost 1, the help says so */ }
```

and `report()` passes `cost`. `run.ts` help: `spin { spins, steps, bet, cost, rtp, … }` and the rtp lines: "rtp: mean of each round's final totalWin divided by `cost` (the action's bet multiplier from the .spin; 1 when unknown); a round's Step calls cost nothing extra".

- [ ] **Step 4: Run** `npm test -w @energy8engine/ide-host -- compute-spin`; `npm test -w @energy8engine/e8` → PASS.

- [ ] **Step 5: Commit** `git add engine/ide/host engine/apps/cli && git commit -m "e8 spin: rtp divides by the action's cost"`

---

### Task 9: `reels.origin: cell | center`

**Files:**
- Modify: `engine/game/reels/src/index.ts` (`GridLike`), `engine/game/reels/src/runtime.ts`
- Test: `engine/game/reels/tests/runtime.test.ts`

- [ ] **Step 1: Failing test** (in `describe('the reels node type')`):

```ts
  it('origin: center wraps the board view offset by the grid’s centre; cell (the default) hands out the bare view; unmount resets', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { config: { grid: { cols: 5, rows: 3, cellSize: 100, gap: 10 } } });
    const nodeTypes = createNodeTypes();
    ctx.provide('nodeTypes', nodeTypes);
    await vi.waitFor(() => expect(nodeTypes.get('reels')).toBeDefined());
    const type = nodeTypes.get('reels')!;
    const board = ctx.get('board')!;
    const g = board.grid.geometry!;
    const view = type.mount({ row: 'reels1', origin: 'center' }, ctx);
    expect(view).not.toBe(board.view);
    expect(board.view.parent).toBe(view);
    expect(board.view.position.x).toBeCloseTo(-g.centerX);
    expect(board.view.position.y).toBeCloseTo(-g.centerY);
    type.unmount!(view);
    expect(board.view.parent).toBeNull();
    expect(board.view.position.x).toBe(0);
    expect(type.mount({ row: 'reels1', origin: 'cell' }, ctx)).toBe(board.view);
  });
```

- [ ] **Step 2: Run** `npm test -w @energy8engine/reels -- runtime` → FAIL.

- [ ] **Step 3: Implement.** `GridLike` gains `readonly geometry?: { centerX: number; centerY: number };` (doc: the legacy `ReelGrid.geometry`; optional because the tests' fake grid has none). `runtime.ts` node type:

```ts
          schema: Schema.object({
            row: Schema.string().default('reels1').description('the reels row this node shows'),
            origin: Schema.union(['cell', 'center'])
              .default('cell')
              .description("what x/y name: reel 0's cell centre (the board's own origin) or the board's centre"),
          }),
          mount: (props) => {
            board.view.parent?.removeChild(board.view);
            if (props.origin !== 'center') return board.view;
            const g = board.grid.geometry;
            board.view.position.set(-(g?.centerX ?? 0), -(g?.centerY ?? 0));
            const wrap = new Container();
            wrap.label = 'reels:center';
            wrap.addChild(board.view);
            return wrap;
          },
          unmount: (view) => {
            view.parent?.removeChild(view);
            if (view === board.view) return;
            board.view.position.set(0, 0);
            board.view.parent?.removeChild(board.view);
            view.destroy();
          },
```

(`Container` import from `pixi.js`.) The scenes runtime remounts on an own-prop change (slice 28), so toggling `origin` in the IDE re-places the board.

- [ ] **Step 4: Run** `npm test -w @energy8engine/reels` → PASS.

- [ ] **Step 5: Commit** `git add engine/game/reels && git commit -m "Reels node: origin center"`

---

### Task 10: `shell-pixi` derives a paytable from `/api/spec`

**Files:**
- Create: `engine/game/shell-pixi/src/paytable.ts`
- Modify: `engine/game/shell-pixi/src/index.ts`
- Test: `engine/game/shell-pixi/tests/paytable.test.ts` (new), `engine/game/shell-pixi/tests/row.test.ts`

- [ ] **Step 1: Failing tests.** `paytable.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { paytableFrom } from '../src/paytable';

const spec = { symbols: [
  { id: 'ROCK', name: 'Rock', pay: { '30': 1.2, '8': 0.15, '9': 0.25 } },
  { id: 'WILD', name: 'Wild' },
  { id: 'NUT', pay: { '8': 0.05 } },
] };
const symbols = { version: 1, symbols: [
  { id: 'ROCK', static: { type: 'image', props: { src: 'assets/rock.webp' } } },
  { id: 'NUT', static: { type: 'strip', props: { src: 'assets/nut.webp' } } },
] };

describe('paytableFrom', () => {
  it('one row per symbol with pay, counts ascending, image from an image static state, text otherwise', () => {
    expect(paytableFrom(spec, symbols)).toEqual({
      type: 'paytable', title: 'Paytable',
      rows: [
        { symbol: { image: 'assets/rock.webp' }, wins: [{ count: '8', multiplier: 0.15 }, { count: '9', multiplier: 0.25 }, { count: '30', multiplier: 1.2 }] },
        { symbol: { text: 'NUT' }, wins: [{ count: '8', multiplier: 0.05 }] },
      ],
    });
  });
  it('null when no symbol pays, when spec is null, or when symbols is not an array', () => {
    expect(paytableFrom({ symbols: [{ id: 'A' }] }, null)).toBeNull();
    expect(paytableFrom(null, null)).toBeNull();
    expect(paytableFrom({ symbols: 'x' }, null)).toBeNull();
  });
});
```

`row.test.ts` — with the file's fake `createPixiShell` capture: a row config with `gameInfo: { sections: [] }` and a `fetchFn` answering `/api/spec` with the spec above → `createPixiShell` received `gameInfo.sections[0].type === 'paytable'`; authored `sections: [{ type: 'custom', title: 'Rules' }]` → untouched and NO fetch; a `fetchFn` that rejects → `sections: []`, no throw.

- [ ] **Step 2: Run** `npm test -w @energy8engine/shell-pixi` → FAIL.

- [ ] **Step 3: Implement.** `paytable.ts`:

```ts
import type { SymbolsDoc } from '@energy8engine/contracts';

export interface PaytableSection {
  type: 'paytable';
  title: string;
  rows: { symbol: { text?: string; image?: string }; wins: { count: string; multiplier: number }[] }[];
}

/** `spec.symbols[].pay` as the shell's paytable section; `null` when nothing pays. Art: the symbol's `static` state when it is an `image`. */
export function paytableFrom(spec: unknown, symbols: SymbolsDoc | null): PaytableSection | null {
  const list = (spec as { symbols?: unknown } | null)?.symbols;
  if (!Array.isArray(list)) return null;
  const art = new Map<string, string>();
  for (const def of symbols?.symbols ?? []) {
    const src = def.static?.type === 'image' ? def.static.props?.src : undefined;
    if (typeof src === 'string' && src) art.set(def.id, src);
  }
  const rows: PaytableSection['rows'] = [];
  for (const s of list as { id?: unknown; name?: unknown; pay?: unknown }[]) {
    if (typeof s?.id !== 'string' || !s.pay || typeof s.pay !== 'object') continue;
    const wins = Object.entries(s.pay as Record<string, unknown>)
      .filter(([, m]) => typeof m === 'number')
      .map(([count, multiplier]) => ({ count, multiplier: multiplier as number }))
      .sort((a, b) => Number(a.count) - Number(b.count));
    if (!wins.length) continue;
    const image = art.get(s.id);
    rows.push({ symbol: image ? { image } : { text: typeof s.name === 'string' ? s.name : s.id }, wins });
  }
  return rows.length ? { type: 'paytable', title: 'Paytable', rows } : null;
}
```

`index.ts` `apply` becomes `async`; before `createPixiShell`:

```ts
  const validated = Config(config);
  const sections = (validated.gameInfo as { sections?: unknown[] } | undefined)?.sections;
  if (Array.isArray(sections) && sections.length === 0) {
    const fetchFn = (config as { fetchFn?: typeof fetch }).fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    try {
      const res = await fetchFn('/api/spec');
      const body = res.ok ? ((await res.json()) as { spec?: unknown }) : null;
      const symbols = ctx.reflect.get('symbols', false) as { doc(): SymbolsDoc | null; ready?: Promise<void> } | undefined;
      await symbols?.ready?.catch(() => {});
      const section = paytableFrom(body?.spec ?? null, symbols?.doc() ?? null);
      if (section) validated.gameInfo = { ...validated.gameInfo, sections: [section] };
    } catch {
      // No host, or no spec: the game info stays as authored (empty). The static default build lands here.
    }
  }
```

then `toShellConfig(validated, init)`. The row's module doc gains a paragraph: the fetch happens only for empty `sections`, before the shell exists (there is no `setGameInfo`), silently on failure.

- [ ] **Step 4: Run** `npm test -w @energy8engine/shell-pixi` → PASS; typecheck.

- [ ] **Step 5: Commit** `git add engine/game/shell-pixi && git commit -m "Shell row: a paytable derived from game/spec.json when none is authored"`

---

### Task 11: The example, the template and the browser proof

**Files:**
- Modify: `engine/examples/first-slot/flow.yml`, `engine/templates/slot-basic/flow.yml` (byte-identical pair)
- Modify: `engine/apps/web/tests/e2e/text.spec.ts`
- Test: `engine/ide/host/tests/template.test.ts` (unchanged — it pins the pair), `npx playwright test text.spec.ts` from `engine/apps/web`

- [ ] **Step 1: Change the pair.** In both `flow.yml`s, `show_win`'s value: `value: '{$result.winAmount | currency}'`. Keep every other byte. Run `npm test -w @energy8engine/ide-host -- template` → PASS (the pair still matches).

- [ ] **Step 2: Update `text.spec.ts` case 1** — the final assertion: 

```ts
    .toBe(`$${spins.at(-1)!.result.winAmount.toFixed(2)}`);
```

(the dev host's currency is `{ symbol: '$', decimals: 2, position: 'left' }`; `spins()` entries carry `result.winAmount` since slice 26 — verify in `src/main.ts`'s `__e8.spins`). Update the file's header comment (the value is now a template with `currency`).

- [ ] **Step 3: Add case 4** to `text.spec.ts` — a `projectCopy()` whose `flow.yml` is:

```yaml
version: 1
nodes:
  - { id: start, kind: boot, ui: { x: 40,  y: 80 } }
  - { id: base,  kind: show, props: { scene: base_game }, ui: { x: 220, y: 80 } }
  - { id: beat,  kind: emit, props: { event: pd.round, payload: { n: 3 }, wait: true }, ui: { x: 400, y: 80 } }
  - { id: after, kind: prop, props: { target: base_game/win, prop: text, value: 'after {$n}' }, ui: { x: 580, y: 80 } }
  - { id: hear,  kind: on,   props: { event: pd.round, busy: parallel }, ui: { x: 400, y: 240 } }
  - { id: pause, kind: wait, props: { ms: 300 }, ui: { x: 580, y: 240 } }
  - { id: inner, kind: prop, props: { target: base_game/win, prop: text, value: 'x{$event.n * 2}' }, ui: { x: 760, y: 240 } }
edges:
  - { from: start, to: base }
  - { from: base,  to: beat }
  - { from: beat,  to: after }
  - { from: hear,  to: pause }
  - { from: pause, to: inner }
```

Assert: the win text becomes `x6` first (poll), then `after ` (the main branch has no `$n`: `''`), and the flow trace (`__e8.trace()` or the IDE's flow panel — use whatever `flow.spec.ts` reads) shows `inner:next` before `after:null`. Name the test "an emit with wait holds the main branch until a parallel on-branch ends; templates and arithmetic reach a text node".

- [ ] **Step 4: Run** the e2e file alone: `cd engine/apps/web && npx playwright test text.spec.ts` → PASS (the host must be rebuilt first: `npm run build -w @energy8engine/ide-host` and whatever `project-fixture` expects — read its header).

- [ ] **Step 5: Commit** `git add engine/examples/first-slot/flow.yml engine/templates/slot-basic/flow.yml engine/apps/web/tests/e2e/text.spec.ts && git commit -m "Example: the win text is a currency template; e2e for a parallel on-branch held by emit"`

---

## Self-review (done while writing)

- Spec §1.2–1.4 → Tasks 1–3; §2 → Tasks 4–5; §3 → Task 7; §4.1 → Task 6; §4.2 → Task 8; §4.3 → Task 9; §4.4 → Tasks 7 + 10; §5 e2e → Task 11.
- Names used across tasks: `EmitStep` (T1 → T3), `EventsService.emit(): Promise<void>` (T2 → T3 structurally), `evaluateValue` (T4 → T5), `resolveValue` (T5 → flow-fx), `SessionInit.actions` (T1 → T6), `gameSpecHost.attachGameRoutes` (T7 → dev-game), `GridLike.geometry` (T9), `paytableFrom` (T10).
- No task edits `packages/*`.
