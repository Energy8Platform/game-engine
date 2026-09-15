# Headless Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three commands an agent can run without a browser in hand — `e8 check`, `e8 spin`, `e8 shot` — each printing one JSON document to stdout with diagnostics of the panel's own type, plus a measured load-time budget in the e2e suite.

**Architecture:** Pure functions in `engine/ide/host/src/compute/{check,spin,shot}.ts` (`(input) → Promise<Result>`, never throw, diagnostics inside the result); the CLI (`engine/apps/cli/src/index.ts`) parses flags, calls one function, prints JSON, exits 0/1. `spin` composes `@energy8engine/session-dev` on a bare `Context`; `shot` boots `createIdeHost({ root: cwd })`, reads `previewUrl`, drives Chromium through a dynamically imported `playwright`.

**Tech Stack:** Node 22, cordis, `@energy8engine/session-dev`, `@energy8engine/spin-parser`, `playwright` (CLI dependency), Vitest, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-09-15-headless-loop-design.md`

## Global Constraints

- stdout = exactly one JSON document; stderr = progress/prose; exit `1` iff the result carries an `error` diagnostic (or the command could not run); `--quiet` silences stderr.
- `Diagnostic` from `@energy8engine/contracts`, `plugin: 'compute'` for the commands' own refusals; `session`'s diagnostics pass through unchanged.
- `spin`: `win` is a bet multiplier; `rtp = Σwin / n`; `hitRate = count(win > 0) / n`; `maxWin = max(win)`; `avgWin = Σwin / n` (same as rtp for a single-spin round — say so in the doc); `stages` = histogram of `result.stage`; `wins` = `{ p50, p90, p99 }` of the sorted `win` list (nearest-rank); `seed` echoed; `scriptSha256` from the first result; determinism: same `seed` + same `n` → identical `Σwin`.
- `shot`: waits for `#status` non-empty on the game page (readiness per spec §9); `loadMs` = `performance`-style wall clock from navigation start to that moment; `--spin` clicks `#spin` and waits for `#status` text to change; `--ide` screenshots the IDE root instead (needs `dist`; otherwise diagnostic).
- `playwright` is a dependency of `@energy8engine/e8` only; `ide-host` imports it dynamically and turns a missing module or browser into a `compute` diagnostic with fix `npx playwright install chromium`.
- Load budget `LOAD_BUDGET_MS`: measured (three runs, median × 3), the measurement recorded in the test's comment and the report.
- Every assertion with a mutation confirmed LANDED by before/after count on the ORIGINAL file.
- Playwright ALONE; `pgrep -fl e8-server | grep -v pantheon` before/after; no `e8-compose-*`, `engine/examples` = three shipped; no `.e8/` left in fixtures after a run.
- Shell zsh; no trailing `#`; nothing under `packages/`; prettier clean.

---

## File map

| Task | Files |
|---|---|
| 1 | `engine/ide/host/src/compute/check.ts`, `spin.ts`, `index.ts`; tests `tests/compute-check.test.ts`, `compute-spin.test.ts`; `engine/apps/cli/src/index.ts` (`check`, `spin`), `cli-smoke.test.ts` |
| 2 | `engine/ide/host/src/compute/shot.ts`; test `tests/compute-shot.test.ts` (fake playwright); `engine/apps/cli/{package.json,src/index.ts}` (`shot`, `playwright` dep); `cli-smoke.test.ts` (real Chromium PNG) |
| 3 | `engine/apps/web/tests/e2e/runtime.spec.ts` (budget), `headless.spec.ts` (new) |

---

### Task 1: `check` and `spin`

**Files:** create `engine/ide/host/src/compute/check.ts`, `spin.ts`, `index.ts` (re-exports); tests `engine/ide/host/tests/compute-check.test.ts`, `compute-spin.test.ts`; modify `engine/apps/cli/src/index.ts`, `engine/ide/host/tests/cli-smoke.test.ts`; `ide-host` `package.json` `exports` gains `./compute` if the CLI imports by subpath (measure how it imports `dev-game` today: `@energy8engine/ide-host/dev-game` — follow that).

**Interfaces:**
```ts
// check.ts
export interface CheckInput { file: string }          // absolute or cwd-relative path to a .spin
export interface CheckResult { file: string; diagnostics: Diagnostic[]; schema?: SpinSchema }
export function check(input: CheckInput): Promise<CheckResult>
// spin.ts
export interface SpinInput { cwd: string; n?: number; bet?: number; seed?: string; action?: string; binPath?: string; onProgress?: (done: number, n: number) => void }
export interface SpinReport { spins: number; bet: number; rtp: number; hitRate: number; maxWin: number; avgWin: number; stages: Record<string, number>; wins: { p50: number; p90: number; p99: number }; seed: string; scriptSha256: string | null; diagnostics: Diagnostic[] }
export function spin(input: SpinInput): Promise<SpinReport>
```

- [ ] **Step 1: Tests (red)**
  - `compute-check.test.ts`: `first-slot`'s `game/script.spin` → no `error` diagnostics, `schema.gameId === 'first-slot'`; a temp file with `record {` appended → at least one `error` with `at.line`; a missing path → one `compute` diagnostic (`where` = the path), no throw.
  - `compute-spin.test.ts` (real `e8-server`, the way `dev-game.test.ts` gets it): `spin({ cwd: <copy of first-slot>, n: 20, seed: 'abc' })` → `spins === 20`, `bet` = spec's first betLevel, `rtp >= 0`, `0 <= hitRate <= 1`, `maxWin >= every wins.p*`, `Object.values(stages)` sums to 20, `scriptSha256` a 64-hex string, `diagnostics` empty; a second call with the same seed → identical `rtp` and `stages`; a different seed → not asserted (may coincide). `binPath: '/nonexistent'` → `spins === 0`, one `session` diagnostic, no leaked process (`pgrep` count before/after). `n: 0` → `compute` diagnostic (`n must be ≥ 1`). Progress callback called with `(20, 20)` last.
  - `cli-smoke.test.ts`: `e8 check` in a copy of `first-slot` → stdout parses as JSON, `diagnostics` without `error`, exit 0; with a broken `.spin` → exit 1, JSON still on stdout; `e8 spin --n 5 --seed abc` → JSON `spins: 5`, exit 0; `e8 spin --n x` → exit 1 with a `compute` diagnostic.
- [ ] **Step 2: Implement** — `check`: `readFile` in try → diagnostic on failure; `parseSpinSchema`. `spin`: read `game/spec.json` for `gameId` (the `.spin`'s `game` declaration via `check` is the fallback when `spec.json` is absent — use the schema's `gameId`), `betLevels[0]` default; `const ctx = new Context(); session.apply(ctx, { gamesDir: join(cwd,'game'), port: 0, serverSeed: seed, binPath })` (the direct-call form `dev-game` uses; `serverSeed` must reach `startE8Server` — check `session-dev`'s config passes it; add if not, one line); if `ctx.session.startupDiagnostic` → report with it, dispose, return; loop `play({ gameId, action, betLevel })` collecting `win`/`stage`; on a rejected `play` → diagnostic + stop; percentiles nearest-rank on the sorted array; `await ctx.fiber.dispose()` in `finally`. CLI: `check [file]` (default `game/script.spin`), `spin [--n N] [--bet B] [--seed S] [--action A] [--quiet]`; a tiny flag parser (no dependency); JSON via `console.log(JSON.stringify(result, null, 2))`; exit code from diagnostics severity; progress to stderr every 10%.
- [ ] **Step 3: Mutations** (counts): `rtp` computed as `Σwin/(n·bet)` → the rtp test with bet 0.2 red; `hitRate` counts `win >= 0` → red; percentiles off-by-one → a crafted-wins unit test on a pure `percentiles()` helper (export it) red; determinism: drop `serverSeed` pass-through → red; missing-binary cleanup dropped → pgrep red; CLI exit code ignores diagnostics → red.
- [ ] **Step 4: Suites (`ide-host`, `e8` typecheck); commit** — "Give the agent a check and a spin"

---

### Task 2: `shot`

**Files:** create `engine/ide/host/src/compute/shot.ts`; test `engine/ide/host/tests/compute-shot.test.ts`; modify `engine/apps/cli/package.json` (`"playwright": "^1.49.0"` — same major as `@playwright/test` in `apps/web`; measure `npm ls @playwright/test` for the exact installed version and match it), `engine/apps/cli/src/index.ts` (`shot`), `cli-smoke.test.ts`.

**Interfaces:**
```ts
export interface ShotInput { cwd: string; out?: string; viewport?: { width: number; height: number }; spin?: boolean; ide?: boolean; budgetMs?: number; launch?: () => Promise<BrowserLike> }   // `launch` injected by tests; default: (await import('playwright')).chromium.launch()
export interface ShotResult { path: string | null; width: number; height: number; loadMs: number | null; diagnostics: Diagnostic[] }
export function shot(input: ShotInput): Promise<ShotResult>
```
`BrowserLike` = the minimal surface used: `newPage({ viewport })` → `{ goto, locator(sel).textContent/click, waitForFunction, screenshot({ path }), close }`, `browser.close()`.

- [ ] **Step 1: Tests (red)** — with a fake `launch` recording calls: boots a host over a `first-slot` copy (real host, `previewPort: 0`, `port: 0`), `goto` receives the `previewUrl`; readiness = the fake's `waitForFunction` resolving; `loadMs` a number; `screenshot` called with `out` (default under `<cwd>/.e8/shots/` with an ISO-ish name; the directory created); `--spin` → `click('#spin')` then a second wait; `--ide` → `goto(host.url)` and, with no `dist`, a `compute` diagnostic + no screenshot; `launch` rejecting (`Cannot find module 'playwright'`) → one `compute` diagnostic with fix `npx playwright install chromium`, host disposed (`pgrep`/port free); readiness timeout (fake never resolves; `budgetMs: 50`) → screenshot still taken, `loadMs: null`, one `warning`. Host always disposed (`finally`) — assert the port is free afterwards.
  - `cli-smoke.test.ts`: `e8 shot --out <tmp>/a.png --viewport 320x200` in a `first-slot` copy with REAL Chromium → file exists, first 8 bytes `89 50 4E 47 0D 0A 1A 0A`, stdout JSON `width: 320`, `loadMs` number ≤ 30000; skip with a clear message if `playwright`'s Chromium is not installed (`launch` throws `Executable doesn't exist`) — measure whether it is on this machine (the e2e suite uses it, so yes).
- [ ] **Step 2: Implement** — `createIdeHost({ root: cwd, port: 0, previewPort: 0 })`; `state().active === null` → diagnostic `not a project`; `previewUrl === null` → diagnostic (project has no game); `launch()` in try; page; `t0 = Date.now()`; `goto(url)`; `waitForFunction(() => document.querySelector('#status')?.textContent?.trim(), { timeout: budgetMs ?? 30000 })` → `loadMs`; on timeout → warning, continue; `--spin`: read `#status`, click `#spin`, wait for change (same timeout, warning on miss); `screenshot({ path })`; `finally`: page/browser close (each in try), `host.stop()`. `--ide`: `goto(host.url + '/')`; readiness = `[data-testid="activity-explorer"]` present; without `dist` the host answers 503 — detect by response status → diagnostic with the build hint, no screenshot. CLI: `shot [--out p] [--viewport WxH] [--spin] [--ide] [--budget ms] [--quiet]`.
- [ ] **Step 3: Mutations** (counts): `finally` host stop dropped → port test red; timeout warning path returns early without screenshot → red; `--spin` skips the click → red; `--ide` ignores 503 → red; CLI `--viewport` parse dropped → cli test red.
- [ ] **Step 4: Suites; `npm install` at the root once (new dependency — check the lockfile diff is only `playwright` + its `playwright-core`); commit** — "Give the agent eyes: e8 shot"

---

### Task 3: The budget, and the loop end to end

**Files:** `engine/apps/web/tests/e2e/runtime.spec.ts` (budget), new `engine/apps/web/tests/e2e/headless.spec.ts`.

- [ ] **Step 1: Measure** — run `runtime.spec.ts`'s first test three times recording `Date.now()` from `page.goto(host.gameUrl)` to `#status` non-empty (log it); median × 3 → `LOAD_BUDGET_MS` (round up to 500). Record the three numbers in the test's comment.
- [ ] **Step 2: Budget assertion** in `runtime.spec.ts`'s first test: `expect(loadMs, 'measured median … on …').toBeLessThanOrEqual(LOAD_BUDGET_MS)`; export `LOAD_BUDGET_MS` from `project-fixture.ts` so `headless.spec.ts` shares it.
- [ ] **Step 3: `headless.spec.ts`** (spawns the real CLI the way `cli-smoke` does, against a `projectCopy()`; no host of its own — the CLI boots one on port 0):
  1. `e8 spin --n 50 --seed e2e` → JSON `spins: 50`, `rtp` in `[0.2, 3]`, `hitRate` in `(0, 1]`, `Object.values(stages)` sums to 50; a second run with the same seed → same `rtp`.
  2. `e8 shot --spin --out <tmp>/shot.png` → PNG exists, `loadMs <= LOAD_BUDGET_MS`, `diagnostics` empty; the image is not blank (read the PNG bytes' length > 5 KB — a 480×288 all-black PNG is ~1 KB).
  3. `e8 check` → exit 0; after writing `record {` into the copy's `.spin`, `e8 check` → exit 1 and the same `at.line` the IDE's panel would show (compare with `POST /api/check` on a host? — no host here; assert `at.line === <the appended line number>`).
  Mutations: budget constant halved → test 2 red (if the measured median allows — else note); `spin` seed dropped → determinism red; `shot` PNG path ignored → red.
- [ ] **Step 4: Whole suite alone → 84 + 3 = 87/87; cleanup checks; commit** — "Close the loop: a budget, and three commands measured end to end"

---

## Self-review
- Spec §3 rows → T1 (check, spin, output rules), T2 (shot, playwright policy), T3 (budget, e2e). §4 refusal cases → T1/T2 tests. §5 → T1/T2 unit + cli-smoke, T3 e2e. §6 risks → T2 (browser missing = diagnostic), T3 (budget from measurement), T1 (progress on stderr).
- Types: `SpinReport`/`ShotResult` fields named once here and used by T3's JSON assertions verbatim.
