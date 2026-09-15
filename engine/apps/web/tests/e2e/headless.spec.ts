/**
 * The headless loop, end to end: the real `e8` binary (`engine/apps/cli
 * /bin/e8.mjs`, the way a shell invokes it), against a real project, from
 * a process that is not the IDE. No host of its own — `spin` starts an
 * `e8-server` and `shot` boots the same host `e8 dev` does, both on port
 * 0, and both take them down with the process.
 *
 * What the unit tests and `cli-smoke` do not cover is the JOIN: the
 * numbers a person would read in the math panel, the picture a person
 * would see in the preview, and the verdict the schema panel would give —
 * each from the same project, and each within the budget `runtime.spec.ts`
 * measured (`LOAD_BUDGET_MS`). The project is a `projectCopy()` — the
 * copy lands beside `first-slot` for the reasons `project-fixture.ts`
 * argues — so `check`'s edit and `shot`'s PNG never touch the checked-in
 * example, and the copy is removed in `finally`.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { LOAD_BUDGET_MS, projectCopy } from './project-fixture';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', '..', 'cli', 'bin', 'e8.mjs');

/** Runs `e8 <args>` in `cwd` to completion; stdout is the one JSON document (spec §3's output rule). */
async function e8(args: string[], cwd: string) {
  return new Promise<{ json: any; stderr: string; exit: number | null }>((resolve) => {
    const c = spawn(process.execPath, [CLI_BIN, ...args], {
      cwd,
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => (stdout += d));
    c.stderr.on('data', (d) => (stderr += d));
    c.once('exit', (exit) => resolve({ json: JSON.parse(stdout), stderr, exit }));
  });
}

let dir: string;
test.beforeAll(() => {
  dir = projectCopy();
});
test.afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('`e8 spin --n 50` reports the numbers the math panel would, and the same seed gives the same numbers', async () => {
  const first = await e8(['spin', '--n', '50', '--seed', 'e2e'], dir);
  expect(first.exit, first.stderr).toBe(0);
  const report = first.json;
  expect(report.diagnostics).toEqual([]);
  expect(report.spins).toBe(50);
  // Sanity bounds on the fixture's math (spec §5: 0.2–3), not a claim
  // about its exact RTP — that is what `e8 simulate` will be for. Fifty
  // spins is noisy (measured: seed `e2e` → 0.34, seed `other` → 0.12), so
  // the bound holds for THIS seed because the run is deterministic.
  expect(report.rtp).toBeGreaterThanOrEqual(0.2);
  expect(report.rtp).toBeLessThanOrEqual(3);
  expect(report.hitRate).toBeGreaterThan(0);
  expect(report.hitRate).toBeLessThanOrEqual(1);
  // Every spin landed in exactly one stage.
  expect(
    Object.values<number>(report.stages).reduce((a, b) => a + b, 0),
    JSON.stringify(report.stages),
  ).toBe(50);
  expect(report.seed).toBe('e2e');

  // Determinism: `serverSeed` reaches the process, so the same seed is
  // the same fifty rounds — not fifty rounds that happen to average the same.
  const second = await e8(['spin', '--n', '50', '--seed', 'e2e'], dir);
  expect(second.exit, second.stderr).toBe(0);
  expect(second.json.rtp).toBe(report.rtp);
  expect(second.json.stages).toEqual(report.stages);
  expect(second.json.wins).toEqual(report.wins);

  // And the seed is the CLI's, not a constant of the process: `session-dev`
  // falls back to a fixed `serverSeed` of its own when none is passed, so
  // "same seed, same numbers" alone would also pass with the flag dropped.
  const other = await e8(['spin', '--n', '50', '--seed', 'other'], dir);
  expect(other.exit, other.stderr).toBe(0);
  expect(other.json.seed).toBe('other');
  expect(other.json.rtp).not.toBe(report.rtp);
});

test('`e8 shot --spin` writes a picture of a played game, within the load budget', async () => {
  const out = join(dir, 'shot.png');
  const r = await e8(['shot', '--spin', '--out', out], dir);
  expect(r.exit, r.stderr).toBe(0);
  expect(r.json.diagnostics).toEqual([]);
  expect(r.json.path).toBe(out);
  expect(r.json.width).toBe(480);
  expect(r.json.height).toBe(288);
  expect(
    r.json.loadMs,
    `shot loadMs ${r.json.loadMs}; budget ${LOAD_BUDGET_MS} — see LOAD_BUDGET_MS`,
  ).toBeLessThanOrEqual(LOAD_BUDGET_MS);

  const png = readFileSync(out);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // Not blank. Measured on 2026-09-16: a 480×288 single-colour PNG from the
  // same Chromium is 1071 bytes (black) / 1074 (white); a shot of this
  // game after a spin is ~10.9 KB. 5 KB sits between the two with room.
  expect(png.length, `${png.length} bytes — a blank 480×288 PNG is ~1 KB`).toBeGreaterThan(5000);
});

test("`e8 check` gives the panel's verdict: clean, then an error and a line after one edit", async () => {
  const ok = await e8(['check'], dir);
  expect(ok.exit, ok.stderr).toBe(0);
  expect(ok.json.diagnostics).toEqual([]);

  // One severity rule, shared with the IDE's panel (`compute/check.ts`):
  // a parse loss is a WARNING, an action naming an undeclared stage an
  // ERROR. So exit 1 needs the action, and the parse warning is the one
  // that carries `at.line` — both appended, the unterminated `record {`
  // last so its block runs to EOF.
  const file = join(dir, 'game', 'script.spin');
  const lines = readFileSync(file, 'utf8').split('\n').length; // trailing newline → last index is empty
  appendFileSync(file, 'action bonus {\n  stage = free_spins\n  cost = 1.0\n}\nrecord {\n');
  const recordLine = lines + 4;

  const bad = await e8(['check'], dir);
  expect(bad.exit).toBe(1);
  expect(bad.json.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('free_spins'),
      }),
      expect.objectContaining({ severity: 'warning', at: { line: recordLine } }),
    ]),
  );
});
