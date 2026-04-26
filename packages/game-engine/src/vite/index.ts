import type { UserConfig, Plugin } from 'vite';
import { devBridgePlugin, luaPlugin } from '@energy8platform/platform-core/vite';

// Re-export so users importing from `@energy8platform/game-engine/vite`
// can still grab the plugins directly without a separate platform-core import.
export { devBridgePlugin, luaPlugin } from '@energy8platform/platform-core/vite';

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

// ─── defineGameConfig ────────────────────────────────────

/**
 * Define a Vite configuration tailored for Energy8 casino games on
 * @energy8platform/game-engine (PixiJS).
 *
 * Merges sensible defaults for iGaming projects:
 * - Build target: ESNext
 * - Asset inlining threshold: 8KB
 * - PixiJS-specific dedupe / chunk splitting / prebundle hints
 * - Optional DevBridge auto-injection in dev mode (with Lua engine)
 *
 * For Phaser/Three/custom engines, import the bare plugins directly
 * from `@energy8platform/platform-core/vite` and write your own config.
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
    plugins.push(luaPlugin(configPath));
  }

  const userVite = config.vite ?? {};

  return {
    base: config.base ?? './',

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
        'react',
        'react-dom',
        'react-reconciler',
      ],
      ...userVite.resolve,
    },

    optimizeDeps: {
      include: [
        'pixi.js',
        'react',
        'react-dom',
      ],
      exclude: [
        'fengari',
      ],
      esbuildOptions: {
        target: 'esnext',
      },
      ...userVite.optimizeDeps,
    },
  };
}
