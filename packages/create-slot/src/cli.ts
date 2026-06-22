import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { parseFlags, applyDefaults } from './answers';
import { prompt } from './prompts';
import { generate } from './generate';

const PUBLISHED: Parameters<typeof generate>[2] = {
  'platform-core': '^0.24.4', 'game-engine': '^0.17.0', 'stake-kit': '^0.1.0', 'stake-bridge': '^0.2.1',
};

async function main(): Promise<void> {
  const flags = parseFlags(argv.slice(2));
  const target = argv.slice(2).find((a) => !a.startsWith('--') && !/^[a-z0-9.]/i.test(a) === false && a !== flags.id);
  const yes = argv.includes('--yes');
  const answers = yes || flags.id ? applyDefaults(flags) : await prompt(flags);
  const dir = resolve(process.cwd(), target ?? answers.id);
  await generate(answers, dir, PUBLISHED);
  console.log(`\n✓ Created ${answers.id} at ${dir}\n  cd ${answers.id} && npm install && npm run dev\n`);
}

main().catch((err) => { console.error(err.message); exit(1); });
