/**
 * Everything that used to be bound to `createIdeHost`'s `cwd`, as one
 * plugin the workspace plugs when a project opens and disposes when it
 * closes (spec §5). The order and the `inject`s inside are exactly what
 * `index.ts` had; only the owner of the scope changed.
 *
 * Two facts from the pre-plan spike, both load-bearing:
 *  - `plugin-include` resolves `config.path` with `new URL(path, ctx.baseUrl)`,
 *    so an absolute `file://` URL works with no `baseUrl` on the root.
 *  - A loader entry created from inside a scope OUTLIVES the scope's
 *    dispose (it belongs to the root tree). `ctx.loader.remove(id)` in an
 *    effect disposer is what actually takes the project's IDE plugins
 *    down with the project. (`Loader.write()` on the root tree is a no-op
 *    — measured — so the remove touches no file.)
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import { loadComposition } from '../composition-file';
import * as clientAssets from './client-assets';
import * as composition from './composition';
import * as devGame from './dev-game';
import * as files from './files';
import * as flow from './flow';
import * as project from './project';
import * as runtimeAssets from './runtime-assets';
import * as scenes from './scenes';
import * as schema from './schema';
import * as symbols from './symbols';
import type { ProjectScopeHandle } from './workspace';

export interface ProjectScopeConfig {
  cwd: string;
  /** The game preview's port (spec §6) — `dev-game` boots the game's own server there. */
  previewPort: number;
}

export const name = 'project-scope';
export const inject = ['loader', 'server', 'ideRpc'];

export async function apply(ctx: Context, config: ProjectScopeConfig): Promise<void> {
  const { cwd } = config;
  const { diagnostics: bootDiagnostics, entryId } = await loadComposition(ctx, cwd);
  if (entryId !== undefined) {
    ctx.effect(() => () => ctx.loader.remove(entryId), 'project-scope:include');
  }
  // A fresh nonce per boot, not per host: reopening the same project is a
  // new boot too, and its client halves may have been edited meanwhile.
  const clientNonce = randomUUID().slice(0, 8);
  await ctx.plugin(composition, { cwd, bootDiagnostics, clientNonce });
  // The GAME's composition (e8.profile.yml + bundles + e8.patch.yml) is a
  // different format from e8.yml above and lives on its own service —
  // see plugins/project.ts's doc comment for why the two are not merged.
  await ctx.plugin(project, { cwd });
  await ctx.plugin(schema, { cwd });
  await ctx.plugin(files, { cwd });
  await ctx.plugin(clientAssets, { cwd });
  await ctx.plugin(runtimeAssets, { cwd });
  await ctx.plugin(scenes);
  await ctx.plugin(flow);
  await ctx.plugin(symbols);
  await ctx.loader.await();

  // dev-game: what `e8 dev` used to add after the host. Its config is read
  // from the project the way the CLI read it (game/spec.json). A project
  // with no `game/` at all is an IDE-only project (what `e8 ide` always
  // served) — open, silently, without a game; a spec that IS there but
  // cannot be used is reported, and the project is still open.
  const game = await readGameConfig(cwd);
  if (game.diagnostics.length) {
    ctx.ideRpc.reportGameDiagnostics('dev-game', game.diagnostics);
  } else if (game.config) {
    await ctx.plugin(devGame, { ...game.config, port: 0, previewPort: config.previewPort });
  }
}

/** The `scope` factory `createIdeHost` hands to `workspace`. Rejects → the workspace records a diagnostic. */
export function bootProjectScope(
  root: Context,
  cwd: string,
  previewPort: number,
): Promise<ProjectScopeHandle> {
  const fiber = root.plugin({ name, inject, apply }, { cwd, previewPort });
  // `ctx.plugin()` hands back a Fiber that is thenable (cordis rc.8 wraps
  // `fiber.await()`); `Promise.resolve` adopts it so a throw in `apply`
  // rejects — and a rejected boot takes its half-built fiber down with it,
  // rather than leaving a FAILED fiber in the registry until the root goes.
  return Promise.resolve(fiber).then(
    () => {
      // Where dev-game put the game (its own server, spec §6) — `null` for
      // an IDE-only project, and for a preview port that could not be bound.
      const previewUrl = fiber.ctx.get('devGamePreview')?.url ?? null;
      return { previewUrl, dispose: () => fiber.dispose() };
    },
    async (error: unknown) => {
      await fiber.dispose();
      throw error;
    },
  );
}

interface GameConfig {
  root: string;
  gamesDir: string;
  gameId: string;
  betLevel: number;
}

async function readGameConfig(
  cwd: string,
): Promise<{ config?: GameConfig; diagnostics: Diagnostic[] }> {
  const gamesDir = join(cwd, 'game');
  const specPath = join(gamesDir, 'spec.json');
  let spec: { id?: unknown; betLevels?: unknown };
  try {
    spec = JSON.parse(await readFile(specPath, 'utf8')) as typeof spec;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { diagnostics: [] };
    return {
      diagnostics: [
        diagnostic(
          'error',
          'dev-game',
          'game/spec.json',
          `could not read ${specPath}: ${error instanceof Error ? error.message : String(error)}`,
          'fix game/spec.json; the project is open without its game',
        ),
      ],
    };
  }
  if (typeof spec.id !== 'string' || spec.id.length === 0) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'dev-game',
          'game/spec.json',
          `${specPath} has no string "id" (the game's game_id)`,
          'add "id" to game/spec.json; the project is open without its game',
        ),
      ],
    };
  }
  const betLevel =
    Array.isArray(spec.betLevels) && typeof spec.betLevels[0] === 'number'
      ? (spec.betLevels[0] as number)
      : 1;
  return { config: { root: cwd, gamesDir, gameId: spec.id, betLevel }, diagnostics: [] };
}
