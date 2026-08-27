import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';

declare module 'cordis' {
  interface Context {
    modules: ModulesService;
  }
}

export interface ModulesService {
  /** Entry ids whose client half has been imported and applied without error. */
  loaded(): string[];
}

export interface ModulesConfig {
  /** Swap the real dynamic `import()` for a fake in tests. */
  importModule?: (url: string) => Promise<unknown>;
}

export const name = 'modules';
export const inject = ['connection', 'slots'];

export function apply(ctx: Context, config: ModulesConfig) {
  // Entry ids for which an import has been *started* — claimed before the
  // await, never released. Distinct from `applied` below: a row that fails
  // to import stays in `attempted` forever (so it is never retried) but
  // never enters `applied` (so `loaded()` keeps meaning what its docstring
  // says). Un-claiming on failure was tried first, matching the plan's own
  // code, and rejected: `ctx.connection.report()` notifies subscribers —
  // including this plugin's own `sync`, subscribed below — so un-claiming
  // would let that very notification re-trigger the same import, forever,
  // for a client half that fails the same way every time.
  const attempted = new Set<string>();
  const applied = new Set<string>();
  const importModule = config.importModule ?? ((url: string) => import(/* @vite-ignore */ url));

  const sync = () => {
    const snapshot = ctx.connection.snapshot;
    if (!snapshot) return;

    for (const row of snapshot.rows) {
      if (!row.clientUrl || attempted.has(row.id)) continue;
      // Claim the id before awaiting the import: the host may push several
      // snapshots per edit, in an order that is not guaranteed, and both
      // could otherwise observe the row as "not yet attempted" and start a
      // duplicate import.
      attempted.add(row.id);
      const url = row.clientUrl;
      void importModule(url)
        .then((module) => {
          // A module with no `apply` (or a non-function one) is a no-op,
          // not a failure — it imported cleanly, it just has nothing to
          // wire up. `apply` throwing synchronously is still caught here:
          // this callback runs inside the promise chain, so a synchronous
          // throw rejects the chain and lands in `.catch` below exactly
          // like an import failure would.
          const half = module as { apply?: (ctx: Context) => void };
          half.apply?.(ctx);
          applied.add(row.id);
        })
        .catch((error: unknown) => {
          ctx.connection.report(
            diagnostic(
              'error',
              row.id,
              'client',
              error instanceof Error ? error.message : String(error),
              'check the plugin client entry in its package.json',
            ),
          );
        });
    }
  };

  const service: ModulesService = { loaded: () => [...applied] };

  ctx.effect(() => ctx.connection.subscribe(sync), 'modules-sync');
  ctx.provide('modules', service);
  // Cover the case where a snapshot already arrived before this plugin's
  // subscription was in place.
  sync();
}
