import { createIdeHost } from '@energy8engine/ide-host';

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

const state = host.ctx.workspace.state();
if (command === 'dev' && state.active === null) {
  // Degrades to `e8`, not an exit: the host is up and lists what it found.
  console.error(
    `e8 dev: ${process.cwd()} is not a project (no e8.yml) — listing ${state.projects.length} project(s) instead`,
  );
}

console.log(`e8 ${command} listening on ${host.url}`);

for (const diag of state.diagnostics) {
  console.error(`[${diag.severity}] ${diag.plugin} (${diag.where}): ${diag.message}`);
  if (diag.fix) console.error(`  fix: ${diag.fix}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void host.stop().then(() => process.exit(0));
  });
}
