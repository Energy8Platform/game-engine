import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { IDE_BUILD_HINT, IDE_DIST_DEFAULT, createIdeHost } from '@energy8engine/ide-host';

// `e8` alone is `e8 ide`. Both commands boot the same host over `cwd`
// (spec §3): a `cwd` holding `e8.yml` is the one project and opens at
// boot — which is what `e8 dev` in a project folder always meant, and
// its `dev-game` now comes up inside that project's scope; a `cwd` of
// project folders lists them and opens none.
const [command = 'ide'] = process.argv.slice(2);

if (command !== 'ide' && command !== 'dev') {
  console.error('usage: e8 [ide|dev]');
  process.exit(1);
}

// `PORT=0` lets a test (or a developer running two instances) bind an
// ephemeral port instead of the fixed default — see
// engine/ide/host/tests/cli-smoke.test.ts, which spawns this exact binary
// and needs a port nothing else could be holding. `PREVIEW_PORT` is the
// same knob for the game preview (spec §3).
const host = await createIdeHost({
  root: process.cwd(),
  port: process.env.PORT ? Number(process.env.PORT) : undefined,
  previewPort: process.env.PREVIEW_PORT ? Number(process.env.PREVIEW_PORT) : undefined,
});

// Before the first line of output: a caller that sends SIGTERM the moment
// it reads "listening on" (cli-smoke.test.ts does) must find the handler
// already installed, or the signal's default kills the process with no
// exit code instead of the clean 0 `host.stop()` earns.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void host.stop().then(() => process.exit(0));
  });
}

const state = host.ctx.workspace.state();
if (command === 'dev' && state.active === null) {
  // Degrades to `e8`, not an exit: the host is up and lists what it found.
  // Two different reasons for "nothing open": no project here at all, or
  // one that refused to start — whose refusal `state.diagnostics` (printed
  // below) already holds.
  console.error(
    existsSync(join(process.cwd(), 'e8.yml'))
      ? 'e8 dev: the project did not start — see the diagnostics below'
      : `e8 dev: ${process.cwd()} is not a project (no e8.yml) — listing ${state.projects.length} project(s) instead`,
  );
}

console.log(`e8 ${command} listening on ${host.url}`);
console.log(`IDE: ${host.url}/`);
// The same fallback `ide-static` uses (spec §7): `IDE_DIST`, else the repo's own build.
if (!existsSync(join(process.env.IDE_DIST ?? IDE_DIST_DEFAULT, 'index.html'))) {
  console.error(`the IDE shell is not built: ${IDE_BUILD_HINT}`);
}

for (const diag of state.diagnostics) {
  console.error(`[${diag.severity}] ${diag.plugin} (${diag.where}): ${diag.message}`);
  if (diag.fix) console.error(`  fix: ${diag.fix}`);
}
