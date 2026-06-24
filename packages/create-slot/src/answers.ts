export type Mechanic = 'lines' | 'ways' | 'cluster' | 'anywhere' | 'custom';
export interface Answers {
  id: string;
  title: string;
  mechanic: Mechanic;
  grid: { cols: number; rows: number };
  stake: boolean;
  cascades?: boolean;
}

const DEFAULT_GRID: Record<Mechanic, { cols: number; rows: number }> = {
  lines: { cols: 5, rows: 3 },
  ways: { cols: 5, rows: 3 },
  cluster: { cols: 7, rows: 7 },
  anywhere: { cols: 5, rows: 4 },
  custom: { cols: 6, rows: 6 },
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
    else if (a === '--cascades') out.cascades = true;
    else if (a === '--no-cascades') out.cascades = false;
    else if (a === '--stake') out.stake = true;
    else if (a === '--no-stake') out.stake = false;
  }
  return out;
}

export function applyDefaults(partial: Partial<Answers>): Answers {
  const mechanic = partial.mechanic ?? 'cluster';
  return {
    id: partial.id ?? '',
    title: partial.title ?? titleCase(partial.id ?? ''),
    mechanic,
    grid: partial.grid ?? DEFAULT_GRID[mechanic],
    stake: partial.stake ?? true,
    cascades: partial.cascades ?? (mechanic !== 'lines'),
  };
}

export function validate(a: Answers): void {
  if (!/^[a-z][a-z0-9-]*$/.test(a.id)) throw new Error(`invalid id (must be kebab-case): "${a.id}"`);
  if (!['lines', 'ways', 'cluster', 'anywhere', 'custom'].includes(a.mechanic)) throw new Error(`invalid mechanic: "${a.mechanic}"`);
  if (a.grid.cols <= 0 || a.grid.rows <= 0) throw new Error('grid dimensions must be > 0');
}

/** Flags that consume the next token as their value — used to skip those tokens during positional scan. */
const VALUE_FLAGS = new Set(['--id', '--title', '--mechanic', '--grid']);

/**
 * Build an answers seed from argv: flags, plus a lone positional used as
 * the id when --id is absent. Correctly skips tokens that are values of
 * known value-taking flags (e.g. `--mechanic cluster` — `cluster` is NOT
 * treated as a positional even when no --id is supplied).
 */
export function seedFromArgv(argv: string[]): Partial<Answers> {
  // Normalize --flag=value to ['--flag', 'value'] for uniform processing
  const args: string[] = [];
  for (const tok of argv) {
    if (tok.startsWith('--') && tok.includes('=')) {
      const i = tok.indexOf('=');
      args.push(tok.slice(0, i), tok.slice(i + 1));
    } else {
      args.push(tok);
    }
  }

  // Collect indices that are consumed as flag values so we don't
  // accidentally treat them as positionals.
  const valueIndices = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i]) && i + 1 < args.length) {
      valueIndices.add(i + 1);
    }
  }

  const flags = parseFlags(argv);

  if (!flags.id) {
    const positional = args.find((a, idx) => !a.startsWith('--') && !valueIndices.has(idx));
    if (positional) flags.id = positional;
  }

  return flags;
}
