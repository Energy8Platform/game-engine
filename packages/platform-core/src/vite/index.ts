import type { Plugin } from 'vite';

// ─── DevBridge Plugin ────────────────────────────────────

/**
 * Vite plugin that auto-injects the DevBridge mock-host bootstrapper
 * into the HTML during development, so the game can communicate with
 * a mock casino host without manual setup.
 *
 * Pair with `spinPlugin` to serve the math endpoint at POST /__lua-play
 * (the route name is the frozen frontend contract; the engine is e8).
 */
const VIRTUAL_ID = '/@dev-bridge-entry.js';

export function devBridgePlugin(configPath: string): Plugin {
  let entrySrc = '';
  let viteRoot = '';
  let resolvedConfigPath = configPath;

  return {
    name: 'platform-core:dev-bridge',
    apply: 'serve', // dev only
    enforce: 'pre',

    configResolved(config) {
      viteRoot = config.root;
      // Resolve relative config path against Vite root so the virtual
      // module can import it with an absolute path.
      if (configPath.startsWith('.')) {
        resolvedConfigPath = config.root + '/' + configPath.replace(/^\.\//, '');
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return id;
    },

    load(id) {
      if (id === VIRTUAL_ID) {
        // This goes through Vite's pipeline so bare imports are resolved
        return `
import { DevBridge } from '@energy8platform/platform-core/dev-bridge';

try {
  const mod = await import('${resolvedConfigPath}');
  const config = mod.default ?? mod.config ?? mod;
  new DevBridge(config).start();
} catch (e) {
  console.warn('[DevBridge] Failed to load config:', e);
}

await import('${entrySrc}');
`;
      }
    },

    transformIndexHtml(html) {
      // Find the app's entry module script (skip Vite internal /@... scripts)
      const scriptRegex = /<script\s+type="module"\s+src="((?!\/@)[^"]+)"\s*>\s*<\/script>/;
      const match = html.match(scriptRegex);

      if (!match) {
        console.warn('[DevBridge] Could not find entry module script in index.html');
        return html;
      }

      entrySrc = match[1];
      if (entrySrc.startsWith('.')) {
        entrySrc = viteRoot + '/' + entrySrc.replace(/^\.\//, '');
      } else if (entrySrc.startsWith('/')) {
        entrySrc = viteRoot + entrySrc;
      }
      return html.replace(match[0], `<script type="module" src="${VIRTUAL_ID}"></script>`);
    },
  };
}

export { spinPlugin } from './spinPlugin';
export type { SpinPluginOptions } from './spinPlugin';
