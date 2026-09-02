/**
 * `createGame`'s Files list doesn't include this test file's own concern
 * as a feature — it pins a regression. `src/index.ts` used to `import *
 * as session from '@energy8engine/session-dev'` at module top level,
 * unconditionally. That's fine under Node/jsdom (this suite's own
 * environment), but session-dev's own module graph reaches
 * `node:child_process`/`node:fs`/`node:net` (it spawns the real
 * `e8-server` binary) — and a bundler targeting a BROWSER externalizes
 * those, throwing the instant the import evaluates. Measured directly
 * against `engine/examples/first-slot`'s browser entry (Task 11's manual
 * run — see task-11-report.md): the page never got past its own module
 * load, even though that entry never sets `config.session` at all (it
 * reaches the math over its own `/api/spin` fetch, not through this seam).
 *
 * The fix moved the import inside the existing `if (config.session)`
 * branch as `await import(...)` — gating import TIMING behind the same
 * condition that already gated its USE.
 *
 * The signal that actually matters here is MODULE EVALUATION, not
 * `apply()` being called — `apply()` was already gated behind `if
 * (config.session)` before this fix; what changed is only whether a
 * bundler ever has to resolve/evaluate `session-dev`'s module body at
 * all. A static top-level `import * as session from '...'` resolves and
 * evaluates the target the moment `src/index.ts` itself loads — before
 * any of `createGame`'s own code runs — regardless of whether `apply()`
 * is later called; a dynamic `await import(...)` only evaluates it at the
 * point in the code where that expression is actually reached. This file
 * tracks evaluation directly, from inside the mock factory itself (which
 * Vitest invokes the first time the mocked id is actually resolved), not
 * from inside the mocked `apply`.
 *
 * `@energy8engine/session-dev` is mocked here (not the real module,
 * unlike `compose.test.ts`, which deliberately DOES spawn a real
 * `e8-server`) — this file's whole point is measuring import timing, which
 * a real spawned process would only obscure with unrelated latency/cleanup
 * concerns.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { moduleEvaluatedSpy, applySpy } = vi.hoisted(() => {
  const moduleEvaluatedSpy = vi.fn();
  const applySpy = vi.fn((ctx: { provide: (name: string, value: unknown) => void }) => {
    // Provides just enough of `SessionService` for `createGame`'s own
    // `ctx.session.startupDiagnostic` read (right after this call) to
    // resolve instead of throwing — this test is about WHETHER/WHEN the
    // module gets resolved, not about session-dev's own startup behaviour
    // (that's session-dev's and compose.test.ts's job, against the real
    // thing).
    ctx.provide('session', {
      startupDiagnostic: null,
      pid: null,
      async play() {
        throw new Error('not implemented — unused by this test');
      },
    });
  });
  return { moduleEvaluatedSpy, applySpy };
});

vi.mock('@energy8engine/session-dev', () => {
  // Runs once, the first time this id is actually resolved by the module
  // loader — a static top-level import in src/index.ts would trigger this
  // before any `it` body below ever runs; a dynamic `await import(...)`
  // guarded behind `if (config.session)` would not, until that branch
  // actually executes.
  moduleEvaluatedSpy();
  return {
    name: 'session',
    apply: applySpy,
    // `ctx.plugin()` reads `plugin.Config`/`plugin.inject` unconditionally
    // (real session-dev has neither — both are optional there); Vitest's
    // auto-mock proxy throws on a property this factory didn't return at
    // all, so both are named here explicitly rather than left absent.
    Config: undefined,
    inject: undefined,
  };
});

import { createGame, type GameApp } from '../src/index';
import { fakeFetch } from './helpers';

/** No rows, no host — this file is about an import that happens before any of that. */
const noComposition = { fetchFn: fakeFetch({ rows: [], diagnostics: [] }) };

let game: GameApp | undefined;
afterEach(async () => {
  await game?.stop();
  game = undefined;
});

describe('createGame — session-dev is imported lazily, not statically', () => {
  it('does not resolve session-dev merely by loading createGame', () => {
    // Checked BEFORE any createGame() call — a regression back to a
    // static top-level import would already have failed this, since ESM
    // linking resolves a static import's target before the importing
    // module's own code runs at all, i.e. before this test file even
    // reaches its first `it`.
    expect(moduleEvaluatedSpy).not.toHaveBeenCalled();
  });

  it('does not resolve session-dev when config.session is not set', async () => {
    game = await createGame({ loader: noComposition });
    expect(moduleEvaluatedSpy).not.toHaveBeenCalled();
  });

  it('does resolve (and apply) session-dev once config.session is set — proves the mock is genuinely wired, not vacuously passing', async () => {
    game = await createGame({ session: { gamesDir: '/tmp/unused', port: 0 }, loader: noComposition });
    expect(moduleEvaluatedSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledTimes(1);
  });
});
