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

/** The `e8` field of a plugin's package.json. */
export interface E8Manifest {
  client?: E8ClientHalf;
  runtime?: E8RuntimeHalf;
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

  return { manifest, diagnostics };
}
