import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { curateModes } from '../src/pipeline/curate';
import type { ResolvedMode } from '../src/mathConfig';

/**
 * Modes are independent from `pool` onward, so the curate stage runs them with
 * bounded concurrency (`--jobs`). Whatever the job count, the artifacts and the
 * order of the returned reports must not change — the reports are printed
 * per mode and the CSVs are published.
 */

const CAP_X = 5000;

function roundLine(roundIdx: number, winX: number): string {
  return JSON.stringify({
    round_idx: roundIdx, worker_idx: 0, action: 'spin', bet: 1,
    cost_multiplier: 1, round_cost: 1, total_win: winX, total_win_x: winX,
    spins: [{ spin_idx: 0, stage: 'base_game', nonce: 1, win: winX, win_x: winX, data: {} }],
  });
}

function makeFixture(seed: number): string {
  const lines: string[] = [];
  let r = 0;
  for (let i = 0; i < 60; i++) lines.push(roundLine(r++, 0));
  for (let i = 0; i < 30; i++) lines.push(roundLine(r++, 1 + ((i + seed) % 5)));
  for (let i = 0; i < 9; i++) lines.push(roundLine(r++, 20 + i));
  lines.push(roundLine(r++, 4900));
  return lines.join('\n') + '\n';
}

function makeMode(name: string): ResolvedMode {
  return {
    mode: name, action: 'spin', costMultiplier: 1,
    sim: { iterations: 100, bet: 1, rng: 'provably-fair' },
    curate: {
      capMaxWin: CAP_X * 100, costMultiplier: 1, nRowsOut: 30,
      targetRTP: 0.5, toleranceRTP: 1.0, targetCV: 5, toleranceCV: 100,
      targetHitRate: 0.3, toleranceHitRate: 0.5, algorithm: 'tiered', requireMaxReached: false,
    },
  };
}

const MODES = ['BASE', 'BONUS', 'SUPER'].map(makeMode);

let dir: string, poolDir: string, outDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'e8-modes-'));
  poolDir = join(dir, 'pool');
  outDir = join(dir, 'out');
  mkdirSync(poolDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  MODES.forEach((m, i) => writeFileSync(join(poolDir, `books_${m.mode}.jsonl`), makeFixture(i)));
});

afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

describe('curateModes', () => {
  it('curates every mode and returns the reports in config order', async () => {
    const results = await curateModes(MODES, { poolDir, outDir, jobs: 3 });

    expect(results.map((r) => r.mode)).toEqual(['BASE', 'BONUS', 'SUPER']);
    for (const m of MODES) {
      expect(existsSync(join(outDir, `lookUpTable_${m.mode}_0.csv`))).toBe(true);
    }
  });

  it('produces the same artifacts at jobs=3 as at jobs=1', async () => {
    const sequential = await curateModes(MODES, { poolDir, outDir, jobs: 1 });
    const seqCsv = MODES.map((m) =>
      readFileSync(join(outDir, `lookUpTable_${m.mode}_0.csv`), 'utf-8'));

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    const parallel = await curateModes(MODES, { poolDir, outDir, jobs: 3 });
    const parCsv = MODES.map((m) =>
      readFileSync(join(outDir, `lookUpTable_${m.mode}_0.csv`), 'utf-8'));

    expect(parCsv).toEqual(seqCsv);
    expect(parallel.map((r) => r.result.rows.length)).toEqual(sequential.map((r) => r.result.rows.length));
  });

  it('keeps one index.json entry per mode when modes finish out of order', async () => {
    await curateModes(MODES, { poolDir, outDir, jobs: 3 });
    const idx = JSON.parse(readFileSync(join(outDir, 'index.json'), 'utf-8')) as {
      modes: { name: string }[];
    };
    expect(idx.modes.map((m) => m.name).sort()).toEqual(['BASE', 'BONUS', 'SUPER']);
  });
});
