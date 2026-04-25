import type { Plugin } from 'vite';

// ─── DevBridge Plugin ────────────────────────────────────

/**
 * Vite plugin that auto-injects the DevBridge mock-host bootstrapper
 * into the HTML during development, so the game can communicate with
 * a mock casino host without manual setup.
 *
 * Pair with `luaPlugin` to also enable `.lua` raw imports and serve a
 * Lua execution endpoint at POST /__lua-play.
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

// ─── Lua Plugin ─────────────────────────────────────────

/**
 * Vite plugin that:
 * 1. Enables importing `.lua` files as raw strings with HMR
 * 2. Runs a LuaEngine on the Vite dev server (Node.js) via POST /__lua-play
 *
 * fengari runs server-side only — no browser shims needed.
 */
export function luaPlugin(configPath: string): Plugin {
  let luaEngine: any = null;
  let viteServer: any = null;

  async function initEngine() {
    if (!viteServer) return;

    try {
      // Invalidate cached modules so HMR picks up changes
      const root = viteServer.config.root;
      const fullConfigPath = configPath.startsWith('.')
        ? root + '/' + configPath.replace(/^\.\//, '')
        : configPath;

      // Invalidate the config module and its dependencies
      const configMod = viteServer.moduleGraph.getModuleById(fullConfigPath);
      if (configMod) viteServer.moduleGraph.invalidateModule(configMod);

      // ssrLoadModule handles TS transpilation and resolves all imports
      const mod = await viteServer.ssrLoadModule(fullConfigPath);
      const config = mod.default ?? mod.config ?? mod;

      if (!config.luaScript || !config.gameDefinition) {
        console.log('[LuaPlugin] No luaScript/gameDefinition in config — Lua server disabled');
        luaEngine = null;
        return;
      }

      // Load LuaEngine via SSR (fengari runs natively in Node.js)
      const luaMod = await viteServer.ssrLoadModule('@energy8platform/platform-core/lua');
      const { LuaEngine } = luaMod;

      if (luaEngine) luaEngine.destroy();
      luaEngine = new LuaEngine({
        script: config.luaScript,
        gameDefinition: config.gameDefinition,
        seed: config.luaSeed,
      });
      console.log('[LuaPlugin] LuaEngine initialized (server-side)');
    } catch (e: any) {
      console.warn('[LuaPlugin] Failed to initialize LuaEngine:', e.message);
      luaEngine = null;
    }
  }

  return {
    name: 'platform-core:lua',
    apply: 'serve',

    async configureServer(server) {
      viteServer = server;
      await initEngine();

      // POST /__lua-play — execute Lua on the server
      server.middlewares.use('/__lua-play', (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk: string) => { body += chunk; });
        req.on('end', () => {
          try {
            if (!luaEngine) {
              res.statusCode = 503;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'LuaEngine not initialized' }));
              return;
            }

            const params = JSON.parse(body);
            const result = luaEngine.execute(params);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },

    transform(code: string, id: string) {
      if (id.endsWith('.lua')) {
        return {
          code: `export default ${JSON.stringify(code)};`,
          map: null,
        };
      }
    },

    async handleHotUpdate({ file, server }: { file: string; server: any }) {
      if (file.endsWith('.lua') || file.includes('dev.config')) {
        console.log('[LuaPlugin] Reloading LuaEngine...');

        // Invalidate all SSR modules so ssrLoadModule picks up fresh code
        server.moduleGraph.invalidateAll();

        await initEngine();
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}
