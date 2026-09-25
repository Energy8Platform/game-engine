# Engine tween Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No `@energy8platform/game-engine` anywhere in `engine/` (outside the user's `paper-duel`): the one piece the engine uses — `Tween` + `Easing` — becomes `@energy8engine/tween`, and a guard test keeps the string out.

**Architecture:** A library package forked from the 0.44.1 workspace's `packages/game-engine/src/animation/{Tween,Easing}.ts`, API unchanged, so the three consumers (`reel-core`, `reels-features`, `flow-fx`) move by import path. The dead dependency leaves `game-runtime`, `first-slot`, `slot-basic`; the nested registry copies of 0.41.0 are purged; every textual mention is reworded; an `ide-host` test walks `engine/` and fails on the string.

**Tech Stack:** TypeScript, pixi.js v8 (`Ticker.shared`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-engine-tween-design.md`

## Global Constraints

- `packages/*` is not edited.
- No string `@energy8platform/game-engine` anywhere under `engine/` — code, package.json, comments, READMEs, tests — except `engine/examples/paper-duel` (the user's tree) and `node_modules`/`dist`. Fork provenance headers naming the PATH (`// Forked from packages/game-engine/src/…`) stay.
- Every change carries a test in its package.
- One workspace per test command; `@energy8engine/ide-host` ALONE. Playwright ALONE, `E8_E2E_HOST_PORT=5779`, from `engine/apps/web`.
- After adding a package or changing dependencies: `npm install` at the root; `package-lock.json` is gitignored.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`. Never `git stash`/`checkout`/`restore`.

## Review Focus

1. `flow-fx`'s `tween`/`count` nodes move from the registry 0.41.0 `Tween` to a fork of 0.44.1 — any behaviour difference between the two versions shows up here first. Pinned in Task 2 by running flow-fx's suite unchanged and diffing the two legacy `Tween.ts` versions in the report.
2. Two copies of `@energy8engine/tween` cannot exist (a nested copy under a consumer): every consumer declares `"*"`. Pinned in Task 2 by listing `engine/*/*/node_modules/@energy8engine/tween` (none).
3. `Tween.killTweensOf` resolves a pending `to` promise (the reels' skip depends on it). Pinned in Task 1.
4. The guard must not match itself nor miss a file type the string hides in (`.md`, `.yml`, `.json`, `.ts`, `.tsx`). Pinned in Task 3.
5. `reel-core`'s README note "build `packages/game-engine` first" becomes false once reel-core no longer imports it — removed in Task 3.

---

### Task 1: `@energy8engine/tween`

**Files:**
- Create: `engine/game/tween/{package.json,tsconfig.json,vitest.config.ts,README.md}` — modelled on `engine/game/reel-core` (a library: NO `e8` block); `exports` `{ ".": "./src/index.ts" }`; dependencies `pixi.js` (same range as reel-core) only.
- Create: `engine/game/tween/src/{Tween,Easing,index}.ts`
- Test: `engine/game/tween/tests/{Easing,Tween}.test.ts`

**Interfaces:**
- Produces: `Tween` (static `to`, `from`, `fromTo`, `delay`, `killTweensOf`, `killAll`, `activeTweens`, `reset` — the legacy signatures), `Easing`, `type EasingFunction = (t: number) => number`, `type TweenOptions` if `Tween.ts` uses it.

- [ ] **Step 1: Fork.** Copy `packages/game-engine/src/animation/Tween.ts` and `Easing.ts` (read from the workspace, 0.44.1). First line of each: `// Forked from packages/game-engine/src/animation/<file> (slice 37).` Replace `import type { EasingFunction } from '../types'` with a local export in `Easing.ts`: `export type EasingFunction = (t: number) => number;` (and `TweenOptions` copied from `packages/game-engine/src/types.ts` into `Tween.ts` if referenced). `src/index.ts` exports `Tween`, `Easing`, `EasingFunction` (+ `TweenOptions` if present). Nothing else changes.
- [ ] **Step 2: Tests.** Fork `packages/game-engine/tests/Easing.test.ts` (import `../src/Easing`). New `tests/Tween.test.ts`, driving `Ticker.shared` the way `engine/game/reel-core/tests/tumbleController.test.ts` drives it (read it; reuse the approach, calling `Tween.reset()` between tests):
  - `Tween.to(obj, { x: 10 }, 100)` → after the ticker advances ≥ 100 ms, `obj.x === 10` and the promise resolved;
  - `Tween.fromTo(obj, { x: 0 }, { x: 5 }, 50)` → first frame `obj.x` near 0, end 5;
  - `Tween.killTweensOf(obj)` mid-tween → the pending `to` promise resolves, `obj.x` stops changing, `activeTweens` drops by one;
  - `Tween.delay(60)` resolves only after 60 ms of ticker time;
  - `activeTweens` counts two concurrent tweens as 2, 0 after they end.
  Run `npm install` (root) then `npm test -w @energy8engine/tween` — PASS (forked code); prove each new test non-vacuous by a temporary break in `Tween.ts` (e.g. `killTweensOf` not resolving), restore exactly (`git diff` on the file empty — it is new, so compare with the legacy source).
- [ ] **Step 3:** `npm run typecheck -w @energy8engine/tween` — 0. README: two sentences — what it is (the engine's tween, forked from the legacy animation module), driven by pixi's `Ticker.shared`.
- [ ] **Step 4: Commit** — `Tween: the engine's own tween and easing, forked from the legacy animation module`.

---

### Task 2: move the consumers; drop the dead dependency

**Files:**
- Modify: every `from '@energy8platform/game-engine/animation'` in `engine/game/{reel-core,reels-features,flow-fx}/{src,tests}` → `from '@energy8engine/tween'`
- Modify: `engine/game/{reel-core,reels-features,flow-fx}/package.json` — `@energy8platform/game-engine` → `"@energy8engine/tween": "*"`
- Modify: `engine/game/runtime/package.json`, `engine/examples/first-slot/package.json`, `engine/templates/slot-basic/package.json` — remove the `@energy8platform/game-engine` dependency
- Modify: `engine/game/reel-core/src/anim/easing-map.ts` — if it defines its own `EasingFunction`, import it from `@energy8engine/tween` instead
- Modify: `engine/game/flow-fx/vitest.config.ts` comment (names the package)

**Interfaces:**
- Consumes: Task 1's `@energy8engine/tween`.

- [ ] **Step 1: Diff the versions.** `diff` the 0.41.0 registry copy's animation sources (`engine/game/flow-fx/node_modules/@energy8platform/game-engine/dist/…` or its `src` if shipped — find where `Tween` lives in that copy) against the 0.44.1 workspace `packages/game-engine/src/animation/Tween.ts`/`Easing.ts`; record every behavioural difference in the report (this is what `flow-fx` changes to).
- [ ] **Step 2: Edit** imports and package.json files as listed.
- [ ] **Step 3: Purge and reinstall.** Remove the `engine/*/*/node_modules/@energy8platform/game-engine` entries (everything except `engine/examples/paper-duel`'s) from the root `package-lock.json` (gitignored; edit it or delete those `packages` keys with a small `node -e` script), delete those nested directories, `npm install` at the root. Prove: `find engine -path '*/node_modules/@energy8platform/game-engine' -not -path '*/paper-duel/*'` prints nothing; `find engine -path '*/node_modules/@energy8engine/tween' -type d` prints nothing (all consumers resolve the workspace symlink).
- [ ] **Step 4: Gate:** tests + typecheck for `tween`, `reel-core`, `reels-features`, `flow-fx`, `game-runtime`, `reels`, `reels-motion`, `reels-cascade`, `symbols`; `first-slot`'s typecheck (`npm run typecheck -w e8-example-first-slot` or its workspace name); `ide-host` ALONE (template pins read package.json). All green, assertions unchanged.
- [ ] **Step 5: Commit** — `Engine: reels and flow-fx tween through @energy8engine/tween; the legacy engine dependency is gone`.

---

### Task 3: the words, and the guard

**Files:**
- Create: `engine/ide/host/tests/no-legacy-engine.test.ts`
- Modify: every remaining file under `engine/` (not `paper-duel`, `node_modules`, `dist`) that contains `@energy8platform/game-engine` — at planning time: `engine/core/contracts/src/presentation.ts`, `engine/game/mechanic-cascade/src/index.ts`, `engine/game/reel-core/README.md`, `engine/game/reels-features/README.md`, the fork files whose header or comments name the package, `engine/apps/web/tests/e2e/{composition,schema,tempo}.spec.ts`, `engine/ide/host/tests/template.test.ts`, and any others the guard finds

**Interfaces:**
- Consumes: Tasks 1–2.

- [ ] **Step 1: The guard (failing).**

```ts
/**
 * The engine does not depend on — or mention — the legacy game engine
 * package (slice 37). What it needed became `@energy8engine/*` packages; a
 * mention is how a dependency creeps back. The user's `paper-duel` tree is
 * theirs to move, and is skipped.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENGINE = join(__dirname, '..', '..', '..');
// Built from parts, so this file does not match itself.
const NEEDLE = ['@energy8platform', 'game-engine'].join('/');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vite', 'test-results', 'playwright-report']);
const SKIP_PATHS = [join(ENGINE, 'examples', 'paper-duel')];
const EXTENSIONS = /\.(ts|tsx|js|mjs|json|md|yml|yaml|html)$/;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (SKIP_PATHS.includes(path)) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path, out);
    } else if (EXTENSIONS.test(name) && readFileSync(path, 'utf8').includes(NEEDLE)) {
      out.push(relative(ENGINE, path));
    }
  }
  return out;
}

describe('no legacy engine in the engine', () => {
  it('no file under engine/ names the legacy game engine package', () => {
    expect(walk(ENGINE, [])).toEqual([]);
  });
});
```

(Check `ENGINE` resolves to the repo's `engine/` from `engine/ide/host/tests`; adjust the `..` count if not. If `ide-host` tests use ESM without `__dirname`, derive it from `import.meta.url` the way sibling tests do.) Run `npm test -w @energy8engine/ide-host` ALONE — Expected: FAIL listing the remaining files.
- [ ] **Step 2: Reword each listed file.** Code comments name the engine's own pieces (`@energy8engine/reel-core`'s `SymbolCell` / `TumbleController`, `@energy8engine/tween`) or "the legacy engine" without the package name; READMEs drop the "build `packages/game-engine` first" note (reel-core no longer imports it); e2e specs and `template.test.ts` comments reworded; fork headers keep their `packages/game-engine/src/…` path.
- [ ] **Step 3:** `ide-host` ALONE — the guard PASSES and every other test is green. Typecheck `ide-web` (e2e specs edited), `contracts`, `mechanic-cascade`.
- [ ] **Step 4: Commit** — `Engine: no file names the legacy game engine; a guard keeps it that way`.
