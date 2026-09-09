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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether an `exports` CONDITIONS value — the value a `"."` key (or any
 * nested condition inside it) can hold — names an actual file anywhere
 * under it: a bare string target, or an object of further conditions
 * (`"import"`, `"require"`, `"default"`, a runtime name, …) where at least
 * one of THOSE holds a string, checked recursively so a condition nested
 * two or more levels deep — `{ "node": { "import": "./x.js" } }` — still
 * counts. An object with no string anywhere under it — `{}`, or a set of
 * conditions that only ever nest further objects — genuinely names
 * nothing importable, the same as no `"."` key at all.
 */
function hasStringTarget(value: unknown): boolean {
  if (typeof value === 'string') return true;
  return isRecord(value) && Object.values(value).some(hasStringTarget);
}

/**
 * Whether a package.json declares anywhere for a bare `import(name)` to
 * land: a `"main"` field, or an `exports` map with a `"."` entry (the
 * shorthand `"exports": "./foo.js"` form counts too). Used only to decide
 * whether one of `NOTHING_IMPORTABLE_CODES`, below, was EXPECTED — see
 * that decision in `schemaOf`'s own catch block for why "was a main
 * declared" and "did `readPackageJson` find a package.json at all" are
 * two different questions this needs answered separately.
 *
 * Fix round 4: `exp['.']` used to have to be a STRING for this to return
 * `true` — which missed the modern, and at least as common, conditional
 * form: `"exports": { ".": { "import": "./index.js" } }`, the shape a
 * package reaches for the moment it wants separate ESM and CommonJS
 * targets. A hoisted package written that way, with `./index.js` missing,
 * throws the same `ERR_MODULE_NOT_FOUND` `missing-entry-hoisted` (round 2)
 * does — Node resolves the `"."` key fine, matches the `"import"`
 * condition, and only then discovers the file it points to is not there —
 * but `hasImportableMain` read the OBJECT at `exp['.']` as "nothing
 * declared" and this function silenced it: the exact outcome the three
 * rounds before this one exist to prevent, on a manifest shape this
 * function itself was never taught to recognize. `hasStringTarget`, above,
 * is what closes it — a real fault stays reported the moment ANY condition
 * anywhere under `"."` names a file; only a `"."` with no string target at
 * all (this plugin's actual client-only case, and `client-only`/
 * `client-only-hoisted`'s fixtures) stays quiet.
 */
function hasImportableMain(pkgJson: unknown): boolean {
  if (!isRecord(pkgJson)) return false;
  if (typeof pkgJson.main === 'string') return true;
  const exp = pkgJson.exports;
  if (typeof exp === 'string') return true;
  return isRecord(exp) && hasStringTarget(exp['.']);
}

/**
 * Node's own names for "this bare specifier had nothing for `import()` to
 * land on" — not one code, but three, because Node reaches "nothing here"
 * by different routes depending on where the package actually lives:
 *
 *  - `ERR_MODULE_NOT_FOUND` (and CommonJS's `MODULE_NOT_FOUND`, kept
 *    alongside it in case a future loader change resolves through
 *    `require` instead) — the package itself could not be located AT ALL.
 *    This is what a `plugins/<name>`-only package throws: `ctx.loader
 *    .import`'s plain resolution has no notion of `plugins/`, so it never
 *    even reaches the point of reading that package's `main`/`exports`.
 *  - `ERR_PACKAGE_PATH_NOT_EXPORTED` — fix round 3: the HOISTED twin of the
 *    same shape. A real `node_modules` entry (or a workspace package like
 *    `@energy8engine/ide-bridge` — this monorepo already publishes several)
 *    IS locatable, so Node gets far enough to read its `exports` map — and
 *    an `exports` map present with no `"."` key (the modern, well-formed
 *    way to write a client-only package's manifest; both fixtures this
 *    file's own tests use already write it this way) is a DIFFERENT thrown
 *    code than "package not found", even though the underlying fact —
 *    nothing importable was ever declared — is identical. Verified against
 *    the real pipeline before adding it here, not assumed: a hoisted
 *    package with `exports` and no `"."` throws exactly this code, with
 *    the message `No "exports" main defined in <path>/package.json`.
 *
 * All three converge on the same downstream question `hasImportableMain`
 * already answers from the manifest alone — was anything importable ever
 * DECLARED — which is why recognizing the third code cannot mask a real
 * fault: Node throws `ERR_PACKAGE_PATH_NOT_EXPORTED` for a bare specifier
 * only when no `"."` export exists, precisely the condition
 * `hasImportableMain` detects from the manifest directly. The two signals
 * agree by construction, not by coincidence.
 */
const NOTHING_IMPORTABLE_CODES = new Set([
  'ERR_MODULE_NOT_FOUND',
  'MODULE_NOT_FOUND',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
]);

async function schemaOf(
  ctx: Context,
  entryId: string,
  name: string,
  pkg: ReturnType<typeof readPackageJson>,
): Promise<SchemaResult> {
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
    // Fix round 1 (task 7, "a screen is a plugin"): a client-only plugin
    // with no `main`/`"."` export — `screen-demo`, a project-local plugin
    // whose ONLY job is a browser-side `apply(ctx)` — was never going to
    // have anything here for `import(name)` to find, and that is not a
    // plugin author's mistake to report. Two earlier attempts at this are
    // in this function's git history and both were wrong, each caught by
    // re-running the suite it broke rather than assumed correct: gating on
    // `manifest.runtime`'s presence broke `probe-plugin`/`ide-bridge`
    // (neither declares `e8.runtime` either, yet their schemas are exactly
    // what the composition screen's own form fields come from); gating on
    // `readPackageJson`'s result ALONE broke `broken.test.ts`'s
    // `import-broken-plugin` case, whose fixture is deliberately composed
    // from outside the repo specifically because `ctx.loader.import`
    // resolves wider than `readPackageJson(config.cwd, …)` does.
    //
    // Fix round 2: the round-1 fix — silence EVERY `MODULE_NOT_FOUND`-
    // family failure — was itself one case too wide. A package that
    // resolves (a real `plugins/<name>` or `node_modules` entry —
    // `readPackageJson` found it) but whose DECLARED `main`/`"."` points at
    // a file that is not actually there throws the exact same
    // `ERR_MODULE_NOT_FOUND` `screen-demo` does — measured directly: a
    // project-local package with `main: "./index.js"` and no `index.js` on
    // disk throws `Cannot find package "<name>"`, byte-for-byte the same
    // message shape as a client-only manifest with no `main` at all,
    // because `ctx.loader.import` cannot even locate a `plugins/`-only
    // directory to begin checking `main` against — while the hoisted
    // (real `node_modules`) equivalent throws the more specific `Cannot
    // find module '<absolute path to index.js>'`. Both are
    // `ERR_MODULE_NOT_FOUND`; neither is `screen-demo`'s case; both used
    // to vanish into `diagnostics: []` under the round-1 fix, with NO
    // `package`, `schema`, or `apply` diagnostic anywhere to say why — a
    // typo'd `e8.runtime.entry`, or a dependency whose build silently
    // failed to produce its output, would have looked identical to a
    // healthy client-only plugin.
    //
    // So `MODULE_NOT_FOUND` alone is not enough; whether a `main`/`"."`
    // was ever DECLARED is the other half. `pkg` — `readPackageJson`'s own
    // result, computed once in `snapshot()`'s row loop and threaded
    // through here rather than re-resolved — answers that without parsing
    // the error message at all:
    //  - no `pkg`: the row's package could not be resolved by ANY means,
    //    and `snapshot()`'s own `!pkg` branch, a few lines up from where
    //    this is called, already pushed a `package` diagnostic naming it —
    //    silent here, or every misspelled row would say the same thing
    //    twice.
    //  - `pkg` found, no `main`/`"."` declared: nothing was ever going to
    //    be importable, by design — `screen-demo`'s case, and the case
    //    round 1 was written for. Silent.
    //  - `pkg` found, a `main`/`"."` IS declared, and the import still
    //    failed: the manifest promised a module that is not actually
    //    there. A real fault, and the one round 1 went silent on by
    //    mistake. Reported.
    // Anything that is not one of `NOTHING_IMPORTABLE_CODES` at all — a
    // module that DOES exist and throws while being evaluated, or has
    // broken syntax — is unconditionally reported regardless of `pkg`,
    // exactly as before: `import-broken-plugin` throws a plain `Error`
    // from inside its own module body, carrying none of those codes, so
    // it never reaches this decision at all.
    //
    // Fix round 3: `hasImportableMain` reading "an `exports` map with no
    // `"."` key" as nothing-declared was correct from the start, but the
    // round-2 code set only recognized the PROJECT-LOCAL shape of "nothing
    // to find" (`ERR_MODULE_NOT_FOUND`). Resolve the identical manifest
    // through the HOISTED path instead and Node finds the package, reads
    // its `exports` map, finds no `"."`, and throws
    // `ERR_PACKAGE_PATH_NOT_EXPORTED` — a code the round-2 set did not
    // hold, so `nothingImportable` came back `false` and the row fell
    // through to the report branch regardless of `wasExpectedToResolve`.
    // Latent rather than live at the time it was found — nothing in this
    // repo happened to compose a hoisted client-only plugin yet — but not
    // contrived either: `client-only-hoisted`'s own manifest (this file's
    // fixture for it) is the same well-formed `exports`-with-no-`"."`
    // shape `screen-demo` and `client-only` already use, and this monorepo
    // already publishes plugins as ordinary packages (`@energy8engine
    // /ide-bridge`, composed in `e8.yml` the same as any of these). Added
    // to `NOTHING_IMPORTABLE_CODES` above rather than handled as a fourth
    // special case here, since the decision below already treats every
    // code in that set identically.
    const code = (error as { code?: unknown } | null)?.code;
    const nothingImportable = typeof code === 'string' && NOTHING_IMPORTABLE_CODES.has(code);
    const wasExpectedToResolve = pkg !== null && hasImportableMain(pkg.json);
    if (nothingImportable && !wasExpectedToResolve) {
      return { schema: null, diagnostic: null };
    }
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

        const schemaResult = await schemaOf(ctx, entry.id, pkgName, pkg);
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
