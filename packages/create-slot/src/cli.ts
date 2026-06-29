import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { seedFromArgv, applyDefaults } from './answers';
import { prompt } from './prompts';
import { generate } from './generate';

// Dependency versions written into a scaffolded game's package.json. Keep in lock-step with the
// published @energy8platform/* versions (a create-slot test asserts these match the workspace).
const PUBLISHED: Parameters<typeof generate>[2] = {
  'platform-core': '^0.26.2', 'game-engine': '^0.22.1', 'stake-kit': '^0.3.0', 'stake-bridge': '^0.3.1',
  'stake-math-tools': '^0.8.0',
};

async function main(): Promise<void> {
  const seed = seedFromArgv(argv.slice(2));
  const yes = argv.includes('--yes');
  const answers = yes ? applyDefaults(seed) : await prompt(seed);
  // Target dir: explicit --dir (resolved against cwd) wins; else cwd/<id> (backward compatible).
  const dir = seed.dir ? resolve(process.cwd(), seed.dir) : resolve(process.cwd(), answers.id);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`Target directory ${dir} already exists and is not empty.`);
  }
  await generate(answers, dir, PUBLISHED);
  console.log(`\n✓ Created ${answers.id} at ${dir}\n  cd ${seed.dir ?? answers.id} && npm install && npm run dev\n`);
}

main().catch((err) => { console.error(err.message); exit(1); });
