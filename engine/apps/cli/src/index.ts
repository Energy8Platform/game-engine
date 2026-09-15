import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { IDE_BUILD_HINT, IDE_DIST_DEFAULT, createIdeHost } from '@energy8engine/ide-host';
import { check, shot, spin } from '@energy8engine/ide-host/compute';

// `e8` alone is `e8 ide`. Both commands boot the same host over `cwd`
// (spec §3): a `cwd` holding `e8.yml` is the one project and opens at
// boot — which is what `e8 dev` in a project folder always meant, and
// its `dev-game` now comes up inside that project's scope; a `cwd` of
// project folders lists them and opens none.
const [command = 'ide', ...rest] = process.argv.slice(2);

const USAGE = [
  'usage: e8 [ide|dev]',
  '       e8 check [file]                       parse a .spin (default game/script.spin)',
  '       e8 spin [--n N] [--bet B] [--seed S] [--action A] [--quiet]',
  '                                             play N spins through e8-server',
  '       e8 shot [--out p] [--viewport WxH] [--spin] [--ide] [--budget ms] [--quiet]',
  '                                             screenshot the running game (or the IDE)',
  '',
  'check, spin and shot print one JSON document on stdout, progress on stderr,',
  'and exit 1 when a diagnostic is an error.',
  '',
  'environment:',
  '  PORT          the IDE host (default 5679; 0 picks a free port)',
  '  PREVIEW_PORT  the game preview (default 5681; 0 picks a free port)',
  "  IDE_DIST      where the built IDE shell is served from (default: this repo's engine/apps/web/dist)",
  '  IDE_ORIGINS   comma-separated extra origins allowed to write to the IDE API',
].join('\n');

if (command === '--help' || command === '-h') {
  console.log(USAGE);
  process.exit(0);
}
if (command === 'check' || command === 'spin' || command === 'shot') {
  const { flags, rest: positional } = parseFlags(rest);
  const known: string[] = {
    check: [],
    spin: ['n', 'bet', 'seed', 'action', 'quiet'],
    shot: ['out', 'viewport', 'spin', 'ide', 'budget', 'quiet'],
  }[command];
  const unknown = Object.keys(flags).filter((flag) => !known.includes(flag));
  const quiet = flags.quiet !== undefined;
  const viewport = flags.viewport?.match(/^(\d+)x(\d+)$/);
  if (command === 'shot' && flags.viewport !== undefined && !viewport) unknown.push('viewport');
  const result = unknown.length
    ? {
        diagnostics: unknown.map((flag) => ({
          severity: 'error' as const,
          plugin: 'compute',
          where: `--${flag}`,
          message:
            flag === 'viewport' && flags.viewport !== undefined
              ? `--viewport must be WxH, got ${flags.viewport}`
              : `e8 ${command} does not take --${flag}`,
        })),
      }
    : command === 'check'
      ? await check({ file: positional[0] ?? join('game', 'script.spin') })
      : command === 'shot'
        ? await shot({
            cwd: process.cwd(),
            out: flags.out,
            viewport: viewport
              ? { width: Number(viewport[1]), height: Number(viewport[2]) }
              : undefined,
            spin: flags.spin !== undefined,
            ide: flags.ide !== undefined,
            budgetMs: num(flags.budget),
          })
        : await spin({
            cwd: process.cwd(),
            n: num(flags.n),
            bet: num(flags.bet),
            seed: flags.seed,
            action: flags.action,
            onProgress(done, n) {
              const step = Math.ceil(n / 10);
              if (!quiet && (done % step === 0 || done === n)) console.error(`${done}/${n}`);
            },
          });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.diagnostics.some((d) => d.severity === 'error') ? 1 : 0);
}
if (command !== 'ide' && command !== 'dev') {
  console.error(USAGE);
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

/** `--k v` pairs and bare positionals; a `--flag` before another `--` or the end is `''`. */
function parseFlags(args: string[]): { flags: Record<string, string | undefined>; rest: string[] } {
  const flags: Record<string, string | undefined> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) {
      rest.push(args[i]);
    } else if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
      flags[args[i].slice(2)] = args[++i];
    } else {
      flags[args[i].slice(2)] = '';
    }
  }
  return { flags, rest };
}

/** An absent flag stays absent; anything else is `Number`ed — `spin` reports a NaN as a diagnostic. */
function num(v: string | undefined): number | undefined {
  return v === undefined ? undefined : Number(v);
}
