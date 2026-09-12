import type { Context, Fiber } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';

declare module 'cordis' {
  interface Context {
    modules: ModulesService;
  }
}

export interface ModulesService {
  /** Entry ids whose client half has been imported and applied without error. */
  loaded(): string[];
  /**
   * True once a snapshot has been seen and every client half it names has
   * been attempted — imported and applied, or failed and said so. Until
   * then a document the address names may still be on its way, and "not
   * registered" would be a guess about a plugin that has not had its turn.
   */
  settled(): boolean;
  /** Fires when `settled()` may have changed. */
  subscribe(listener: () => void): () => void;
}

export interface ModulesConfig {
  /** Swap the real dynamic `import()` for a fake in tests. */
  importModule?: (url: string) => Promise<unknown>;
}

export const name = 'modules';
/**
 * `connection` and nothing else. This list used to name `slots` and
 * `layout` too, because a half was applied by calling `half.apply(ctx)`
 * with THIS plugin's own scope — so a half could reach exactly the
 * services this plugin happened to declare, and nothing more. That made
 * the list a hardcoded allowlist of what a plugin was permitted to see,
 * maintained here, by us, one service behind whoever needed the next one.
 * A half now goes through `ctx.plugin()` and gets a fiber of its own, with
 * its own `inject` (see `apply` below), so what a half may reach is a
 * question this plugin no longer answers.
 */
export const inject = ['connection'];

/**
 * cordis's `FiberState.ACTIVE`. The enum is declared `const` in cordis's
 * own typings, so it exists at compile time only and cannot be imported —
 * the same reason `CompositionRow.state` carries a bare number and says so
 * in its doc.
 */
const FIBER_ACTIVE = 2;

export function apply(ctx: Context, config: ModulesConfig) {
  /**
   * The current attempt for a row, if any. A token rather than a boolean
   * because the whole point is telling attempts apart: an import that was
   * in flight when its row left the snapshot must not apply itself on
   * arrival, and must not be mistaken for the fresh attempt a later
   * snapshot started. The claim is taken BEFORE the await — the host may
   * push several snapshots per edit, in an order that is not guaranteed,
   * and both could otherwise see the row as unattempted and start a
   * duplicate import.
   *
   * Released on failure, so a later snapshot (the developer fixes the
   * client half, the host pushes a new one) gets a fresh attempt instead
   * of the row staying broken until a full page reload. That release does
   * let a failure retrigger itself once, on its own: `ctx.connection
   * .report()` notifies subscribers, including this plugin's own `sync`
   * below, so the notification from the FIRST failure causes one immediate
   * extra attempt before this function even returns. It does not cascade —
   * a second consecutive failure produces a byte-identical `Diagnostic`,
   * and `report()`'s own identity dedupe recognises the repeat and returns
   * before notifying — so the self-triggered retry is bounded at exactly
   * one wasted fetch. Verified by mutation testing (delete this release
   * and rerun modules.test.ts: the "retries a failed import" test starts
   * failing because the second, explicit snapshot no longer gets a turn).
   */
  const claims = new Map<string, symbol>();
  /**
   * What each row is holding, so it can be handed back. An entry appears
   * the moment the fiber exists rather than once it has settled: a row
   * that leaves the snapshot while its own `apply` is still running is
   * exactly the case a disposal ledger is for, and a fiber missing from
   * here is a fiber nothing can ever take down.
   */
  const holding = new Map<string, Fiber>();
  /** Entry ids whose half imported and applied without error — `loaded()`. */
  const loaded = new Set<string>();
  /** Entry ids with an attempt in flight, whichever way it ends — `settled()`. */
  const settling = new Set<string>();
  /** Whether any snapshot has been synced yet; before one, nothing can be settled. */
  let seen = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  /** Row ids the latest snapshot says should be running right now. */
  const wanted = new Set<string>();
  const importModule = config.importModule ?? ((url: string) => import(/* @vite-ignore */ url));

  const report = (id: string, message: string, fix: string) => {
    ctx.connection.report(diagnostic('error', id, 'client', message, fix));
  };

  /**
   * Hands back everything a row's client half is holding. Disposing the
   * fiber is what takes its contributions with it — a screen, a card, a
   * subscription — provided the half registered them as effects, which is
   * cordis's own contract and what `screen-demo` demonstrates. A half that
   * calls `ctx.slots.register(...)` bare keeps its document after its row
   * is gone, exactly as a runtime plugin that skips `ctx.effect` keeps
   * whatever it registered.
   */
  const release = (id: string) => {
    const fiber = holding.get(id);
    holding.delete(id);
    loaded.delete(id);
    claims.delete(id);
    void fiber?.dispose();
  };

  const load = async (id: string, pkg: string, url: string, needs: string[], token: symbol) => {
    settling.add(id);
    try {
      await attempt(id, pkg, url, needs, token);
    } finally {
      settling.delete(id);
      notify();
    }
  };

  const attempt = async (id: string, pkg: string, url: string, needs: string[], token: symbol) => {
    let module: unknown;
    try {
      module = await importModule(url);
    } catch (error) {
      // Nothing to say if this attempt is no longer the current one. The
      // row can have left the snapshot, or turned `disabled`, or been
      // superseded, while the import was in flight — and a failure to
      // fetch a half the composition has since removed is not a failure
      // anyone should be asked to fix. Reporting it would name a plugin
      // and a remedy that stopped applying the moment the row went, which
      // is exactly the "asserts a cause the code does not know" this
      // module's diagnostics exist to avoid.
      if (claims.get(id) !== token) return;
      claims.delete(id);
      report(
        id,
        error instanceof Error ? error.message : String(error),
        'check the plugin client entry in its package.json',
      );
      return;
    }

    // The row can have left the snapshot, or a later attempt can have
    // taken over, while the import was in flight. Either way this attempt
    // is stale and must not apply: applying anyway would put a plugin on a
    // context nothing is tracking, with no way left to take it off.
    if (claims.get(id) !== token) return;

    // A module with no `apply` (or a non-function one) is a no-op, not a
    // failure — it imported cleanly, it just has nothing to wire up. It
    // cannot go through `ctx.plugin()` either: cordis rejects a plugin
    // object without an `apply` method, synchronously, and that refusal is
    // about the shape of the call, not about anything the developer did
    // wrong.
    const half = module as { apply?: (ctx: Context) => void };
    if (typeof half.apply !== 'function') {
      loaded.add(id);
      return;
    }

    // Through cordis, never `half.apply(ctx)` directly. Two things follow
    // from that and neither is available any other way: the half's own
    // `inject` is honoured, so it reaches the services it declared rather
    // than the ones this plugin happens to hold; and the call yields a
    // fiber, so the half can be handed back when its row goes.
    //
    // The fiber is named after the row's package rather than anything the
    // module exports: it is what a human wrote in `e8.yml`, and it is what
    // cordis shows if this half ever turns up in a trace.
    const fiber = ctx.plugin({ name: pkg, inject: needs, apply: half.apply });
    holding.set(id, fiber);
    try {
      await fiber;
    } catch (error) {
      // Checked before `release(id)`, which would otherwise clear the
      // claim and hide the very thing being checked — and, worse, dispose
      // a fiber belonging to a NEWER attempt that has since claimed this
      // row. A half whose `apply` awaits anything (a fetch, a nested
      // import) is still settling for as long as that takes, and cordis
      // rejects an `await`ed fiber that was disposed underneath it, so
      // "the row left mid-apply" arrives here as an ordinary failure.
      // Same reasoning as the import path above.
      if (claims.get(id) !== token) return;
      release(id);
      report(
        id,
        error instanceof Error ? error.message : String(error),
        "fix the plugin's client half, or add what it reaches to e8.client.inject in its package.json",
      );
      return;
    }

    // A fiber that never reached ACTIVE and never threw is one cordis is
    // still holding back: every service in its `inject` has to exist
    // first, and one of them does not. Nothing throws on this path and
    // nothing renders — the half simply never runs — which is the one
    // outcome a person cannot diagnose from the screen, so it is said out
    // loud here. The message names the services actually missing rather
    // than the whole list, because the whole list is what the developer
    // already wrote down.
    if (fiber.state !== FIBER_ACTIVE) {
      // A fiber this load no longer owns is not PENDING, it is DISPOSED —
      // by `release()`, because the row went while the half was settling.
      // Without this the branch below would announce that a half "never
      // started" and tell a developer to check the inject list of a plugin
      // the composition deliberately removed. Same guard, same reason, as
      // the two paths above.
      if (claims.get(id) !== token) return;
      const missing = needs.filter((service) => ctx.reflect.get(service, false) === undefined);
      release(id);
      report(
        id,
        missing.length
          ? `waiting for ${missing.join(', ')}, which the editor does not provide`
          : 'the client half never started, and the services it asked for are all present',
        'check e8.client.inject in its package.json against the services the editor provides',
      );
      return;
    }

    loaded.add(id);
  };

  const sync = () => {
    const snapshot = ctx.connection.snapshot;
    if (!snapshot) return;

    wanted.clear();
    for (const row of snapshot.rows) {
      // `disabled` is read here rather than folded into `clientUrl` on the
      // host — see `composition.ts`. A row the composition has switched
      // off must not have its client half running for the same reason its
      // server half does not: the composition says it is off. This is also
      // the only half of "a row leaves" that arrives as an edit rather
      // than as an absence.
      if (row.clientUrl && !row.disabled) wanted.add(row.id);
    }

    // Anything applied (or mid-import) that the snapshot no longer wants
    // goes back before anything new is loaded, so a row that is removed
    // and re-added in one edit ends up applied once, not twice.
    for (const id of [...holding.keys()]) if (!wanted.has(id)) release(id);
    for (const id of [...claims.keys()]) if (!wanted.has(id)) claims.delete(id);
    for (const id of [...loaded]) if (!wanted.has(id)) loaded.delete(id);

    for (const row of snapshot.rows) {
      const url = row.clientUrl;
      if (!url || !wanted.has(row.id) || claims.has(row.id)) continue;
      const token = Symbol(row.id);
      claims.set(row.id, token);
      void load(row.id, row.name, url, row.clientInject ?? [], token);
    }
    seen = true;
    notify();
  };

  const service: ModulesService = {
    loaded: () => [...loaded],
    settled: () => seen && settling.size === 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  ctx.effect(() => ctx.connection.subscribe(sync), 'modules-sync');
  ctx.provide('modules', service);
  // Cover the case where a snapshot already arrived before this plugin's
  // subscription was in place.
  sync();
}
