import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { seedFromArgv, applyDefaults } from './answers';
import { prompt } from './prompts';
import { generate } from './generate';

// Dependency versions written into a scaffolded game's package.json. Keep in lock-step with the
// published @energy8platform/* versions (a create-slot test asserts these match the workspace).
const PUBLISHED: Parameters<typeof generate>[2] = {
  'platform-core': '^0.25.0', 'game-engine': '^0.18.0', 'stake-kit': '^0.2.0', 'stake-bridge': '^0.3.0',
  'stake-math-tools': '^0.8.0',
};

async function main(): Promise<void> {
  const seed = seedFromArgv(argv.slice(2));
  const yes = argv.includes('--yes');
  const answers = yes ? applyDefaults(seed) : await prompt(seed);
  const dir = resolve(process.cwd(), answers.id);
  await generate(answers, dir, PUBLISHED);
  console.log(`\n✓ Created ${answers.id} at ${dir}\n  cd ${answers.id} && npm install && npm run dev\n`);
}

main().catch((err) => { console.error(err.message); exit(1); });
