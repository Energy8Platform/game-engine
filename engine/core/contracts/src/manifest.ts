import { type Diagnostic, diagnostic } from './diagnostic';

/** The browser half of a plugin, loaded into the IDE at runtime. */
export interface E8ClientHalf {
  /** Module path inside the package, relative to its root. */
  entry: string;
  /** Client services this half needs before it can register anything. */
  inject: string[];
}

/** The game half of a plugin, loaded into the running game at runtime. */
export interface E8RuntimeHalf {
  /** Module path inside the package, relative to its root. */
  entry: string;
  /** Runtime services this half needs before it can register anything. */
  inject: string[];
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
          'add e8.runtime.entry, e.g. "./runtime.js"',
        ),
      );
    } else {
      const inject = Array.isArray(runtime.inject)
        ? runtime.inject.filter((v): v is string => typeof v === 'string')
        : [];
      manifest.runtime = { entry: runtime.entry, inject };
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
