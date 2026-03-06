import type { UserConfig, Plugin } from 'vite';

// ─── Types ───────────────────────────────────────────────

export interface GameConfig {
  /** Vite `base` path for deployment (default: '/') */
  base?: string;

  /** Enable DevBridge mock server in dev mode (default: false) */
  devBridge?: boolean;

  /** Path to DevBridge config file (default: './dev.config.ts') */
  devBridgeConfig?: string;

  /** Additional Vite config to merge */
  vite?: UserConfig;
}

// ─── DevBridge Plugin ────────────────────────────────────

/**
 * Vite plugin that auto-injects the DevBridge script into the
 * HTML during development, so the game can communicate with a
 * mock casino host without manual setup.
 */
const VIRTUAL_ID = '/@dev-bridge-entry.js';

function devBridgePlugin(configPath: string): Plugin {
  let entrySrc = '';
  let resolvedConfigPath = configPath;

  return {
    name: 'game-engine:dev-bridge',
    apply: 'serve', // dev only
    enforce: 'pre',

    configResolved(config) {
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
import { DevBridge } from '@energy8platform/game-engine/debug';

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
      return html.replace(match[0], `<script type="module" src="${VIRTUAL_ID}"></script>`);
    },
  };
}

// ─── defineGameConfig ────────────────────────────────────

/**
 * Define a Vite configuration tailored for Energy8 casino games.
 *
 * Merges sensible defaults for iGaming projects:
 * - Build target: ESNext (required for yoga-layout WASM top-level await)
 * - Asset inlining threshold: 8KB
 * - Source maps for dev, none for prod
 * - Optional DevBridge auto-injection in dev mode
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineGameConfig } from '@energy8platform/game-engine/vite';
 *
 * export default defineGameConfig({
 *   base: '/',
 *   devBridge: true,
 * });
 * ```
 */
export function defineGameConfig(config: GameConfig = {}): UserConfig {
  const plugins: Plugin[] = [];

  if (config.devBridge) {
    const configPath = config.devBridgeConfig ?? './dev.config';
    plugins.push(devBridgePlugin(configPath));
  }

  const userVite = config.vite ?? {};

  return {
    base: config.base ?? '/',

    plugins: [
      ...plugins,
      ...((userVite.plugins as Plugin[]) ?? []),
    ],

    build: {
      target: 'esnext',
      assetsInlineLimit: 8192,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            pixi: ['pixi.js'],
          },
        },
      },
      ...userVite.build,
    },

    server: {
      port: 3000,
      open: true,
      ...userVite.server,
    },

    resolve: {
      dedupe: [
        'pixi.js',
        '@pixi/layout',
        '@pixi/layout/components',
        '@pixi/ui',
        'yoga-layout',
        'yoga-layout/load',
      ],
      ...userVite.resolve,
    },

    optimizeDeps: {
      include: [
        'pixi.js',
        '@pixi/layout',
        '@pixi/layout/components',
        '@pixi/ui',
        'yoga-layout/load',
      ],
      exclude: [
        'yoga-layout',
      ],
      esbuildOptions: {
        target: 'esnext',
      },
      ...userVite.optimizeDeps,
    },
  };
}
