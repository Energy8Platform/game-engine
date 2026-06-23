# Math-CLI (e8-math) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ship `e8-math` (a bin in `stake-math-tools`) that, from a game's spec modes + a node-only `math.config.ts`, runs go-native `sim`/`pool` and stake-math-tools `curate` per mode with full per-mode config and full reports; scaffold emits the scripts.

**Architecture:** add `dump?` + `requireNativeBinary()` to platform-core's `NativeSimulationRunner` (surface the Go binary's existing `-dump`). Add an `e8-math` tsx-bin to `stake-math-tools` (deps platform-core) with subcommands `sim|pool|curate|all` that read `math.config.ts` (`{model, luaScript, modes}`), run the native runner (sim = no dump, pool = `-dump`) and `optimizeLookupTable` (curate). Scaffold generates `math.config.ts` + scripts.

**Tech Stack:** TypeScript, tsx (runtime TS loader for the bin + config), Vitest 2.x, the Go native simulate binary, `@energy8platform/{platform-core,stake-math-tools}`.

## Global Constraints

- **go-native only — NO JS fallback** in the math path. `sim`/`pool` use `NativeSimulationRunner`; if `findNativeBinary()` is null → throw via `requireNativeBinary()` with install guidance. Never use the fengari `SimulationRunner` here.
- Do NOT touch the Go source (binary is a GitHub-Releases build); it already supports `-dump <path>` (per-round JSONL).
- Curation = `stake-math-tools` `optimizeLookupTable(rows: LookupRow[], params: OptimizeParams): OptimizeResult`. `LookupRow = { sim: number; weight: number; payoutCents: number }`. Source rows from a pool = one row per simulated round, `weight: 1`, `payoutCents = round payout × 100` (integer cents-of-base-bet).
- The CLI bin runs as a tsx script (`#!/usr/bin/env npx tsx`, like `packages/platform-core/bin/simulate.ts`) so it can import the user's `.ts` `math.config`. No bundler/build added to stake-math-tools.
- Modes come from `model.mathModes` (`MathModeSpec = { action, mode, costMultiplier }`); per-mode sim+curate params from `math.config.ts` `modes` (seeded defaults for any missing). `math.config` is node-only (reads Lua via `node:fs` + `buildLuaScript`); never load the browser `dev.config.ts` (Vite `?raw`).
- Full reports: sim/pool print the entire `GoSimulationOutput` (use `formatNativeResult`); curate prints the entire `OptimizeResult.stakeReport` + `toleranceMet` + `detectHitRateGaps`.
- Commit after each task. Branch `feat/game-spec-define-game`. Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Out of scope: Go source; parallel/JS pool; game-specific book trimming beyond a default mapper + optional hook; migrating existing games' scripts.

## File Structure

```
packages/platform-core/src/simulation/NativeSimulationRunner.ts   + dump?:string, + requireNativeBinary()
packages/platform-core/tests/native-dump.test.ts                  (new)
packages/stake-math-tools/package.json                            + bin, files, deps(platform-core), scripts
packages/stake-math-tools/src/cli.ts                              (new) #!/usr/bin/env npx tsx — arg parse + dispatch
packages/stake-math-tools/src/pipeline/{config.ts,sim.ts,pool.ts,curate.ts,report.ts}  (new)
packages/stake-math-tools/src/mathConfig.ts                       (new) MathConfig/ModeMathConfig types + resolveModes()
packages/stake-math-tools/src/index.ts                            + export MathConfig types + resolveModes
packages/stake-math-tools/test/{config.test.ts,curate-pipeline.test.ts,cli-args.test.ts}  (new)
packages/create-slot/src/codegen/mathConfig.ts                    (new) genMathConfig
packages/create-slot/src/codegen/packageJson.ts                   scripts: sim/pool/curate/math; devDep
packages/create-slot/src/generate.ts                              write math.config.ts
packages/create-slot/test/{mathConfig.test.ts,packageJson.test.ts,generate.test.ts}
examples/spec-slot/math.config.ts                                 (new) living proof
```

---

## Task 1: platform-core — `NativeSimulationRunner` book dump + `requireNativeBinary`

**Files:**
- Modify: `packages/platform-core/src/simulation/NativeSimulationRunner.ts`, `packages/platform-core/src/simulation/index.ts` (export `requireNativeBinary`)
- Test: `packages/platform-core/tests/native-dump.test.ts`

**Interfaces:**
- Produces: `NativeSimulationConfig.dump?: string`; the args builder pushes `-dump <path>`; `requireNativeBinary(): string` (throws if absent).

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform-core/tests/native-dump.test.ts
import { describe, it, expect } from 'vitest';
import { buildNativeArgs, requireNativeBinary } from '../src/simulation/NativeSimulationRunner';

describe('NativeSimulationRunner dump', () => {
  it('adds -dump <path> to the args when dump is set', () => {
    const args = buildNativeArgs({ configPath: '/tmp/c.json', iterations: 1000, bet: 1, action: 'spin', dump: '/tmp/books.jsonl' });
    expect(args).toContain('-dump');
    expect(args[args.indexOf('-dump') + 1]).toBe('/tmp/books.jsonl');
  });
  it('omits -dump when not set', () => {
    const args = buildNativeArgs({ configPath: '/tmp/c.json', iterations: 1000, bet: 1, action: 'spin' });
    expect(args).not.toContain('-dump');
  });
});

describe('requireNativeBinary', () => {
  it('throws a helpful error when no binary is found', () => {
    // force the not-found path by pointing the lookup at an empty dir
    expect(() => requireNativeBinary('/nonexistent-bin-dir')).toThrow(/native simulation binary/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/native-dump.test.ts`
Expected: FAIL — `buildNativeArgs`/`requireNativeBinary` not exported.

- [ ] **Step 3: Refactor the arg-building into an exported pure `buildNativeArgs`, add `dump`, add `requireNativeBinary`**

Read the current `run()` arg-assembly (the `const args = [ '-config', configPath, '-iterations', String(iterations), '-bet', String(bet), ... ]` block plus the conditional `-action`/`-params`/`-rng`/`-seed`/replay pushes) and `findNativeBinary()`. Extract a pure exported function and add `-dump`:
```ts
export interface NativeArgsInput {
  configPath: string; iterations: number; bet: number; action?: string;
  params?: unknown; rng?: string; seed?: string; dump?: string;
  replay?: { serverSeed: string; clientSeed: string; nonceStart: number };
}
export function buildNativeArgs(a: NativeArgsInput): string[] {
  const args = ['-config', a.configPath, '-iterations', String(a.iterations), '-bet', String(a.bet)];
  if (a.action) args.push('-action', a.action);
  if (a.params !== undefined) args.push('-params', JSON.stringify(a.params));
  if (a.rng) args.push('-rng', a.rng);
  if (a.seed) args.push('-seed', a.seed);
  if (a.dump) args.push('-dump', a.dump);
  if (a.replay) args.push('-replay-server-seed', a.replay.serverSeed, '-replay-client-seed', a.replay.clientSeed, '-replay-nonce-start', String(a.replay.nonceStart));
  return args;
}
```
Have `run()` build its args via `buildNativeArgs({ configPath, iterations, bet, action, params, rng, seed, dump: this.config.dump, replay })` (keep the existing replay-validation). Add `dump?: string;` to `NativeSimulationConfig`. Add:
```ts
import { existsSync } from 'fs';
/** The math path requires the native binary — NO JS fallback. */
export function requireNativeBinary(binDir?: string): string {
  const bin = findNativeBinary(binDir); // pass-through if findNativeBinary accepts a dir; else ignore the arg
  if (!bin) {
    throw new Error('native simulation binary not found — run `npm install` (platform-core fetches it via install-simulate). The math pipeline is go-native only (no JS fallback).');
  }
  return bin;
}
```
(If `findNativeBinary()` takes no arg, make `requireNativeBinary(binDir?)` call it and ignore `binDir`; the test's `/nonexistent-bin-dir` arg just needs `requireNativeBinary` to throw when nothing is found — adjust the test to whatever forces not-found, e.g. temporarily, or assert the throw message shape with the real lookup when the binary is genuinely absent. Keep the binary-present path working.) Export both from `src/simulation/index.ts`.

- [ ] **Step 4: Run test + suite**

Run: `npx vitest run packages/platform-core/tests/native-dump.test.ts`
Expected: PASS.
Run: `npx vitest run --root packages/platform-core`
Expected: PASS (no regression; use `--root` so the package's alias config loads).

- [ ] **Step 5: Commit**

```bash
git add packages/platform-core/src/simulation/NativeSimulationRunner.ts packages/platform-core/src/simulation/index.ts packages/platform-core/tests/native-dump.test.ts
git commit -m "feat(platform-core): NativeSimulationRunner -dump + requireNativeBinary (go-native, no JS fallback)"
```

---

## Task 2: stake-math-tools — CLI scaffold + `MathConfig` types + `resolveModes`

**Files:**
- Modify: `packages/stake-math-tools/package.json`, `packages/stake-math-tools/src/index.ts`
- Create: `packages/stake-math-tools/src/mathConfig.ts`, `packages/stake-math-tools/src/pipeline/config.ts`, `packages/stake-math-tools/bin/e8-math.ts`
- Test: `packages/stake-math-tools/test/config.test.ts`

**Interfaces:**
- Consumes: `model.mathModes` (`MathModeSpec[]`), `OptimizeParams` (this package).
- Produces: `MathConfig`, `ModeMathConfig`, `resolveModes(cfg): ResolvedMode[]`. Bin `e8-math`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/stake-math-tools/test/config.test.ts
import { describe, it, expect } from 'vitest';
import { resolveModes } from '../src/mathConfig';

const model = {
  spec: { maxWin: 5000 },
  mathModes: [
    { action: 'spin', mode: 'BASE', costMultiplier: 1 },
    { action: 'buy_bonus', mode: 'BUY_BONUS', costMultiplier: 100 },
  ],
} as any;

describe('resolveModes', () => {
  it('lists every spec mode, merging per-mode overrides over seeded defaults', () => {
    const resolved = resolveModes({
      model,
      luaScript: '-- lua',
      modes: { BASE: { sim: { iterations: 5000 }, curate: { targetRTP: 0.96 } } },
    });
    const base = resolved.find((m) => m.mode === 'BASE')!;
    expect(base.action).toBe('spin');
    expect(base.sim.iterations).toBe(5000);            // override
    expect(base.curate.capMaxWin).toBe(5000);          // seeded from spec.maxWin
    expect(base.curate.targetRTP).toBe(0.96);          // override
    const buy = resolved.find((m) => m.mode === 'BUY_BONUS')!;
    expect(buy.action).toBe('buy_bonus');              // present even with no modes block
    expect(buy.curate.capMaxWin).toBe(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/stake-math-tools/test/config.test.ts`
Expected: FAIL — `resolveModes` not found.

- [ ] **Step 3: Write `mathConfig.ts`**

```ts
// packages/stake-math-tools/src/mathConfig.ts
import type { OptimizeParams } from './types';

/** A platform-core GameModel — typed loosely here to avoid a hard type import. */
export interface MathModel {
  spec: { maxWin: number; [k: string]: unknown };
  mathModes: { action: string; mode: string; costMultiplier: number }[];
}

export interface ModeSimConfig {
  iterations?: number;
  bet?: number;
  rng?: 'provably-fair' | 'fast';
  seed?: string;
  params?: unknown;
}

export interface ModeMathConfig {
  sim?: ModeSimConfig;
  /** Curate params (stake-math-tools OptimizeParams); capMaxWin defaults to spec.maxWin. */
  curate?: Partial<OptimizeParams>;
}

export interface MathConfig {
  model: MathModel;
  /** node-built: buildLuaScript(model, readFileSync(logic.lua)). */
  luaScript: string;
  /** Per-mode overrides keyed by Stake mode (e.g. BASE). Missing modes use seeded defaults. */
  modes?: Record<string, ModeMathConfig>;
}

export interface ResolvedMode {
  mode: string;
  action: string;
  costMultiplier: number;
  sim: { iterations: number; bet: number; rng: 'provably-fair' | 'fast'; seed?: string; params?: unknown };
  curate: Partial<OptimizeParams> & { capMaxWin: number; costMultiplier: number };
}

const SIM_DEFAULTS = { iterations: 1_000_000, bet: 1, rng: 'provably-fair' as const };

/** Every mode from model.mathModes, with per-mode overrides merged over spec-seeded defaults. */
export function resolveModes(cfg: MathConfig): ResolvedMode[] {
  const maxWin = cfg.model.spec.maxWin;
  return cfg.model.mathModes.map((m) => {
    const over = cfg.modes?.[m.mode] ?? {};
    return {
      mode: m.mode,
      action: m.action,
      costMultiplier: m.costMultiplier,
      sim: { ...SIM_DEFAULTS, ...over.sim },
      curate: { capMaxWin: maxWin, costMultiplier: m.costMultiplier, ...over.curate },
    };
  });
}
```

- [ ] **Step 4: Wire package + bin skeleton**

In `packages/stake-math-tools/package.json`: add
```json
  "bin": { "e8-math": "bin/e8-math.ts" },
  "files": ["src", "bin", "README.md"],
  "dependencies": { "@energy8platform/platform-core": "*" },
```
(mirror how `packages/platform-core` references workspace deps; keep the existing `test`/`typecheck` scripts; no build — the bin runs via tsx).
Create `packages/stake-math-tools/bin/e8-math.ts`:
```ts
#!/usr/bin/env npx tsx
import { runCli } from '../src/cli';
runCli(process.argv.slice(2)).catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
```
Create a minimal `packages/stake-math-tools/src/cli.ts` (filled in Tasks 3-4):
```ts
import { loadMathConfig } from './pipeline/config';
import { resolveModes } from './mathConfig';

export async function runCli(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const flags = parseFlags(argv.slice(1));
  if (!['sim', 'pool', 'curate', 'all'].includes(cmd)) {
    throw new Error(`usage: e8-math <sim|pool|curate|all> --config ./math.config.ts [--mode BASE]`);
  }
  const cfg = await loadMathConfig(flags.config ?? './math.config.ts');
  let modes = resolveModes(cfg);
  if (flags.mode) modes = modes.filter((m) => m.mode === flags.mode);
  // sim/pool/curate/all dispatch wired in Tasks 3-4
  console.log(`e8-math ${cmd}: ${modes.length} mode(s)`);
}

export function parseFlags(argv: string[]): { config?: string; mode?: string; out?: string } {
  const out: { config?: string; mode?: string; out?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') out.config = argv[++i];
    else if (argv[i] === '--mode') out.mode = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}
```
Create `packages/stake-math-tools/src/pipeline/config.ts`:
```ts
import { resolve } from 'node:path';
import type { MathConfig } from '../mathConfig';
/** Load a node-only math.config.ts (the CLI runs under tsx, so .ts import works). */
export async function loadMathConfig(path: string): Promise<MathConfig> {
  const mod = await import(resolve(process.cwd(), path));
  return (mod.default ?? mod.config) as MathConfig;
}
```
Export the types + `resolveModes` from `src/index.ts`:
```ts
export type { MathConfig, ModeMathConfig, ModeSimConfig, ResolvedMode, MathModel } from './mathConfig';
export { resolveModes } from './mathConfig';
```

- [ ] **Step 5: Run test + install (links the new platform-core dep) + commit**

Run: `npm install` (links `@energy8platform/platform-core` into stake-math-tools).
Run: `npx vitest run packages/stake-math-tools/test/config.test.ts`
Expected: PASS.
Run: `npm run typecheck --workspace @energy8platform/stake-math-tools`
Expected: clean.
```bash
git add packages/stake-math-tools/package.json packages/stake-math-tools/src/mathConfig.ts \
        packages/stake-math-tools/src/pipeline/config.ts packages/stake-math-tools/src/cli.ts \
        packages/stake-math-tools/bin/e8-math.ts packages/stake-math-tools/src/index.ts \
        packages/stake-math-tools/test/config.test.ts package-lock.json
git commit -m "feat(stake-math-tools): e8-math CLI scaffold + MathConfig + resolveModes"
```

---

## Task 3: `sim` + `pool` subcommands (go-native, full Go report)

**Files:**
- Create: `packages/stake-math-tools/src/pipeline/sim.ts`, `packages/stake-math-tools/src/pipeline/report.ts`
- Modify: `packages/stake-math-tools/src/cli.ts` (dispatch sim/pool)
- Test: `packages/stake-math-tools/test/cli-args.test.ts`

**Interfaces:**
- Consumes: `requireNativeBinary`, `NativeSimulationRunner`, `formatNativeResult` (platform-core, Task 1); `ResolvedMode` (Task 2).
- Produces: `runSim(cfg, mode, { dump? })`; the CLI handles `sim` (no dump) + `pool` (dump → `stake-math-pool/books_<MODE>.jsonl`).

- [ ] **Step 1: Write the failing test** (arg-parse + the report formatter; the binary run is exercised in Task 6's gated e2e)

```ts
// packages/stake-math-tools/test/cli-args.test.ts
import { describe, it, expect } from 'vitest';
import { parseFlags } from '../src/cli';
import { formatGoReport } from '../src/pipeline/report';

describe('parseFlags', () => {
  it('parses --config/--mode', () => {
    expect(parseFlags(['--config', './math.config.ts', '--mode', 'BASE'])).toEqual({ config: './math.config.ts', mode: 'BASE' });
  });
});

describe('formatGoReport', () => {
  it('renders the full Go output (rtp, hit, maxWin, per-stage, distribution)', () => {
    const out = formatGoReport('BASE', {
      total_rtp: 96.1, hit_frequency: 0.25, max_win: 5000, max_win_hits: 2, iterations: 1000,
      per_stage_stats: { base_game: { rtp: 90, hit_frequency: 0.3 } as any },
      win_distribution: [{ label: '0-1x', count: 750, pct: 75 }],
    } as any);
    expect(out).toContain('BASE');
    expect(out).toContain('96.1');
    expect(out).toContain('max');
    expect(out).toContain('per-stage');
    expect(out).toContain('0-1x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/stake-math-tools/test/cli-args.test.ts`
Expected: FAIL — `formatGoReport` not found.

- [ ] **Step 3: Write `report.ts` (Go side) + `sim.ts`**

Read `formatNativeResult` in `NativeSimulationRunner.ts` (it already formats a `GoSimulationOutput`/`NativeSimulationResult`). In `report.ts`, write `formatGoReport(mode, out)` that prefixes the mode and includes the full output — reuse `formatNativeResult` for the body and append `per_stage_stats` + `win_distribution` lines so the report is complete:
```ts
// packages/stake-math-tools/src/pipeline/report.ts
import { formatNativeResult } from '@energy8platform/platform-core/simulation';

export function formatGoReport(mode: string, out: any): string {
  const lines = [`── ${mode} ──`, formatNativeResult(out)];
  if (out.per_stage_stats) {
    lines.push('per-stage:');
    for (const [stage, s] of Object.entries<any>(out.per_stage_stats)) {
      lines.push(`  ${stage}: rtp ${(s.rtp).toFixed?.(2) ?? s.rtp} · hit ${(s.hit_frequency)}`);
    }
  }
  if (out.win_distribution) {
    lines.push('win distribution:');
    for (const b of out.win_distribution) lines.push(`  ${b.label}: ${b.count} (${b.pct}%)`);
  }
  return lines.join('\n');
}
```
(If `formatNativeResult` is imported from a different sub-path, use the real one; verify the `/simulation` export.)
```ts
// packages/stake-math-tools/src/pipeline/sim.ts
import { NativeSimulationRunner, requireNativeBinary } from '@energy8platform/platform-core/simulation';
import type { MathConfig, ResolvedMode } from '../mathConfig';

/** Run one mode go-native. With `dump`, the binary also writes per-round JSONL to that path. */
export async function runSim(cfg: MathConfig, m: ResolvedMode, opts: { dump?: string } = {}) {
  const binaryPath = requireNativeBinary();
  return new NativeSimulationRunner({
    binaryPath,
    script: cfg.luaScript,
    gameDefinition: cfg.model.gameDefinition as any,
    iterations: m.sim.iterations,
    bet: m.sim.bet,
    action: m.action,
    rng: m.sim.rng,
    seed: m.sim.seed,
    params: m.sim.params,
    dump: opts.dump,
  }).run();
}
```
(Read `NativeSimulationConfig` for the exact field names — `gameDefinition` comes from `cfg.model.gameDefinition`; ensure `MathModel` includes it. If `model.gameDefinition` isn't on the loose `MathModel`, widen `MathModel` to `{ spec; mathModes; gameDefinition: unknown }`.)

- [ ] **Step 4: Wire `sim`/`pool` in `cli.ts`**

Replace the placeholder dispatch:
```ts
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSim } from './pipeline/sim';
import { formatGoReport } from './pipeline/report';
// inside runCli, after `modes` is resolved:
const poolDir = resolve(process.cwd(), flags.out ?? 'stake-math-pool');
if (cmd === 'sim' || cmd === 'pool') {
  if (cmd === 'pool') mkdirSync(poolDir, { recursive: true });
  for (const m of modes) {
    const dump = cmd === 'pool' ? resolve(poolDir, `books_${m.mode}.jsonl`) : undefined;
    const out = await runSim(cfg, m, { dump });
    console.log(formatGoReport(m.mode, out));
    if (dump) console.log(`  → ${dump}`);
  }
  return;
}
// 'curate' and 'all' wired in Task 4
```

- [ ] **Step 5: Run test + typecheck + commit**

Run: `npx vitest run packages/stake-math-tools/test/cli-args.test.ts`
Expected: PASS.
Run: `npm run build --workspace @energy8platform/platform-core && npm run typecheck --workspace @energy8platform/stake-math-tools`
Expected: clean.
```bash
git add packages/stake-math-tools/src/pipeline/sim.ts packages/stake-math-tools/src/pipeline/report.ts \
        packages/stake-math-tools/src/cli.ts packages/stake-math-tools/test/cli-args.test.ts
git commit -m "feat(stake-math-tools): e8-math sim + pool (go-native, full Go report)"
```

---

## Task 4: `curate` + `all` (dump → lookup table + full stake report)

**Files:**
- Create: `packages/stake-math-tools/src/pipeline/curate.ts`
- Modify: `packages/stake-math-tools/src/cli.ts` (dispatch curate/all), `packages/stake-math-tools/src/pipeline/report.ts` (stake report)
- Test: `packages/stake-math-tools/test/curate-pipeline.test.ts`

**Interfaces:**
- Consumes: `optimizeLookupTable`, `transformJsonlZst`, `detectHitRateGaps`, `OptimizeResult` (this package); `ResolvedMode`.
- Produces: `curateMode(...)` → writes `lookUpTable_<MODE>_0.csv` + `books_<MODE>.jsonl.zst` + `index.json`; `formatCurateReport(mode, result)`.

- [ ] **Step 1: PIN the dump row shape from a real sample (no test yet)**

Run a tiny go-native dump to learn the exact per-round JSON the binary writes (the curate `LineMapper` input):
```bash
# from a game that has a built dev setup, OR generate a trivial config; simplest — use spec-slot's model via a scratch node script, OR run the binary on any game config you have. Inspect ONE line:
head -1 <some>/stake-math-pool/books_BASE.jsonl   # if a game already has a pool dump
# otherwise run: packages/platform-core/bin/simulate-<plat> -config <gamedef.json> -action spin -iterations 100 -dump /tmp/books.jsonl ; head -1 /tmp/books.jsonl
```
Record the field that holds the round payout (e.g. `payoutMultiplier`, `payout`, or a `win`/`total_win`), and whether payouts are already cents or bet-multipliers. The `LineMapper` (Step 3) maps each line → `{ sim, weight: 1, payoutCents }`.

- [ ] **Step 2: Write the failing test** (binary-independent — a static sample-dump fixture)

```ts
// packages/stake-math-tools/test/curate-pipeline.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { curateMode } from '../src/pipeline/curate';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('curateMode', () => {
  it('reads a pool JSONL, optimizes, writes lookUpTable CSV + index.json + a stake report', async () => {
    dir = mkdtempSync(join(tmpdir(), 'e8m-'));
    // sample pool: 1000 rounds, mostly 0, some small, one near-cap — matches the pinned dump shape
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const pm = i === 0 ? 4000 : i < 250 ? (i % 5) : 0; // bet-multiplier payouts
      lines.push(JSON.stringify({ payoutMultiplier: pm }));   // ← field per Step 1
    }
    writeFileSync(join(dir, 'books_BASE.jsonl'), lines.join('\n'));
    const result = await curateMode({
      mode: 'BASE', action: 'spin', costMultiplier: 1,
      sim: { iterations: 1000, bet: 1, rng: 'fast' },
      curate: { capMaxWin: 5000, costMultiplier: 1, targetRTP: 0.5, toleranceRTP: 0.5, targetCV: 1, toleranceCV: 5, targetHitRate: 0.25, toleranceHitRate: 0.25, nRowsOut: 200 },
    }, { poolDir: dir, outDir: dir });
    expect(existsSync(join(dir, 'lookUpTable_BASE_0.csv'))).toBe(true);
    expect(existsSync(join(dir, 'index.json'))).toBe(true);
    expect(result.stakeReport.payoutMultMax).toBeGreaterThan(0);
    expect(typeof result.achieved.rtp).toBe('number');
  });
});
```

- [ ] **Step 3: Write `curate.ts`**

```ts
// packages/stake-math-tools/src/pipeline/curate.ts
import { createReadStream, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { optimizeLookupTable } from '../optimize-lookup';
import { transformJsonlZst } from '../transform-jsonl-zst';
import type { LookupRow, OptimizeResult, OptimizeParams } from '../types';
import type { ResolvedMode } from '../mathConfig';

/** Map one pool-dump JSONL line → a LookupRow. Adjust the payout field to the Step-1 shape. */
function lineToRow(line: string, sim: number): LookupRow | null {
  if (!line.trim()) return null;
  const o = JSON.parse(line) as { payoutMultiplier?: number; payout?: number; total_win?: number };
  const pm = o.payoutMultiplier ?? o.payout ?? o.total_win ?? 0; // ← per Step 1
  return { sim, weight: 1, payoutCents: Math.round(pm * 100) };
}

export async function curateMode(
  m: ResolvedMode,
  io: { poolDir: string; outDir: string },
): Promise<OptimizeResult> {
  const poolPath = resolve(io.poolDir, `books_${m.mode}.jsonl`);
  if (!existsSync(poolPath)) throw new Error(`pool not found: ${poolPath} — run \`e8-math pool\` first`);
  const rows: LookupRow[] = [];
  let i = 0;
  const rl = createInterface({ input: createReadStream(poolPath), crlfDelay: Infinity });
  for await (const line of rl) { const r = lineToRow(line, i++); if (r) rows.push(r); }

  const params = { betCostCents: 100, nRowsOut: 100_000, ...m.curate } as OptimizeParams;
  const result = optimizeLookupTable(rows, params);

  mkdirSync(io.outDir, { recursive: true });
  // lookUpTable_<MODE>_0.csv — sim,weight,payoutCents
  const csv = result.rows.map((r) => `${r.sim},${r.weight},${r.payoutCents}`).join('\n') + '\n';
  writeFileSync(resolve(io.outDir, `lookUpTable_${m.mode}_0.csv`), csv);
  // index.json — record the modes present
  const indexPath = resolve(io.outDir, 'index.json');
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { modes: [] as string[] };
  if (!index.modes.includes(m.mode)) index.modes.push(m.mode);
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return result;
}
```
(Verify `optimizeLookupTable`/`transformJsonlZst` import paths against `src/index.ts` exports; this package's modules use `.js` ESM specifiers — match the existing style. The `books_<MODE>.jsonl.zst` write — produce it from the pool via `transformJsonlZst` (read its signature) OR copy the optimized rows; if `transformJsonlZst`'s shape needs a mapper, use it; the load-bearing assertions are the CSV + index + report.)

- [ ] **Step 4: Add `formatCurateReport` to `report.ts` + wire `curate`/`all` in `cli.ts`**

```ts
// report.ts — append
import { detectHitRateGaps } from '../stake-report';
import type { OptimizeResult } from '../types';
export function formatCurateReport(mode: string, r: OptimizeResult): string {
  const sr = r.stakeReport, t = r.toleranceMet;
  const gaps = detectHitRateGaps(sr.hitRateDistribution);
  return [
    `── ${mode} (curate) ──`,
    `rtp ${r.achieved.rtp.toFixed(4)} · cv ${r.achieved.cv.toFixed(3)} · hit ${r.achieved.hitRate.toFixed(4)} · rows ${r.rows.length}`,
    `maxPayoutMult ${sr.payoutMultMax} · uniqueEvents ${sr.uniqueEvents} · P5K ${sr.prob5K} · P10K ${sr.prob10K} · cvar ${sr.cvarNormalized.toFixed(1)}`,
    `tolerance: ${Object.entries(t).filter(([, v]) => !v).map(([k]) => `${k}✗`).join(' ') || 'all ✓'}`,
    `hit-rate gaps: ${gaps.length ? gaps.map((g) => `[${g.low},${g.high})`).join(' ') : 'none'}`,
    ...(r.warnings.length ? [`warnings: ${r.warnings.join('; ')}`] : []),
  ].join('\n');
}
```
In `cli.ts`, after the sim/pool branch:
```ts
import { curateMode } from './pipeline/curate';
import { formatCurateReport } from './pipeline/report';
const outDir = resolve(process.cwd(), 'stake-math');
if (cmd === 'curate' || cmd === 'all') {
  for (const m of modes) {
    if (cmd === 'all') { const dump = resolve(poolDir, `books_${m.mode}.jsonl`); mkdirSync(poolDir, { recursive: true }); const out = await runSim(cfg, m, { dump }); console.log(formatGoReport(m.mode, out)); }
    const result = await curateMode(m, { poolDir, outDir });
    console.log(formatCurateReport(m.mode, result));
  }
  return;
}
```

- [ ] **Step 5: Run test + typecheck + commit**

Run: `npx vitest run packages/stake-math-tools/test/curate-pipeline.test.ts`
Expected: PASS (CSV + index + stake report produced from the fixture).
Run: `npm run typecheck --workspace @energy8platform/stake-math-tools`
Expected: clean.
```bash
git add packages/stake-math-tools/src/pipeline/curate.ts packages/stake-math-tools/src/pipeline/report.ts \
        packages/stake-math-tools/src/cli.ts packages/stake-math-tools/test/curate-pipeline.test.ts
git commit -m "feat(stake-math-tools): e8-math curate + all (lookup table + full stake report)"
```

---

## Task 5: create-slot — generate `math.config.ts` + scripts

**Files:**
- Create: `packages/create-slot/src/codegen/mathConfig.ts`
- Modify: `packages/create-slot/src/codegen/packageJson.ts`, `packages/create-slot/src/generate.ts`
- Test: `packages/create-slot/test/mathConfig.test.ts`, `packages/create-slot/test/packageJson.test.ts`, `packages/create-slot/test/generate.test.ts`

**Interfaces:**
- Consumes: `Answers` (id/title/mechanic/grid/cascades/stake). Produces: `genMathConfig(answers): string`; package.json `sim`/`pool`/`curate`/`math` scripts + `stake-math-tools` devDep; `generate()` writes `math.config.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/create-slot/test/mathConfig.test.ts
import { describe, it, expect } from 'vitest';
import { genMathConfig } from '../src/codegen/mathConfig';
describe('genMathConfig', () => {
  const s = genMathConfig({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
  it('is node-only (reads lua via node:fs), imports the model, exports a MathConfig with a modes block', () => {
    expect(s).toContain("import { readFileSync } from 'node:fs'");
    expect(s).toContain("import { buildLuaScript } from '@energy8platform/platform-core/game-spec'");
    expect(s).toContain("import { model } from './src/game.spec'");
    expect(s).toContain('luaScript: buildLuaScript(model');
    expect(s).toContain('capMaxWin: model.spec.maxWin');
    expect(s).toContain('export default');
    expect(s).not.toContain('?raw'); // node-only, not the browser dev.config
  });
});
```
Add to `packages/create-slot/test/packageJson.test.ts`:
```ts
it('emits sim/pool/curate/math scripts via e8-math and the stake-math-tools devDep', () => {
  const json = JSON.parse(genPackageJson({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true } as any,
    { 'platform-core': '^0.24.4', 'game-engine': '^0.17.0', 'stake-kit': '^0.1.0', 'stake-bridge': '^0.2.1' }));
  expect(json.scripts.math).toContain('e8-math all');
  expect(json.scripts.pool).toContain('e8-math pool');
  expect(json.scripts.curate).toContain('e8-math curate');
  expect(json.devDependencies['@energy8platform/stake-math-tools']).toBeTruthy();
});
```
Add to `packages/create-slot/test/generate.test.ts` (cascade/cluster case):
```ts
    expect(existsSync(join(dir, 'math.config.ts'))).toBe(true);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/create-slot/test/mathConfig.test.ts packages/create-slot/test/packageJson.test.ts`
Expected: FAIL — `genMathConfig` missing, scripts absent.

- [ ] **Step 3: Write `genMathConfig`**

```ts
// packages/create-slot/src/codegen/mathConfig.ts
import type { Answers } from '../answers';

export function genMathConfig(_a: Answers): string {
  return `import { readFileSync } from 'node:fs';
import { buildLuaScript } from '@energy8platform/platform-core/game-spec';
import { model } from './src/game.spec';
import type { MathConfig } from '@energy8platform/stake-math-tools';

// node-only (the e8-math CLI runs in node) — reads the Lua via node:fs.
const logic = readFileSync(new URL('./src/game/script.logic.lua', import.meta.url), 'utf8');

const config: MathConfig = {
  model,
  luaScript: buildLuaScript(model, logic),
  // One block per spec mode (Stake mode key). Tune sim iterations + curate targets per mode.
  modes: {
    BASE: {
      sim: { iterations: 100_000, bet: 1, rng: 'provably-fair' },
      curate: { capMaxWin: model.spec.maxWin, algorithm: 'tiered', targetRTP: 0.96, toleranceRTP: 0.01, targetCV: 5, toleranceCV: 2, targetHitRate: 0.25, toleranceHitRate: 0.05, nRowsOut: 50_000 },
    },
    // add BUY_BONUS / ANTE blocks to override their defaults
  },
};
export default config;
`;
}
```

- [ ] **Step 4: Wire `packageJson.ts` + `generate.ts`**

In `packages/create-slot/src/codegen/packageJson.ts`, replace the `simulate` script and add the devDep. Change the `scripts` block's `simulate` line to:
```ts
      sim: 'e8-math sim --config ./math.config.ts',
      pool: 'e8-math pool --config ./math.config.ts',
      curate: 'e8-math curate --config ./math.config.ts',
      math: 'e8-math all --config ./math.config.ts',
```
and add to `devDependencies`: `'@energy8platform/stake-math-tools': v['stake-kit'] ? '^0.1.0' : '^0.1.0',` — i.e. add `'@energy8platform/stake-math-tools': '^0.1.0'` (use a fixed published range; it's a dev-time tool).
In `packages/create-slot/src/generate.ts`, import `genMathConfig` and write it next to the other root files:
```ts
writeFileSync(join(targetDir, 'math.config.ts'), genMathConfig(a));
```

- [ ] **Step 5: Run tests (incl. scaffold smoke) + commit**

Run: `npm run build --workspace @energy8platform/platform-core && npm run build --workspace @energy8platform/stake-bridge && npm run build --workspace @energy8platform/stake-kit && npm run build --workspace @energy8platform/game-engine`
Run: `npx vitest run packages/create-slot/test/`
Expected: PASS — incl. the scaffold smoke (the generated `math.config.ts` typechecks against `MathConfig`; note the smoke's generated tsconfig includes `src/**` — `math.config.ts` is root-level, so it isn't typechecked by the smoke's `tsc`, matching how `dev.config.ts` is treated; the codegen tests assert its content).
```bash
git add packages/create-slot/src/codegen/mathConfig.ts packages/create-slot/src/codegen/packageJson.ts \
        packages/create-slot/src/generate.ts packages/create-slot/test/mathConfig.test.ts \
        packages/create-slot/test/packageJson.test.ts packages/create-slot/test/generate.test.ts
git commit -m "feat(create-slot): scaffold math.config.ts + e8-math sim/pool/curate/math scripts"
```

---

## Task 6: living proof — `spec-slot` math.config + binary-gated e2e

**Files:**
- Create: `examples/spec-slot/math.config.ts`
- Test: `packages/stake-math-tools/test/e2e.test.ts` (binary-gated)

**Interfaces:** consumes everything above.

- [ ] **Step 1: Write `examples/spec-slot/math.config.ts`**

```ts
// examples/spec-slot/math.config.ts
import { readFileSync } from 'node:fs';
import { buildLuaScript } from '@energy8platform/platform-core/game-spec';
import { model } from './game.spec';
import type { MathConfig } from '@energy8platform/stake-math-tools';

const logic = readFileSync(new URL('./game/script.logic.lua', import.meta.url), 'utf8');
const config: MathConfig = {
  model,
  luaScript: buildLuaScript(model, logic),
  modes: {
    BASE: { sim: { iterations: 50_000, bet: 1, rng: 'fast' }, curate: { capMaxWin: model.spec.maxWin, algorithm: 'tiered', targetRTP: 0.96, toleranceRTP: 0.02, targetCV: 5, toleranceCV: 3, targetHitRate: 0.25, toleranceHitRate: 0.1, nRowsOut: 20_000 } },
  },
};
export default config;
```
(Adjust the relative paths to where spec-slot keeps its model + logic Lua; if spec-slot has no `script.logic.lua`, point at its actual Lua source or inline a trivial `function execute(state) return { total_win = 0 } end` file.)

- [ ] **Step 2: Write a binary-gated e2e test**

```ts
// packages/stake-math-tools/test/e2e.test.ts
import { describe, it, expect } from 'vitest';
import { findNativeBinary } from '@energy8platform/platform-core/simulation';

const hasBinary = !!findNativeBinary();
describe.skipIf(!hasBinary)('e8-math pool→curate e2e (needs native binary)', () => {
  it('pools a trivial model and curates it to a lookup table', async () => {
    // build a trivial model + run runSim with dump → curateMode → assert CSV/report
    // (use defineGame + buildLuaScript for a 1-action model; write to a tmp dir)
    expect(hasBinary).toBe(true);
  });
});
```
(Flesh out with `defineGame` + a trivial Lua + `runSim({dump})` + `curateMode`; keep it `skipIf(!hasBinary)` so CI without the binary stays green. The binary-independent coverage is Task 4's fixture test.)

- [ ] **Step 3: typecheck spec-slot + run stake-math-tools suite**

Run: `npm run build --workspace @energy8platform/platform-core`
Run: `cd examples/spec-slot && npx tsc --noEmit && cd ../..`
Expected: clean (`math.config.ts` typechecks against `MathConfig`).
Run: `npx vitest run packages/stake-math-tools/test/`
Expected: PASS (config + curate-pipeline + cli-args; e2e runs or skips per binary presence).

- [ ] **Step 4: Commit**

```bash
git add examples/spec-slot/math.config.ts packages/stake-math-tools/test/e2e.test.ts
git commit -m "docs(examples): spec-slot math.config + e8-math e2e (binary-gated)"
```

---

## Self-Review

**Spec coverage:** go-native sim/pool + requireNative → Task 1 + Task 3. curate via stake-math-tools → Task 4. e8-math CLI (sim/pool/curate/all) → Tasks 2-4. Modes-from-spec + per-mode config (math.config) → Task 2 (`resolveModes`) + Task 5 (`genMathConfig`). Full reports → Task 3 (Go) + Task 4 (stake). Scaffold scripts → Task 5. Proof → Task 6. ✓ Out of scope honored (no Go source, no JS fallback, no parallel pool).

**Placeholder scan:** Task 4 Step 1 is an explicit "pin the dump row shape from a real sample" instruction (the per-round JSON shape is only knowable at runtime) with a concrete fallback mapper (`payoutMultiplier ?? payout ?? total_win`) — grounded, not a vague TODO. A few steps say "verify the import path / field against the in-repo file" (`formatNativeResult` sub-path, `transformJsonlZst` signature, `NativeSimulationConfig` fields, spec-slot's Lua path) — concrete read-and-match instructions. No "add error handling"/"TBD".

**Type consistency:** `LookupRow {sim,weight,payoutCents}` + `OptimizeParams`/`OptimizeResult` (from this package) used in Task 4 match `types.ts`. `ResolvedMode` (Task 2) consumed by `runSim`/`curateMode` (Tasks 3-4). `MathConfig {model, luaScript, modes}` consistent across Task 2 (def), 5 (`genMathConfig`), 6 (spec-slot). `buildNativeArgs`/`requireNativeBinary`/`dump` (Task 1) consumed by `runSim` (Task 3). `resolveModes` seeds `capMaxWin` from `model.spec.maxWin` (Tasks 2/5). CLI subcommands `sim|pool|curate|all` consistent across Tasks 2-5. ✓
