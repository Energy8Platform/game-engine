import type { UserConfig, Plugin } from 'vite';
import { devBridgePlugin, spinPlugin } from '@energy8platform/platform-core/vite';

// Re-export so users importing from `@energy8platform/game-engine/vite`
// can still grab the plugins directly without a separate platform-core import.
export { devBridgePlugin, spinPlugin } from '@energy8platform/platform-core/vite';

// ─── Types ───────────────────────────────────────────────

export interface GameConfig {
  /** Vite `base` path for deployment (default: '/') */
  base?: string;

  /** Enable DevBridge mock server in dev mode (default: false) */
  devBridge?: boolean;

  /** Path to DevBridge config file (default: './dev.config.ts') */
  devBridgeConfig?: string;

  /** Path to the game's .spin math (default: './src/game/script.spin'). */
  spinScript?: string;

  /** Game id for the spin dev server (default: first loaded game). */
  gameId?: string;

  /**
   * Starting gRPC port for the spin dev server (default: `E8_SERVER_PORT`
   * → 50151). If the port is taken — e.g. another game's `npm run dev` is
   * already up — the next free one is used instead.
   */
  spinPort?: number;

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
    // e8-server ведёт раунды и hot-reload .spin (математика — SpinML)
    plugins.push(
      spinPlugin({
        spinPath: config.spinScript ?? './src/game/script.spin',
        gameId: config.gameId,
        port: config.spinPort,
      }),
    );
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
      ],
      ...userVite.resolve,
    },

    optimizeDeps: {
      include: [
        'pixi.js',
      ],
      esbuildOptions: {
        target: 'esnext',
      },
      ...userVite.optimizeDeps,
    },
  };
}
