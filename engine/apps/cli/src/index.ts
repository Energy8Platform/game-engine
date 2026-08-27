#!/usr/bin/env node
import { createIdeHost } from '@energy8engine/ide-host';

const [command] = process.argv.slice(2);

if (command !== 'ide') {
  console.error('usage: e8 ide');
  process.exit(1);
}

const host = await createIdeHost({ cwd: process.cwd() });
console.log(`e8 ide listening on ${host.url}`);

for (const diag of host.diagnostics) {
  console.error(`[${diag.severity}] ${diag.plugin} (${diag.where}): ${diag.message}`);
  if (diag.fix) console.error(`  fix: ${diag.fix}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void host.stop().then(() => process.exit(0));
  });
}
