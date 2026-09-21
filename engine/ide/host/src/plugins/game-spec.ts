/**
 * `GET /api/spec` — `game/spec.json` as written (`{ spec }`, `null` when
 * absent or not JSON), on the root server and, through `attachGameRoutes`,
 * the game preview. A document the rows read (the shell derives a paytable
 * from `symbols[].pay`) — so `e8 build` freezes it beside flow/scenes/symbols.
 * Read per request: the dev host has no cache to keep fresh.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from 'cordis';
import type { Server } from '@cordisjs/plugin-server';

declare module 'cordis' {
  interface Context {
    gameSpecHost: GameSpecHost;
  }
}

export interface GameSpecHost {
  /** Registers `GET /api/spec` on another server — the preview's, so the game reads the document same-origin. */
  attachGameRoutes(server: Server): void;
}

export const name = 'game-spec';
export const inject = ['server'];

export interface GameSpecConfig {
  cwd: string;
}

export function apply(ctx: Context, config: GameSpecConfig): void {
  type Handler = Parameters<Server['get']>[1];

  const get: Handler = async (_req, res) => {
    let spec: unknown = null;
    try {
      spec = JSON.parse(await readFile(join(config.cwd, 'game', 'spec.json'), 'utf8'));
    } catch {
      // Absent file or invalid JSON both answer `null` — the caller cannot
      // tell the two apart, same as `symbols.ts`'s `known()` on its own
      // `game/spec.json` read.
      spec = null;
    }
    res.json({ spec });
  };

  ctx.server.get('/api/spec', get);
  ctx.provide('gameSpecHost', { attachGameRoutes: (server) => server.get('/api/spec', get) });
}
