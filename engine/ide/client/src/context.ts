import { Context } from 'cordis';
import * as connection from './plugins/connection';
import type { ConnectionConfig } from './plugins/connection';
import * as workspace from './plugins/workspace';
import * as slots from './plugins/slots';
import * as languages from './plugins/languages';
import * as viewers from './plugins/viewers';
import * as viewersMedia from './plugins/viewers-media';
import * as shell from './plugins/shell';
import * as modules from './plugins/modules';
import type { ModulesConfig } from './plugins/modules';
import * as history from './plugins/history';
import * as gameComposition from './plugins/game-composition';
import type { GameCompositionConfig } from './plugins/game-composition';
import * as assetNodeTypes from './plugins/asset-node-types';
import * as scenes from './plugins/scenes';
import type { ScenesConfig } from './plugins/scenes';
import * as flow from './plugins/flow';
import type { FlowConfig } from './plugins/flow';
import * as symbols from './plugins/symbols';
import type { SymbolsConfig } from './plugins/symbols';
import * as reels from './plugins/reels';
import * as gameDiagnostics from './plugins/diagnostics';
import * as files from './plugins/files';
import type { FilesConfig } from './plugins/files';
import * as check from './plugins/check';
import type { CheckConfig } from './plugins/check';
import * as languagesBasic from './plugins/languages-basic';
import * as languageSpin from './plugins/language-spin';

/**
 * Boot the browser-side cordis application.
 *
 * Async, not the synchronous shape a naive reading of "boot a context and
 * register a plugin" might suggest: `ctx.plugin()` returns a Fiber that
 * cordis advances through its lifecycle asynchronously, so a bare
 * `void ctx.plugin(...)` gives no guarantee the fiber has reached ACTIVE —
 * and therefore that `ctx.connection` or `ctx.slots` exists — by the time
 * this function would otherwise return. Awaiting each fiber here means
 * every caller gets a `Context` with both services already provided.
 */
export async function createIdeClient(
  config: ConnectionConfig &
    ModulesConfig &
    GameCompositionConfig &
    ScenesConfig &
    FlowConfig &
    SymbolsConfig &
    FilesConfig &
    CheckConfig,
): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(connection, config);
  await ctx.plugin(slots);
  // Languages are a contribution like slots: a registry a plugin's client
  // half adds to. Composed before `shell` so that anything composed after
  // — a project plugin included — can register one.
  await ctx.plugin(languages);
  // The shell's regions are the same kind of contribution cards already
  // are (a registry a plugin's client half adds to, `App` merely draws),
  // so it composes right after `slots` — which it reads directly, a hard
  // dependency — and before the plugins that fetch or forward data rather
  // than just hold state.
  await ctx.plugin(shell);
  // A contribution the Explorer reads, like `languages` — composed right
  // after `shell` since `openPath` (which `Explorer` calls) needs
  // `ctx.viewers` at hand.
  await ctx.plugin(viewers);
  // After `shell`, which it injects alongside `connection`: a project
  // switch closes the shell's `f:` tabs (spec §8). Reads the same
  // `url`/`socketFactory` (its own socket, see its module doc) and the
  // same `fetchFn` `files` already takes.
  await ctx.plugin(workspace, config);
  await ctx.plugin(modules, config);
  // In-memory undo/redo, no deps of its own — composed here, ahead of
  // every service below that records a step into it (`gameComposition`
  // included) and every tab that registers a `scope`.
  await ctx.plugin(history);
  await ctx.plugin(gameComposition, config);
  // A pure contribution registry, like `viewers` — composed right before
  // `scenes`, whose canvas drop handler (a later task) is its first reader.
  await ctx.plugin(assetNodeTypes);
  // The scene documents: reads `connection` (frames) and `shell` (tabs),
  // and the same `fetchFn`/`origin` `gameComposition` takes.
  await ctx.plugin(scenes, config);
  // The flow document: same shape as `scenes` above (`connection` frames,
  // `shell` for its activity/document slots) minus the canvas deps —
  // there is no iframe to drop assets onto or read a design size from.
  // Injects `scenes` (the mutual deselect, the `scene` picker) and
  // `files` (the inspector's `asset` picker).
  await ctx.plugin(flow, config);
  // The symbols document: `flow` again with `symbols` in place of `flow`.
  // Injects `scenes` and `flow` (the three-way deselect, the node types
  // and pickers), `files` and `assetNodeTypes` (the document's drop).
  await ctx.plugin(symbols, config);
  // The Reels document: `gameComposition`'s rows split into sections,
  // registered only while one of them is `reels1` (`reels.tsx`'s own
  // doc). No fetch of its own — nothing here for a config to carry — so,
  // unlike every plugin above it, this composes with no second argument.
  await ctx.plugin(reels);
  // `GameDiagnosticsConfig` is `ConnectionConfig` by another name (see its
  // own doc) — no new field for this signature to carry, just another
  // plugin reading the same `url`/`socketFactory` this function's caller
  // already supplies.
  await ctx.plugin(gameDiagnostics, config);
  // A plain fetch wrapper like `gameComposition`. `scenes` and `flow`
  // inject it (cordis holds them until it is provided), so its place here
  // is history, not order.
  await ctx.plugin(files, config);
  // Same kind of plain fetch wrapper as `files`, nothing here depends on
  // it either — the editor two tasks from now is the first consumer.
  await ctx.plugin(check, config);
  // The two core language providers: Monaco's own grammars for the files
  // a project is made of, and `.spin`. Composed last — they are pure
  // contributions to `languages`, and a project plugin composed later
  // may replace either by registering the same id.
  await ctx.plugin(languagesBasic);
  await ctx.plugin(languageSpin);
  // The built-in media viewers (image/audio/video) — a pure contribution
  // to `viewers`, composed last so a project plugin composed earlier may
  // still be overridden by registering the same id later, same rule the
  // two language providers above follow for `languages`.
  await ctx.plugin(viewersMedia);
  return ctx;
}
