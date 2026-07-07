// export.e8.ts — generate the E8 platform deliverables from the single game spec.
//
//   npm run export:e8   →   dist/e8/{config.json, script.spin}
//
// config.json is the GameDefinition (engine_mode=spin); script.spin is the
// self-contained SpinML (auto-generated prelude ⧺ your script.spin). Upload to
// S3 as games/{id}/config.json and games/{id}/script.spin — e8-server picks the
// script up from its --games-s3 prefix; the platform routes by engine_mode.
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportGameSpin } from '@energy8platform/platform-core/game-spec';
import { findE8Binary } from '@energy8platform/platform-core/simulation';
import { spec } from './src/game.spec';

const root = fileURLToPath(new URL('.', import.meta.url));
const logic = readFileSync(resolve(root, 'src/game/script.spin'), 'utf8');

// exportGameSpin runs structural validation (well-formed config, `fn execute`).
const out = exportGameSpin(spec, { logicSpin: logic });

// Boot check: the exported script must typecheck+compile in the e8 engine.
const e8 = findE8Binary();
if (e8) {
  const tmp = resolve(tmpdir(), `export-${process.pid}.spin`);
  writeFileSync(tmp, out['script.spin']);
  try {
    execFileSync(e8, ['check', tmp], { stdio: 'inherit' });
  } finally {
    rmSync(tmp, { force: true });
  }
} else {
  console.warn('[export] e8 binary not found — skipping compile check (npm install fetches it)');
}

const dir = resolve(root, 'dist/e8');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'config.json'), out['config.json']);
writeFileSync(resolve(dir, 'script.spin'), out['script.spin']);
console.log(`E8 deliverables written to ${dir}: config.json + script.spin`);
