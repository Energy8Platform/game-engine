# Module copies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The engine says so when a project ends up with a second copy of a stateful module: a runtime marker for `@energy8engine/tween`/`reel-core` checked at boot, and a host check for `pixi.js`/`cordis` and the legacy engine.

**Spec:** `docs/superpowers/specs/2026-09-25-module-copies-design.md`

## Global Constraints

- `packages/*` not edited; no `@energy8platform/game-engine` literal under `engine/` except where the host check must name it — build it from parts there (the ide-host guard `no-legacy-engine.test.ts` scans engine/).
- Every change carries a test in its package; one workspace per test command; `ide-host` ALONE.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, the paper-duel note. Never `git stash`/`checkout`/`restore`.

## Review Focus

1. The marker map must survive a duplicated `contracts` (or helper) — `Symbol.for` on `globalThis`, not a module-level variable. Pinned in Task 1.
2. A hot re-apply / second `createGame` on the same page (the editor page composes twice) must not report a false duplicate: the same URL twice is one copy. Pinned in Task 1.
3. The host check must stay quiet for the example and template as they are (no false warnings in the IDE). Pinned in Task 2 (run on the real first-slot).
4. A project without `plugins/` or without `node_modules` → no error, no warning. Pinned in Task 2.

---

### Task 1: the runtime marker and the boot warning

**Files:** `engine/core/contracts/src/module-copies.ts` (+ export) — or per-package copies of the helper if a dependency cycle forbids it (say which); `engine/game/tween/src/index.ts`, `engine/game/reel-core/src/index.ts` (top-level mark); `engine/game/runtime/src/index.ts` (read after compose, push the warning); tests in each package.

- [ ] TDD: tests first (spec §3 runtime bullets), red, then implement per spec §1 exactly (message and fix text verbatim).
- [ ] Gate: contracts, tween, reel-core, reels-features, game-runtime tests + typecheck.
- [ ] Commit — `Engine: a second copy of a stateful engine module is reported at boot`.

### Task 2: the host check

**Files:** `engine/ide/host/src/plugins/project.ts` (a `moduleCopies(cwd, composition)` beside `tumblePair`, appended to the composition diagnostics); a test file in `engine/ide/host/tests/` with tmp fixture dirs.

- [ ] TDD: fixtures per spec §3 host bullets, red, then implement per spec §2 (messages verbatim; the legacy name built from parts).
- [ ] Prove quiet on the real example: the check over `engine/examples/first-slot` yields no warning.
- [ ] Gate: `ide-host` ALONE + typecheck.
- [ ] Commit — `Host: a project resolving its own pixi.js or cordis, or the legacy engine, is told so`.
