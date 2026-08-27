import type { Context } from 'cordis';
import {
  type CompositionRow,
  type Diagnostic,
  type Snapshot,
  diagnostic,
  parseManifest,
} from '@energy8engine/contracts';
import Schema from 'schemastery';
import { readPackageJson } from '../resolvePackage';

declare module 'cordis' {
  interface Context {
    composition: CompositionService;
  }
}

export interface CompositionService {
  snapshot(): Promise<Snapshot>;
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
    // toJSON() dedupes nested schemas into a { uid, refs } graph rather than
    // inlining them (schemastery's own wire format) — rebuilding it through
    // `new Schema(...)` is what turns it back into a schema whose nested
    // fields (e.g. `.dict.speed.meta.min`) are reachable by property access.
    return new Schema(Config.toJSON() as any);
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
  };

  ctx.provide('composition', service);
}
