import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { applyDefaults, type Answers, type Mechanic } from './answers';

/** Ask the 5 questions interactively, applying defaults for blank answers. */
export async function prompt(seed: Partial<Answers>): Promise<Answers> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const id = seed.id ?? (await rl.question('Game id (kebab-case): ')).trim();
    const titleInput = (await rl.question(`Title [${applyDefaults({ id }).title}]: `)).trim();
    const title = seed.title ?? (titleInput || undefined);
    const mechanic = (seed.mechanic ?? ((await rl.question('Mechanic (lines|ways|cluster|anywhere|custom) [cluster]: ')).trim() || 'cluster')) as Mechanic;
    const gridStr = (await rl.question('Grid colsxrows [default for mechanic]: ')).trim();
    const grid = seed.grid ?? (gridStr ? { cols: Number(gridStr.split('x')[0]), rows: Number(gridStr.split('x')[1]) } : undefined);
    const stakeAns = seed.stake ?? ((await rl.question('Stake integration? (Y/n): ')).trim().toLowerCase() !== 'n');
    return applyDefaults({ id, title, mechanic, grid, stake: stakeAns });
  } finally {
    rl.close();
  }
}
