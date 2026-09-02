import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIdeHost } from '@energy8engine/ide-host';
import * as devGame from '@energy8engine/ide-host/dev-game';

const [command] = process.argv.slice(2);

if (command !== 'ide' && command !== 'dev') {
  console.error('usage: e8 ide | e8 dev');
  process.exit(1);
}

const cwd = process.cwd();
// `PORT=0` lets a test (or a developer running two instances) bind an
// ephemeral port instead of the fixed default — see
// engine/ide/host/tests/cli-smoke.test.ts, which spawns this exact binary
// and needs a port nothing else could be holding.
const port = process.env.PORT ? Number(process.env.PORT) : undefined;
const host = await createIdeHost({ cwd, port });

if (command === 'dev') {
  // `e8 dev` boots the same host `e8 ide` does, plus `dev-game`: one
  // server, two consumers (see engine/ide/host/src/plugins/dev-game.ts's
  // module doc). Project layout convention, mirroring `engine/examples
  // /first-slot`: the game's `.spin`/spec live under `<cwd>/game`, and
  // `spec.json` names the game_id and default bet — the same metadata
  // file the .spin's own header already points at as "read by later IDE
  // tasks", now one of them.
  const gamesDir = join(cwd, 'game');
  const specPath = join(gamesDir, 'spec.json');

  let spec: { id?: unknown; betLevels?: unknown };
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8'));
  } catch (error) {
    console.error(
      `e8 dev: could not read ${specPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    await host.stop();
    process.exit(1);
  }
  if (typeof spec.id !== 'string' || spec.id.length === 0) {
    console.error(`e8 dev: ${specPath} has no string "id" (the game's game_id)`);
    await host.stop();
    process.exit(1);
  }
  const betLevel =
    Array.isArray(spec.betLevels) && typeof spec.betLevels[0] === 'number'
      ? (spec.betLevels[0] as number)
      : 1;

  try {
    await host.ctx.plugin(devGame, { root: cwd, gamesDir, gameId: spec.id, betLevel });
  } catch (error) {
    console.error(
      `e8 dev: failed to start: ${error instanceof Error ? error.message : String(error)}`,
    );
    await host.stop();
    process.exit(1);
  }
}

console.log(`e8 ${command} listening on ${host.url}`);

for (const diag of host.diagnostics) {
  console.error(`[${diag.severity}] ${diag.plugin} (${diag.where}): ${diag.message}`);
  if (diag.fix) console.error(`  fix: ${diag.fix}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void host.stop().then(() => process.exit(0));
  });
}
