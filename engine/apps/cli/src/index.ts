// The binary's entry (`bin/e8.mjs` registers tsx and imports this). All
// of the CLI is `run()`; this file is what only the real process can do:
// exit with the code — after `run` has flushed stdout — for the one-shot
// commands, and stay alive for `ide`/`dev` (`null`), which the host's
// signal handlers end.
import { run } from './run';

const code = await run(process.argv.slice(2), process);
if (code !== null) process.exit(code);
