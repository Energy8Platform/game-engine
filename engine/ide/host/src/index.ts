import { pathToFileURL } from 'node:url';
import { Context } from 'cordis';
import Loader from '@cordisjs/plugin-loader';
import Server from '@cordisjs/plugin-server';

export interface IdeHostOptions {
  /** Project directory; its e8.yml is the composition. */
  cwd: string;
  /** 0 picks a free port — used by tests. */
  port?: number;
  host?: string;
}

export interface IdeHost {
  ctx: Context;
  /** Base URL the browser talks to, e.g. http://127.0.0.1:5679 */
  url: string;
  stop(): Promise<void>;
}

/**
 * The composition file. This is the Slice 0 stand-in for the profile + patch
 * format; the project package replaces it without touching this module's API.
 */
export const COMPOSITION_FILE = './e8.yml';

export async function createIdeHost(options: IdeHostOptions): Promise<IdeHost> {
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(options.cwd).href + '/';

  await ctx.plugin(Loader);
  await ctx.loader.create({
    name: '@cordisjs/plugin-include',
    config: { path: COMPOSITION_FILE },
  });

  await ctx.plugin(Server, { host: options.host ?? '127.0.0.1', port: options.port ?? 5679 });
  await ctx.loader.await();

  ctx.server.get('/api/health', async (_req, res) => {
    res.json({ ok: true });
  });

  return {
    ctx,
    url: `http://${ctx.server.host}:${ctx.server.port}`,
    stop: async () => {
      await ctx.fiber.dispose();
    },
  };
}
