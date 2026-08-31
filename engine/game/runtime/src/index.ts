/**
 * The game runtime: a cordis application, exactly like the IDE host and the
 * IDE client. `createGame` composes the whole `e8-base` bundle Slice 0
 * actually needs — `session-dev`, the per-stage mechanic registry, `reels`,
 * `renderer-pixi`, `stage`, and `boot` — instead of hosting only the
 * registry the way it did before this task.
 *
 * **What "compose" means here, concretely.** Not every piece is created
 * equal:
 *  - `mechanics` and `session` never need a canvas — they come up (or fail
 *    as data) before anything pixi-shaped is even attempted.
 *  - `reels` (the `board` service) doesn't either: Task 9 measured
 *    `createReelSystem` building its scene graph headlessly, so `ctx.board`
 *    comes up whenever `config.reels` is well-formed, renderer or no
 *    renderer — see `plugins/reels.ts`'s module doc.
 *  - `renderer-pixi` and `stage` DO need a real browser (measured — see
 *    the task-10 report), so their failure is exactly what `boot` exists
 *    to catch: `boot` runs once, after everything above, and either calls
 *    `start()` (which is what actually attempts the renderer) or shows the
 *    failure screen instead of trying — see `@energy8engine/boot`'s module
 *    doc for the one gap this leaves (a renderer that fails only once
 *    `start()` is already running).
 *
 * Order and dependency are expressed with cordis `inject`, not by the
 * sequence `ctx.plugin()` happens to be called in: `stage` declares
 * `inject: ['renderer']`, and `reels`' mount-into-stage step uses
 * `ctx.inject(['stage'], …)`, which cordis resolves reactively regardless
 * of registration order (measured directly against cordis — see the
 * report). Both were checked to *never hang* when the dependency never
 * shows up, which is the normal case in a test environment with no
 * renderer: `ctx.plugin()` and `ctx.inject()` both resolve immediately,
 * they just never run the gated `apply()`/callback.
 */
import { Context } from 'cordis';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import * as boot from '@energy8engine/boot';
import type { SessionConfig } from '@energy8engine/session-dev';
import { mechanic as classicMechanic } from '@energy8engine/mechanic-classic';
import { mechanic as cascadeMechanic } from '@energy8engine/mechanic-cascade';
import * as mechanics from './plugins/mechanics';
import * as rendererPlugin from './plugins/renderer';
import * as stagePlugin from './plugins/stage';
import * as reelsPlugin from './plugins/reels';
import type { RendererConfig } from './plugins/renderer';
import type { StageConfig } from './plugins/stage';
import type { ReelsConfig } from './plugins/reels';

export type { MechanicsService, MechanicsConfig } from './plugins/mechanics';
export type { RendererConfig } from './plugins/renderer';
export type { StageConfig } from './plugins/stage';
export type { ReelsConfig } from './plugins/reels';

export interface GameConfig {
  /**
   * Started through `session-dev` when given. Omitted entirely — not an
   * error, no diagnostic — for a caller with no math engine to reach yet
   * (e.g. a test that only exercises the mechanic registry, same as
   * `createGame({})` before this task).
   */
  session?: SessionConfig;
  /**
   * Pixi `Application` options. Presence — even `{}` — is what opts a
   * caller into attempting a renderer at all; omitting both this and
   * `mount` means the game genuinely has no visual surface to bring up,
   * which is a legitimate, silent case, not a failure.
   */
  renderer?: RendererConfig['options'];
  /** Design-resolution stage; only ever mounted once a renderer exists. */
  stage?: Pick<StageConfig, 'design' | 'mode'>;
  /** The legacy reel system's construction options — `resolve` plus grid/motion config. */
  reels?: ReelsConfig['options'];
  /** stage id → mechanic id, applied to the two mechanics `createGame` always registers (`classic`, `cascade`). */
  stages?: Record<string, string>;
  /**
   * Where `boot` renders the failure screen when composition produced an
   * `error` diagnostic. Browser only; omitted in tests. Not where the
   * renderer's canvas goes on success — that stays the caller's own step
   * (via `game.ctx.renderer`), see `start()`'s comment in `createGame`.
   */
  mount?: HTMLElement;
}

export interface GameApp {
  ctx: Context;
  /** Boot-time and runtime failures (e.g. a stage bound to an unregistered mechanic, or a renderer that didn't start) that don't stop `createGame` from returning. */
  diagnostics: Diagnostic[];
  stop(): Promise<void>;
}

/**
 * Boots the game. Async, not synchronous, for the same reason
 * `createIdeHost` is: `ctx.plugin()` returns a Fiber that cordis advances
 * asynchronously, so an un-awaited `ctx.plugin()` gives no guarantee its
 * service exists yet. Awaiting every step here means every caller gets a
 * `GameApp` whose services are already settled — present, or permanently
 * absent with a `Diagnostic` explaining why, never "maybe, ask again
 * later."
 */
export async function createGame(config: GameConfig): Promise<GameApp> {
  const ctx = new Context();
  const diagnostics: Diagnostic[] = [];

  try {
    await ctx.plugin(mechanics, { diagnostics });

    // Both mechanics Slice 0 ships are always registered; which stage uses
    // which is entirely a config choice, not a code choice — that's the
    // knob the IDE (a later task) turns.
    ctx.mechanics.register(classicMechanic);
    ctx.mechanics.register(cascadeMechanic);
    for (const [stage, mechanicId] of Object.entries(config.stages ?? {})) {
      ctx.mechanics.bind(stage, mechanicId);
    }

    if (config.session) {
      // Dynamic, not a static top-level import — session-dev's own module
      // graph reaches node:child_process/node:fs/node:net (it spawns the
      // real e8-server binary), and a bundler targeting a browser has no
      // way to know that's dead code for a caller who never sets
      // config.session at all. A static import pulls it in regardless,
      // and Vite's browser externalization of those node builtins throws
      // the instant the import evaluates — aborting the whole module
      // graph before createGame ever runs, session or no session (measured
      // directly in engine/examples/first-slot's browser entry — see
      // task-11-report.md). Gating the import behind the same condition
      // that gates its use means a session-less caller (first-slot's own
      // browser bundle: it reaches the math over its own `/api/spin`
      // fetch, not through this seam at all) never asks a bundler to
      // resolve session-dev in the first place.
      const session = await import('@energy8engine/session-dev');
      await ctx.plugin(session, config.session);
      // `boot` needs to know about a dead session *before* ever attempting
      // a canvas. `session-dev` already computes the SPECIFIC reason
      // (naming the binary, pointing at binPath/E8_SERVER_BINARY/gamesDir)
      // and exposes it eagerly as `startupDiagnostic` for exactly this —
      // pushing that straight through, not re-deriving a vaguer generic
      // one from `pid === null` (the earlier version of this file did;
      // the specific reason `session-dev` already computed was there for
      // the taking, and re-deriving a worse one instead of using it wastes
      // what `session-dev` measured).
      if (ctx.session.startupDiagnostic) {
        diagnostics.push(ctx.session.startupDiagnostic);
      }
    }

    if (config.reels) {
      await ctx.plugin(reelsPlugin, { options: config.reels, diagnostics });
    }

    await ctx.plugin(boot, {
      diagnostics,
      mount: config.mount,
      async start() {
        // Nothing asked for a visual surface — a legitimate no-op, not a
        // skipped failure.
        if (config.renderer === undefined && !config.mount) return;

        await ctx.plugin(rendererPlugin, { options: config.renderer, diagnostics });

        if (config.stage && ctx.renderer) {
          await ctx.plugin(stagePlugin, { ...config.stage, diagnostics });
        }

        // Mounting `ctx.renderer.app.canvas` somewhere visible is
        // deliberately NOT this function's job: unlike the failure
        // screen, that step cannot be exercised under jsdom at all (a
        // renderer that starts is exactly what jsdom cannot produce), so
        // it stays out of `createGame` rather than shipping untested. The
        // caller already has `game.ctx.renderer` for this.
      },
    });

    return {
      ctx,
      diagnostics,
      stop: async () => {
        await ctx.fiber.dispose();
      },
    };
  } catch (error) {
    // A later boot step throwing must not leak whatever already got
    // registered on `ctx` — nothing external holds a reference to it yet.
    await ctx.fiber.dispose();

    // Unreachable today only because every plugin `createGame` composes
    // catches its own failures internally (`renderer.ts`, `stage.ts`,
    // `reels.ts` all degrade to a diagnostic instead of throwing). It is
    // still the one path a caller like `first-slot`'s `main.ts` relies on:
    // it `await`s `createGame` at module top level with no `try` of its
    // own, so a throw here would abort module evaluation and render
    // nothing — precisely the white rectangle `boot` exists to prevent.
    // Converting to a `Diagnostic` and rendering it through the same
    // `boot.renderBootFailure` the normal path uses closes that gap: a
    // plugin that starts throwing tomorrow still shows readable text
    // today, not a blank mount.
    const message = error instanceof Error ? error.message : String(error);
    const failure = diagnostic(
      'error',
      'game-runtime',
      'compose',
      `composition failed: ${message}`,
    );
    diagnostics.push(failure);
    if (config.mount) {
      boot.renderBootFailure(config.mount, diagnostics);
    }

    return {
      ctx,
      diagnostics,
      // `ctx` is already disposed above — nothing left to tear down.
      stop: async () => {},
    };
  }
}
