# Armed skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A skip that lands while a round's request is in flight is kept and collapses that round's plan when it starts.

**Architecture:** `PlayService` gains `arm(): () => void`. While any arm is live and no `execute` runs, `skip()` sets a `pending` flag; the next `execute` starts latched and disarms everything; the last release with no `execute` clears `pending`. The flow's `spin`/`step` nodes (through `playThrough`) arm before `session.play`, release on `failed` at once and on `result` when the run goes idle.

**Tech Stack:** TypeScript, cordis 4, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-armed-skip-design.md`

## Global Constraints

- `packages/*` is not edited.
- Every fix carries a unit test in its package; the browser proof is the new `tempo.spec.ts` case.
- One workspace per test command (`npm test -w @energy8engine/play-loop`, `-w @energy8engine/flow`); typecheck each package touched.
- Playwright runs ALONE, one spec file, with `E8_E2E_HOST_PORT=5779`: `cd engine/apps/web && E8_E2E_HOST_PORT=5779 npx playwright test tempo.spec.ts`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`. Never `git stash`/`checkout`/`restore`.

## Review Focus

1. A request that FAILS after a skip was kept: the next round must not start latched. Pinned in Task 1 (release clears `pending`) and Task 2 (`failed` releases at once).
2. A skip AFTER a plan ended while the spin node's arm is still unreleased (its release waits for idle): dropped, not kept. Pinned in Task 1 (`execute` disarms).
3. Two arms (a `step` inside a run whose `spin` has not released): one release must not clear the other's pending skip. Pinned in Task 1.
4. A composition without a `play` row: `spin` still spins. Pinned in Task 2.
5. The e2e case must not race the arm: the skip is sent only after the held request is seen by `page.route`. Built into Task 3.

---

### Task 1: `PlayService.arm()` in the play row

**Files:**
- Modify: `engine/game/play-loop/src/runtime.ts` (`PlayService` interface ~line 108; `skip` ~line 262; `execute` ~line 307; the provided service object)
- Test: `engine/game/play-loop/tests/runtime.test.ts`

**Interfaces:**
- Produces: `PlayService.arm(): () => void`.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` at the end of `runtime.test.ts` (it reuses the file's imports; `BoardApi` is already imported):

```ts
describe('play-loop runtime half: arm — a skip before the plan', () => {
  /** A one-step plan whose board records `skip` calls; resolves at once. */
  const board = () => {
    const skip = vi.fn();
    return { skip, api: { spinTo: async () => {}, skip } as unknown as BoardApi };
  };
  const plan = [{ kind: 'spinTo' as const, board: [[1]] }];

  it('with no run and no arm, a skip is dropped — the next execute is not latched', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);
    ctx.play.skip();
    const b = board();
    await ctx.play.execute(plan, b.api);
    expect(b.skip).not.toHaveBeenCalled();
    await ctx.fiber.dispose();
  });

  it('armed, a skip is kept: the next execute collapses its first step as it starts', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);
    ctx.play.arm();
    ctx.play.skip();
    const b = board();
    await ctx.play.execute(plan, b.api);
    expect(b.skip).toHaveBeenCalledTimes(1);
    await ctx.fiber.dispose();
  });

  it('the release before any execute clears a kept skip — a failed request does not hurry the next round', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);
    const release = ctx.play.arm();
    ctx.play.skip();
    release();
    release(); // idempotent
    const b = board();
    await ctx.play.execute(plan, b.api);
    expect(b.skip).not.toHaveBeenCalled();
    await ctx.fiber.dispose();
  });

  it('arms nest: one of two released, the skip is still kept', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);
    const first = ctx.play.arm();
    ctx.play.arm();
    ctx.play.skip();
    first();
    const b = board();
    await ctx.play.execute(plan, b.api);
    expect(b.skip).toHaveBeenCalledTimes(1);
    await ctx.fiber.dispose();
  });

  it('execute disarms: a skip after the plan ended is dropped though the arm was never released', async () => {
    const ctx = new Context();
    await ctx.plugin(runtime);
    ctx.play.arm(); // released only when the run goes idle — not yet
    await ctx.play.execute(plan, board().api);
    ctx.play.skip(); // the plan is over; nothing live, nothing armed
    const b = board();
    await ctx.play.execute(plan, b.api);
    expect(b.skip).not.toHaveBeenCalled();
    await ctx.fiber.dispose();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w @energy8engine/play-loop`
Expected: FAIL — `ctx.play.arm is not a function` in four cases (the first passes already: that is today's idle guard, kept as the baseline).

- [ ] **Step 3: Declare `arm` on `PlayService`**

After the `skip(): void;` declaration and its doc, add:

```ts
  /**
   * "A plan is on its way" — what the flow's `spin`/`step` nodes call before
   * they ask the session for a round. Until the next `execute` starts, or the
   * returned release is called, a `skip()` with no run in flight is KEPT, and
   * that next `execute` starts latched: every step collapsed as it starts,
   * exactly as a skip mid-run does. Without it a second tap during the
   * round's request landed on no live run and was dropped.
   *
   * Arms nest (a set, not a flag); a release is idempotent, and the LAST one
   * with no `execute` having started clears a kept skip — a request that
   * failed does not hurry the next round. `execute` starting releases every
   * arm, so a skip after a plan began is the ordinary mid-run skip and one
   * after it ended is dropped as before. Never throws.
   */
  arm(): () => void;
```

And in `skip`'s doc, the paragraph "**A no-op with no run in flight**" gains, after its first sentence: "— unless the row is armed (see `arm`), when it is kept for the plan on its way".

- [ ] **Step 4: Implement it**

Next to `let skipped = false;`:

```ts
  // `arm()`'s live tokens, and a skip that landed while one was live but no
  // run was — kept for the plan on its way (see `PlayService.arm`).
  const arms = new Set<object>();
  let pending = false;
```

In `skip`, replace `if (!lastBoard) return;` with:

```ts
    if (!lastBoard) {
      if (arms.size > 0) pending = true;
      return;
    }
```

(and extend the comment above it by one sentence: "An ARMED row keeps it instead: the round's plan is on its way, and the skip is for it.")

In `execute`, as its first lines (before `lastBoard = board;`):

```ts
      // A skip kept while the request was in flight latches this run from
      // its first step; every arm is spent — a later skip is mid-run or idle.
      skipped = pending;
      pending = false;
      arms.clear();
```

In the provided service object, after `skip,`:

```ts
    arm() {
      const token = {};
      arms.add(token);
      return () => {
        if (arms.delete(token) && arms.size === 0) pending = false;
      };
    },
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @energy8engine/play-loop` — Expected: PASS (all).
Run: `npm run typecheck -w @energy8engine/play-loop` — Expected: 0 errors.
Then find full `PlayService` fakes elsewhere: `grep -rln "PlayService" engine --include=*.ts | grep -v node_modules` — and typecheck each package that has one (`npm run typecheck -w <name>`); a fake typed as the full `PlayService` gains `arm: () => () => {}`. Expected: 0 errors everywhere.

- [ ] **Step 6: Commit**

```bash
git add engine/game/play-loop/src/runtime.ts engine/game/play-loop/tests/runtime.test.ts
# plus any fake the typecheck step touched, by path
git commit -m "Play loop: an armed row keeps a skip for the plan on its way

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: the flow's `spin`/`step` arm the play row

**Files:**
- Modify: `engine/game/flow/src/kinds.ts` (`playThrough` ~line 191; its two callers in `spin` ~line 240 and `step` ~line 281)
- Test: `engine/game/flow/tests/kinds.test.ts`

**Interfaces:**
- Consumes: `PlayService.arm(): () => void` (Task 1; `PlayService` is already imported in `kinds.ts` from `@energy8engine/play-loop/runtime`).

- [ ] **Step 1: Write the failing tests**

Add after the existing `spin: a play that throws …` case (same `describe`; `runCtx`, `fakeSession`, `kind` are the file's own helpers):

```ts
  /** A play row whose `arm` records when it was called and released, against `session.play`. */
  const armingPlay = (log: string[]) => ({
    arm: vi.fn(() => {
      log.push('arm');
      return () => log.push('release');
    }),
  });

  it('spin: arms the play row before session.play and releases at once on failed', async () => {
    const log: string[] = [];
    const session = {
      ...fakeSession(),
      play: vi.fn(async () => {
        log.push('play');
        return { diagnostics: [{ severity: 'error', message: 'down' }] };
      }),
    };
    const { rc } = runCtx({ session, play: armingPlay(log) });
    const out = await kind('spin').run!({ action: 'spin' }, rc);
    expect(out).toMatchObject({ out: 'failed' });
    expect(log).toEqual(['arm', 'play', 'release']);
  });

  it('spin: on result the release waits for the run to go idle', async () => {
    const log: string[] = [];
    let idle!: () => void;
    const { rc } = runCtx({ session: fakeSession(), play: armingPlay(log) });
    rc.idle = () => new Promise<void>((r) => (idle = r));
    const out = await kind('spin').run!({ action: 'spin' }, rc);
    expect(out).toMatchObject({ out: 'result' });
    expect(log).toEqual(['arm']);
    idle();
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['arm', 'release']);
  });

  it('step: arms too, and a thrown session releases at once', async () => {
    const log: string[] = [];
    const session = { ...fakeSession(), play: vi.fn(async () => { log.push('play'); throw new Error('gone'); }) };
    const { rc } = runCtx({ session, play: armingPlay(log) });
    const out = await kind('step').run!({ roundId: 'r1', action: 'next' }, rc);
    expect(out).toMatchObject({ out: 'failed' });
    expect(log).toEqual(['arm', 'play', 'release']);
  });

  it('spin: a composition without a play row still spins', async () => {
    const { rc } = runCtx({ session: fakeSession() });
    await expect(kind('spin').run!({ action: 'spin' }, rc)).resolves.toMatchObject({ out: 'result' });
  });
```

If `kind(...).run!(props, rc)` is not how the file's existing `spin` cases invoke a kind, use the exact invocation those cases use (read `kinds.test.ts` ~lines 129–260 first); the assertions stay as written.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w @energy8engine/flow`
Expected: FAIL — the three arming cases (`log` is `['play']` / `[]`); the no-play case passes already (baseline).

- [ ] **Step 3: Implement — `playThrough` arms**

Change `playThrough`'s signature to take the run's `idle`, and arm around the session call:

```ts
async function playThrough(
  ctx: Context,
  request: PlayRequest,
  report: RunCtx['report'],
  idle: RunCtx['idle'],
): Promise<{ out: string; vars?: Record<string, unknown> }> {
  const session = ctx.reflect.get('session', false) as SessionService | undefined;
  if (!session) {
    report('no session row in this composition');
    return { out: 'failed', vars: { error: 'no session' } };
  }
  // "A plan is on its way" (`PlayService.arm`): a second tap while this
  // request is in flight is kept for the plan instead of landing on no live
  // run. Released at once on a failure (no plan is coming), else when the
  // run goes idle — normally long after `present`'s `execute` spent it.
  // Lenient: a composition without a play row still spins.
  const release = (ctx.reflect.get('play', false) as PlayService | undefined)?.arm?.();
  const out = await (async () => {
    try {
      const { result, diagnostics } = await session.play(request);
      if (result) return { out: 'result', vars: { result, request } };
      for (const d of diagnostics) report(d.message, d.severity);
      return { out: 'failed', vars: { error: diagnostics.map((d) => d.message).join('; ') || 'no result' } };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      report(message);
      return { out: 'failed', vars: { error: message } };
    }
  })();
  if (out.out === 'failed') release?.();
  else void idle().then(() => release?.());
  return out;
}
```

In `spin.run` and `step.run`, destructure `idle` from the run context (`async run(p, { ctx, vars, report, idle })`) and pass it: `return playThrough(ctx, request, report, idle);`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @energy8engine/flow` — Expected: PASS (all).
Run: `npm run typecheck -w @energy8engine/flow` — Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add engine/game/flow/src/kinds.ts engine/game/flow/tests/kinds.test.ts
git commit -m "Flow: spin and step arm the play row while their request is in flight

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: the browser proof in `tempo.spec.ts`

**Files:**
- Modify: `engine/apps/web/tests/e2e/tempo.spec.ts` (case 3's doc ~line 234; a new case after case 3)

**Interfaces:**
- Consumes: Tasks 1–2 (no new names). The page's `__e8.spin()` / `__e8.skip()` (existing).

- [ ] **Step 1: Add the case**

After case 3 (`skip, 100 ms into a spin, …`), using the same fixture idiom (`host = await startDevHost(dir); await readyPage(page);`):

```ts
/**
 * Case 3b (slice 34). The window case 3 only hoped to miss: a skip that
 * lands while the round's request is still in flight. `page.route` holds
 * `/api/spin` for `HOLD_MS`, and the skip is sent only once the held request
 * has been SEEN — so it provably arrives before any plan exists. The flow's
 * `spin` node armed the play row, so the skip is kept, and the plan that
 * arrives after the hold is collapsed from its first step. Without the arm
 * the spin resolves after the hold PLUS a played-out round (≥ 2 s).
 */
test('a skip during a held spin request is kept, and the round collapses when its plan arrives', async ({
  page,
}) => {
  host = await startDevHost(dir);
  await readyPage(page);

  const HOLD_MS = 800;
  let seen!: () => void;
  const requested = new Promise<void>((r) => (seen = r));
  await page.route('**/api/spin', async (route) => {
    seen();
    await new Promise((r) => setTimeout(r, HOLD_MS));
    await route.continue();
  });

  const spinPromise = page.evaluate(() => (window as any).__e8.spin());
  await requested;
  const skipAt = Date.now();
  await page.evaluate(() => (window as any).__e8.skip());
  const outcome = await spinPromise;
  const elapsedMs = Date.now() - skipAt;

  expect(outcome).toEqual({ out: 'next' });
  expect(elapsedMs, `held ${HOLD_MS} ms`).toBeLessThan(HOLD_MS + 1000);
});
```

- [ ] **Step 2: Amend case 3's doc**

In case 3's doc comment, replace the parenthetical claim that `spin`'s POST plus `mechanics.present` "both settle well under that on a warm dev server" with: "a skip that lands before the plan — the POST still in flight — is kept by the armed play row since slice 34 (case 3b proves that window on purpose), so the 100 ms is no longer a race with the network".

- [ ] **Step 3: Run the spec alone — green**

Run: `cd engine/apps/web && E8_E2E_HOST_PORT=5779 npx playwright test tempo.spec.ts`
Expected: all cases pass (6/6).

- [ ] **Step 4: Prove the new case is not vacuous**

Temporarily change Task 1's `if (arms.size > 0) pending = true;` in `engine/game/play-loop/src/runtime.ts` to `if (false) pending = true;`, run ONLY the new case (`… npx playwright test tempo.spec.ts -g "held spin request"`) — Expected: FAIL (elapsed ≥ `HOLD_MS + 1000`). Put the line back exactly and confirm `git diff engine/game/play-loop/src/runtime.ts` is empty. Record both numbers in the report.

- [ ] **Step 5: Typecheck the e2e and commit**

Run: `npm run typecheck -w @energy8engine/ide-web` (it includes `tsconfig.e2e.json`) — Expected: 0 errors.

```bash
git add engine/apps/web/tests/e2e/tempo.spec.ts
git commit -m "E2e: a skip during a held spin request collapses the round when its plan arrives

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
