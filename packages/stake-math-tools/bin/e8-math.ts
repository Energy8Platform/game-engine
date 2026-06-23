#!/usr/bin/env npx tsx
import { runCli } from '../src/cli';
runCli(process.argv.slice(2)).catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
