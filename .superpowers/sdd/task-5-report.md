# Task 5 Report: package scaffold + answers + prompts

## TDD RED/GREEN Evidence

### RED
Ran `npx vitest run packages/create-slot/test/answers.test.ts` before writing `src/answers.ts`.
Result: `Error: Failed to load url ../src/answers` — 0 tests ran, 1 file failed. Confirmed RED.

### GREEN
After writing `src/answers.ts`, `src/prompts.ts`, `src/index.ts`:
Result: `5 tests passed (5)` — all assertions in parseFlags / applyDefaults / validate green.

---

## Rollup Entry Choice

**Entry: `src/index.ts`** (re-exports answers + prompts).

Rationale: `src/cli.ts` doesn't exist yet (Task 9). Pointing rollup at `src/cli.ts` would fail the build. A tiny `src/index.ts` re-export lets the build run cleanly NOW and produces `dist/cli.js` with the `#!/usr/bin/env node` banner. Task 9 will replace the rollup input with `src/cli.ts` when it adds the CLI entry point.

Output: `dist/cli.js`, format `esm`, banner `#!/usr/bin/env node`, `node:*` externalized.

---

## npm install Result

`npm install` from repo root ran cleanly. Symlink confirmed:
`node_modules/@energy8platform/create-slot -> ../../packages/create-slot`

Note: `package-lock.json` is listed in `.gitignore` — cannot commit it per the brief's Step 7 instruction. The brief says to add it; however it's gitignored. Left it out.

---

## Files Created

- `packages/create-slot/package.json`
- `packages/create-slot/rollup.config.ts`
- `packages/create-slot/tsconfig.json`
- `packages/create-slot/vitest.config.ts`
- `packages/create-slot/src/answers.ts`
- `packages/create-slot/src/prompts.ts`
- `packages/create-slot/src/index.ts` (tiny re-export stub; replaced by cli.ts in Task 9)
- `packages/create-slot/test/answers.test.ts`

---

## Build / Typecheck / Test Summary

- `npm run typecheck --workspace @energy8platform/create-slot` → clean
- `npm run build --workspace @energy8platform/create-slot` → `dist/cli.js` created (245ms). One cosmetic warning from `@rollup/plugin-typescript` acting as the rollup config plugin (`Rollup 'sourcemap' option must be set`) — this is a known upstream issue when the plugin is used via `--configPlugin`; the actual bundle output is correct and sourcemapped.
- `npx vitest run packages/create-slot/test/answers.test.ts` → 5/5 passed

---

## Concerns

1. **package-lock.json is gitignored** — the brief says to commit it; it was left out.
2. **Cosmetic build warning** — `@rollup/plugin-typescript: Rollup 'sourcemap' option must be set` appears during build. This is a known quirk of using the TypeScript plugin as the `--configPlugin` transpiler; the dist output is correct.
3. **`dist/` not gitignored** — the dist output (`packages/create-slot/dist/`) is not staged; only source files are committed as expected.
4. **prompts.ts fix** — one line from the brief used `?? ... ||` without parens (TS5076 strictness). Fixed by splitting into two statements; semantics identical.
