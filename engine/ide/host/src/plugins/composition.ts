import type { Context } from 'cordis';
import {
  type CompositionRow,
  type Diagnostic,
  type Snapshot,
  diagnostic,
  parseManifest,
} from '@energy8engine/contracts';
import { readPackageJson, unresolvedReason } from '../resolvePackage';

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

/**
 * Result of trying to read a plugin's `Config` schema. `schema: null` alone
 * is ambiguous by construction — a plugin can legitimately declare no
 * `Config` at all — so a failed *import* carries its own diagnostic
 * alongside the same `schema: null`, instead of being indistinguishable
 * from the legitimate case. Without this, an import failure (the root-hoist
 * trap documented below is exactly this) renders as an empty form with
 * nothing saying why — the white-rectangle outcome the spec's §8 exists to
 * forbid.
 */
interface SchemaResult {
  schema: unknown | null;
  diagnostic: Diagnostic | null;
}

async function schemaOf(ctx: Context, entryId: string, name: string): Promise<SchemaResult> {
  let plugin: unknown;
  try {
    // `ctx.loader.import(name)` resolves a bare specifier with a plain
    // `import(name)` called from inside @cordisjs/plugin-loader's own file, not
    // from `config.cwd` — so it only finds a package hoisted to this monorepo's
    // ROOT node_modules. A name collision with any other package here silently
    // loses that hoist: the import throws (MODULE_NOT_FOUND) or resolves to an
    // unrelated package — either way this is the "import itself failed" branch
    // below, not the "declares no Config" one.
    plugin = ctx.loader.unwrapExports(await ctx.loader.import(name));
  } catch (error) {
    return {
      schema: null,
      diagnostic: diagnostic(
        'error',
        entryId,
        'schema',
        `failed to import "${name}" while reading its config schema: ${
          error instanceof Error ? error.message : String(error)
        }`,
        `check that "${name}" resolves from this workspace and that its module loads without throwing`,
      ),
    };
  }

  const Config = (plugin as { Config?: { toJSON?: () => unknown } } | undefined)?.Config;
  if (typeof Config?.toJSON !== 'function') return { schema: null, diagnostic: null };
  try {
    // Deliberately the raw toJSON() output — schemastery's own deduped
    // { uid, refs } graph — and not a live `new Schema(...)` instance.
    // Snapshot exists to cross a socket; a class instance in that position
    // is a category error (it happens to work in-process, then degrades
    // silently once actually JSON.stringify'd for the wire, since its own
    // toJSON() fires again). Every reader, in-process or over the wire,
    // rebuilds with `new Schema(json)` before touching `.dict`/`.meta` — see
    // CompositionRow.schema's doc comment.
    return { schema: Config.toJSON(), diagnostic: null };
  } catch {
    return { schema: null, diagnostic: null };
  }
}

export const name = 'composition';
export const inject = ['loader'];

/**
 * Errors this module has already turned into a `Diagnostic` (see the
 * `internal/status` listener in `apply()` below), tracked by object
 * identity. Read by the `unhandledRejection` guard below — see its doc
 * comment for why a *second* channel is needed at all.
 */
const knownPluginFailures = new WeakSet<object>();

/**
 * A plugin whose `apply()` throws must not take the host process with it —
 * but by default it does. `@cordisjs/plugin-loader`'s `Entry.init()` (see
 * node_modules/@cordisjs/plugin-loader/lib/index.js:388) ends with
 * `this.fiber?.await().finally(() => {...})`, called with no `.catch` and
 * never awaited by its own caller. `Fiber#await()` (node_modules/cordis/lib/index.js,
 * the public method backing `fiber.await()`) rethrows the fiber's stored
 * error once it settles FAILED, so that call's Promise rejects — and
 * nothing in the library ever attaches a handler to it.
 *
 * This is the same failure shape already documented on `loadComposition()`
 * in `../index.ts` for a broken e8.yml — but that fix works by never
 * calling `ctx.loader.create()` for the bad input in the first place, which
 * isn't available here: whether a *given* plugin's `apply()` throws can only
 * be known by actually trying it, so the entry always gets created. Nor can
 * this module's own `fiber.await()` call below (used to read the error —
 * see the `internal/status` listener) intercept the library's rejection:
 * each call to `await()` is a fresh invocation returning an independent
 * Promise, and by the time our listener runs, cordis has already cleared
 * `fiber.inertia`, so *our* call resolves/rejects synchronously against the
 * already-settled fiber. The library's call, in contrast, was made much
 * earlier (from `Entry.init()`, right after the entry is created) and was
 * still genuinely `await`-ing `fiber.inertia` when the failure landed — a
 * different Promise object entirely. Verified empirically: with no guard, a
 * plugin whose `apply()` throws produces a process-level
 * `unhandledRejection` for the exact same error a `fiber.await().catch()`
 * elsewhere already observed and reported.
 *
 * So the only way to stop it from reaching the process as fatal is to
 * recognize it after the fact, at the `process` level. This listener does
 * only that: rejections whose `reason` is an error this module already
 * turned into a `Diagnostic` (tracked by identity in `knownPluginFailures`)
 * are swallowed — they are not new information, the human already sees
 * them as a red row. Anything else is rethrown so a genuinely unrelated bug
 * still surfaces as loudly as it would without this guard.
 *
 * Registered once for the whole process (idempotent — tests construct many
 * hosts), not per host instance: the failure it's dodging is a `process`-
 * wide event by construction, so there's nothing host-scoped to hang its
 * lifetime off of, and installing it repeatedly would just accumulate
 * duplicate listeners for no benefit.
 */
let unhandledRejectionGuardInstalled = false;
function ensureUnhandledRejectionGuard(): void {
  if (unhandledRejectionGuardInstalled) return;
  unhandledRejectionGuardInstalled = true;
  process.on('unhandledRejection', (reason) => {
    if (typeof reason === 'object' && reason !== null && knownPluginFailures.has(reason)) return;
    throw reason;
  });
}

export function apply(ctx: Context, config: CompositionConfig) {
  ensureUnhandledRejectionGuard();

  // A plugin that throws in apply must not take the host with it: remember
  // the failure, keep serving, and let it reach the human as a diagnostic.
  // `Fiber#await()` is the public, documented way to learn a FAILED fiber's
  // error (it rethrows what would otherwise sit on the private `_error`
  // field) — see the doc comment above for why this module also needs the
  // `unhandledRejection` guard on top of this.
  const failures = new Map<string, string>();

  ctx.on('internal/status', (fiber) => {
    const entryId = fiber.entry?.id;
    if (!entryId) return;
    if (fiber.state === 2 /* FiberState.ACTIVE */) {
      failures.delete(entryId);
      return;
    }
    if (fiber.state !== 3 /* FiberState.FAILED */) return;
    fiber.await().catch((error: unknown) => {
      if (error && typeof error === 'object') knownPluginFailures.add(error);
      failures.set(
        entryId,
        error instanceof Error ? error.message : String(error ?? 'plugin failed'),
      );
    });
  });

  const service: CompositionService = {
    async snapshot() {
      const rows: CompositionRow[] = [];
      const diagnostics: Diagnostic[] = [...(config.bootDiagnostics ?? [])];

      for (const entry of ctx.loader.entries()) {
        const pkgName = entry.options.name;
        const pkg = readPackageJson(config.cwd, pkgName);
        if (!pkg) {
          // Same distinction `runtime-assets.ts` draws, for the same
          // reason: a package that IS in this project's `plugins/` and
          // whose manifest will not parse is not a package that could not
          // be found, and "install it" is the wrong instruction.
          const reason = unresolvedReason(config.cwd, pkgName);
          diagnostics.push(
            reason
              ? diagnostic(
                  'error',
                  entry.id,
                  'package',
                  `package "${pkgName}" is present in this project's plugins/ but could not be read: ${reason}`,
                  `fix the JSON in ${pkgName}'s package.json`,
                )
              : diagnostic(
                  'error',
                  entry.id,
                  'package',
                  `cannot resolve package "${pkgName}"`,
                  `install it, or fix the name in ${'e8.yml'}`,
                ),
          );
        }

        // Pass the entry id, not `pkgName` — `Diagnostic.plugin` is the
        // entry's stable identity (see its doc comment); two entries can
        // share a package name, and the screen resolves this id back to a
        // row name for display.
        const parsed = pkg
          ? parseManifest(pkg.json, entry.id)
          : { manifest: null, diagnostics: [] };
        diagnostics.push(...parsed.diagnostics);

        const failure = failures.get(entry.id);
        if (failure) {
          diagnostics.push(
            diagnostic(
              'error',
              entry.id,
              'apply',
              failure,
              'fix the plugin, then reload the composition',
            ),
          );
        }

        const schemaResult = await schemaOf(ctx, entry.id, pkgName);
        if (schemaResult.diagnostic) diagnostics.push(schemaResult.diagnostic);

        rows.push({
          id: entry.id,
          name: pkgName,
          disabled: entry.disabled,
          state: entry.fiber?.state ?? null,
          config: entry.options.config ?? {},
          schema: schemaResult.schema,
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
