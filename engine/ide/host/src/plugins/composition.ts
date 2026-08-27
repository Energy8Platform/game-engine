import type { Context } from 'cordis';
import {
  type CompositionRow,
  type Diagnostic,
  type Snapshot,
  diagnostic,
  parseManifest,
} from '@energy8engine/contracts';
import { readPackageJson } from '../resolvePackage';

declare module 'cordis' {
  interface Context {
    composition: CompositionService;
  }
}

export interface CompositionService {
  snapshot(): Promise<Snapshot>;
  /**
   * Restarts entry `id`'s plugin in place with `config`: tears down its
   * effects, re-applies it with the new value, and writes the value back
   * into e8.yml. An empty result means "applied to the running graph" —
   * NOT "durable on disk". The actual file write is an unowned,
   * uncancellable `setTimeout(0)` debounce inside `@cordisjs/plugin-include`
   * with no public signal for when it lands; `update()`'s promise resolves
   * once the in-memory graph has settled, before that write necessarily
   * completes. A change made moments before the host process exits can be
   * lost. Draining that queue on shutdown, if ever needed, belongs to
   * whichever code owns host shutdown — this service has no primitive to
   * wait for it.
   */
  update(id: string, config: unknown): Promise<Diagnostic[]>;
}

export interface CompositionConfig {
  /** Project directory, used to resolve plugin packages. */
  cwd: string;
  /**
   * Diagnostics already found while loading the composition file (e.g. a
   * missing or unparsable e8.yml). The host computes these before this
   * plugin exists, so it hands them over at registration; every snapshot
   * carries them alongside whatever this service discovers on its own —
   * otherwise a project whose composition failed to load shows an empty,
   * blameless screen.
   */
  bootDiagnostics?: Diagnostic[];
}

async function schemaOf(ctx: Context, name: string): Promise<unknown | null> {
  try {
    const plugin = ctx.loader.unwrapExports(await ctx.loader.import(name));
    const Config = (plugin as { Config?: { toJSON?: () => unknown } } | undefined)?.Config;
    if (typeof Config?.toJSON !== 'function') return null;
    // Deliberately the raw toJSON() output — schemastery's own deduped
    // { uid, refs } graph — and not a live `new Schema(...)` instance.
    // Snapshot exists to cross a socket; a class instance in that position
    // is a category error (it happens to work in-process, then degrades
    // silently once actually JSON.stringify'd for the wire, since its own
    // toJSON() fires again). Every reader, in-process or over the wire,
    // rebuilds with `new Schema(json)` before touching `.dict`/`.meta` — see
    // CompositionRow.schema's doc comment.
    return Config.toJSON();
  } catch {
    return null;
  }
}

export const name = 'composition';
export const inject = ['loader'];

export function apply(ctx: Context, config: CompositionConfig) {
  const service: CompositionService = {
    async snapshot() {
      const rows: CompositionRow[] = [];
      const diagnostics: Diagnostic[] = [...(config.bootDiagnostics ?? [])];

      for (const entry of ctx.loader.entries()) {
        const pkgName = entry.options.name;
        const pkg = readPackageJson(config.cwd, pkgName);
        if (!pkg) {
          diagnostics.push(
            diagnostic(
              'error',
              entry.id,
              'package',
              `cannot resolve package "${pkgName}"`,
              `install it, or fix the name in ${'e8.yml'}`,
            ),
          );
        }

        const parsed = pkg ? parseManifest(pkg.json, pkgName) : { manifest: null, diagnostics: [] };
        diagnostics.push(...parsed.diagnostics);

        rows.push({
          id: entry.id,
          name: pkgName,
          disabled: entry.disabled,
          state: entry.fiber?.state ?? null,
          config: entry.options.config ?? {},
          schema: await schemaOf(ctx, pkgName),
          hot: parsed.manifest?.hot ?? false,
          clientUrl: parsed.manifest?.client ? `/plugin-client/${entry.id}` : null,
        });
      }

      return { rows, diagnostics };
    },

    async update(id, next) {
      const entry = [...ctx.loader.entries()].find((entry) => entry.id === id);
      if (!entry) {
        return [diagnostic('error', id, 'composition', `no entry with id "${id}"`)];
      }
      const before = entry.options.config;
      try {
        await ctx.loader.update(id, { config: next });
        // `ctx.loader.update()` kicks off the effect teardown/reapply cycle
        // but does not itself wait for it — `Entry.update()` calls
        // `_patchContext()` without awaiting it. Without this, the caller
        // can observe a state where the old effect has been torn down but
        // the new one hasn't been (re-)applied yet.
        await entry.fiber?.await();
        return [];
      } catch (error) {
        // Measured, not assumed: on a rejected `ctx.loader.update()`, the
        // loader has NOT rolled `entry.options.config` back — it was already
        // overwritten with the invalid value before validation ran (cordis's
        // `resolveConfig()` throws before the write-to-disk listener fires,
        // but after `Entry.update()` mutates `options.config`). The live
        // fiber never received the bad value (it never got that far), so the
        // running plugin is unaffected — but without this explicit call, the
        // *bookkeeping* (and, on the next successful edit, the file) would
        // stay on the rejected value. This restores both.
        //
        // The rollback itself can fail too (rare — `before` was valid a
        // moment ago — but not impossible, e.g. a concurrent edit racing
        // this one). `fiber.await()` rethrows a stored error, and nothing
        // upstream of this service is allowed to see an exception: a host
        // service reporting failure as data is the whole contract. So the
        // rollback gets its own try/catch, and a failed rollback is
        // reported as its own diagnostic alongside the original one — the
        // caller must be able to learn the value is now in an unknown
        // state, which is exactly the case where staying silent is worst.
        const diagnostics = [
          diagnostic(
            'error',
            id,
            'config',
            error instanceof Error ? error.message : String(error),
            'fix the value and try again',
          ),
        ];
        try {
          await ctx.loader.update(id, { config: before });
          await entry.fiber?.await();
        } catch (rollbackError) {
          diagnostics.push(
            diagnostic(
              'error',
              id,
              'config',
              `rollback to the previous config also failed: ${
                rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
              }`,
              'the plugin may now be in an unknown state — inspect and fix its config directly',
            ),
          );
        }
        return diagnostics;
      }
    },
  };

  ctx.provide('composition', service);
}
