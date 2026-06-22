export type Mechanic = 'cascade' | 'lines' | 'ways';
export interface Answers {
  id: string;
  title: string;
  mechanic: Mechanic;
  grid: { cols: number; rows: number };
  stake: boolean;
}

const DEFAULT_GRID: Record<Mechanic, { cols: number; rows: number }> = {
  cascade: { cols: 6, rows: 6 },
  lines: { cols: 5, rows: 3 },
  ways: { cols: 5, rows: 3 },
};

function titleCase(id: string): string {
  return id.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export function parseFlags(argv: string[]): Partial<Answers> {
  // normalize --flag=value → --flag value
  const args: string[] = [];
  for (const tok of argv) {
    if (tok.startsWith('--') && tok.includes('=')) {
      const i = tok.indexOf('=');
      args.push(tok.slice(0, i), tok.slice(i + 1));
    } else {
      args.push(tok);
    }
  }

  const out: Partial<Answers> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--id') out.id = args[++i];
    else if (a === '--title') out.title = args[++i];
    else if (a === '--mechanic') out.mechanic = args[++i] as Mechanic;
    else if (a === '--grid') { const [c, r] = args[++i].split('x').map(Number); out.grid = { cols: c, rows: r }; }
    else if (a === '--stake') out.stake = true;
    else if (a === '--no-stake') out.stake = false;
  }
  return out;
}

export function applyDefaults(partial: Partial<Answers>): Answers {
  const mechanic = partial.mechanic ?? 'cascade';
  return {
    id: partial.id ?? '',
    title: partial.title ?? titleCase(partial.id ?? ''),
    mechanic,
    grid: partial.grid ?? DEFAULT_GRID[mechanic],
    stake: partial.stake ?? true,
  };
}

export function validate(a: Answers): void {
  if (!/^[a-z][a-z0-9-]*$/.test(a.id)) throw new Error(`invalid id (must be kebab-case): "${a.id}"`);
  if (!['cascade', 'lines', 'ways'].includes(a.mechanic)) throw new Error(`invalid mechanic: "${a.mechanic}"`);
  if (a.grid.cols <= 0 || a.grid.rows <= 0) throw new Error('grid dimensions must be > 0');
}
