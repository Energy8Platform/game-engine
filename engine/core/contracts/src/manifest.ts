/**
 * The `e8` field of a plugin's package.json — the manifest a plugin author
 * writes, and the shapes the host reads out of it.
 *
 * **Writing a plugin for one project, with no install step.**
 *
 * Documented here because this is the file a plugin author reads to write
 * their `package.json`, and the rule itself lives in the IDE host's own
 * internals (`resolvePackage.ts`), which a project does not depend on and
 * would have no reason to open. It was reverse-engineered by the first
 * person who tried; that is the gap this comment closes.
 *
 * A package named by a row is looked for in two places, in this order:
 *
 *  1. `<project>/plugins/<name>` — a directory placed by hand. No install,
 *     no `node_modules` entry, not a workspace. This wins over an installed
 *     package of the same name, deliberately: someone who put a plugin in
 *     `plugins/` did it to have THAT one used.
 *  2. ordinary Node resolution from the project (`node_modules`, including
 *     workspace symlinks).
 *
 * So a whole plugin is four things:
 *
 *  - `<project>/plugins/<name>/package.json` — whose `"name"` and whose
 *    **directory name must both be `<name>`**: the row's `name` is joined
 *    straight onto `plugins/`, so `plugins/reel-step` is reached by a row
 *    saying `name: reel-step`. A scoped name lands at
 *    `plugins/@acme/thing`, nested exactly as written.
 *  - `"e8": { "runtime": { "entry": "./src/index.ts" }, "hot": false }` —
 *    see `E8RuntimeHalf` above for when a `.ts` entry is safe.
 *  - the entry module itself, exporting `apply(ctx, config)` (and
 *    optionally `name`, and a `Config` schema if the IDE should render a
 *    form for it).
 *  - a row in the project's `e8.patch.yml` carrying both an `id` and that
 *    `name` — a patch row with a `name` INSERTS a row no bundle placed, and
 *    it lands last, after the rows `e8-base` supplies.
 *
 * `engine/examples/first-slot/plugins/reel-step` is a worked example of all
 * four, including the two halves a mechanic-bearing plugin needs.
 *
 * A plugin directory that is itself a symlink pointing outside `plugins/`
 * does not resolve — deliberately, so a project-local drop-in cannot
 * silently pull in code from elsewhere.
 */
import { type Diagnostic, diagnostic } from './diagnostic';

/** The browser half of a plugin, loaded into the IDE at runtime. */
export interface E8ClientHalf {
  /** Module path inside the package, relative to its root. */
  entry: string;
  /**
   * Client services this half needs before it can register anything —
   * `ctx.slots`, `ctx.shell`, `ctx.gameComposition` and so on, named
   * exactly as the editor provides them.
   *
   * **This is the one place a client half declares its needs.** The host
   * copies the list onto `CompositionRow.clientInject`, and the editor's
   * `modules.ts` hands it to `ctx.plugin()`, which holds the half pending
   * until every named service exists. A half that reaches for a service it
   * did not name here gets cordis's own `cannot get property "x" without
   * inject` back, reported as a diagnostic against its row. A module-level
   * `export const inject` is NOT consulted: the host has to know a half's
   * needs without importing it, and one declaration that both sides read
   * cannot disagree with itself.
   */
  inject: string[];
}

/**
 * The game half of a plugin, loaded into the running game at runtime.
 *
 * No `inject`, deliberately — the client half has one, this does not, and
 * the asymmetry is real rather than an oversight. A CLIENT half is applied
 * through cordis (`ctx.plugin()`), which honours `inject` by holding the
 * plugin pending until the named services exist. A RUNTIME half is not:
 * `composeFromProject` calls `module.apply?.(ctx, config)` directly, so
 * nothing on this path would ever read an `inject` list. The field existed,
 * was parsed, was typed, and was declared in six package.json files while
 * being read by nothing — a promise of dependency ordering that the loader
 * does not keep.
 *
 * What actually orders runtime rows is their ORDER in the resolved
 * composition: bundles in profile order, then patch layers, applied one at
 * a time with `await` (see `@energy8engine/loader`). A row that needs
 * another row's service must either come after it in the composition, or
 * reach it reactively with `ctx.inject([...], cb)` from inside its own
 * `apply` — which is what `@energy8engine/reels`'s runtime half does.
 *
 * Honouring `inject` instead of removing it would mean the loader either
 * topologically sorting rows or skipping rows whose injects are absent.
 * Both are real designs with real trade-offs; neither is a thing to pick
 * at the end of a plan.
 */
export interface E8RuntimeHalf {
  /**
   * Module path inside the package, relative to its root.
   *
   * **A `.ts` path works only in a project whose `game/spec.json` is
   * usable, and that is worth knowing before you pick one.** With
   * `dev-game` composed (the project has a usable spec) the host hands the
   * browser `/@fs/<realpath>` served through that plugin's own vite
   * instance, which strips types and rewrites bare specifiers — so
   * `./src/index.ts` importing `pixi.js` is fine. With no vite on the
   * origin (no usable spec, so no `dev-game`) the host serves
   * `/plugin-runtime/:id`,
   * which is the file's bytes verbatim: a browser's native `import()`
   * throws on the first piece of TypeScript syntax or the first bare
   * specifier it meets. Ship a built `.js` for anything that must load
   * under both. See `engine/ide/host/src/plugins/runtime-assets.ts`.
   *
   * The path must stay inside the package — an entry that resolves outside
   * it (through a symlink, most often) is refused, with a diagnostic, at
   * composition time and again on the raw route.
   */
  entry: string;
  /**
   * Services this row cannot work without. Checked AFTER composition, never
   * used to order anything — this is not a revival of the old `inject` field.
   * See the note above on why `inject` was removed: a runtime half is applied
   * directly via `module.apply?.(ctx, config)`, not through `ctx.plugin()`,
   * so cordis's dependency gating never sees it. The composition order is
   * fixed: bundles in profile order, then patch layers, one at a time with
   * `await`. A row that needs another service must come after it in that
   * order, or reach it reactively via `ctx.inject()` from inside its own
   * `apply`. This field lets a row DECLARE what it needs, so the host can
   * check afterward that those services exist.
   *
   * Not the other `requires` in this package. `SpinMechanic.requires`
   * (`./mechanic.ts`) is a mechanic's list of FIELDS its stage data must
   * carry, checked against the math's `.spin` schema. The two are read
   * fifteen lines apart in `@energy8engine/game-runtime`'s `createGame`,
   * they share a word and nothing else: different subject (a service vs. a
   * data shape), different checker, different moment. Whichever one you are
   * reading, the other is probably not the one you meant.
   */
  requires?: string[];
}

/**
 * How a provider says which environment it is for. The resolution rule
 * that reads this lives in `@energy8engine/seam` (`selectProvider`), which
 * re-exports this type rather than defining a second copy: the shape is
 * vocabulary — it travels from a package.json, through the host, over the
 * wire, into the browser — while the rule that interprets it is one
 * package's job. Exactly one of the three fields is legal; `selectProvider`
 * is what says so, since the type cannot.
 */
export interface SeamMatcher {
  buildTarget?: string;
  urlParam?: string;
  default?: true;
}

/**
 * A package declaring "I can be the provider of this seam" — the
 * `e8.seam` field of its package.json. A seam is a capability with
 * exactly one provider (`renderer`, `session`, `assets`, ...), so a row
 * carrying this is a CANDIDATE, not a certainty: the game picks between
 * the candidates at compose time through `selectProvider`, and a row that
 * loses is never applied.
 */
export interface E8SeamDeclaration {
  /** The seam this package can provide — `renderer`, `session`, ... */
  name: string;
  matcher: SeamMatcher;
}

/** The `e8` field of a plugin's package.json. */
export interface E8Manifest {
  client?: E8ClientHalf;
  runtime?: E8RuntimeHalf;
  /** Set when this package provides a capability seam — see `E8SeamDeclaration`. */
  seam?: E8SeamDeclaration;
  /** Whether a config change can restart this plugin in place. */
  hot: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseManifest(
  pkg: unknown,
  /**
   * The identity to stamp on any diagnostic this returns — see
   * `Diagnostic.plugin`'s doc comment. Callers pass the composition entry
   * id where one exists (`composition.ts`'s snapshot loop) so a manifest
   * problem traces back to the same row as every other diagnostic about
   * that entry; not the package name, which two entries can share.
   */
  pluginId: string,
): { manifest: E8Manifest | null; diagnostics: Diagnostic[] } {
  if (!isRecord(pkg) || pkg.e8 === undefined) return { manifest: null, diagnostics: [] };

  const raw = pkg.e8;
  if (!isRecord(raw)) {
    return {
      manifest: null,
      diagnostics: [
        diagnostic(
          'warning',
          pluginId,
          'e8',
          'the "e8" field must be an object',
          'remove it or make it an object',
        ),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const manifest: E8Manifest = { hot: raw.hot === true };

  if (raw.client !== undefined) {
    const client = raw.client;
    if (!isRecord(client) || typeof client.entry !== 'string') {
      diagnostics.push(
        diagnostic(
          'warning',
          pluginId,
          'e8.client.entry',
          'the client half needs a module path in "entry"',
          'add e8.client.entry, e.g. "./client.js"',
        ),
      );
    } else {
      const inject = Array.isArray(client.inject)
        ? client.inject.filter((v): v is string => typeof v === 'string')
        : [];
      manifest.client = { entry: client.entry, inject };
    }
  }

  if (raw.runtime !== undefined) {
    const runtime = raw.runtime;
    if (!isRecord(runtime) || typeof runtime.entry !== 'string') {
      diagnostics.push(
        diagnostic(
          'warning',
          pluginId,
          'e8.runtime.entry',
          'the runtime half needs a module path in "entry"',
          'add e8.runtime.entry — a built "./runtime.js" to load under both `e8 dev` and `e8 ide`, or "./src/index.ts" for a dev-only plugin vite will transform',
        ),
      );
    } else {
      const runtimeHalf: E8RuntimeHalf = { entry: runtime.entry };

      if (runtime.requires !== undefined) {
        if (!Array.isArray(runtime.requires)) {
          diagnostics.push(
            diagnostic(
              'warning',
              pluginId,
              'e8.runtime.requires',
              'the runtime half needs an array of service names in "requires"',
              'add e8.runtime.requires as an array of strings, or remove it',
            ),
          );
        } else {
          const validRequires = runtime.requires.filter((v): v is string => typeof v === 'string');
          // An entry that is not a string is dropped, and SAID. Dropping
          // it quietly weakened the declaration in the one direction a
          // reader can never notice: `["board", 7]` became "requires
          // board", `[7]` became "requires nothing", and both look
          // exactly like a package that meant it. The strings around it
          // still parse, for the same reason a malformed `requires`
          // leaves `entry` alone one branch up — half a manifest beats
          // none.
          const dropped = runtime.requires.length - validRequires.length;
          if (dropped > 0) {
            diagnostics.push(
              diagnostic(
                'warning',
                pluginId,
                'e8.runtime.requires',
                `"requires" lists service names, and ${dropped} of its ${runtime.requires.length} entries ${dropped === 1 ? 'is' : 'are'} not a string — ${dropped === 1 ? 'that one is' : 'those are'} dropped, the rest still count`,
                'make every entry of e8.runtime.requires a string, e.g. ["board", "mechanics"]',
              ),
            );
          }
          if (validRequires.length > 0) {
            runtimeHalf.requires = validRequires;
          }
        }
      }

      manifest.runtime = runtimeHalf;
    }
  }

  if (raw.seam !== undefined) {
    const seam = raw.seam;
    if (!isRecord(seam) || typeof seam.name !== 'string') {
      diagnostics.push(
        diagnostic(
          'warning',
          pluginId,
          'e8.seam.name',
          'a seam declaration needs the seam it provides in "name"',
          'add e8.seam.name, e.g. "renderer"',
        ),
      );
    } else {
      // The matcher is copied field by field rather than passed through
      // whole: everything downstream of here (the wire, then
      // `selectProvider`) treats a matcher as exactly these three
      // discriminators, and letting a fourth, unknown field ride along
      // would look meaningful to a reader while matching nothing.
      // Whether the RESULT is legal — exactly one discriminator — is
      // `selectProvider`'s call, not this parser's: it already reports
      // zero and two, naming the row, and duplicating that rule here
      // would give the same mistake two different messages.
      const rawMatcher = isRecord(seam.matcher) ? seam.matcher : {};
      const matcher: SeamMatcher = {};
      if (typeof rawMatcher.buildTarget === 'string') matcher.buildTarget = rawMatcher.buildTarget;
      if (typeof rawMatcher.urlParam === 'string') matcher.urlParam = rawMatcher.urlParam;
      if (rawMatcher.default === true) matcher.default = true;
      manifest.seam = { name: seam.name, matcher };
    }
  }

  return { manifest, diagnostics };
}
