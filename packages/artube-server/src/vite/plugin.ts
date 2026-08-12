/**
 * `artubePlugin` — one call site, both halves of the Artube target.
 *
 * A game's `vite.config.ts` says `artubePlugin({ spinPath })` once and gets
 * the dev loop (`apply: 'serve'`: start the backend, own the port, proxy
 * `/api`) *and* the build artifact (`apply: 'build'`: emit the deployable
 * backend with the game's math in it). They are two plugin objects because
 * each keeps an unconditional `apply` — the guarantee that neither can ever
 * take part in the other's mode is then a property of the object, not of a
 * branch inside a hook.
 *
 * Vite flattens plugin arrays, so returning one changes nothing at the call
 * site.
 */
import type { Plugin } from 'vite';
import { artubeDevPlugin, type ArtubePluginOptions } from './devPlugin.js';
import { artubeBuildPlugin } from './buildPlugin.js';

export function artubePlugin(opts: ArtubePluginOptions = {}): Plugin[] {
  return [artubeDevPlugin(opts), artubeBuildPlugin(opts)];
}
